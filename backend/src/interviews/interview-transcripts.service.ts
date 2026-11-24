import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AiRunStatus, AiRunType, Prisma, TranscriptMaterialSource } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { AuthorizationService } from '../auth/authorization.service.js';
import {
  MINUTES_SOURCE,
  MinutesSourceError,
  parseMinutesLink,
  type MinutesCapability,
  type MinutesMaterial,
  type MinutesSource,
} from '../dingtalk/dingtalk-minutes.client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TimelineService } from '../timeline/timeline.service.js';
import { buildInterviewEvalInput } from './interview-eval.contract.js';

/** 单条素材上限与听记客户端保持一致，避免人工录入绕过限制 */
const MAX_MATERIAL_CHARS = 2_000_000;

type Input = Record<string, unknown>;
const record = (value: unknown): Input => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('请求格式无效');
  }
  return value as Input;
};
const optionalText = (value: unknown, name: string): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new BadRequestException(`${name}必须为文本`);
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_MATERIAL_CHARS) throw new BadRequestException(`${name}超出上限`);
  return trimmed;
};

@Injectable()
export class InterviewTranscriptsService {
  constructor(
    private readonly db: PrismaService,
    private readonly auth: AuthorizationService,
    private readonly timeline: TimelineService,
    @Inject(MINUTES_SOURCE) private readonly minutes: MinutesSource,
  ) {}

  /** 租户能力探测：只报告状态与错误码，不返回任何素材内容 */
  async capability(actor: AuthenticatedUser): Promise<MinutesCapability & { manualEntryAvailable: true }> {
    this.auth.scopesFor(actor, 'candidate:read');
    return { ...(await this.minutes.capability()), manualEntryAvailable: true };
  }

  async list(interviewId: string, linkId: string, actor: AuthenticatedUser) {
    const interview = await this.readable(interviewId, actor);
    const link = await this.link(interviewId, linkId);
    const materials = await this.db.interviewTranscriptMaterial.findMany({
      where: { linkId: link.id },
      orderBy: { fetchedAt: 'asc' },
    });
    return {
      link: this.linkDto(link),
      interview: { id: interview.id, round: interview.round },
      materials: materials.map((row) => this.materialDto(row)),
    };
  }

  /**
   * 读取听记原文/摘要。
   *
   * 钉钉侧由部署机的服务账号统一授权，ATS 侧只做数据范围校验；操作者仅作为审计归属记录，
   * 不要求绑定钉钉身份。越权、未开通与失败分别给出显式错误码。
   */
  async fetchMaterial(interviewId: string, linkId: string, actor: AuthenticatedUser) {
    const interview = await this.readable(interviewId, actor);
    const link = await this.link(interviewId, linkId);
    const minutesId = link.minutesId ?? parseMinutesLink(link.url)?.minutesId ?? null;
    if (!minutesId) {
      throw new BadRequestException('该链接不是可读取的钉钉听记地址，请粘贴原文或摘要');
    }

    let material: MinutesMaterial;
    try {
      material = await this.minutes.fetch(minutesId, actor.id);
    } catch (error) {
      throw await this.fail(interview.id, link.id, actor.id, error);
    }

    const hash = this.contentHash(material);
    const existing = await this.db.interviewTranscriptMaterial.findUnique({
      where: { linkId_contentHash: { linkId: link.id, contentHash: hash } },
    });
    if (existing) {
      await this.backfillLink(link.id, minutesId);
      return { material: this.materialDto(existing), deduplicated: true };
    }

    let created;
    try {
      created = await this.db.interviewTranscriptMaterial.create({
        data: {
          linkId: link.id,
          interviewId: interview.id,
          candidateId: interview.candidateId,
          jobId: interview.jobId,
          round: interview.round,
          source: TranscriptMaterialSource.DINGTALK,
          minutesId,
          title: material.title,
          summary: material.summary,
          originalText: material.originalText,
          segments: material.segments as unknown as Prisma.InputJsonValue,
          contentHash: hash,
          sourceRef: `dingtalk-minutes:${minutesId}#${hash.slice(0, 12)}`,
          fetchedBy: actor.id,
        },
      });
    } catch (error) {
      // 并发读取同一素材：唯一约束保证只有一条，另一路按已有素材返回
      if (this.uniqueViolation(error)) {
        const row = await this.db.interviewTranscriptMaterial.findUniqueOrThrow({
          where: { linkId_contentHash: { linkId: link.id, contentHash: hash } },
        });
        return { material: this.materialDto(row), deduplicated: true };
      }
      throw error;
    }

    await this.backfillLink(link.id, minutesId);
    await this.record(interview.id, 'interview.transcript.material_fetched', actor.id, {
      linkId: link.id,
      materialId: created.id,
      minutesId,
      chars: (material.originalText ?? material.summary ?? '').length,
      hash: hash.slice(0, 12),
      // 逐字稿未取到但摘要可读时如实标注部分成功，避免下游当成完整转写
      transcriptUnavailable: material.transcriptUnavailable ?? null,
    });
    return { material: this.materialDto(created), deduplicated: false };
  }

  /** 听记读取不可用或越权时的人工录入降级（DT-4 失败策略） */
  async addManualMaterial(interviewId: string, linkId: string, value: unknown, actor: AuthenticatedUser) {
    const interview = await this.readable(interviewId, actor);
    if (!(await this.auth.canAccessCandidate(actor, 'candidate:stage:update', interview.candidateId))) {
      throw new ForbiddenException('当前角色无权录入面试素材');
    }
    const link = await this.link(interviewId, linkId);
    const input = record(value);
    const summary = optionalText(input.summary, '摘要');
    const originalText = optionalText(input.originalText, '转写原文');
    const title = optionalText(input.title, '标题');
    if (!summary && !originalText) throw new BadRequestException('摘要与转写原文至少填写一项');

    const hash = this.contentHash({ minutesId: '', title, summary, originalText, segments: [] });
    const existing = await this.db.interviewTranscriptMaterial.findUnique({
      where: { linkId_contentHash: { linkId: link.id, contentHash: hash } },
    });
    if (existing) return { material: this.materialDto(existing), deduplicated: true };

    const created = await this.db.interviewTranscriptMaterial.create({
      data: {
        linkId: link.id,
        interviewId: interview.id,
        candidateId: interview.candidateId,
        jobId: interview.jobId,
        round: interview.round,
        source: TranscriptMaterialSource.MANUAL_ENTRY,
        minutesId: link.minutesId,
        title,
        summary,
        originalText,
        segments: [] as unknown as Prisma.InputJsonValue,
        contentHash: hash,
        sourceRef: `manual-entry:${link.id}#${hash.slice(0, 12)}`,
        fetchedBy: actor.id,
      },
    });
    await this.record(interview.id, 'interview.transcript.material_entered', actor.id, {
      linkId: link.id,
      materialId: created.id,
      chars: (originalText ?? summary ?? '').length,
    });
    return { material: this.materialDto(created), deduplicated: false };
  }

  /** 把素材按统一 INTERVIEW_EVAL 契约交付，生成待执行的 AI 草稿任务（ATS-021 执行模型） */
  async deliverToInterviewEval(
    interviewId: string,
    linkId: string,
    value: unknown,
    actor: AuthenticatedUser,
  ) {
    const interview = await this.readable(interviewId, actor);
    const link = await this.link(interviewId, linkId);
    const input = record(value ?? {});
    const materialId = typeof input.materialId === 'string' ? input.materialId.trim() : '';
    const material = materialId
      ? await this.db.interviewTranscriptMaterial.findFirst({ where: { id: materialId, linkId: link.id } })
      : await this.db.interviewTranscriptMaterial.findFirst({
          where: { linkId: link.id },
          orderBy: { fetchedAt: 'desc' },
        });
    if (!material) throw new BadRequestException('请先读取或录入听记素材');
    if (!material.originalText && !material.summary) throw new BadRequestException('听记素材为空，无法发起评估');

    const job = await this.db.job.findUnique({ where: { id: interview.jobId }, select: { requirements: true } });
    if (!job?.requirements?.trim()) {
      throw new BadRequestException('职位未填写招聘要求，无法发起面试评估（AI-5）');
    }
    const feedback = await this.db.interviewFeedback.findMany({
      where: { interviewId: interview.id },
      orderBy: { createdAt: 'asc' },
      select: { interviewerId: true, conclusion: true, content: true },
    });
    const segments = Array.isArray(material.segments) ? material.segments : [];
    const payload = buildInterviewEvalInput({
      interview: {
        id: interview.id,
        candidateId: interview.candidateId,
        jobId: interview.jobId,
        round: interview.round,
        mode: interview.mode,
        startAt: interview.time.toISOString(),
        endAt: interview.endTime?.toISOString() ?? null,
        interviewerIds: (interview.interviewerIds ?? '').split('|').filter(Boolean),
      },
      requirements: job.requirements,
      feedback,
      material: {
        id: material.id,
        linkId: material.linkId,
        minutesId: material.minutesId,
        source: material.source,
        sourceRef: material.sourceRef,
        title: material.title,
        fetchedAt: material.fetchedAt,
        summary: material.summary,
        originalText: material.originalText,
        contentHash: material.contentHash,
        segmentCount: segments.length,
      },
    });

    const run = await this.db.aIRun.create({
      data: {
        type: AiRunType.INTERVIEW_EVAL,
        status: AiRunStatus.PENDING,
        isDraft: true,
        interviewId: interview.id,
        inputRefs: JSON.stringify(payload),
      },
    });
    await this.record(interview.id, 'interview.ai_run_requested', actor.id, {
      airRunId: run.id,
      materialId: material.id,
      linkId: link.id,
      scenario: 'INTERVIEW_EVAL',
    });
    return {
      airRun: { id: run.id, type: run.type, status: run.status, isDraft: run.isDraft, createdAt: run.createdAt },
      input: payload,
    };
  }

  async evalRuns(interviewId: string, actor: AuthenticatedUser) {
    const interview = await this.readable(interviewId, actor);
    const runs = await this.db.aIRun.findMany({
      where: { interviewId: interview.id, type: AiRunType.INTERVIEW_EVAL },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return runs.map((run) => ({
      id: run.id,
      type: run.type,
      status: run.status,
      isDraft: run.isDraft,
      errorCode: run.errorCode,
      createdAt: run.createdAt,
      inputRefs: run.inputRefs,
      output: run.output,
    }));
  }

  private async readable(interviewId: string, actor: AuthenticatedUser) {
    const interview = await this.db.interview.findUnique({ where: { id: interviewId } });
    if (!interview || !(await this.auth.canAccessCandidate(actor, 'candidate:read', interview.candidateId))) {
      throw new NotFoundException('面试不存在');
    }
    return interview;
  }

  private async link(interviewId: string, linkId: string) {
    const link = await this.db.interviewTranscriptLink.findUnique({ where: { id: linkId } });
    if (!link || link.interviewId !== interviewId) throw new NotFoundException('听记链接不存在');
    return link;
  }

  private async backfillLink(linkId: string, minutesId: string) {
    // 只补齐解析结果，不覆盖链接地址与既有来源关联
    await this.db.interviewTranscriptLink.updateMany({
      where: { id: linkId, minutesId: null },
      data: { minutesId, source: 'DINGTALK' },
    });
  }

  private async fail(interviewId: string, linkId: string, actorId: string, error: unknown) {
    if (!(error instanceof MinutesSourceError)) {
      return new ServiceUnavailableException('听记读取失败，请稍后重试或人工录入');
    }
    await this.record(interviewId, 'interview.transcript.material_failed', actorId, {
      linkId,
      code: error.code,
      kind: error.kind,
    });
    switch (error.kind) {
      case 'DENIED':
        return new ForbiddenException('听记读取越权被拒绝');
      case 'NOT_FOUND':
        return new NotFoundException('听记不存在或已删除');
      case 'UNSUPPORTED':
        return new ServiceUnavailableException('当前租户未开通听记读取能力，请粘贴原文或摘要');
      default:
        return new ServiceUnavailableException('听记读取失败，请稍后重试或人工录入');
    }
  }

  private async record(interviewId: string, action: string, actorId: string, payload: Prisma.InputJsonValue) {
    try {
      await this.timeline.record({ entityType: 'Interview', entityId: interviewId, action, actorId, payload });
    } catch {
      // 操作记录失败不影响听记读取结果
    }
  }

  private contentHash(material: {
    minutesId: string;
    title: string | null;
    summary: string | null;
    originalText: string | null;
    segments: { index: number; speaker: string | null; text: string }[];
  }) {
    const normalized = [
      material.minutesId,
      material.title ?? '',
      material.summary ?? '',
      material.originalText ?? '',
      material.segments.map((item) => `${item.index}:${item.speaker ?? ''}:${item.text}`).join('\n'),
    ].join('\n');
    return createHash('sha256').update(normalized).digest('hex');
  }

  private uniqueViolation(error: unknown) {
    return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code: unknown }).code === 'P2002');
  }

  private linkDto(link: { id: string; url: string; round: number; source: string; minutesId: string | null; createdAt: Date }) {
    return {
      id: link.id,
      url: link.url,
      round: link.round,
      source: link.source,
      minutesId: link.minutesId,
      createdAt: link.createdAt,
    };
  }

  private materialDto(row: {
    id: string;
    linkId: string;
    interviewId: string;
    round: number;
    source: string;
    minutesId: string | null;
    title: string | null;
    summary: string | null;
    originalText: string | null;
    segments: Prisma.JsonValue;
    contentHash: string;
    sourceRef: string;
    fetchedBy: string;
    fetchedAt: Date;
  }) {
    return {
      id: row.id,
      linkId: row.linkId,
      interviewId: row.interviewId,
      round: row.round,
      source: row.source,
      minutesId: row.minutesId,
      title: row.title,
      summary: row.summary,
      originalText: row.originalText,
      segments: Array.isArray(row.segments) ? row.segments : [],
      contentHash: row.contentHash,
      sourceRef: row.sourceRef,
      fetchedBy: row.fetchedBy,
      fetchedAt: row.fetchedAt,
    };
  }
}

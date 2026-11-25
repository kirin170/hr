import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AiRunStatus,
  AiRunType,
  CandidateStage,
  DataScope,
  IntakeStatus,
  JobStatus,
  PoolType,
  SensitiveField,
} from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import type { MockOutcome } from '../ai/ai.types.js';
import { ParseQueueService } from '../ai/parse.queue.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthorizationService } from '../auth/authorization.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { expiryFor, loadRetentionPolicy } from '../retention/retention.config.js';
import { StorageService } from '../storage/storage.service.js';
import { buildResumeStorageKey } from '../storage/storage.types.js';
import {
  resumeMaxBytes,
  validateUpload,
  type UploadValidationResult,
} from '../storage/upload-validation.js';
import { TimelineService } from '../timeline/timeline.service.js';
import { normalizeEmail, normalizePhone } from './dedup.util.js';
import {
  ALLOWED_ENTRY_MODES,
  ALLOWED_RESUME_EXTENSIONS,
  ALLOWED_SOURCES,
  ENTRY_MODE,
  INTAKE_SOURCE,
} from './intake.constants.js';
import {
  EXCEL_ENTRY_MODE,
  EXCEL_ERROR,
  EXCEL_MAX_ROWS,
  ExcelImportError,
  buildExcelTemplate,
  buildFailedRowsWorkbook,
  parseExcelRows,
  validateExcelRow,
  type ExcelRawRow,
  type FailedRowExport,
} from './intake-excel.js';

export interface UploadedResumeFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface UploadIntakeBody extends SourceInputBody {
  jobId?: string;
  intentId?: string;
  source?: string;
  entryMode?: string;
  mockOutcome?: MockOutcome;
  actorId?: string;
}

export interface ManualIntakeBody extends SourceInputBody {
  name?: string;
  phone?: string;
  email?: string;
  jobId?: string;
  intentId?: string;
  source?: string;
  actorId?: string;
}

/** 来源记录：推荐人/来源标识随简历入场或由 HR 维护（FR-REF-1～3） */
export interface SourceInputBody {
  referrerName?: string;
  referrerContact?: string;
  referralCode?: string;
  sourceNote?: string;
}

export interface SourceRecordQuery {
  source?: string;
  referrer?: string;
  candidateId?: string;
  jobId?: string;
  createdFrom?: string;
  createdTo?: string;
  page?: number;
  pageSize?: number;
}

export interface CampusApplyBody extends SourceInputBody {
  name?: string;
  phone?: string;
  email?: string;
  jobId?: string;
  school?: string;
  major?: string;
  graduationYear?: string;
  expectedCity?: string;
  availableFrom?: string;
  desiredPositions?: string | string[];
  remark?: string;
}

export interface CampusApplicationQuery {
  status?: string;
  jobId?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
}

export interface CampusApplyResult {
  applicationId: string;
  status: string;
  jobIsVirtual: boolean;
  message: string;
}

type SourceFields = {
  referrerName: string | null;
  referrerContact: string | null;
  referralCode: string | null;
  sourceNote: string | null;
};

export interface EmailAttachmentBody {
  fileName?: string;
  mimeType?: string;
  contentBase64?: string;
}

export interface EmailIntakeBody {
  mailboxAddress?: string;
  from?: string;
  subject?: string;
  receivedAt?: string;
  jobId?: string;
  mockOutcome?: MockOutcome;
  attachments?: EmailAttachmentBody[];
  actorId?: string;
}

/** 已解码的邮件附件；Mock 接口与真实 IMAP 轮询共用同一条入库链路（ATS-022） */
export interface EmailAttachmentFile {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}

export interface IntakeResult {
  intakeId: string;
  candidateId: string | null;
  airRunId: string | null;
  status: IntakeStatus;
  duplicate: boolean;
  parseQueued: boolean;
  /** 上传校验或解析失败时的明确错误码（NFR-11） */
  errorCode?: string | null;
  errorMessage?: string | null;
  /** 查重命中时命中的维度（ATS-010：平台 ID / 附件哈希 / 联系方式） */
  duplicateDimensions?: DuplicateDimension[];
}

/** 浏览器导入查重维度 */
export const DUPLICATE_DIMENSION = {
  PLATFORM_ID: 'PLATFORM_ID',
  FILE_HASH: 'FILE_HASH',
  CONTACT: 'CONTACT',
} as const;

export type DuplicateDimension =
  (typeof DUPLICATE_DIMENSION)[keyof typeof DUPLICATE_DIMENSION];

export interface IntakeListQuery {
  status?: string;
  entryMode?: string;
  source?: string;
  jobId?: string;
  mailbox?: string;
  createdFrom?: string;
  createdTo?: string;
  receivedFrom?: string;
  receivedTo?: string;
  page?: number;
  pageSize?: number;
  limit?: number;
}

export interface IntakeMonitorQuery {
  jobId?: string;
  mailbox?: string;
  entryMode?: string;
  source?: string;
  receivedFrom?: string;
  receivedTo?: string;
}

export interface PoolListQuery {
  keyword?: string;
  page?: number;
  pageSize?: number;
}

type IntakeWithFile = Prisma.ResumeIntakeGetPayload<{
  include: {
    resumeFile: {
      select: { id: true; fileName: true; mimeType: true; size: true };
    };
  };
}>;

@Injectable()
export class IntakeService {
  private readonly logger = new Logger(IntakeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly timeline: TimelineService,
    private readonly storage: StorageService,
    private readonly queue: ParseQueueService,
    private readonly authorization: AuthorizationService,
  ) {}

  /** 批量上传 / 单个上传（FR-ENT-3） */
  async ingestUploads(
    files: UploadedResumeFile[],
    body: UploadIntakeBody,
  ): Promise<IntakeResult[]> {
    const actor = await this.requireActor(body.actorId);
    if (!files || files.length === 0) {
      throw new BadRequestException('At least one resume file is required');
    }

    const entryMode =
      body.entryMode ??
      (files.length > 1 ? ENTRY_MODE.BATCH_UPLOAD : ENTRY_MODE.SINGLE_UPLOAD);
    this.assertEntryMode(entryMode);
    const source = body.source ?? INTAKE_SOURCE.UPLOAD;
    this.assertSource(source);
    const sourceFields = this.normalizeSourceFields(body);
    const jobId = body.jobId?.trim() || null;
    if (jobId) {
      await this.assertJobAccessible(jobId, actor, 'intake:manage');
    }

    const results: IntakeResult[] = [];
    const limits = this.uploadLimits();
    for (const file of files) {
      const validation = validateUpload(
        {
          fileName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
          buffer: file.buffer,
        },
        limits,
      );
      if (!validation.ok) {
        results.push(
          await this.recordRejectedFile(file, {
            source,
            entryMode,
            jobId,
            actorId: actor.id,
            errorCode: validation.code,
            errorMessage: validation.message,
          }),
        );
        continue;
      }

      const sha256 = createHash('sha256').update(file.buffer).digest('hex');
      results.push(
        await this.createFileIntake({
          file,
          validated: validation,
          sha256,
          source,
          entryMode,
          jobId,
          intentId: body.intentId ?? null,
          sourceFields,
          actor,
          mockOutcome: body.mockOutcome,
        }),
      );
    }

    return results;
  }

  /** 手工录入（FR-ENT-3）：直接产生候选人或待分配池记录 */
  async ingestManual(body: ManualIntakeBody): Promise<IntakeResult> {
    const actor = await this.requireActor(body.actorId);
    const name = body.name?.trim();
    if (!name) {
      throw new BadRequestException('name is required');
    }

    const phone = normalizePhone(body.phone);
    const email = normalizeEmail(body.email);
    if (!phone && !email) {
      throw new BadRequestException('phone or email is required for dedup');
    }
    await this.authorization.assertSensitiveFieldAccess(
      actor,
      SensitiveField.CANDIDATE_CONTACT,
      'WRITE',
    );

    const source = body.source ?? INTAKE_SOURCE.MANUAL;
    this.assertSource(source);
    const sourceFields = this.normalizeSourceFields(body);
    const jobId = body.jobId?.trim() || null;
    if (jobId) {
      await this.assertJobAccessible(jobId, actor, 'intake:manage');
    }

    const duplicate = await this.findDuplicateCandidate(phone, email);
    if (duplicate) {
      const duplicateCandidateId =
        (await this.authorization.canAccessCandidate(
          actor,
          'intake:manage',
          duplicate.id,
        ))
          ? duplicate.id
          : null;
      const intake = await this.prisma.resumeIntake.create({
        data: {
          source,
          entryMode: ENTRY_MODE.MANUAL,
          status: IntakeStatus.DUPLICATE,
          duplicateOfCandidateId: duplicateCandidateId,
          createdById: actor.id,
          jobId,
          intentId: body.intentId ?? null,
          referrerName: sourceFields.referrerName,
          referrerContact: sourceFields.referrerContact,
          referralCode: sourceFields.referralCode,
          sourceNote: sourceFields.sourceNote,
        },
      });
      await this.timeline.record({
        entityType: 'ResumeIntake',
        entityId: intake.id,
        action: 'intake.duplicate',
        actorId: actor.id,
        payload: {
          ...(duplicateCandidateId ? { candidateId: duplicateCandidateId } : {}),
          entryMode: ENTRY_MODE.MANUAL,
          duplicate: true,
        },
      });
      return {
        intakeId: intake.id,
        candidateId: duplicateCandidateId,
        airRunId: null,
        status: intake.status,
        duplicate: true,
        parseQueued: false,
      };
    }

    const candidate = await this.prisma.candidate.create({
      data: {
        name,
        phone,
        email,
        jobId,
        poolType: jobId ? PoolType.NONE : PoolType.UNASSIGNED,
        stage: jobId ? CandidateStage.RECOMMENDED : CandidateStage.UNASSIGNED,
        source,
        entryMode: ENTRY_MODE.MANUAL,
        intentId: body.intentId ?? null,
        createdById: actor.id,
        appliedAt: new Date(),
      },
    });

    const intake = await this.prisma.resumeIntake.create({
      data: {
        source,
        entryMode: ENTRY_MODE.MANUAL,
        status: IntakeStatus.PARSED,
        candidateId: candidate.id,
        createdById: actor.id,
        jobId,
        intentId: body.intentId ?? null,
        referrerName: sourceFields.referrerName,
        referrerContact: sourceFields.referrerContact,
        referralCode: sourceFields.referralCode,
        sourceNote: sourceFields.sourceNote,
      },
    });

    await this.createSourceRecord(this.prisma, {
      candidateId: candidate.id,
      intakeId: intake.id,
      source,
      entryMode: ENTRY_MODE.MANUAL,
      jobId,
      ...sourceFields,
      createdById: actor.id,
    });

    await this.timeline.record({
      entityType: 'Candidate',
      entityId: candidate.id,
      action: 'candidate.entered',
      actorId: actor.id,
      payload: {
        intakeId: intake.id,
        source,
        entryMode: ENTRY_MODE.MANUAL,
        jobId,
        referrerName: sourceFields.referrerName,
        referralCode: sourceFields.referralCode,
      },
    });

    return {
      intakeId: intake.id,
      candidateId: candidate.id,
      airRunId: null,
      status: intake.status,
      duplicate: false,
      parseQueued: false,
    };
  }

  /** 邮箱自动获取（Mock）：附件入库 → 默认待分配池 → 触发解析（FR-ENT-1/FR-ENT-10） */
  async ingestEmailMock(body: EmailIntakeBody): Promise<IntakeResult[]> {
    const actor = await this.requireActor(body.actorId);
    const attachments = body.attachments ?? [];
    if (attachments.length === 0) {
      throw new BadRequestException('At least one attachment is required');
    }

    const mailboxAddress = body.mailboxAddress?.trim().toLowerCase() || null;
    if (mailboxAddress) {
      await this.prisma.mailInboxConfig.upsert({
        where: { address: mailboxAddress },
        create: {
          address: mailboxAddress,
          provider: 'MOCK',
          lastPolledAt: new Date(),
        },
        update: { lastPolledAt: new Date() },
      });
    }

    const jobId = body.jobId?.trim() || null;
    if (jobId) {
      await this.assertJobAccessible(jobId, actor, 'intake:manage');
    }
    const receivedAt = body.receivedAt ? new Date(body.receivedAt) : new Date();
    if (Number.isNaN(receivedAt.getTime())) {
      throw new BadRequestException('receivedAt is invalid');
    }

    const files: EmailAttachmentFile[] = attachments.map((attachment) => {
      const fileName = attachment.fileName?.trim();
      if (!fileName || !attachment.contentBase64) {
        throw new BadRequestException(
          'attachment.fileName and attachment.contentBase64 are required',
        );
      }
      const buffer = Buffer.from(attachment.contentBase64, 'base64');
      if (buffer.length === 0) {
        throw new BadRequestException(`Attachment ${fileName} is empty`);
      }
      return {
        fileName,
        mimeType: attachment.mimeType ?? 'application/octet-stream',
        buffer,
      };
    });

    return this.ingestEmailFiles(actor, {
      from: body.from ?? null,
      subject: body.subject ?? null,
      mailboxAddress,
      receivedAt,
      files,
      jobId,
      mockOutcome: body.mockOutcome,
    });
  }

  /**
   * 邮箱附件入库（ATS-022 真实轮询入口）：与 Mock 共用校验、查重、落待分配池与解析排队。
   * 不传 jobId，附件一律先入待分配池，由人事手工选职位（FR-ENT-10）。
   */
  async ingestEmailAttachments(params: {
    actorId: string;
    from: string | null;
    subject: string | null;
    mailboxAddress: string | null;
    receivedAt: Date;
    files: EmailAttachmentFile[];
    jobId?: string | null;
    mockOutcome?: MockOutcome;
  }): Promise<IntakeResult[]> {
    const actor = await this.requireActor(params.actorId);
    const jobId = params.jobId?.trim() || null;
    if (jobId) {
      await this.assertJobAccessible(jobId, actor, 'intake:manage');
    }
    return this.ingestEmailFiles(actor, {
      from: params.from,
      subject: params.subject,
      mailboxAddress: params.mailboxAddress,
      receivedAt: params.receivedAt,
      files: params.files,
      jobId,
      mockOutcome: params.mockOutcome,
    });
  }

  private async ingestEmailFiles(
    actor: AuthenticatedUser,
    params: {
      from: string | null;
      subject: string | null;
      mailboxAddress: string | null;
      receivedAt: Date;
      files: EmailAttachmentFile[];
      jobId: string | null;
      mockOutcome?: MockOutcome;
    },
  ): Promise<IntakeResult[]> {
    const results: IntakeResult[] = [];
    const limits = this.uploadLimits();
    for (const attachment of params.files) {
      const file: UploadedResumeFile = {
        originalname: attachment.fileName,
        mimetype: attachment.mimeType,
        size: attachment.buffer.length,
        buffer: attachment.buffer,
      };

      const validation = validateUpload(
        {
          fileName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
          buffer: file.buffer,
        },
        limits,
      );
      if (!validation.ok) {
        results.push(
          await this.recordRejectedFile(file, {
            source: INTAKE_SOURCE.EMAIL,
            entryMode: ENTRY_MODE.EMAIL_AUTO,
            jobId: params.jobId,
            actorId: actor.id,
            errorCode: validation.code,
            errorMessage: validation.message,
            mailFrom: params.from,
            mailSubject: params.subject,
            mailboxAddress: params.mailboxAddress,
            receivedAt: params.receivedAt,
          }),
        );
        continue;
      }

      const sha256 = createHash('sha256').update(file.buffer).digest('hex');
      results.push(
        await this.createFileIntake({
          file,
          validated: validation,
          sha256,
          source: INTAKE_SOURCE.EMAIL,
          entryMode: ENTRY_MODE.EMAIL_AUTO,
          jobId: params.jobId,
          intentId: null,
          actor,
          mockOutcome: params.mockOutcome,
          mail: {
            from: params.from,
            subject: params.subject,
            mailboxAddress: params.mailboxAddress,
            receivedAt: params.receivedAt,
          },
        }),
      );
    }

    return results;
  }

  /** 分配职位：只选职位，负责人由职位带出（FR-ENT-5） */
  async assignJob(intakeId: string, jobId: string, actorId?: string) {
    const actor = await this.requireActor(actorId);
    const targetJobId = jobId?.trim();
    if (!targetJobId) {
      throw new BadRequestException('jobId is required');
    }
    await this.assertJobAccessible(targetJobId, actor, 'intake:manage');

    const job = await this.prisma.job.findUnique({
      where: { id: targetJobId },
      select: { id: true, code: true, title: true, isVirtual: true, recruiterId: true },
    });
    if (!job) {
      throw new NotFoundException('职位不存在');
    }

    const intake = await this.prisma.resumeIntake.findUnique({
      where: { id: intakeId },
    });
    if (!intake) {
      throw new NotFoundException(`Intake ${intakeId} not found`);
    }
    await this.assertIntakeAccessible(intake, actor, 'intake:manage');
    if (!intake.candidateId) {
      throw new BadRequestException(`Intake ${intakeId} has no candidate`);
    }

    // 虚拟职位是校招容器：分配后停留在容器内，不进入「人才推荐」（PRD §3.1 路径③）
    const [candidate] = await this.prisma.$transaction([
      this.prisma.candidate.update({
        where: { id: intake.candidateId },
        data: {
          jobId: targetJobId,
          poolType: job.isVirtual ? PoolType.VIRTUAL : PoolType.NONE,
          stage: job.isVirtual ? CandidateStage.VIRTUAL_POOL : CandidateStage.RECOMMENDED,
        },
      }),
      this.prisma.resumeIntake.update({
        where: { id: intake.id },
        data: { jobId: targetJobId },
      }),
    ]);

    // 校招投递人工分配正式职位：只补充分配结果，原始个人意愿保持不变（功能需求 §4.9）
    if (!job.isVirtual) {
      await this.prisma.campusApplication.updateMany({
        where: { intakeId: intake.id },
        data: {
          candidateId: candidate.id,
          assignedJobId: targetJobId,
          assignedAt: new Date(),
          assignedById: actor.id,
          status: 'ASSIGNED',
        },
      });
    }

    await this.timeline.record({
      entityType: 'Candidate',
      entityId: candidate.id,
      action: 'candidate.job_assigned',
      actorId: actor.id,
      payload: {
        intakeId: intake.id,
        jobId: targetJobId,
        jobCode: job.code,
        isVirtual: job.isVirtual,
        recruiterId: job.recruiterId,
      },
    });

    return {
      intakeId: intake.id,
      candidateId: candidate.id,
      jobId: targetJobId,
      jobCode: job.code,
      jobTitle: job.title,
      isVirtual: job.isVirtual,
      recruiterId: job.recruiterId,
    };
  }

  /** 待分配池批量分配职位：只选职位，负责人由职位带出（FR-ENT-5） */
  async assignJobs(intakeIds: string[], jobId: string, actorId?: string) {
    const actor = await this.requireActor(actorId);
    const targetJobId = jobId?.trim();
    if (!targetJobId) {
      throw new BadRequestException('jobId is required');
    }
    const ids = [...new Set((intakeIds ?? []).map((id) => id?.trim()).filter(Boolean))];
    if (!ids.length) {
      throw new BadRequestException('至少选择一条待分配记录');
    }
    if (ids.length > 200) {
      throw new BadRequestException('单次最多分配 200 条记录');
    }
    await this.assertJobAccessible(targetJobId, actor, 'intake:manage');

    const results: {
      intakeId: string;
      ok: boolean;
      candidateId?: string;
      error?: string;
    }[] = [];
    for (const intakeId of ids) {
      try {
        const assigned = await this.assignJob(intakeId, targetJobId, actorId);
        results.push({
          intakeId,
          ok: true,
          candidateId: assigned.candidateId,
        });
      } catch (error) {
        results.push({
          intakeId,
          ok: false,
          error: error instanceof Error ? error.message : '分配失败',
        });
      }
    }

    const job = await this.prisma.job.findUnique({
      where: { id: targetJobId },
      select: { id: true, code: true, title: true, isVirtual: true, recruiterId: true },
    });

    return {
      job,
      assigned: results.filter((item) => item.ok).length,
      failed: results.filter((item) => !item.ok).length,
      results,
    };
  }

  /** 查重合并：保留重复记录的来源与附件，并挂到已存在候选人（FR-ENT-6） */
  async mergeDuplicate(intakeId: string, actorId?: string) {
    const actor = await this.requireActor(actorId);
    const intake = await this.prisma.resumeIntake.findUnique({
      where: { id: intakeId },
    });
    if (!intake) {
      throw new NotFoundException(`Intake ${intakeId} not found`);
    }
    await this.assertIntakeAccessible(intake, actor, 'intake:manage');
    if (intake.status !== IntakeStatus.DUPLICATE) {
      throw new BadRequestException('只有查重记录可以合并');
    }
    if (!intake.duplicateOfCandidateId) {
      throw new BadRequestException('查重记录缺少可合并的候选人');
    }
    if (intake.mergedAt) {
      throw new BadRequestException('该查重记录已合并');
    }
    const targetCandidateId = intake.duplicateOfCandidateId;
    if (!(await this.authorization.canAccessCandidate(actor, 'intake:manage', targetCandidateId))) {
      throw new NotFoundException('候选人不存在');
    }

    const mergedAt = new Date();
    const { updated, sourceRecord } = await this.prisma.$transaction(async (tx) => {
      const claim = await tx.resumeIntake.updateMany({
        where: { id: intake.id, status: IntakeStatus.DUPLICATE, mergedAt: null },
        data: {
          candidateId: targetCandidateId,
          mergedAt,
          mergedById: actor.id,
        },
      });
      if (claim.count !== 1) {
        throw new BadRequestException('该查重记录已合并');
      }

      // 查重合并保留全部来源：把重复记录的来源写入原候选人的来源台账（FR-REF-3）
      const createdSource = await tx.candidateSourceRecord.upsert({
        where: { intakeId: intake.id },
        create: {
          candidateId: targetCandidateId,
          intakeId: intake.id,
          source: intake.source,
          entryMode: intake.entryMode,
          jobId: intake.jobId,
          referrerName: intake.referrerName,
          referrerContact: intake.referrerContact,
          referralCode: intake.referralCode,
          note: intake.sourceNote,
          mergedFromCandidateId:
            intake.candidateId && intake.candidateId !== targetCandidateId
              ? intake.candidateId
              : null,
          createdById: actor.id,
        },
        update: { candidateId: targetCandidateId },
      });

      return {
        updated: {
          id: intake.id,
          source: intake.source,
          entryMode: intake.entryMode,
          resumeFileId: intake.resumeFileId,
        },
        sourceRecord: createdSource,
      };
    });

    await this.timeline.record({
      entityType: 'Candidate',
      entityId: targetCandidateId,
      action: 'candidate.duplicate_merged',
      actorId: actor.id,
      payload: {
        intakeId: intake.id,
        source: intake.source,
        entryMode: intake.entryMode,
        resumeFileId: intake.resumeFileId,
        sourceRecordId: sourceRecord.id,
        mergedAt: mergedAt.toISOString(),
      },
    });

    return {
      intakeId: updated.id,
      candidateId: targetCandidateId,
      mergedAt,
      source: updated.source,
      entryMode: updated.entryMode,
      resumeFileId: updated.resumeFileId,
      sourceRecordId: sourceRecord.id,
    };
  }

  /** 解析失败后重试（可 Mock 成功/失败，重试不产生重复候选人） */
  async retry(intakeId: string, actorId?: string, mockOutcome?: MockOutcome) {
    const actor = await this.requireActor(actorId);
    const intake = await this.prisma.resumeIntake.findUnique({
      where: { id: intakeId },
    });
    if (!intake) {
      throw new NotFoundException(`Intake ${intakeId} not found`);
    }
    await this.assertIntakeAccessible(intake, actor, 'intake:manage');
    if (!intake.airRunId) {
      throw new BadRequestException(`Intake ${intakeId} has no AI run`);
    }
    if (intake.status === IntakeStatus.PARSED) {
      throw new BadRequestException(`Intake ${intakeId} is already parsed`);
    }

    const run = await this.prisma.aIRun.findUnique({
      where: { id: intake.airRunId },
    });
    if (!run) {
      throw new NotFoundException(`AI run ${intake.airRunId} not found`);
    }

    let inputRefs = run.inputRefs;
    if (mockOutcome) {
      const input = JSON.parse(run.inputRefs ?? '{}') as Record<string, unknown>;
      input.mockOutcome = mockOutcome;
      inputRefs = JSON.stringify(input);
    }

    await this.prisma.$transaction([
      this.prisma.aIRun.update({
        where: { id: intake.airRunId },
        data: {
          status: AiRunStatus.PENDING,
          attempts: 0,
          errorCode: null,
          errorMessage: null,
          inputRefs,
        },
      }),
      this.prisma.resumeIntake.update({
        where: { id: intake.id },
        data: {
          status: IntakeStatus.RECEIVED,
          attempts: 0,
          errorCode: null,
          errorMessage: null,
        },
      }),
    ]);

    const parseQueued = await this.queue.enqueue(intake.id, intake.airRunId, {
      retry: true,
    });

    await this.timeline.record({
      entityType: 'ResumeIntake',
      entityId: intake.id,
      action: 'intake.retry_requested',
      actorId: actor.id,
      payload: { airRunId: intake.airRunId, parseQueued, mockOutcome },
    });

    return { intakeId: intake.id, airRunId: intake.airRunId, parseQueued };
  }

  /** 入场记录列表：分页 + 职位/邮箱/时间筛选，导入页与监控页共用（FR-ENT-10） */
  async list(query: IntakeListQuery, actor: AuthenticatedUser) {
    const pageSize = this.clampInt(query.pageSize ?? query.limit, 20, 1, 100);
    const page = this.clampInt(query.page, 1, 1, Number.MAX_SAFE_INTEGER);
    const where = await this.buildIntakeWhere(query, actor, 'intake:read');
    const [items, total] = await Promise.all([
      this.prisma.resumeIntake.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          resumeFile: {
            select: { id: true, fileName: true, mimeType: true, size: true },
          },
        },
      }),
      this.prisma.resumeIntake.count({ where }),
    ]);
    const canReadContacts = await this.authorization.canAccessSensitiveField(
      actor,
      SensitiveField.CANDIDATE_CONTACT,
      'READ',
    );
    const enriched = await this.enrichIntakes(items);
    return {
      items: canReadContacts
        ? enriched
        : enriched.map((intake) => ({ ...intake, mailFrom: null })),
      page,
      pageSize,
      total,
    };
  }

  /** 待分配池：邮箱/插件入场且尚未分配职位的候选人（FR-ENT-4） */
  async listPool(query: PoolListQuery, actor: AuthenticatedUser) {
    const pageSize = this.clampInt(query.pageSize, 20, 1, 100);
    const page = this.clampInt(query.page, 1, 1, Number.MAX_SAFE_INTEGER);
    const conditions: Prisma.CandidateWhereInput[] = [
      this.authorization.candidateWhere(actor, 'intake:read'),
      { poolType: PoolType.UNASSIGNED },
    ];
    const keyword = query.keyword?.trim();
    if (keyword) {
      conditions.push({
        OR: [
          { name: { contains: keyword } },
          { phone: { contains: keyword } },
          { email: { contains: keyword } },
        ],
      });
    }
    const where: Prisma.CandidateWhereInput = { AND: conditions };
    const [candidates, total] = await Promise.all([
      this.prisma.candidate.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.candidate.count({ where }),
    ]);

    const candidateIds = candidates.map((candidate) => candidate.id);
    const intakes = await this.prisma.resumeIntake.findMany({
      where: { candidateId: { in: candidateIds } },
      orderBy: { createdAt: 'desc' },
      include: {
        resumeFile: {
          select: { id: true, fileName: true, mimeType: true, size: true },
        },
      },
    });
    const latestIntake = new Map<string, (typeof intakes)[number]>();
    for (const intake of intakes) {
      if (intake.candidateId && !latestIntake.has(intake.candidateId)) {
        latestIntake.set(intake.candidateId, intake);
      }
    }
    const airRunIds = [...latestIntake.values()]
      .map((intake) => intake.airRunId)
      .filter((id): id is string => Boolean(id));
    const airRuns = await this.prisma.aIRun.findMany({
      where: { id: { in: airRunIds } },
      select: { id: true, status: true, isDraft: true, errorCode: true },
    });
    const airRunMap = new Map(airRuns.map((run) => [run.id, run]));
    const canReadContacts = await this.authorization.canAccessSensitiveField(
      actor,
      SensitiveField.CANDIDATE_CONTACT,
      'READ',
    );

    return {
      items: candidates.map((candidate) => {
        const intake = latestIntake.get(candidate.id) ?? null;
        return {
          candidateId: candidate.id,
          name: candidate.name,
          phone: canReadContacts ? candidate.phone : null,
          email: canReadContacts ? candidate.email : null,
          source: candidate.source,
          entryMode: candidate.entryMode,
          appliedAt: candidate.appliedAt,
          createdAt: candidate.createdAt,
          intakeId: intake?.id ?? null,
          intakeStatus: intake?.status ?? null,
          mailFrom: canReadContacts ? intake?.mailFrom ?? null : null,
          mailSubject: intake?.mailSubject ?? null,
          mailboxAddress: intake?.mailboxAddress ?? null,
          receivedAt: intake?.receivedAt ?? null,
          resumeFileId: intake?.resumeFileId ?? null,
          resumeFileName: intake?.resumeFile?.fileName ?? null,
          aiRun: intake?.airRunId ? airRunMap.get(intake.airRunId) ?? null : null,
        };
      }),
      page,
      pageSize,
      total,
    };
  }

  /** 待合并查重：命中已有候选人但尚未合并的入场记录（FR-ENT-6） */
  async listDuplicates(
    query: { page?: number; pageSize?: number },
    actor: AuthenticatedUser,
  ) {
    const pageSize = this.clampInt(query.pageSize, 20, 1, 100);
    const page = this.clampInt(query.page, 1, 1, Number.MAX_SAFE_INTEGER);
    const where = await this.buildIntakeWhere(
      { status: IntakeStatus.DUPLICATE },
      actor,
      'intake:read',
    );
    const conditions: Prisma.ResumeIntakeWhereInput = {
      AND: [where, { mergedAt: null }, { duplicateOfCandidateId: { not: null } }],
    };
    const [items, total] = await Promise.all([
      this.prisma.resumeIntake.findMany({
        where: conditions,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          resumeFile: {
            select: { id: true, fileName: true, mimeType: true, size: true },
          },
        },
      }),
      this.prisma.resumeIntake.count({ where: conditions }),
    ]);
    const canReadContacts = await this.authorization.canAccessSensitiveField(
      actor,
      SensitiveField.CANDIDATE_CONTACT,
      'READ',
    );
    const enriched = await this.enrichIntakes(items);
    return {
      items: canReadContacts
        ? enriched
        : enriched.map((intake) => ({ ...intake, mailFrom: null })),
      page,
      pageSize,
      total,
    };
  }

  /** 监控数据：进入/未进入、渠道/邮箱、接收时延、去向与失败归因（FR-ENT-10） */
  async monitor(query: IntakeMonitorQuery, actor: AuthenticatedUser) {
    const where = await this.buildIntakeWhere(query, actor, 'intake:read');
    const notEnteredWhere: Prisma.ResumeIntakeWhereInput = {
      AND: [where, { candidateId: null }],
    };
    const [total, notEntered, statusGroups, sourceGroups, entryGroups, mailboxGroups, errorGroups] =
      await Promise.all([
        this.prisma.resumeIntake.count({ where }),
        this.prisma.resumeIntake.count({ where: notEnteredWhere }),
        this.prisma.resumeIntake.groupBy({
          by: ['status'],
          where,
          _count: { _all: true },
        }),
        this.prisma.resumeIntake.groupBy({
          by: ['source'],
          where,
          _count: { _all: true },
        }),
        this.prisma.resumeIntake.groupBy({
          by: ['entryMode'],
          where,
          _count: { _all: true },
        }),
        this.prisma.resumeIntake.groupBy({
          by: ['mailboxAddress'],
          where,
          _count: { _all: true },
          _max: { receivedAt: true },
        }),
        this.prisma.resumeIntake.groupBy({
          by: ['errorCode'],
          where: { AND: [where, { errorCode: { not: null } }] },
          _count: { _all: true },
        }),
      ]);

    const latencyRows = await this.prisma.resumeIntake.findMany({
      where: { AND: [where, { receivedAt: { not: null } }] },
      select: { receivedAt: true, createdAt: true },
    });
    const latencies = latencyRows
      .map((row) => {
        if (!row.receivedAt) return null;
        const seconds = Math.round(
          (row.createdAt.getTime() - row.receivedAt.getTime()) / 1000,
        );
        return Number.isFinite(seconds) ? Math.max(seconds, 0) : null;
      })
      .filter((value): value is number => value !== null)
      .sort((a, b) => a - b);

    const [assignedCount, recentFailures] = await Promise.all([
      this.prisma.resumeIntake.count({
        where: { AND: [where, { jobId: { not: null } }] },
      }),
      this.prisma.resumeIntake.findMany({
        where: {
          AND: [
            where,
            { status: { in: [IntakeStatus.FAILED, IntakeStatus.NEEDS_MANUAL] } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          source: true,
          entryMode: true,
          status: true,
          errorCode: true,
          errorMessage: true,
          mailFrom: true,
          createdAt: true,
          jobId: true,
        },
      }),
    ]);

    const entered = total - notEntered;
    return {
      totals: {
        total,
        entered,
        notEntered,
        enteredRate: total ? Number((entered / total).toFixed(4)) : 0,
        assigned: assignedCount,
        pool: total - assignedCount,
        latencySamples: latencies.length,
        averageLatencySeconds: this.average(latencies),
        p90LatencySeconds: this.percentile(latencies, 0.9),
        maxLatencySeconds: latencies.length ? latencies[latencies.length - 1] : null,
      },
      byStatus: statusGroups.map((group) => ({
        status: group.status,
        count: group._count._all,
      })),
      bySource: sourceGroups.map((group) => ({
        source: group.source,
        count: group._count._all,
      })),
      byEntryMode: entryGroups.map((group) => ({
        entryMode: group.entryMode,
        count: group._count._all,
      })),
      byMailbox: mailboxGroups
        .filter((group) => Boolean(group.mailboxAddress))
        .map((group) => ({
          mailbox: group.mailboxAddress as string,
          count: group._count._all,
          lastReceivedAt: group._max.receivedAt,
        })),
      failureReasons: errorGroups.map((group) => ({
        errorCode: group.errorCode ?? 'UNKNOWN',
        count: group._count._all,
      })),
      recentFailures,
    };
  }

  /** 已配置的接收邮箱（本期仅 Mock 配置，用于邮箱模拟入口） */
  async listMailboxes() {
    // ATS-024：入场页只需要邮箱地址与抓取状态，连接凭据（密文）与主机账号信息不出接口
    const items = await this.prisma.mailInboxConfig.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, address: true, provider: true, active: true,
        lastPolledAt: true, lastPollStatus: true, lastError: true, lastErrorAt: true,
        consecutiveFailures: true,
      },
    });
    return { items, total: items.length };
  }

  /** Excel 模板下载：独立表格导入，不进入 AI 解析管道（PRD §6.4） */
  async excelTemplate(): Promise<Buffer> {
    return buildExcelTemplate();
  }

  /**
   * Excel 批量导入：逐行校验，成功行直接建档并保留来源，失败行记录错误码可导出修正。
   * Excel 不进入 AI 解析管道，因此不创建 AIRun、不入解析队列。
   */
  async importExcel(
    file: { originalname: string; buffer: Buffer; size: number } | undefined,
    actorId?: string,
  ) {
    const actor = await this.requireActor(actorId);
    if (!file || !file.buffer?.length) {
      throw new BadRequestException('请上传 Excel 文件');
    }
    const extension = extname(file.originalname ?? '').toLowerCase();
    if (extension !== '.xlsx') {
      throw new BadRequestException({
        code: EXCEL_ERROR.UNSUPPORTED_EXCEL_FORMAT,
        message: '仅支持 .xlsx 格式，请使用下载的模板',
      });
    }

    let rawRows: ExcelRawRow[];
    try {
      rawRows = await parseExcelRows(file.buffer);
    } catch (error) {
      if (error instanceof ExcelImportError) {
        throw new BadRequestException({ code: error.code, message: error.message });
      }
      throw new BadRequestException('Excel 解析失败，请确认文件未损坏且使用下载的模板');
    }
    if (!rawRows.length) {
      throw new BadRequestException({ code: EXCEL_ERROR.NO_ROWS, message: 'Excel 中没有数据行' });
    }
    if (rawRows.length > EXCEL_MAX_ROWS) {
      throw new BadRequestException({
        code: EXCEL_ERROR.TOO_MANY_ROWS,
        message: `单个文件最多 ${EXCEL_MAX_ROWS} 行，请拆分后重新导入`,
      });
    }

    const jobCodes = [
      ...new Set(
        rawRows
          .map((row) => (row.values.jobCode ?? '').trim())
          .filter((code) => Boolean(code)),
      ),
    ];
    const jobs = jobCodes.length
      ? await this.prisma.job.findMany({
          where: {
            AND: [
              { code: { in: jobCodes } },
              this.authorization.jobWhere(actor, 'intake:manage'),
            ],
          },
          select: { id: true, code: true, isVirtual: true, recruiterId: true },
        })
      : [];
    const jobByCode = new Map(jobs.map((job) => [job.code, job]));

    const batch = await this.prisma.excelImportBatch.create({
      data: {
        fileName: file.originalname,
        createdById: actor.id,
        totalRows: rawRows.length,
      },
    });

    const canReadContacts = await this.authorization.canAccessSensitiveField(
      actor,
      SensitiveField.CANDIDATE_CONTACT,
      'READ',
    );
    const rows: {
      rowNumber: number;
      status: 'SUCCESS' | 'DUPLICATE' | 'FAILED';
      name: string | null;
      phone: string | null;
      email: string | null;
      jobCode: string | null;
      source: string | null;
      referrerName: string | null;
      referralCode: string | null;
      candidateId: string | null;
      intakeId: string | null;
      errorCode: string | null;
      errorMessage: string | null;
    }[] = [];

    let successRows = 0;
    let duplicateRows = 0;
    let failedRows = 0;

    for (const raw of rawRows) {
      const validation = validateExcelRow(raw);
      if (!validation.ok) {
        failedRows += 1;
        rows.push({
          rowNumber: raw.rowNumber,
          status: 'FAILED',
          name: raw.values.name ?? null,
          phone: raw.values.phone ?? null,
          email: raw.values.email ?? null,
          jobCode: raw.values.jobCode ?? null,
          source: raw.values.source ?? null,
          referrerName: raw.values.referrerName ?? null,
          referralCode: raw.values.referralCode ?? null,
          candidateId: null,
          intakeId: null,
          errorCode: validation.code,
          errorMessage: validation.message,
        });
        continue;
      }

      const value = validation.value;
      let jobId: string | null = null;
      let isVirtual = false;
      if (value.jobCode) {
        const job = jobByCode.get(value.jobCode);
        if (!job) {
          failedRows += 1;
          rows.push({
            rowNumber: raw.rowNumber,
            status: 'FAILED',
            name: value.name,
            phone: value.phone,
            email: value.email,
            jobCode: value.jobCode,
            source: value.source,
            referrerName: value.referrerName,
            referralCode: value.referralCode,
            candidateId: null,
            intakeId: null,
            errorCode: EXCEL_ERROR.JOB_NOT_FOUND,
            errorMessage: `职位编号不存在或不在权限范围：${value.jobCode}`,
          });
          continue;
        }
        jobId = job.id;
        isVirtual = job.isVirtual;
      }

      const duplicate = await this.findDuplicateCandidate(value.phone, value.email);
      if (
        duplicate &&
        (await this.authorization.canAccessCandidate(actor, 'intake:manage', duplicate.id))
      ) {
        const intake = await this.prisma.resumeIntake.create({
          data: {
            source: value.source,
            entryMode: EXCEL_ENTRY_MODE,
            status: IntakeStatus.DUPLICATE,
            createdById: actor.id,
            jobId,
            duplicateOfCandidateId: duplicate.id,
            referrerName: value.referrerName,
            referralCode: value.referralCode,
          },
        });
        duplicateRows += 1;
        rows.push({
          rowNumber: raw.rowNumber,
          status: 'DUPLICATE',
          name: value.name,
          phone: value.phone,
          email: value.email,
          jobCode: value.jobCode,
          source: value.source,
          referrerName: value.referrerName,
          referralCode: value.referralCode,
          candidateId: duplicate.id,
          intakeId: intake.id,
          errorCode: null,
          errorMessage: '手机号或邮箱命中已有候选人，已按查重跳过',
        });
        continue;
      }

      const candidate = await this.prisma.candidate.create({
        data: {
          name: value.name,
          phone: value.phone,
          email: value.email,
          jobId,
          poolType: jobId
            ? isVirtual
              ? PoolType.VIRTUAL
              : PoolType.NONE
            : PoolType.UNASSIGNED,
          stage: jobId
            ? isVirtual
              ? CandidateStage.VIRTUAL_POOL
              : CandidateStage.RECOMMENDED
            : CandidateStage.UNASSIGNED,
          source: value.source,
          entryMode: EXCEL_ENTRY_MODE,
          note: value.note,
          createdById: actor.id,
          appliedAt: new Date(),
        },
      });
      const intake = await this.prisma.resumeIntake.create({
        data: {
          source: value.source,
          entryMode: EXCEL_ENTRY_MODE,
          // Excel 已是结构化数据，直接落为已解析，不创建 AI 解析任务
          status: IntakeStatus.PARSED,
          candidateId: candidate.id,
          createdById: actor.id,
          jobId,
          referrerName: value.referrerName,
          referralCode: value.referralCode,
        },
      });
      await this.createSourceRecord(this.prisma, {
        candidateId: candidate.id,
        intakeId: intake.id,
        source: value.source,
        entryMode: EXCEL_ENTRY_MODE,
        jobId,
        referrerName: value.referrerName,
        referrerContact: null,
        referralCode: value.referralCode,
        sourceNote: null,
        createdById: actor.id,
      });
      await this.timeline.record({
        entityType: 'Candidate',
        entityId: candidate.id,
        action: 'candidate.entered',
        actorId: actor.id,
        payload: {
          intakeId: intake.id,
          source: value.source,
          entryMode: EXCEL_ENTRY_MODE,
          jobId,
          batchId: batch.id,
          rowNumber: raw.rowNumber,
          referrerName: value.referrerName,
          referralCode: value.referralCode,
        },
      });
      successRows += 1;
      rows.push({
        rowNumber: raw.rowNumber,
        status: 'SUCCESS',
        name: value.name,
        phone: value.phone,
        email: value.email,
        jobCode: value.jobCode,
        source: value.source,
        referrerName: value.referrerName,
        referralCode: value.referralCode,
        candidateId: candidate.id,
        intakeId: intake.id,
        errorCode: null,
        errorMessage: null,
      });
    }

    if (rows.length) {
      await this.prisma.excelImportRow.createMany({
        data: rows.map((row) => ({
          batchId: batch.id,
          rowNumber: row.rowNumber,
          payload: {
            name: row.name,
            phone: row.phone,
            email: row.email,
            jobCode: row.jobCode,
            source: row.source,
            referrerName: row.referrerName,
            referralCode: row.referralCode,
          },
          status: row.status,
          candidateId: row.candidateId,
          intakeId: row.intakeId,
          errorCode: row.errorCode,
          errorMessage: row.errorMessage,
        })),
      });
    }
    await this.prisma.excelImportBatch.update({
      where: { id: batch.id },
      data: { successRows, duplicateRows, failedRows },
    });

    await this.timeline.record({
      entityType: 'ResumeIntake',
      entityId: batch.id,
      action: 'intake.excel_imported',
      actorId: actor.id,
      payload: {
        batchId: batch.id,
        fileName: file.originalname,
        totalRows: rows.length,
        successRows,
        duplicateRows,
        failedRows,
      },
    });

    return {
      batchId: batch.id,
      fileName: file.originalname,
      totalRows: rows.length,
      successRows,
      duplicateRows,
      failedRows,
      rows: canReadContacts
        ? rows
        : rows.map((row) => ({ ...row, phone: null, email: null })),
    };
  }

  /** Excel 批次详情：含行级结果，用于失败原因查看与修正 */
  async getExcelBatch(batchId: string, actor: AuthenticatedUser) {
    const batch = await this.prisma.excelImportBatch.findUnique({
      where: { id: batchId },
      include: {
        rows: {
          orderBy: { rowNumber: 'asc' },
          select: {
            id: true,
            rowNumber: true,
            payload: true,
            status: true,
            candidateId: true,
            intakeId: true,
            errorCode: true,
            errorMessage: true,
          },
        },
      },
    });
    if (!batch) {
      throw new NotFoundException(`Excel batch ${batchId} not found`);
    }
    await this.assertExcelBatchAccessible(batch.createdById, actor);
    return batch;
  }

  /** 失败行导出：模板同构 + 错误码/原因，修正后可再次导入 */
  async exportExcelFailedRows(batchId: string, actor: AuthenticatedUser): Promise<Buffer> {
    const batch = await this.prisma.excelImportBatch.findUnique({
      where: { id: batchId },
      include: {
        rows: {
          where: { status: 'FAILED' },
          orderBy: { rowNumber: 'asc' },
        },
      },
    });
    if (!batch) {
      throw new NotFoundException(`Excel batch ${batchId} not found`);
    }
    await this.assertExcelBatchAccessible(batch.createdById, actor);
    const rows: FailedRowExport[] = batch.rows.map((row) => {
      const payload = (row.payload ?? {}) as Record<string, string | null>;
      return {
        rowNumber: row.rowNumber,
        name: payload.name ?? null,
        phone: payload.phone ?? null,
        email: payload.email ?? null,
        jobCode: payload.jobCode ?? null,
        source: payload.source ?? null,
        errorCode: row.errorCode,
        errorMessage: row.errorMessage,
      };
    });
    return buildFailedRowsWorkbook(rows);
  }

  async get(intakeId: string, actor: AuthenticatedUser) {
    const intake = await this.prisma.resumeIntake.findUnique({
      where: { id: intakeId },
      include: {
        resumeFile: {
          select: { id: true, fileName: true, mimeType: true, size: true, createdAt: true },
        },
      },
    });
    if (!intake) {
      throw new NotFoundException(`Intake ${intakeId} not found`);
    }
    await this.assertIntakeAccessible(intake, actor, 'intake:read');
    const canReadContacts = await this.authorization.canAccessSensitiveField(
      actor,
      SensitiveField.CANDIDATE_CONTACT,
      'READ',
    );
    const [candidate, rawAirRun] = await Promise.all([
      intake.candidateId
        ? this.prisma.candidate.findFirst({
            where: {
              AND: [
                { id: intake.candidateId },
                this.authorization.candidateWhere(actor, 'intake:read'),
              ],
            },
          })
        : null,
      intake.airRunId
        ? this.prisma.aIRun.findUnique({ where: { id: intake.airRunId } })
        : null,
    ]);
    const airRun = intake.candidateId && !candidate ? null : rawAirRun;
    return {
      intake: {
        ...intake,
        mailFrom: canReadContacts ? intake.mailFrom : null,
      },
      candidate:
        candidate && !canReadContacts
          ? { ...candidate, phone: null, email: null }
          : candidate,
      airRun: airRun
        ? {
            ...airRun,
            inputRefs: this.filterSensitiveOutput(airRun.inputRefs, canReadContacts),
            output: this.filterSensitiveOutput(airRun.output, canReadContacts),
          }
        : null,
    };
  }

  // ---------- 来源记录（FR-REF-1～3） ----------

  /** 来源台账查询：按来源/推荐人/来源标识/职位/候选人/时间筛选 */
  async listSources(query: SourceRecordQuery, actor: AuthenticatedUser) {
    const pageSize = this.clampInt(query.pageSize, 20, 1, 100);
    const page = this.clampInt(query.page, 1, 1, Number.MAX_SAFE_INTEGER);
    const conditions: Prisma.CandidateSourceRecordWhereInput[] = [];

    if (query.source) {
      this.assertSource(query.source);
      conditions.push({ source: query.source });
    }
    const jobId = query.jobId?.trim();
    if (jobId) conditions.push({ jobId });
    const candidateId = query.candidateId?.trim();
    if (candidateId) conditions.push({ candidateId });
    const referrer = query.referrer?.trim();
    if (referrer) {
      conditions.push({
        OR: [
          { referrerName: { contains: referrer } },
          { referrerContact: { contains: referrer } },
          { referralCode: { contains: referrer } },
        ],
      });
    }
    const createdFrom = this.dateBound(query.createdFrom, false);
    const createdTo = this.dateBound(query.createdTo, true);
    if (createdFrom || createdTo) {
      conditions.push({ createdAt: { gte: createdFrom, lte: createdTo } });
    }

    const scopes = this.authorization.scopesFor(actor, 'intake:read');
    if (!scopes.includes(DataScope.ALL)) {
      const candidates = await this.prisma.candidate.findMany({
        where: this.authorization.candidateWhere(actor, 'intake:read'),
        select: { id: true },
      });
      conditions.push({ candidateId: { in: candidates.map(({ id }) => id) } });
    }

    const where: Prisma.CandidateSourceRecordWhereInput = conditions.length
      ? { AND: conditions }
      : {};
    const [records, total] = await Promise.all([
      this.prisma.candidateSourceRecord.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.candidateSourceRecord.count({ where }),
    ]);

    const candidateIds = this.uniqueStrings(records.map((record) => record.candidateId));
    const jobIds = this.uniqueStrings(records.map((record) => record.jobId));
    const [candidates, jobs, canReadContacts] = await Promise.all([
      this.prisma.candidate.findMany({
        where: { id: { in: candidateIds } },
        select: { id: true, name: true, phone: true, email: true, stage: true, jobId: true },
      }),
      this.prisma.job.findMany({
        where: { id: { in: jobIds } },
        select: { id: true, code: true, title: true, isVirtual: true },
      }),
      this.authorization.canAccessSensitiveField(
        actor,
        SensitiveField.CANDIDATE_CONTACT,
        'READ',
      ),
    ]);
    const candidateMap = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    const jobMap = new Map(jobs.map((job) => [job.id, job]));

    return {
      items: records.map((record) => {
        const candidate = candidateMap.get(record.candidateId) ?? null;
        return {
          ...record,
          candidate: candidate
            ? {
                ...candidate,
                phone: canReadContacts ? candidate.phone : null,
                email: canReadContacts ? candidate.email : null,
              }
            : null,
          job: record.jobId ? jobMap.get(record.jobId) ?? null : null,
        };
      }),
      page,
      pageSize,
      total,
    };
  }

  /** HR 维护来源与推荐人：只改来源台账与入场记录，不判定有效推荐 */
  async updateSourceRecord(recordId: string, body: SourceInputBody, actor: AuthenticatedUser) {
    const record = await this.prisma.candidateSourceRecord.findUnique({
      where: { id: recordId },
    });
    if (!record) {
      throw new NotFoundException('来源记录不存在');
    }
    if (
      !(await this.authorization.canAccessCandidate(
        actor,
        'intake:manage',
        record.candidateId,
      ))
    ) {
      throw new NotFoundException('来源记录不存在');
    }

    const data: Prisma.CandidateSourceRecordUpdateInput = {};
    if (body.referrerName !== undefined) {
      data.referrerName = this.cleanText(body.referrerName, 50);
    }
    if (body.referrerContact !== undefined) {
      data.referrerContact = this.cleanText(body.referrerContact, 100);
    }
    if (body.referralCode !== undefined) {
      data.referralCode = this.cleanText(body.referralCode, 50);
    }
    if (body.sourceNote !== undefined) {
      data.note = this.cleanText(body.sourceNote, 500);
    }

    const updated = await this.prisma.candidateSourceRecord.update({
      where: { id: record.id },
      data,
    });
    if (record.intakeId) {
      await this.prisma.resumeIntake.update({
        where: { id: record.intakeId },
        data: {
          ...(data.referrerName !== undefined ? { referrerName: data.referrerName } : {}),
          ...(data.referrerContact !== undefined
            ? { referrerContact: data.referrerContact }
            : {}),
          ...(data.referralCode !== undefined ? { referralCode: data.referralCode } : {}),
          ...(data.note !== undefined ? { sourceNote: data.note } : {}),
        },
      });
    }
    await this.timeline.record({
      entityType: 'Candidate',
      entityId: record.candidateId,
      action: 'candidate.source_updated',
      actorId: actor.id,
      payload: {
        sourceRecordId: record.id,
        referrerName: updated.referrerName,
        referralCode: updated.referralCode,
      },
    });
    return updated;
  }

  // ---------- 校招投递门户（功能需求 §4.9） ----------

  /** 门户职位列表：仅开放招聘中的职位，虚拟职位作为校招统一入口优先展示 */
  async listCampusJobs() {
    const jobs = await this.prisma.job.findMany({
      where: { status: JobStatus.ACTIVE },
      select: {
        id: true,
        code: true,
        title: true,
        location: true,
        isVirtual: true,
        headcount: true,
      },
      orderBy: [{ isVirtual: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    });
    return { items: jobs };
  }

  /** 公开投递：虚拟职位进入校招容器，带正式职位投递直入 RECOMMENDED */
  async campusApply(
    body: CampusApplyBody,
    file?: UploadedResumeFile,
  ): Promise<CampusApplyResult> {
    const name = body.name?.trim();
    if (!name) throw new BadRequestException('请填写姓名');
    if (name.length > 50) throw new BadRequestException('姓名超过 50 个字符');
    const phone = normalizePhone(body.phone);
    const email = normalizeEmail(body.email);
    if (!phone && !email) {
      throw new BadRequestException('请填写手机号或邮箱，用于查重与联系');
    }
    const jobId = body.jobId?.trim();
    if (!jobId) throw new BadRequestException('请选择投递职位');
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: { id: true, code: true, title: true, isVirtual: true, status: true },
    });
    if (!job || job.status !== JobStatus.ACTIVE) {
      throw new BadRequestException('职位不存在或已停止投递');
    }

    const sourceFields = this.normalizeSourceFields(body);
    const school = this.cleanText(body.school, 100);
    const major = this.cleanText(body.major, 100);
    const graduationYear = this.cleanText(body.graduationYear, 20);
    const expectedCity = this.cleanText(body.expectedCity, 50);
    const remark = this.cleanText(body.remark, 1000);
    const availableFrom = this.dateBound(body.availableFrom, false) ?? null;
    const preferences = JSON.stringify({
      desiredPositions: this.normalizeDesiredPositions(body.desiredPositions),
      expectedCity,
      school,
      major,
      graduationYear,
      availableFrom: availableFrom ? availableFrom.toISOString() : null,
      remark,
    });

    let validated: Extract<UploadValidationResult, { ok: true }> | null = null;
    let sha256: string | null = null;
    let existingFileId: string | null = null;
    if (file && file.buffer?.length) {
      const validation = validateUpload(
        {
          fileName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
          buffer: file.buffer,
        },
        this.uploadLimits(),
      );
      if (!validation.ok) {
        throw new BadRequestException({ code: validation.code, message: validation.message });
      }
      validated = validation;
      sha256 = createHash('sha256').update(file.buffer).digest('hex');
      const existingFile = await this.prisma.resumeFile.findUnique({
        where: { sha256 },
        select: { id: true },
      });
      existingFileId = existingFile?.id ?? null;
      if (!existingFileId) {
        await this.storage.putObject({
          key: buildResumeStorageKey(sha256, validated.extension),
          body: file.buffer,
          contentType: validated.mimeType,
        });
      }
    }

    const duplicate = await this.findDuplicateCandidate(phone, email);
    if (duplicate) {
      // 重复投递仍保留简历附件与来源，后续由人事合并（FR-ENT-6 / FR-REF-3）
      let duplicateFileId = existingFileId;
      if (file && validated && sha256 && !duplicateFileId) {
        const resumeFile = await this.prisma.resumeFile.create({
          data: {
            sha256,
            fileName: file.originalname,
            mimeType: validated.mimeType,
            size: validated.size,
            storageKey: buildResumeStorageKey(sha256, validated.extension),
            storageDriver: this.storage.driverName,
            expiresAt: expiryFor(new Date(), null, loadRetentionPolicy()),
          },
        });
        duplicateFileId = resumeFile.id;
      }
      const intake = await this.prisma.resumeIntake.create({
        data: {
          source: INTAKE_SOURCE.CAMPUS,
          entryMode: ENTRY_MODE.APPLICATION,
          status: IntakeStatus.DUPLICATE,
          duplicateOfCandidateId: duplicate.id,
          jobId,
          resumeFileId: duplicateFileId,
          referrerName: sourceFields.referrerName,
          referrerContact: sourceFields.referrerContact,
          referralCode: sourceFields.referralCode,
          sourceNote: sourceFields.sourceNote,
        },
      });
      const application = await this.prisma.campusApplication.create({
        data: {
          intakeId: intake.id,
          candidateId: duplicate.id,
          jobId,
          jobIsVirtual: job.isVirtual,
          preferences,
          school,
          major,
          graduationYear,
          expectedCity,
          availableFrom,
          remark,
          status: 'SUBMITTED',
        },
      });
      await this.timeline.record({
        entityType: 'Candidate',
        entityId: duplicate.id,
        action: 'campus.application_duplicate',
        payload: { intakeId: intake.id, applicationId: application.id, jobId },
      });
      // 公开入口返回统一回执，不泄露候选人是否已在全库存在（防 PII 存在性探测）
      return {
        applicationId: application.id,
        status: 'SUBMITTED',
        jobIsVirtual: job.isVirtual,
        message: '投递已收到，人事将尽快审核并与您联系',
      };
    }

    const created = await this.prisma.$transaction(async (tx) => {
      let resumeFileId = existingFileId;
      if (file && validated && sha256 && !resumeFileId) {
        const resumeFile = await tx.resumeFile.create({
          data: {
            sha256,
            fileName: file.originalname,
            mimeType: validated.mimeType,
            size: validated.size,
            storageKey: buildResumeStorageKey(sha256, validated.extension),
            storageDriver: this.storage.driverName,
            expiresAt: expiryFor(new Date(), null, loadRetentionPolicy()),
          },
        });
        resumeFileId = resumeFile.id;
      }

      const candidate = await tx.candidate.create({
        data: {
          name,
          phone,
          email,
          jobId,
          poolType: job.isVirtual ? PoolType.VIRTUAL : PoolType.NONE,
          stage: job.isVirtual ? CandidateStage.VIRTUAL_POOL : CandidateStage.RECOMMENDED,
          source: INTAKE_SOURCE.CAMPUS,
          entryMode: ENTRY_MODE.APPLICATION,
          school,
          appliedAt: new Date(),
        },
      });
      const intake = await tx.resumeIntake.create({
        data: {
          source: INTAKE_SOURCE.CAMPUS,
          entryMode: ENTRY_MODE.APPLICATION,
          status: resumeFileId ? IntakeStatus.RECEIVED : IntakeStatus.PARSED,
          candidateId: candidate.id,
          jobId,
          resumeFileId,
          referrerName: sourceFields.referrerName,
          referrerContact: sourceFields.referrerContact,
          referralCode: sourceFields.referralCode,
          sourceNote: sourceFields.sourceNote,
        },
      });
      await this.createSourceRecord(tx, {
        candidateId: candidate.id,
        intakeId: intake.id,
        source: INTAKE_SOURCE.CAMPUS,
        entryMode: ENTRY_MODE.APPLICATION,
        jobId,
        ...sourceFields,
      });
      let airRun: { id: string } | null = null;
      if (resumeFileId) {
        airRun = await tx.aIRun.create({
          data: {
            type: AiRunType.RESUME_PARSE,
            status: AiRunStatus.PENDING,
            isDraft: true,
            inputRefs: JSON.stringify({
              intakeId: intake.id,
              resumeFileId,
              fileName: file?.originalname,
              mimeType: validated?.mimeType,
              jobId,
              source: INTAKE_SOURCE.CAMPUS,
            }),
          },
          select: { id: true },
        });
        await tx.resumeIntake.update({
          where: { id: intake.id },
          data: { airRunId: airRun.id },
        });
      }
      const application = await tx.campusApplication.create({
        data: {
          intakeId: intake.id,
          candidateId: candidate.id,
          jobId,
          jobIsVirtual: job.isVirtual,
          preferences,
          school,
          major,
          graduationYear,
          expectedCity,
          availableFrom,
          remark,
          status: job.isVirtual ? 'SUBMITTED' : 'ASSIGNED',
          assignedJobId: job.isVirtual ? null : jobId,
          assignedAt: job.isVirtual ? null : new Date(),
        },
      });
      return { candidate, intake, application, airRun };
    });

    if (created.airRun) {
      await this.queue.enqueue(created.intake.id, created.airRun.id);
    }
    await this.timeline.record({
      entityType: 'Candidate',
      entityId: created.candidate.id,
      action: 'candidate.entered',
      payload: {
        intakeId: created.intake.id,
        applicationId: created.application.id,
        source: INTAKE_SOURCE.CAMPUS,
        entryMode: ENTRY_MODE.APPLICATION,
        jobId,
        isVirtual: job.isVirtual,
        referrerName: sourceFields.referrerName,
        referralCode: sourceFields.referralCode,
      },
    });

    // 公开入口返回统一回执，与查重分支结构与文案保持一致（防 PII 存在性探测）
    return {
      applicationId: created.application.id,
      status: 'SUBMITTED',
      jobIsVirtual: job.isVirtual,
      message: '投递已收到，人事将尽快审核并与您联系',
    };
  }

  /** 校招投递列表：展示个人意愿与分配结果，原始意愿不被覆盖 */
  async listCampusApplications(query: CampusApplicationQuery, actor: AuthenticatedUser) {
    const pageSize = this.clampInt(query.pageSize, 20, 1, 100);
    const page = this.clampInt(query.page, 1, 1, Number.MAX_SAFE_INTEGER);
    const candidateConditions: Prisma.CandidateWhereInput[] = [
      this.authorization.candidateWhere(actor, 'intake:read'),
    ];
    const keyword = query.keyword?.trim();
    if (keyword) {
      candidateConditions.push({
        OR: [
          { name: { contains: keyword } },
          { phone: { contains: keyword } },
          { email: { contains: keyword } },
        ],
      });
    }
    const candidates = await this.prisma.candidate.findMany({
      where: { AND: candidateConditions },
      select: { id: true, name: true, phone: true, email: true, stage: true, jobId: true },
    });
    const candidateMap = new Map(candidates.map((candidate) => [candidate.id, candidate]));

    const conditions: Prisma.CampusApplicationWhereInput[] = [
      { candidateId: { in: candidates.map(({ id }) => id) } },
    ];
    const status = query.status?.trim().toUpperCase();
    if (status) conditions.push({ status });
    const jobId = query.jobId?.trim();
    if (jobId) conditions.push({ jobId });
    const where: Prisma.CampusApplicationWhereInput = { AND: conditions };

    const [applications, total, canReadContacts] = await Promise.all([
      this.prisma.campusApplication.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.campusApplication.count({ where }),
      this.authorization.canAccessSensitiveField(
        actor,
        SensitiveField.CANDIDATE_CONTACT,
        'READ',
      ),
    ]);
    const jobIds = this.uniqueStrings(
      applications.flatMap((application) => [application.jobId, application.assignedJobId]),
    );
    const jobs = await this.prisma.job.findMany({
      where: { id: { in: jobIds } },
      select: { id: true, code: true, title: true, isVirtual: true },
    });
    const jobMap = new Map(jobs.map((job) => [job.id, job]));

    return {
      items: applications.map((application) => {
        const candidate = candidateMap.get(application.candidateId ?? '') ?? null;
        return {
          ...application,
          preferences: this.parseJsonObject(application.preferences),
          candidate: candidate
            ? {
                ...candidate,
                phone: canReadContacts ? candidate.phone : null,
                email: canReadContacts ? candidate.email : null,
              }
            : null,
          job: application.jobId ? jobMap.get(application.jobId) ?? null : null,
          assignedJob: application.assignedJobId
            ? jobMap.get(application.assignedJobId) ?? null
            : null,
        };
      }),
      page,
      pageSize,
      total,
    };
  }

  /** 校招批量人工分配正式职位：保留原始意愿，只记录分配结果 */
  async assignCampusApplications(
    applicationIds: string[],
    jobId: string,
    actorId?: string,
  ) {
    const actor = await this.requireActor(actorId);
    const targetJobId = jobId?.trim();
    if (!targetJobId) throw new BadRequestException('jobId is required');
    const ids = [...new Set((applicationIds ?? []).map((id) => id?.trim()).filter(Boolean))];
    if (!ids.length) throw new BadRequestException('至少选择一条校招投递');
    if (ids.length > 200) throw new BadRequestException('单次最多分配 200 条记录');
    await this.assertJobAccessible(targetJobId, actor, 'intake:manage');

    const job = await this.prisma.job.findUnique({
      where: { id: targetJobId },
      select: { id: true, code: true, title: true, isVirtual: true, recruiterId: true },
    });
    if (!job) throw new NotFoundException('职位不存在');
    if (job.isVirtual) {
      throw new BadRequestException('校招人工分配需选择正式职位');
    }

    const applications = await this.prisma.campusApplication.findMany({
      where: { id: { in: ids } },
      select: { id: true, intakeId: true, candidateId: true },
    });
    const results: {
      applicationId: string;
      ok: boolean;
      candidateId?: string | null;
      error?: string;
    }[] = [];
    for (const application of applications) {
      try {
        await this.assignJob(application.intakeId, targetJobId, actor.id);
        results.push({
          applicationId: application.id,
          ok: true,
          candidateId: application.candidateId,
        });
      } catch (error) {
        results.push({
          applicationId: application.id,
          ok: false,
          error: error instanceof Error ? error.message : '分配失败',
        });
      }
    }
    for (const id of ids.filter((id) => !applications.some((item) => item.id === id))) {
      results.push({ applicationId: id, ok: false, error: '校招投递记录不存在' });
    }

    return {
      job,
      assigned: results.filter((item) => item.ok).length,
      failed: results.filter((item) => !item.ok).length,
      results,
    };
  }

  private async createFileIntake(params: {
    file: UploadedResumeFile;
    validated: Extract<UploadValidationResult, { ok: true }>;
    sha256: string;
    source: string;
    entryMode: string;
    jobId: string | null;
    intentId: string | null;
    sourceFields?: SourceFields;
    actor: AuthenticatedUser;
    mockOutcome?: MockOutcome;
    mail?: {
      from: string | null;
      subject: string | null;
      mailboxAddress: string | null;
      receivedAt: Date;
    };
  }): Promise<IntakeResult> {
    const { file, validated, sha256, source, entryMode, jobId, intentId, actor } = params;
    const sourceFields: SourceFields = params.sourceFields ?? {
      referrerName: null,
      referrerContact: null,
      referralCode: null,
      sourceNote: null,
    };
    const actorId = actor.id;

    const existingFile = await this.prisma.resumeFile.findUnique({
      where: { sha256 },
      include: {
        intakes: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    if (existingFile) {
      const previous = existingFile.intakes[0] ?? null;
      const duplicateCandidateId = previous?.candidateId &&
        (await this.authorization.canAccessCandidate(
          actor,
          'intake:manage',
          previous.candidateId,
        ))
        ? previous.candidateId
        : null;
      const intake = await this.prisma.resumeIntake.create({
        data: {
          source,
          entryMode,
          status: IntakeStatus.DUPLICATE,
          resumeFileId: existingFile.id,
          duplicateOfCandidateId: duplicateCandidateId,
          createdById: actorId,
          jobId,
          intentId,
          mailFrom: params.mail?.from ?? null,
          mailSubject: params.mail?.subject ?? null,
          mailboxAddress: params.mail?.mailboxAddress ?? null,
          receivedAt: params.mail?.receivedAt ?? null,
          referrerName: sourceFields.referrerName,
          referrerContact: sourceFields.referrerContact,
          referralCode: sourceFields.referralCode,
          sourceNote: sourceFields.sourceNote,
        },
      });
      await this.timeline.record({
        entityType: 'ResumeIntake',
        entityId: intake.id,
        action: 'intake.duplicate',
        actorId,
        payload: {
          sha256,
          resumeFileId: existingFile.id,
          candidateId: duplicateCandidateId,
          entryMode,
        },
      });
      return {
        intakeId: intake.id,
        candidateId: duplicateCandidateId,
        airRunId: null,
        status: intake.status,
        duplicate: true,
        parseQueued: false,
      };
    }

    const storageKey = buildResumeStorageKey(sha256, validated.extension);
    await this.storage.putObject({
      key: storageKey,
      body: file.buffer,
      contentType: validated.mimeType,
    });

    const created = await this.prisma.$transaction(async (tx) => {
      const resumeFile = await tx.resumeFile.create({
        data: {
          sha256,
          fileName: file.originalname,
          mimeType: validated.mimeType,
          size: validated.size,
          storageKey,
          storageDriver: this.storage.driverName,
          expiresAt: expiryFor(new Date(), null, loadRetentionPolicy()),
        },
      });

      const candidate = await tx.candidate.create({
        data: {
          name: '待解析候选人',
          jobId,
          poolType: jobId ? PoolType.NONE : PoolType.UNASSIGNED,
          stage: jobId ? CandidateStage.RECOMMENDED : CandidateStage.UNASSIGNED,
          source,
          entryMode,
          intentId,
          createdById: actorId,
          appliedAt: new Date(),
        },
      });

      const intake = await tx.resumeIntake.create({
        data: {
          source,
          entryMode,
          status: IntakeStatus.RECEIVED,
          candidateId: candidate.id,
          createdById: actorId,
          jobId,
          intentId,
          resumeFileId: resumeFile.id,
          mailFrom: params.mail?.from ?? null,
          mailSubject: params.mail?.subject ?? null,
          mailboxAddress: params.mail?.mailboxAddress ?? null,
          receivedAt: params.mail?.receivedAt ?? null,
          referrerName: sourceFields.referrerName,
          referrerContact: sourceFields.referrerContact,
          referralCode: sourceFields.referralCode,
          sourceNote: sourceFields.sourceNote,
        },
      });

      await this.createSourceRecord(tx, {
        candidateId: candidate.id,
        intakeId: intake.id,
        source,
        entryMode,
        jobId,
        ...sourceFields,
        createdById: actorId,
      });

      const airRun = await tx.aIRun.create({
        data: {
          type: AiRunType.RESUME_PARSE,
          status: AiRunStatus.PENDING,
          isDraft: true,
          inputRefs: JSON.stringify({
            intakeId: intake.id,
            resumeFileId: resumeFile.id,
            fileName: file.originalname,
            mimeType: file.mimetype,
            jobId,
            mockOutcome: params.mockOutcome,
          }),
        },
      });

      const updatedIntake = await tx.resumeIntake.update({
        where: { id: intake.id },
        data: { airRunId: airRun.id },
      });

      return { intake: updatedIntake, candidate, airRun };
    });

    const parseQueued = await this.queue.enqueue(
      created.intake.id,
      created.airRun.id,
    );

    await this.timeline.record({
      entityType: 'Candidate',
      entityId: created.candidate.id,
      action: 'candidate.entered',
      actorId,
      payload: {
        intakeId: created.intake.id,
        airRunId: created.airRun.id,
        source,
        entryMode,
        jobId,
        parseQueued,
      },
    });

    return {
      intakeId: created.intake.id,
      candidateId: created.candidate.id,
      airRunId: created.airRun.id,
      status: created.intake.status,
      duplicate: false,
      parseQueued,
    };
  }

  private async recordRejectedFile(
    file: UploadedResumeFile,
    params: {
      source: string;
      entryMode: string;
      jobId: string | null;
      actorId: string;
      errorCode: string;
      errorMessage: string;
      mailFrom?: string | null;
      mailSubject?: string | null;
      mailboxAddress?: string | null;
      receivedAt?: Date;
    },
  ): Promise<IntakeResult> {
    const intake = await this.prisma.resumeIntake.create({
      data: {
        source: params.source,
        entryMode: params.entryMode,
        status: IntakeStatus.FAILED,
        createdById: params.actorId,
        jobId: params.jobId,
        errorCode: params.errorCode,
        errorMessage: params.errorMessage,
        mailFrom: params.mailFrom ?? null,
        mailSubject: params.mailSubject ?? null,
        mailboxAddress: params.mailboxAddress ?? null,
        receivedAt: params.receivedAt ?? null,
      },
    });

    this.logger.warn(
      `Rejected resume ${file.originalname}: ${params.errorMessage}`,
    );

    await this.timeline.record({
      entityType: 'ResumeIntake',
      entityId: intake.id,
      action: 'intake.rejected',
      actorId: params.actorId,
      payload: {
        fileName: file.originalname,
        errorCode: params.errorCode,
        entryMode: params.entryMode,
      },
    });

    return {
      intakeId: intake.id,
      candidateId: null,
      airRunId: null,
      status: intake.status,
      duplicate: false,
      parseQueued: false,
      errorCode: params.errorCode,
      errorMessage: params.errorMessage,
    };
  }

  private async findDuplicateCandidate(
    phone: string | null,
    email: string | null,
  ) {
    const conditions = [];
    if (phone) {
      conditions.push({ phone });
    }
    if (email) {
      conditions.push({ email });
    }
    if (conditions.length === 0) {
      return null;
    }
    return this.prisma.candidate.findFirst({
      where: { OR: conditions },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async buildIntakeWhere(
    query: IntakeListQuery,
    actor: AuthenticatedUser,
    permission: string,
  ): Promise<Prisma.ResumeIntakeWhereInput> {
    const conditions: Prisma.ResumeIntakeWhereInput[] = [];

    if (query.status) {
      if (!Object.values(IntakeStatus).includes(query.status as IntakeStatus)) {
        throw new BadRequestException(`Unsupported status: ${query.status}`);
      }
      conditions.push({ status: query.status as IntakeStatus });
    }
    if (query.entryMode) {
      this.assertEntryMode(query.entryMode);
      conditions.push({ entryMode: query.entryMode });
    }
    if (query.source) {
      this.assertSource(query.source);
      conditions.push({ source: query.source });
    }
    const jobId = query.jobId?.trim();
    if (jobId) conditions.push({ jobId });
    const mailbox = query.mailbox?.trim();
    // 邮箱口径按「接收简历的招聘邮箱」筛选，不按候选人发件地址（NFR-8）
    if (mailbox) conditions.push({ mailboxAddress: { contains: mailbox } });

    const createdFrom = this.dateBound(query.createdFrom, false);
    const createdTo = this.dateBound(query.createdTo, true);
    if (createdFrom || createdTo) {
      conditions.push({
        createdAt: { gte: createdFrom, lte: createdTo },
      });
    }
    const receivedFrom = this.dateBound(query.receivedFrom, false);
    const receivedTo = this.dateBound(query.receivedTo, true);
    if (receivedFrom || receivedTo) {
      conditions.push({
        receivedAt: { gte: receivedFrom, lte: receivedTo },
      });
    }

    const scopes = this.authorization.scopesFor(actor, permission);
    if (!scopes.includes(DataScope.ALL)) {
      const [candidates, jobs] = await Promise.all([
        this.prisma.candidate.findMany({
          where: this.authorization.candidateWhere(actor, permission),
          select: { id: true },
        }),
        this.prisma.job.findMany({
          where: this.authorization.jobWhere(actor, permission),
          select: { id: true },
        }),
      ]);
      const clauses: Prisma.ResumeIntakeWhereInput[] = [];
      if (scopes.includes(DataScope.SELF) || scopes.includes(DataScope.OWN_JOBS)) {
        clauses.push({ createdById: actor.id });
      }
      if (candidates.length) {
        const candidateIds = candidates.map(({ id }) => id);
        clauses.push(
          { candidateId: { in: candidateIds } },
          { duplicateOfCandidateId: { in: candidateIds } },
        );
      }
      if (jobs.length) clauses.push({ jobId: { in: jobs.map(({ id }) => id) } });
      conditions.push({ OR: clauses.length ? clauses : [{ id: '__no_access__' }] });
    }

    return conditions.length ? { AND: conditions } : {};
  }

  /** 列表展示所需的候选人/职位/解析状态摘要，避免前端再逐条请求 */
  private async enrichIntakes(items: IntakeWithFile[]) {
    const candidateIds = this.uniqueStrings(
      items.flatMap((item) => [item.candidateId, item.duplicateOfCandidateId]),
    );
    const jobIds = this.uniqueStrings(items.map((item) => item.jobId));
    const airRunIds = this.uniqueStrings(items.map((item) => item.airRunId));

    const [candidates, jobs, airRuns] = await Promise.all([
      this.prisma.candidate.findMany({
        where: { id: { in: candidateIds } },
        select: {
          id: true,
          name: true,
          stage: true,
          poolType: true,
          jobId: true,
          appliedAt: true,
        },
      }),
      this.prisma.job.findMany({
        where: { id: { in: jobIds } },
        select: { id: true, code: true, title: true, isVirtual: true, recruiterId: true },
      }),
      this.prisma.aIRun.findMany({
        where: { id: { in: airRunIds } },
        select: { id: true, status: true, isDraft: true, attempts: true, errorCode: true },
      }),
    ]);

    const candidateMap = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    const jobMap = new Map(jobs.map((job) => [job.id, job]));
    const airRunMap = new Map(airRuns.map((run) => [run.id, run]));

    return items.map((item) => ({
      ...item,
      candidate: item.candidateId ? candidateMap.get(item.candidateId) ?? null : null,
      duplicateCandidate: item.duplicateOfCandidateId
        ? candidateMap.get(item.duplicateOfCandidateId) ?? null
        : null,
      job: item.jobId ? jobMap.get(item.jobId) ?? null : null,
      aiRun: item.airRunId ? airRunMap.get(item.airRunId) ?? null : null,
    }));
  }

  private async assertExcelBatchAccessible(
    createdById: string | null,
    actor: AuthenticatedUser,
  ): Promise<void> {
    if (createdById && createdById === actor.id) return;
    const scopes = this.authorization.scopesFor(actor, 'intake:read');
    if (scopes.includes(DataScope.ALL)) return;
    throw new NotFoundException('Excel 导入批次不存在');
  }

  private uniqueStrings(values: (string | null | undefined)[]): string[] {
    return [...new Set(values.filter((value): value is string => Boolean(value)))];
  }

  private clampInt(
    value: number | string | undefined,
    fallback: number,
    min: number,
    max: number,
  ): number {
    const parsed = Number(value ?? fallback);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(Math.trunc(parsed), min), max);
  }

  private dateBound(value: string | undefined, endOfDay: boolean): Date | undefined {
    const text = value?.trim();
    if (!text) return undefined;
    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`时间格式不正确：${text}`);
    }
    if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(text)) {
      parsed.setHours(23, 59, 59, 999);
    }
    return parsed;
  }

  private average(values: number[]): number | null {
    if (!values.length) return null;
    const sum = values.reduce((total, value) => total + value, 0);
    return Math.round(sum / values.length);
  }

  private percentile(values: number[], ratio: number): number | null {
    if (!values.length) return null;
    const index = Math.min(values.length - 1, Math.floor(values.length * ratio));
    return values[index];
  }

  private async requireActor(actorId?: string): Promise<AuthenticatedUser> {
    if (!actorId) throw new UnauthorizedException('需要登录后继续');
    return this.authorization.loadUserContext(actorId);
  }

  private async assertJobAccessible(
    jobId: string,
    actor: AuthenticatedUser,
    permission: string,
  ): Promise<void> {
    if (!(await this.authorization.canAccessJob(actor, permission, jobId))) {
      throw new NotFoundException('职位不存在');
    }
  }

  private async assertIntakeAccessible(
    intake: {
      candidateId: string | null;
      duplicateOfCandidateId: string | null;
      jobId: string | null;
      createdById: string | null;
    },
    actor: AuthenticatedUser,
    permission: string,
  ): Promise<void> {
    if (!(await this.authorization.canAccessIntake(actor, permission, intake))) {
      throw new NotFoundException('简历入场记录不存在');
    }
  }

  private uploadLimits() {
    return {
      maxBytes: resumeMaxBytes(),
      allowedExtensions: ALLOWED_RESUME_EXTENSIONS,
    };
  }

  private filterSensitiveOutput(
    output: string | null,
    canReadContacts: boolean,
  ): string | null {
    if (canReadContacts || !output) return output;
    try {
      const value: unknown = JSON.parse(output);
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
      const profile = value as Record<string, unknown>;
      for (const field of ['phone', 'email', 'contactEmail']) {
        const contact = profile[field];
        if (typeof contact === 'string') {
          profile[field] = null;
        } else if (contact && typeof contact === 'object' && !Array.isArray(contact)) {
          (contact as Record<string, unknown>).value = null;
        }
      }
      return JSON.stringify(profile);
    } catch {
      return null;
    }
  }

  private normalizeSourceFields(body: SourceInputBody): SourceFields {
    return {
      referrerName: this.cleanText(body.referrerName, 50),
      referrerContact: this.cleanText(body.referrerContact, 100),
      referralCode: this.cleanText(body.referralCode, 50),
      sourceNote: this.cleanText(body.sourceNote, 500),
    };
  }

  private cleanText(value: string | null | undefined, max: number): string | null {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) return null;
    if (text.length > max) {
      throw new BadRequestException(`文本超过 ${max} 个字符`);
    }
    return text;
  }

  private normalizeDesiredPositions(value: string | string[] | undefined): string[] {
    const raw = Array.isArray(value)
      ? value
      : typeof value === 'string'
        ? value.split(/[,，;；]/)
        : [];
    return [...new Set(raw.map((item) => String(item).trim()).filter(Boolean))].slice(0, 5);
  }

  private parseJsonObject(value: string | null): Record<string, unknown> {
    if (!value) return {};
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // 非法历史数据按空对象返回，避免列表整体失败
    }
    return {};
  }

  private async createSourceRecord(
    client: { candidateSourceRecord: PrismaService['candidateSourceRecord'] },
    params: {
      candidateId: string;
      intakeId: string | null;
      source: string;
      entryMode?: string | null;
      jobId?: string | null;
      referrerName?: string | null;
      referrerContact?: string | null;
      referralCode?: string | null;
      sourceNote?: string | null;
      mergedFromCandidateId?: string | null;
      createdById?: string | null;
    },
  ) {
    if (!params.intakeId) return null;
    return client.candidateSourceRecord.create({
      data: {
        candidateId: params.candidateId,
        intakeId: params.intakeId,
        source: params.source,
        entryMode: params.entryMode ?? null,
        jobId: params.jobId ?? null,
        referrerName: params.referrerName ?? null,
        referrerContact: params.referrerContact ?? null,
        referralCode: params.referralCode ?? null,
        note: params.sourceNote ?? null,
        mergedFromCandidateId: params.mergedFromCandidateId ?? null,
        createdById: params.createdById ?? null,
      },
    });
  }

  private assertSource(source: string): void {
    if (!ALLOWED_SOURCES.has(source)) {
      throw new BadRequestException(`Unsupported source: ${source}`);
    }
  }

  private assertEntryMode(entryMode: string): void {
    if (!ALLOWED_ENTRY_MODES.has(entryMode)) {
      throw new BadRequestException(`Unsupported entryMode: ${entryMode}`);
    }
  }
}

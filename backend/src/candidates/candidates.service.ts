import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CandidateStage as DbCandidateStage, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

const uiStages = ['new', 'screening', 'interview', 'offer', 'hired', 'rejected'] as const;
type UiStage = (typeof uiStages)[number];

const toDatabaseStage: Record<UiStage, DbCandidateStage> = {
  new: DbCandidateStage.RECOMMENDED,
  screening: DbCandidateStage.HR_SCREENING,
  interview: DbCandidateStage.INTERVIEWING,
  offer: DbCandidateStage.OFFERING,
  hired: DbCandidateStage.ONBOARDED,
  rejected: DbCandidateStage.ARCHIVED,
};

const stageOrder: Record<Exclude<UiStage, 'rejected'>, number> = {
  new: 0,
  screening: 1,
  interview: 2,
  offer: 3,
  hired: 4,
};

const avatarColors = ['#6675E8', '#19A77C', '#E27D62', '#D58A28', '#BF7BD5'];

type CandidateInput = {
  name?: unknown;
  phone?: unknown;
  email?: unknown;
  jobId?: unknown;
  source?: unknown;
  tags?: unknown;
  rating?: unknown;
  experience?: unknown;
  education?: unknown;
  school?: unknown;
  currentCompany?: unknown;
  currentTitle?: unknown;
  summary?: unknown;
  resumeName?: unknown;
  workHistory?: unknown;
  note?: unknown;
};

type StageInput = { stage?: unknown };

type CandidateWithJob = Prisma.CandidateGetPayload<{ include: { job: true } }>;

@Injectable()
export class CandidatesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(page = 1, pageSize = 100) {
    const safePage = Number.isInteger(page) && page > 0 ? page : 1;
    const safePageSize = Number.isInteger(pageSize) ? Math.min(Math.max(pageSize, 1), 100) : 100;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.candidate.findMany({
        include: { job: true },
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (safePage - 1) * safePageSize,
        take: safePageSize,
      }),
      this.prisma.candidate.count(),
    ]);

    return {
      items: items.map((candidate) => this.toCandidateDto(candidate)),
      page: safePage,
      pageSize: safePageSize,
      total,
    };
  }

  async get(id: string) {
    const candidate = await this.prisma.candidate.findUnique({
      where: { id },
      include: { job: true },
    });
    if (!candidate) throw new NotFoundException('候选人不存在');
    return this.toCandidateDto(candidate);
  }

  async timeline(id: string) {
    const exists = await this.prisma.candidate.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException('候选人不存在');

    const events = await this.prisma.timelineEvent.findMany({
      where: { entityType: 'Candidate', entityId: id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return events.map((event) => ({
      id: event.id,
      action: event.action,
      payload: event.payload,
      actor: event.actorId ?? '系统',
      createdAt: event.createdAt.toISOString(),
    }));
  }

  async listJobs() {
    return this.prisma.job.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true,
        title: true,
        departmentId: true,
        location: true,
        headcount: true,
        hiredCount: true,
      },
      orderBy: { title: 'asc' },
    });
  }

  async create(value: unknown) {
    const input = this.asRecord<CandidateInput>(value);
    const name = this.requiredText(input.name, '候选人姓名不能为空');
    const jobId = this.optionalText(input.jobId);
    const phone = this.optionalText(input.phone);
    const email = this.optionalText(input.email);
    const source = this.optionalText(input.source) ?? '未知来源';
    const tags = Array.isArray(input.tags) ? input.tags.filter((tag): tag is string => typeof tag === 'string') : [];
    const rating = typeof input.rating === 'number' && Number.isFinite(input.rating)
      ? Math.min(Math.max(Math.round(input.rating), 0), 5)
      : null;

    return this.prisma.$transaction(async (tx) => {
      const candidate = await tx.candidate.create({
        data: {
          name,
          phone,
          email,
          jobId,
          poolType: jobId ? 'NONE' : 'UNASSIGNED',
          stage: jobId ? DbCandidateStage.RECOMMENDED : DbCandidateStage.UNASSIGNED,
          source,
          entryMode: 'MANUAL',
          tags: JSON.stringify(tags),
          rating,
          experience: this.optionalText(input.experience),
          education: this.optionalText(input.education),
          school: this.optionalText(input.school),
          currentCompany: this.optionalText(input.currentCompany),
          currentTitle: this.optionalText(input.currentTitle),
          summary: this.optionalText(input.summary),
          resumeName: this.optionalText(input.resumeName),
          workHistory: this.workHistory(input.workHistory),
          note: this.optionalText(input.note),
          appliedAt: new Date(),
        },
        include: { job: true },
      });

      await tx.timelineEvent.create({
        data: {
          entityType: 'Candidate',
          entityId: candidate.id,
          action: 'candidate.created',
          payload: {
            stage: this.toUiStage(candidate.stage),
            jobId: candidate.jobId,
            source: candidate.source,
          },
        },
      });

      return this.toCandidateDto(candidate);
    });
  }

  async updateStage(id: string, value: unknown) {
    const input = this.asRecord<StageInput>(value);
    if (typeof input.stage !== 'string' || !uiStages.includes(input.stage as UiStage)) {
      throw new BadRequestException(`阶段必须是以下值之一：${uiStages.join(', ')}`);
    }
    const nextUiStage = input.stage as UiStage;
    const nextDbStage = toDatabaseStage[nextUiStage];

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.candidate.findUnique({ where: { id }, include: { job: true } });
      if (!current) throw new NotFoundException('候选人不存在');

      const currentUiStage = this.toUiStage(current.stage);
      if (currentUiStage === nextUiStage) return this.toCandidateDto(current);

      if (nextUiStage !== 'rejected' && currentUiStage !== 'rejected') {
        const currentOrder = stageOrder[currentUiStage as Exclude<UiStage, 'rejected'>];
        const nextOrder = stageOrder[nextUiStage as Exclude<UiStage, 'rejected'>];
        if (nextOrder <= currentOrder) {
          throw new ConflictException('候选人阶段只能向前推进；淘汰后不能直接恢复');
        }
      } else if (currentUiStage === 'rejected') {
        throw new ConflictException('已归档候选人需要通过人才库激活流程恢复');
      }

      const updated = await tx.candidate.update({
        where: { id },
        data: { stage: nextDbStage },
        include: { job: true },
      });

      await tx.timelineEvent.create({
        data: {
          entityType: 'Candidate',
          entityId: id,
          action: 'candidate.stage_changed',
          payload: {
            from: currentUiStage,
            to: nextUiStage,
            databaseFrom: current.stage,
            databaseTo: nextDbStage,
          },
        },
      });

      return this.toCandidateDto(updated);
    });
  }

  private toCandidateDto(candidate: CandidateWithJob) {
    return {
      id: candidate.id,
      name: candidate.name,
      phone: candidate.phone ?? '待补充',
      email: candidate.email ?? '待补充',
      jobId: candidate.jobId ?? '',
      jobTitle: candidate.job?.title ?? '',
      jobLocation: candidate.job?.location ?? '',
      departmentId: candidate.job?.departmentId ?? '',
      departmentName: '',
      departmentColor: '#8390A5',
      stage: this.toUiStage(candidate.stage),
      source: candidate.source ?? '未知来源',
      experience: candidate.experience ?? '待补充',
      education: candidate.education ?? '待补充',
      school: candidate.school ?? '待补充',
      currentCompany: candidate.currentCompany ?? '待补充',
      currentTitle: candidate.currentTitle ?? '待补充',
      tags: this.parseTags(candidate.tags),
      rating: candidate.rating ?? 0,
      appliedAt: (candidate.appliedAt ?? candidate.createdAt).toISOString().slice(0, 10),
      lastActivity: this.relativeDate(candidate.updatedAt),
      owner: '待分配',
      avatarColor: this.avatarColor(candidate.id),
      summary: candidate.summary ?? '候选人档案资料待补充。',
      resumeName: candidate.resumeName ?? '暂无附件简历',
      workHistory: this.parseWorkHistory(candidate.workHistory),
      note: candidate.note ?? undefined,
      updatedAt: candidate.updatedAt.toISOString(),
    };
  }

  private toUiStage(stage: DbCandidateStage): UiStage {
    switch (stage) {
      case DbCandidateStage.UNASSIGNED:
      case DbCandidateStage.VIRTUAL_POOL:
      case DbCandidateStage.RECOMMENDED:
        return 'new';
      case DbCandidateStage.HR_SCREENING:
      case DbCandidateStage.DEPT_SCREENING:
        return 'screening';
      case DbCandidateStage.INTERVIEWING:
        return 'interview';
      case DbCandidateStage.OFFERING:
      case DbCandidateStage.PENDING_ONBOARD:
        return 'offer';
      case DbCandidateStage.ONBOARDED:
      case DbCandidateStage.PROBATION:
        return 'hired';
      case DbCandidateStage.ENDED:
      case DbCandidateStage.ARCHIVED:
        return 'rejected';
    }
  }

  private parseTags(tags: string | null): string[] {
    if (!tags) return [];
    try {
      const parsed: unknown = JSON.parse(tags);
      if (Array.isArray(parsed)) return parsed.filter((tag): tag is string => typeof tag === 'string');
    } catch {
      // Older records may contain comma-separated tags.
    }
    return tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean);
  }

  private workHistory(value: unknown): Prisma.InputJsonValue | undefined {
    if (!Array.isArray(value)) return undefined;
    const entries = value.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const item = entry as Record<string, unknown>;
      return [{
        company: typeof item.company === 'string' ? item.company.slice(0, 200) : '',
        title: typeof item.title === 'string' ? item.title.slice(0, 200) : '',
        period: typeof item.period === 'string' ? item.period.slice(0, 100) : '',
      }];
    });
    return entries;
  }

  private parseWorkHistory(value: Prisma.JsonValue | null): { company: string; title: string; period: string }[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
      const item = entry as Prisma.JsonObject;
      return [{
        company: typeof item.company === 'string' ? item.company : '',
        title: typeof item.title === 'string' ? item.title : '',
        period: typeof item.period === 'string' ? item.period : '',
      }];
    });
  }

  private avatarColor(id: string): string {
    let hash = 0;
    for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return avatarColors[hash % avatarColors.length];
  }

  private relativeDate(date: Date): string {
    const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
    if (days <= 0) return '今天';
    if (days === 1) return '昨天';
    return `${days}天前`;
  }

  private asRecord<T>(value: unknown): T {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException('请求体格式不正确');
    }
    return value as T;
  }

  private requiredText(value: unknown, message: string): string {
    if (typeof value !== 'string' || !value.trim()) throw new BadRequestException(message);
    return value.trim();
  }

  private optionalText(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    return text && text !== '待补充' ? text : null;
  }
}

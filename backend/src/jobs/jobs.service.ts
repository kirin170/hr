import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CandidateStage, JobStatus, Prisma } from '@prisma/client';
import { AuthorizationService } from '../auth/authorization.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { parseDateValue } from '../requisitions/requisition-cycle.js';

export type JobListQuery = {
  page?: string;
  pageSize?: string;
  code?: string;
  keyword?: string;
  departmentId?: string;
  recruiterId?: string;
  channel?: string;
  status?: string;
  isVirtual?: string;
  resumeUpdatedFrom?: string;
  resumeUpdatedTo?: string;
  sort?: string;
  order?: string;
};

const listSorts = ['code', 'createdAt', 'updatedAt'] as const;
type ListSort = (typeof listSorts)[number];

const closedStages: CandidateStage[] = [
  CandidateStage.ARCHIVED,
  CandidateStage.ENDED,
  CandidateStage.ONBOARDED,
];

export type JobDto = {
  id: string;
  code: string;
  title: string;
  departmentId: string;
  location: string | null;
  recruiterId: string | null;
  requirements: string | null;
  headcount: number;
  hiredCount: number;
  status: JobStatus;
  interviewPlanId: string | null;
  channel: string | null;
  isVirtual: boolean;
  requisitionId: string | null;
  requisition: { id: string; oaApprovalId: string; title: string; status: string } | null;
  headcountFull: boolean;
  headcountHint: string | null;
  createdAt: string;
  updatedAt: string;
};

@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
  ) {}

  async list(actor: AuthenticatedUser, query: JobListQuery = {}) {
    const page = this.positiveInt(query.page, 1, Number.MAX_SAFE_INTEGER);
    const pageSize = this.positiveInt(query.pageSize, 20, 100);
    const conditions: Prisma.JobWhereInput[] = [
      this.authorization.jobWhere(actor, 'job:read'),
    ];

    const code = this.optionalText(query.code);
    if (code) conditions.push({ code: { contains: code } });
    const keyword = this.optionalText(query.keyword);
    if (keyword) conditions.push({ title: { contains: keyword } });
    const departmentId = this.optionalText(query.departmentId);
    if (departmentId) conditions.push({ departmentId });
    const recruiterId = this.optionalText(query.recruiterId);
    if (recruiterId) conditions.push({ recruiterId });
    const channel = this.optionalText(query.channel);
    if (channel) conditions.push({ sources: { contains: channel } });

    if (query.status) {
      if (query.status !== JobStatus.ACTIVE && query.status !== JobStatus.CLOSED) {
        throw new BadRequestException('状态必须为 ACTIVE 或 CLOSED');
      }
      conditions.push({ status: query.status });
    }

    // 虚拟职位默认不进入普通职位筛选集（FR-JOB-6）。
    conditions.push({ isVirtual: this.booleanFlag(query.isVirtual, false) });

    const resumeRange = this.resumeUpdatedRange(query.resumeUpdatedFrom, query.resumeUpdatedTo);
    if (resumeRange) conditions.push({ candidates: { some: { updatedAt: resumeRange } } });

    const where: Prisma.JobWhereInput = { AND: conditions };
    const [items, total] = await Promise.all([
      this.prisma.job.findMany({
        where,
        include: {
          requisition: { select: { id: true, oaApprovalId: true, title: true, status: true } },
        },
        orderBy: this.orderBy(query.sort, query.order),
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.job.count({ where }),
    ]);

    return { items: items.map((job) => this.toDto(job)), page, pageSize, total };
  }

  /** 虚拟职位（校招容器）列表，仅用于入场容器，不进入普通职位筛选默认集。 */
  async listVirtual(actor: AuthenticatedUser) {
    const items = await this.prisma.job.findMany({
      where: {
        AND: [this.authorization.jobWhere(actor, 'job:read'), { isVirtual: true }],
      },
      orderBy: { code: 'asc' },
      take: 200,
    });
    return { items: items.map((job) => this.toDto(job)), total: items.length };
  }

  async get(id: string, actor: AuthenticatedUser) {
    const job = await this.prisma.job.findFirst({
      where: { AND: [{ id }, this.authorization.jobWhere(actor, 'job:read')] },
      include: {
        requisition: { select: { id: true, oaApprovalId: true, title: true, status: true } },
        _count: { select: { candidates: true } },
      },
    });
    if (!job) throw new NotFoundException('职位不存在');
    return {
      ...this.toDto(job),
      candidateCount: job._count.candidates,
      requirementsEditableBy:
        job.recruiterId ?? '未指定招聘负责人，需先指定后才能维护招聘要求',
    };
  }

  async create(value: unknown, actor: AuthenticatedUser) {
    const input = this.asRecord(value);
    const title = this.requiredText(input.title, '职位名称不能为空');
    const departmentId = this.requiredText(input.departmentId, '部门不能为空');
    await this.assertDepartment(departmentId);
    const headcount = this.nonNegativeInt(input.headcount, 0, '招聘人数必须为非负整数');
    const recruiterId = this.optionalText(input.recruiterId);
    if (recruiterId) await this.assertUser(recruiterId);
    const requisitionId = this.optionalText(input.requisitionId);
    if (requisitionId) await this.assertRequisition(requisitionId);
    const data = {
      title,
      departmentId,
      location: this.optionalText(input.location),
      recruiterId,
      requirements: this.optionalText(input.requirements),
      headcount,
      sources: this.optionalText(input.sources),
      interviewPlanId: this.optionalText(input.interviewPlanId),
      isVirtual: this.booleanFlag(
        typeof input.isVirtual === 'boolean' ? String(input.isVirtual) : input.isVirtual,
        false,
      ),
      requisitionId,
    };

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const code = await this.nextJobCode(tx);
          const job = await tx.job.create({ data: { ...data, code } });
          await tx.timelineEvent.create({
            data: {
              entityType: 'Job',
              entityId: job.id,
              actorId: actor.id,
              action: 'job.created',
              payload: { code, title, departmentId, headcount, isVirtual: data.isVirtual },
            },
          });
          return this.toDto(job);
        });
      } catch (error) {
        if (!this.isUniqueViolation(error, 'code')) throw error;
      }
    }
    throw new ConflictException('职位编号生成冲突，请重试');
  }

  async update(id: string, value: unknown, actor: AuthenticatedUser) {
    const input = this.asRecord(value);
    const current = await this.findScoped(id, actor, 'job:update');
    const data: Prisma.JobUpdateInput = {};
    const changes: Record<string, { from: unknown; to: unknown }> = {};

    const assign = (field: keyof Prisma.JobUpdateInput, next: unknown, previous: unknown) => {
      if (next === previous) return;
      (data as Record<string, unknown>)[field] = next;
      changes[field] = { from: previous ?? null, to: next ?? null };
    };

    if ('title' in input) {
      assign('title', this.requiredText(input.title, '职位名称不能为空'), current.title);
    }
    if ('departmentId' in input) {
      const next = this.requiredText(input.departmentId, '部门不能为空');
      await this.assertDepartment(next);
      assign('departmentId', next, current.departmentId);
    }
    if ('location' in input) {
      assign('location', this.optionalText(input.location), current.location);
    }
    if ('recruiterId' in input) {
      const next = this.optionalText(input.recruiterId);
      if (next) await this.assertUser(next);
      assign('recruiterId', next, current.recruiterId);
    }
    if ('requirements' in input) {
      const next = this.optionalText(input.requirements);
      if (next !== current.requirements) {
        const isAdmin = actor.roles.some((role) => role.code === 'ADMIN');
        if (!isAdmin && current.recruiterId !== actor.id) {
          throw new ForbiddenException('仅该职位的招聘负责人可编辑招聘要求');
        }
      }
      assign('requirements', next, current.requirements);
    }
    if ('headcount' in input) {
      const next = this.nonNegativeInt(input.headcount, current.headcount, '招聘人数必须为非负整数');
      if (next < current.hiredCount) {
        throw new BadRequestException('招聘人数不能小于已入职人数');
      }
      assign('headcount', next, current.headcount);
    }
    if ('sources' in input) {
      assign('sources', this.optionalText(input.sources), current.sources);
    }
    if ('interviewPlanId' in input) {
      assign('interviewPlanId', this.optionalText(input.interviewPlanId), current.interviewPlanId);
    }
    if ('isVirtual' in input) {
      assign(
        'isVirtual',
        this.booleanFlag(
          typeof input.isVirtual === 'boolean' ? String(input.isVirtual) : input.isVirtual,
          current.isVirtual,
        ),
        current.isVirtual,
      );
    }
    if ('status' in input) {
      if (input.status !== JobStatus.ACTIVE && input.status !== JobStatus.CLOSED) {
        throw new BadRequestException('状态必须为 ACTIVE 或 CLOSED');
      }
      assign('status', input.status, current.status);
    }

    if (Object.keys(changes).length === 0) {
      return this.toDto(current);
    }

    const updated = await this.prisma.job.update({ where: { id }, data });
    await this.prisma.timelineEvent.create({
      data: {
        entityType: 'Job',
        entityId: id,
        actorId: actor.id,
        action: 'job.updated',
        payload: { changes, operator: actor.id } as unknown as Prisma.InputJsonObject,
      },
    });
    return this.toDto(updated);
  }

  /** 关闭职位：仅停止新简历进入，不淘汰也不改动流程中候选人。 */
  async close(id: string, actor: AuthenticatedUser) {
    const current = await this.findScoped(id, actor, 'job:close');
    const candidatesInProcess = await this.prisma.candidate.count({
      where: { jobId: id, stage: { notIn: closedStages } },
    });
    if (current.status === JobStatus.CLOSED) {
      return {
        job: this.toDto(current),
        changed: false,
        candidatesInProcess,
        note: '职位已关闭；关闭仅停止新简历进入，不影响流程中候选人',
      };
    }

    const updated = await this.prisma.job.update({
      where: { id },
      data: { status: JobStatus.CLOSED },
    });
    await this.prisma.timelineEvent.create({
      data: {
        entityType: 'Job',
        entityId: id,
        actorId: actor.id,
        action: 'job.closed',
        payload: {
          candidatesInProcess,
          operator: actor.id,
          note: '职位关闭仅停止新简历进入，不影响流程中候选人',
        },
      },
    });
    return {
      job: this.toDto(updated),
      changed: true,
      candidatesInProcess,
      note: '职位关闭仅停止新简历进入，不影响流程中候选人',
    };
  }

  async timeline(id: string, actor: AuthenticatedUser) {
    await this.findScoped(id, actor, 'job:read');
    const events = await this.prisma.timelineEvent.findMany({
      where: { entityType: 'Job', entityId: id },
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

  private toDto(job: {
    id: string;
    code: string;
    title: string;
    departmentId: string;
    location: string | null;
    recruiterId: string | null;
    requirements: string | null;
    headcount: number;
    hiredCount: number;
    status: JobStatus;
    interviewPlanId: string | null;
    sources: string | null;
    isVirtual: boolean;
    requisitionId: string | null;
    createdAt: Date;
    updatedAt: Date;
    requisition?: { id: string; oaApprovalId: string; title: string; status: string } | null;
  }): JobDto {
    const headcountFull = job.headcount > 0 && job.hiredCount >= job.headcount;
    return {
      id: job.id,
      code: job.code,
      title: job.title,
      departmentId: job.departmentId,
      location: job.location,
      recruiterId: job.recruiterId,
      requirements: job.requirements,
      headcount: job.headcount,
      hiredCount: job.hiredCount,
      status: job.status,
      interviewPlanId: job.interviewPlanId,
      channel: job.sources,
      isVirtual: job.isVirtual,
      requisitionId: job.requisitionId,
      requisition: job.requisition ?? null,
      headcountFull,
      headcountHint:
        headcountFull && job.status === JobStatus.ACTIVE
          ? 'HC 已满，建议关闭职位（系统不会自动关闭）'
          : null,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
    };
  }

  private async findScoped(id: string, actor: AuthenticatedUser, permission: string) {
    const job = await this.prisma.job.findFirst({
      where: { AND: [{ id }, this.authorization.jobWhere(actor, permission)] },
    });
    if (!job) throw new NotFoundException('职位不存在');
    return job;
  }

  private async nextJobCode(tx: Prisma.TransactionClient): Promise<string> {
    const last = await tx.job.findFirst({
      where: { code: { startsWith: 'MJ' } },
      orderBy: { code: 'desc' },
      select: { code: true },
    });
    const lastNumber = last ? Number.parseInt(last.code.slice(2), 10) : 0;
    const next = Number.isFinite(lastNumber) && lastNumber > 0 ? lastNumber + 1 : 1;
    return `MJ${String(next).padStart(6, '0')}`;
  }

  private async assertDepartment(departmentId: string) {
    const department = await this.prisma.department.findFirst({
      where: { id: departmentId, isActive: true },
      select: { id: true },
    });
    if (!department) throw new NotFoundException('部门不存在');
  }

  private async assertUser(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new NotFoundException('招聘负责人不存在');
  }

  private async assertRequisition(requisitionId: string) {
    const requisition = await this.prisma.jobRequisition.findUnique({
      where: { id: requisitionId },
      select: { id: true },
    });
    if (!requisition) throw new NotFoundException('招聘需求不存在');
  }

  private resumeUpdatedRange(from?: string, to?: string) {
    const range: Prisma.DateTimeFilter = {};
    if (from) {
      const parsed = parseDateValue(from);
      if (!parsed) throw new BadRequestException('简历更新起始日期格式应为 YYYY-MM-DD');
      range.gte = parsed;
    }
    if (to) {
      const parsed = parseDateValue(to);
      if (!parsed) throw new BadRequestException('简历更新结束日期格式应为 YYYY-MM-DD');
      // 结束日期包含当天
      range.lte = new Date(parsed.getTime() + 86_400_000 - 1);
    }
    return Object.keys(range).length ? range : null;
  }

  private orderBy(
    sort: string | undefined,
    order: string | undefined,
  ): Prisma.JobOrderByWithRelationInput[] {
    if (sort && !listSorts.includes(sort as ListSort)) {
      throw new BadRequestException(`排序字段必须为以下值之一：${listSorts.join(', ')}`);
    }
    if (order && order !== 'asc' && order !== 'desc') {
      throw new BadRequestException('排序方向必须为 asc 或 desc');
    }
    const direction: Prisma.SortOrder = order === 'asc' ? 'asc' : 'desc';
    const selected = (sort ?? 'updatedAt') as ListSort;
    return [{ [selected]: direction }, { id: 'asc' }];
  }

  private asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException('请求体格式不正确');
    }
    return value as Record<string, unknown>;
  }

  private requiredText(value: unknown, message: string): string {
    if (typeof value !== 'string' || !value.trim()) throw new BadRequestException(message);
    return value.trim();
  }

  private optionalText(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    return text || null;
  }

  private nonNegativeInt(value: unknown, fallback: number, message: string): number {
    if (value === undefined || value === null || value === '') return fallback;
    const parsed = typeof value === 'string' ? Number(value) : value;
    if (typeof parsed !== 'number' || !Number.isInteger(parsed) || parsed < 0) {
      throw new BadRequestException(message);
    }
    return parsed;
  }

  private booleanFlag(value: unknown, fallback: boolean): boolean {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw new BadRequestException('布尔参数必须为 true 或 false');
  }

  private positiveInt(value: string | undefined, fallback: number, max: number): number {
    if (value === undefined || value === '') return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new BadRequestException('分页参数必须为正整数');
    }
    return Math.min(parsed, max);
  }

  private isUniqueViolation(error: unknown, field?: string): boolean {
    if (!error || typeof error !== 'object') return false;
    const candidate = error as { code?: string; meta?: { target?: unknown } };
    if (candidate.code !== 'P2002') return false;
    if (!field) return true;
    const target = candidate.meta?.target;
    if (Array.isArray(target)) return target.includes(field);
    if (typeof target === 'string') return target.includes(field);
    return true;
  }
}

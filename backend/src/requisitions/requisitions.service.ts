import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RequisitionStatus } from '@prisma/client';
import { AuthorizationService } from '../auth/authorization.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { assertDictValue } from '../settings/config-rules.js';
import {
  CYCLE_FORMULA,
  calculateCycleDays,
  calculateInProgressDays,
  isClosedBeforeStart,
  parseDateValue,
  toDateOnly,
  todayDateOnly,
} from './requisition-cycle.js';

export type RequisitionListQuery = {
  page?: string;
  pageSize?: string;
  keyword?: string;
  oaApprovalId?: string;
  departmentId?: string;
  recruiterId?: string;
  requisitionType?: string;
  status?: string;
  startFrom?: string;
  startTo?: string;
  closedFrom?: string;
  closedTo?: string;
  cycleMin?: string;
  cycleMax?: string;
  sort?: string;
  order?: string;
};

const listSorts = [
  'cycleDays',
  'recruitmentStartDate',
  'closedAt',
  'submittedAt',
  'inProgressDays',
  'updatedAt',
] as const;

type ListSort = (typeof listSorts)[number];

const readOnlyFields = [
  'oaApprovalId',
  'submittedAt',
  'closedAt',
  'cycleDays',
  'cycleEligible',
  'status',
  'version',
  'source',
] as const;

export type RequisitionDto = {
  id: string;
  oaApprovalId: string;
  oaApprovalTitle: string | null;
  oaBusinessId: string | null;
  title: string;
  departmentId: string;
  recruiterId: string | null;
  jobLevel: string | null;
  requisitionType: string | null;
  headcount: number;
  source: string;
  status: RequisitionStatus;
  submittedAt: string | null;
  recruitmentStartDate: string | null;
  closedAt: string | null;
  cycleDays: number | null;
  cycleEligible: boolean;
  inProgressDays: number | null;
  inProgressLabel: string | null;
  note: string | null;
  requirements: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

@Injectable()
export class RequisitionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
  ) {}

  async list(actor: AuthenticatedUser, query: RequisitionListQuery = {}) {
    const page = this.positiveInt(query.page, 1, Number.MAX_SAFE_INTEGER);
    const pageSize = this.positiveInt(query.pageSize, 20, 100);
    const conditions: Prisma.JobRequisitionWhereInput[] = [
      this.authorization.requisitionWhere(actor, 'requisition:read'),
    ];

    const keyword = this.optionalText(query.keyword);
    if (keyword) conditions.push({ title: { contains: keyword } });
    const oaApprovalId = this.optionalText(query.oaApprovalId);
    if (oaApprovalId) conditions.push({ oaApprovalId: { contains: oaApprovalId } });
    const departmentId = this.optionalText(query.departmentId);
    if (departmentId) conditions.push({ departmentId });
    const recruiterId = this.optionalText(query.recruiterId);
    if (recruiterId) conditions.push({ recruiterId });
    const requisitionType = this.optionalText(query.requisitionType);
    if (requisitionType) conditions.push({ requisitionType });

    if (query.status) {
      if (query.status !== RequisitionStatus.ACTIVE && query.status !== RequisitionStatus.CLOSED) {
        throw new BadRequestException('状态必须为 ACTIVE 或 CLOSED');
      }
      conditions.push({ status: query.status });
    }

    const startRange = this.dateRange(query.startFrom, query.startTo, '开始招聘时间');
    if (startRange) conditions.push({ recruitmentStartDate: startRange });
    const closedRange = this.dateRange(query.closedFrom, query.closedTo, '关闭时间');
    if (closedRange) conditions.push({ closedAt: closedRange });

    const cycleMin = this.optionalNonNegativeInt(query.cycleMin, '招聘周期下限');
    const cycleMax = this.optionalNonNegativeInt(query.cycleMax, '招聘周期上限');
    if (cycleMin !== null && cycleMax !== null && cycleMin > cycleMax) {
      throw new BadRequestException('招聘周期下限不能大于上限');
    }
    if (cycleMin !== null || cycleMax !== null) {
      // 未纳入周期统计的存量已关闭需求 cycleDays 为空，天然被区间筛选排除。
      conditions.push({
        cycleDays: {
          ...(cycleMin !== null ? { gte: cycleMin } : {}),
          ...(cycleMax !== null ? { lte: cycleMax } : {}),
        },
      });
    }

    const where: Prisma.JobRequisitionWhereInput = { AND: conditions };
    const orderBy = this.orderBy(query.sort, query.order);
    const [items, total] = await Promise.all([
      this.prisma.jobRequisition.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.jobRequisition.count({ where }),
    ]);

    return {
      items: items.map((item) => this.toDto(item)),
      page,
      pageSize,
      total,
    };
  }

  async get(id: string, actor: AuthenticatedUser) {
    const record = await this.findScoped(id, actor, 'requisition:read');
    const jobs = await this.prisma.job.findMany({
      where: { requisitionId: id },
      select: { id: true, code: true, title: true, status: true },
      orderBy: { code: 'asc' },
    });
    return {
      ...this.toDto(record),
      linkedJobs: jobs,
      cycleRule: CYCLE_FORMULA,
      submittedAtNote: '需求提报时间仅记录，不参与周期计算',
    };
  }

  /**
   * 按 OA 审批生成招聘需求（FR-REQ-1 / NFR-13）。
   * 幂等：重复与并发回调都按 oaApprovalId 唯一约束 + 事务兜底，不会重复落库。
   * 本方法只接受由 OA 对接层回读并核实后的审批数据，不再接收 HTTP 请求体直传的 Mock 负载。
   */
  async syncFromOa(
    value: unknown,
    actor: AuthenticatedUser,
    context: { trigger: 'callback' | 'manual'; processCodeVerified: boolean } = {
      trigger: 'manual',
      processCodeVerified: false,
    },
  ) {
    const input = this.asRecord(value);
    const oaApprovalId = this.requiredText(input.oaApprovalId, 'OA 审批单号不能为空');
    const oaBusinessId = this.optionalText(input.oaBusinessId);
    const title = this.requiredText(input.title, '需求名称不能为空');
    const departmentId = this.requiredText(input.departmentId, '部门不能为空');
    const headcount = this.requiredPositiveInt(input.headcount, '招聘人数必须为正整数');
    const submittedAt = this.requiredDate(input.submittedAt, '需求提报时间必须为有效日期');
    const recruitmentStartDate = this.requiredDate(
      input.recruitmentStartDate,
      '开始招聘时间不能为空',
    );
    await this.assertDepartment(departmentId);
    const oaApprovalTitle = this.optionalText(input.oaApprovalTitle);
    const jobLevel = this.optionalText(input.jobLevel);
    const requisitionType = this.optionalText(input.requisitionType);
    if (requisitionType) {
      await assertDictValue(this.prisma, 'REQUISITION_TYPE', requisitionType, '需求类型');
    }
    const recruiterId = this.optionalText(input.recruiterId);
    const note = this.optionalText(input.note);
    const requirements = this.optionalText(input.requirements);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.jobRequisition.findUnique({ where: { oaApprovalId } });
        if (existing) {
          return { created: false, requisition: this.toDto(existing) };
        }
        const created = await tx.jobRequisition.create({
          data: {
            oaApprovalId,
            oaApprovalTitle,
            oaBusinessId,
            title,
            departmentId,
            recruiterId,
            jobLevel,
            requisitionType,
            headcount,
            submittedAt,
            recruitmentStartDate,
            note,
            requirements,
          },
        });
        await tx.timelineEvent.create({
          data: {
            entityType: 'JobRequisition',
            entityId: created.id,
            actorId: actor.id,
            action: 'requisition.created_from_oa',
            payload: {
              oaApprovalId,
              oaBusinessId,
              submittedAt: toDateOnly(submittedAt),
              recruitmentStartDate: toDateOnly(recruitmentStartDate),
              headcount,
              trigger: context.trigger,
              processCodeVerified: context.processCodeVerified,
              operator: actor.id,
            },
          },
        });
        return { created: true, requisition: this.toDto(created) };
      });
    } catch (error) {
      // 并发回调由 oaApprovalId 唯一约束兜底：第二个事务命中 P2002 后回读已落库记录。
      if (this.isUniqueViolation(error)) {
        const existing = await this.prisma.jobRequisition.findUnique({ where: { oaApprovalId } });
        if (existing) return { created: false, requisition: this.toDto(existing) };
      }
      throw error;
    }
  }

  /** 人事优化/补充需求内容；与 OA 同步信息保存在同一条需求记录，不建副本。 */
  async update(id: string, value: unknown, actor: AuthenticatedUser) {
    const input = this.asRecord(value);
    const current = await this.findScoped(id, actor, 'requisition:manage');
    this.assertNoReadOnlyFields(input);

    const data: Prisma.JobRequisitionUpdateManyMutationInput = {};
    const changes: Record<string, { from: unknown; to: unknown }> = {};

    const assign = <K extends keyof Prisma.JobRequisitionUpdateManyMutationInput>(
      field: K,
      next: Prisma.JobRequisitionUpdateManyMutationInput[K],
      previous: unknown,
    ) => {
      if (next === previous) return;
      data[field] = next;
      changes[field as string] = { from: previous ?? null, to: next ?? null };
    };

    if ('title' in input) {
      const next = this.requiredText(input.title, '需求名称不能为空');
      assign('title', next, current.title);
    }
    if ('departmentId' in input) {
      const next = this.requiredText(input.departmentId, '部门不能为空');
      await this.assertDepartment(next);
      assign('departmentId', next, current.departmentId);
    }
    if ('recruiterId' in input) {
      assign('recruiterId', this.optionalText(input.recruiterId), current.recruiterId);
    }
    if ('jobLevel' in input) {
      assign('jobLevel', this.optionalText(input.jobLevel), current.jobLevel);
    }
    if ('requisitionType' in input) {
      const next = this.optionalText(input.requisitionType);
      if (next) {
        await assertDictValue(this.prisma, 'REQUISITION_TYPE', next, '需求类型');
      }
      assign('requisitionType', next, current.requisitionType);
    }
    if ('headcount' in input) {
      assign(
        'headcount',
        this.requiredPositiveInt(input.headcount, '招聘人数必须为正整数'),
        current.headcount,
      );
    }
    if ('note' in input) {
      assign('note', this.optionalText(input.note), current.note);
    }
    if ('requirements' in input) {
      assign('requirements', this.optionalText(input.requirements), current.requirements);
    }
    if ('oaApprovalTitle' in input) {
      assign('oaApprovalTitle', this.optionalText(input.oaApprovalTitle), current.oaApprovalTitle);
    }

    if (Object.keys(changes).length === 0) {
      return this.toDto(current);
    }

    data.version = { increment: 1 };
    const result = await this.prisma.jobRequisition.updateMany({
      where: { id, version: current.version },
      data,
    });
    if (result.count === 0) {
      throw new ConflictException('需求已被其他操作更新，请刷新后重试');
    }

    await this.prisma.timelineEvent.create({
      data: {
        entityType: 'JobRequisition',
        entityId: id,
        actorId: actor.id,
        action: 'requisition.updated',
        payload: { changes, operator: actor.id } as unknown as Prisma.InputJsonObject,
      },
    });

    const updated = await this.prisma.jobRequisition.findUniqueOrThrow({ where: { id } });
    return this.toDto(updated);
  }

  /** 修改开始招聘时间：仅招聘中可改，留痕并重算进行中天数。 */
  async changeStartDate(id: string, value: unknown, actor: AuthenticatedUser) {
    const input = this.asRecord(value);
    const current = await this.findScoped(id, actor, 'requisition:manage');
    if (current.status !== RequisitionStatus.ACTIVE) {
      throw new ConflictException('已关闭需求需先回退为招聘中，再修改开始招聘时间');
    }
    const next = this.requiredDate(input.recruitmentStartDate, '开始招聘时间不能为空');
    const previous = current.recruitmentStartDate;
    if (previous && toDateOnly(previous) === toDateOnly(next)) {
      return this.toDto(current);
    }

    const result = await this.prisma.jobRequisition.updateMany({
      where: { id, version: current.version, status: RequisitionStatus.ACTIVE },
      data: { recruitmentStartDate: next, version: { increment: 1 } },
    });
    if (result.count === 0) {
      throw new ConflictException('需求已被其他操作更新，请刷新后重试');
    }

    await this.prisma.timelineEvent.create({
      data: {
        entityType: 'JobRequisition',
        entityId: id,
        actorId: actor.id,
        action: 'requisition.start_date_changed',
        payload: {
          from: toDateOnly(previous),
          to: toDateOnly(next),
          inProgressDaysBefore: previous ? calculateInProgressDays(previous) : null,
          inProgressDaysAfter: calculateInProgressDays(next),
          operator: actor.id,
        },
      },
    });

    const updated = await this.prisma.jobRequisition.findUniqueOrThrow({ where: { id } });
    return this.toDto(updated);
  }

  /** 手动关闭：写入关闭时间并计算需求级自然日周期；HC 满员不触发自动关闭。 */
  async close(id: string, value: unknown, actor: AuthenticatedUser) {
    const input = this.asRecord(value);
    const current = await this.findScoped(id, actor, 'requisition:manage');
    if (current.status === RequisitionStatus.CLOSED) {
      throw new ConflictException('需求已关闭，请勿重复关闭');
    }
    if (!current.recruitmentStartDate) {
      throw new BadRequestException('缺少开始招聘时间，无法计算招聘周期');
    }
    const closedAt =
      input.closedAt === undefined || input.closedAt === null || input.closedAt === ''
        ? todayDateOnly()
        : this.requiredDate(input.closedAt, '关闭时间必须为有效日期');
    if (isClosedBeforeStart(current.recruitmentStartDate, closedAt)) {
      throw new BadRequestException('关闭时间不能早于开始招聘时间');
    }
    const cycleDays = calculateCycleDays(current.recruitmentStartDate, closedAt);

    const result = await this.prisma.jobRequisition.updateMany({
      where: { id, version: current.version, status: RequisitionStatus.ACTIVE },
      data: {
        status: RequisitionStatus.CLOSED,
        closedAt,
        cycleDays,
        version: { increment: 1 },
      },
    });
    if (result.count === 0) {
      throw new ConflictException('需求已被其他操作更新，请刷新后重试');
    }

    await this.prisma.timelineEvent.create({
      data: {
        entityType: 'JobRequisition',
        entityId: id,
        actorId: actor.id,
        action: 'requisition.closed',
        payload: {
          recruitmentStartDate: toDateOnly(current.recruitmentStartDate),
          closedAt: toDateOnly(closedAt),
          cycleDays,
          formula: CYCLE_FORMULA,
          operator: actor.id,
        },
      },
    });

    const updated = await this.prisma.jobRequisition.findUniqueOrThrow({ where: { id } });
    return this.toDto(updated);
  }

  /** 关闭 → 招聘中：清空当前关闭时间与周期，历次记录保留在时间线。 */
  async revert(id: string, actor: AuthenticatedUser) {
    const current = await this.findScoped(id, actor, 'requisition:manage');
    if (current.status !== RequisitionStatus.CLOSED) {
      throw new ConflictException('仅已关闭的需求可回退为招聘中');
    }
    if (!current.cycleEligible) {
      throw new ConflictException('存量已关闭需求本期不补录，不支持回退');
    }

    const result = await this.prisma.jobRequisition.updateMany({
      where: { id, version: current.version, status: RequisitionStatus.CLOSED },
      data: {
        status: RequisitionStatus.ACTIVE,
        closedAt: null,
        cycleDays: null,
        version: { increment: 1 },
      },
    });
    if (result.count === 0) {
      throw new ConflictException('需求已被其他操作更新，请刷新后重试');
    }

    await this.prisma.timelineEvent.create({
      data: {
        entityType: 'JobRequisition',
        entityId: id,
        actorId: actor.id,
        action: 'requisition.reverted',
        payload: {
          previousClosedAt: toDateOnly(current.closedAt),
          previousCycleDays: current.cycleDays,
          operator: actor.id,
        },
      },
    });

    const updated = await this.prisma.jobRequisition.findUniqueOrThrow({ where: { id } });
    return this.toDto(updated);
  }

  /** 在招时长列表：N = 当天 - 开始招聘时间，按 N 排序，不做超时预警。 */
  async inProgress(actor: AuthenticatedUser, sort?: string) {
    if (sort && sort !== 'days_asc' && sort !== 'days_desc') {
      throw new BadRequestException('排序必须为 days_asc 或 days_desc');
    }
    // N = 当天 - 开始招聘时间：N 越大表示开始越早，因此 N 降序等价于开始招聘时间升序。
    const startOrder: Prisma.SortOrder = sort === 'days_asc' ? 'desc' : 'asc';
    const items = await this.prisma.jobRequisition.findMany({
      where: {
        AND: [
          this.authorization.requisitionWhere(actor, 'requisition:read'),
          { status: RequisitionStatus.ACTIVE, recruitmentStartDate: { not: null } },
        ],
      },
      orderBy: [{ recruitmentStartDate: startOrder }, { id: 'asc' }],
      take: 200,
    });
    return {
      items: items.map((item) => this.toDto(item)),
      total: items.length,
      sortedBy: sort === 'days_asc' ? 'days_asc' : 'days_desc',
      note: '在招时长不计入招聘周期汇总，本期不做超时预警',
    };
  }

  /** 周期汇总：仅已关闭且纳入统计的需求；存量已关闭需求单独计数但不参与计算。 */
  async cycleStats(actor: AuthenticatedUser) {
    const scope = this.authorization.requisitionWhere(actor, 'requisition:read');
    const [closed, excludedClosed] = await Promise.all([
      this.prisma.jobRequisition.findMany({
        where: {
          AND: [
            scope,
            {
              status: RequisitionStatus.CLOSED,
              cycleEligible: true,
              cycleDays: { not: null },
            },
          ],
        },
        select: { cycleDays: true },
      }),
      this.prisma.jobRequisition.count({
        where: {
          AND: [
            scope,
            {
              status: RequisitionStatus.CLOSED,
              OR: [{ cycleEligible: false }, { cycleDays: null }],
            },
          ],
        },
      }),
    ]);

    const values = closed
      .map((item) => item.cycleDays)
      .filter((value): value is number => typeof value === 'number')
      .sort((left, right) => left - right);
    const total = values.reduce((sum, value) => sum + value, 0);
    const middle = Math.floor(values.length / 2);
    const median =
      values.length === 0
        ? null
        : values.length % 2 === 1
          ? values[middle]
          : (values[middle - 1] + values[middle]) / 2;

    return {
      count: values.length,
      average: values.length ? Math.round((total / values.length) * 10) / 10 : null,
      median,
      min: values.length ? values[0] : null,
      max: values.length ? values[values.length - 1] : null,
      excludedClosed,
      formula: CYCLE_FORMULA,
      note: '未关闭需求与本期不补录的已关闭存量需求不纳入周期汇总',
    };
  }

  async timeline(id: string, actor: AuthenticatedUser) {
    await this.findScoped(id, actor, 'requisition:read');
    const events = await this.prisma.timelineEvent.findMany({
      where: { entityType: 'JobRequisition', entityId: id },
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

  private toDto(record: {
    id: string;
    oaApprovalId: string;
    oaApprovalTitle: string | null;
    oaBusinessId: string | null;
    title: string;
    departmentId: string;
    recruiterId: string | null;
    jobLevel: string | null;
    requisitionType: string | null;
    headcount: number;
    source: string;
    status: RequisitionStatus;
    submittedAt: Date;
    recruitmentStartDate: Date | null;
    closedAt: Date | null;
    cycleDays: number | null;
    cycleEligible: boolean;
    note: string | null;
    requirements: string | null;
    version: number;
    createdAt: Date;
    updatedAt: Date;
    }): RequisitionDto {
      const inProgressDays =
        record.status === RequisitionStatus.ACTIVE && record.recruitmentStartDate
          ? calculateInProgressDays(record.recruitmentStartDate)
          : null;
      return {
        id: record.id,
        oaApprovalId: record.oaApprovalId,
        oaApprovalTitle: record.oaApprovalTitle,
        oaBusinessId: record.oaBusinessId,
      title: record.title,
      departmentId: record.departmentId,
      recruiterId: record.recruiterId,
      jobLevel: record.jobLevel,
      requisitionType: record.requisitionType,
      headcount: record.headcount,
      source: record.source,
      status: record.status,
      submittedAt: toDateOnly(record.submittedAt),
      recruitmentStartDate: toDateOnly(record.recruitmentStartDate),
      closedAt: toDateOnly(record.closedAt),
      cycleDays: record.cycleDays,
      cycleEligible: record.cycleEligible,
      inProgressDays,
      inProgressLabel:
        inProgressDays === null ? null : `进行中 · 已 ${inProgressDays} 天`,
      note: record.note,
      requirements: record.requirements,
      version: record.version,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private async findScoped(id: string, actor: AuthenticatedUser, permission: string) {
    const record = await this.prisma.jobRequisition.findFirst({
      where: { AND: [{ id }, this.authorization.requisitionWhere(actor, permission)] },
    });
    if (!record) throw new NotFoundException('招聘需求不存在');
    return record;
  }

  private async assertDepartment(departmentId: string) {
    const department = await this.prisma.department.findFirst({
      where: { id: departmentId, isActive: true },
      select: { id: true },
    });
    if (!department) throw new NotFoundException('部门不存在');
  }

  private assertNoReadOnlyFields(input: Record<string, unknown>) {
    for (const field of readOnlyFields) {
      if (field in input) {
        throw new BadRequestException(`${field} 为系统只读字段，不能通过编辑接口修改`);
      }
    }
  }

  private orderBy(
    sort: string | undefined,
    order: string | undefined,
  ): Prisma.JobRequisitionOrderByWithRelationInput[] {
    if (sort && !listSorts.includes(sort as ListSort)) {
      throw new BadRequestException(`排序字段必须为以下值之一：${listSorts.join(', ')}`);
    }
    if (order && order !== 'asc' && order !== 'desc') {
      throw new BadRequestException('排序方向必须为 asc 或 desc');
    }
    const direction: Prisma.SortOrder = order === 'asc' ? 'asc' : 'desc';
    const selected = (sort ?? 'updatedAt') as ListSort;
    switch (selected) {
      case 'cycleDays':
        return [{ cycleDays: direction }, { id: 'asc' }];
      case 'recruitmentStartDate':
        return [{ recruitmentStartDate: direction }, { id: 'asc' }];
      case 'closedAt':
        return [{ closedAt: direction }, { id: 'asc' }];
      case 'submittedAt':
        return [{ submittedAt: direction }, { id: 'asc' }];
      case 'inProgressDays':
        // N = 当天 - 开始招聘时间：N 越大，开始招聘时间越早。
        return [
          { recruitmentStartDate: direction === 'asc' ? 'desc' : 'asc' },
          { id: 'asc' },
        ];
      default:
        return [{ updatedAt: direction }, { id: 'asc' }];
    }
  }

  private dateRange(from?: string, to?: string, label = '日期') {
    const range: Prisma.DateTimeNullableFilter = {};
    if (from) range.gte = this.requiredDate(from, `${label}起始日期格式应为 YYYY-MM-DD`);
    if (to) range.lte = this.requiredDate(to, `${label}结束日期格式应为 YYYY-MM-DD`);
    return Object.keys(range).length ? range : null;
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

  private requiredPositiveInt(value: unknown, message: string): number {
    const parsed = typeof value === 'string' ? Number(value) : value;
    if (typeof parsed !== 'number' || !Number.isInteger(parsed) || parsed <= 0) {
      throw new BadRequestException(message);
    }
    return parsed;
  }

  private requiredDate(value: unknown, message: string): Date {
    const parsed = parseDateValue(value);
    if (!parsed) throw new BadRequestException(message);
    return parsed;
  }

  private optionalNonNegativeInt(value: string | undefined, label: string): number | null {
    if (value === undefined || value === '') return null;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new BadRequestException(`${label}必须为非负整数`);
    }
    return parsed;
  }

  private positiveInt(value: string | undefined, fallback: number, max: number): number {
    if (value === undefined || value === '') return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new BadRequestException('分页参数必须为正整数');
    }
    return Math.min(parsed, max);
  }

  private isUniqueViolation(error: unknown): boolean {
    return Boolean(error && typeof error === 'object' && (error as { code?: string }).code === 'P2002');
  }
}

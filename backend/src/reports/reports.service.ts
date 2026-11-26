import { BadRequestException, Injectable } from '@nestjs/common';
import { RequisitionStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { AuthorizationService } from '../auth/authorization.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  CYCLE_FORMULA,
  calculateCycleDays,
  isClosedBeforeStart,
  toDateOnly,
} from '../requisitions/requisition-cycle.js';
import { resolveDepartmentNames, resolveUserNames } from '../settings/display-names.js';
import {
  FUNNEL_LABELS,
  FUNNEL_STAGES,
  monthKey,
  percentage,
  stageRank,
  summarize,
  type CycleSummary,
} from './report-metrics.js';

export type ReportFilters = {
  from?: string;
  to?: string;
  departmentId?: string;
  recruiterId?: string;
  requisitionType?: string;
};

export type ReasonReportType = 'ARCHIVE' | 'OFFER_REJECT' | 'ONBOARD_ABANDON';

export const CYCLE_DIMENSIONS = ['department', 'recruiter', 'period', 'requisitionType'] as const;
export type CycleDimension = (typeof CYCLE_DIMENSIONS)[number];

const DIMENSION_LABELS: Record<CycleDimension, string> = {
  department: '部门',
  recruiter: '招聘负责人',
  period: '时间段（关闭月份）',
  requisitionType: '需求类型',
};

const UNFILLED = '__unfilled__';
const UNFILLED_LABEL = '未填写';

const REASON_TYPE_LABELS: Record<ReasonReportType, string> = {
  ARCHIVE: '初筛/归档原因',
  OFFER_REJECT: 'Offer 拒绝原因',
  ONBOARD_ABANDON: '放弃入职原因',
};

type DateBoundary = { gte: Date | null; lte: Date | null };

type ScopedCandidate = {
  id: string;
  name: string;
  stage: string;
  channel: string | null;
  poolType: string;
  appliedAt: Date | null;
  jobId: string | null;
  job: {
    title: string;
    departmentId: string;
    recruiterId: string | null;
    requisition: { requisitionType: string | null } | null;
  } | null;
};

type CandidateDrillItem = {
  id: string;
  name: string;
  stage: string;
  jobTitle: string | null;
  departmentName: string | null;
  channel: string | null;
  appliedAt: string | null;
};

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
  ) {}

  /** 漏斗：分母为权限范围内的流程内候选人（不含已归档与待分配池）。 */
  async funnel(actor: AuthenticatedUser, filters: ReportFilters, drillStage?: string) {
    const candidates = await this.scopedCandidates(actor, filters);
    const departmentNames = await this.departmentNameMap(candidates);
    const inFunnel = candidates.filter((item) => stageRank(item.stage) >= 0);
    const archived = candidates.filter((item) => item.stage === 'ARCHIVED').length;
    const pool = candidates.filter((item) => item.stage === 'UNASSIGNED' || item.stage === 'VIRTUAL_POOL').length;

    const rankCounts = new Map<number, number>();
    const exactCounts = new Map<string, number>();
    for (const candidate of inFunnel) {
      const rank = stageRank(candidate.stage);
      exactCounts.set(candidate.stage, (exactCounts.get(candidate.stage) ?? 0) + 1);
      for (let index = 0; index <= rank; index += 1) {
        rankCounts.set(index, (rankCounts.get(index) ?? 0) + 1);
      }
    }

    const stages = FUNNEL_STAGES.map((stage, index) => {
      const reached = rankCounts.get(index) ?? 0;
      const previous = index === 0 ? 0 : rankCounts.get(index - 1) ?? 0;
      return {
        key: stage,
        label: FUNNEL_LABELS[stage],
        reached,
        inStage: exactCounts.get(stage) ?? 0,
        conversionFromPrevious: index === 0 ? null : percentage(reached, previous),
      };
    });

    const result: Record<string, unknown> = {
      filters: this.filtersEcho(filters),
      generatedAt: new Date().toISOString(),
      denominator: '权限范围内的流程内候选人（不含已归档与待分配池）；按当前阶段累计回填各环节到达人数',
      total: rankCounts.get(0) ?? 0,
      stages,
      excluded: { archived, pool },
    };

    if (drillStage) {
      if (!(FUNNEL_STAGES as readonly string[]).includes(drillStage)) {
        throw new BadRequestException('下钻阶段无效');
      }
      const items = inFunnel
        .filter((candidate) => candidate.stage === drillStage)
        .slice(0, 500)
        .map((candidate) => this.toDrillItem(candidate, departmentNames));
      result.drill = { stage: drillStage, items, total: exactCounts.get(drillStage) ?? 0 };
    }
    return result;
  }

  /** 渠道：真实计数与各环节转化，数量不做任何放大。 */
  async channels(actor: AuthenticatedUser, filters: ReportFilters, drillChannel?: string) {
    const candidates = await this.scopedCandidates(actor, filters);
    const departmentNames = await this.departmentNameMap(candidates);
    const groups = new Map<
      string,
      { total: number; interviewed: number; offered: number; onboarded: number; archived: number }
    >();
    for (const candidate of candidates) {
      const key = candidate.channel?.trim() ? candidate.channel.trim() : UNFILLED;
      const group = groups.get(key) ?? { total: 0, interviewed: 0, offered: 0, onboarded: 0, archived: 0 };
      group.total += 1;
      const rank = stageRank(candidate.stage);
      if (rank >= stageRank('INTERVIEWING')) group.interviewed += 1;
      if (rank >= stageRank('OFFERING')) group.offered += 1;
      if (rank >= stageRank('ONBOARDED')) group.onboarded += 1;
      if (candidate.stage === 'ARCHIVED') group.archived += 1;
      groups.set(key, group);
    }

    const total = candidates.length;
    const rows = [...groups.entries()]
      .map(([key, group]) => ({
        key,
        label: key === UNFILLED ? UNFILLED_LABEL : key,
        total: group.total,
        interviewed: group.interviewed,
        offered: group.offered,
        onboarded: group.onboarded,
        archived: group.archived,
        share: percentage(group.total, total),
      }))
      .sort((left, right) => right.total - left.total);

    const result: Record<string, unknown> = {
      filters: this.filtersEcho(filters),
      generatedAt: new Date().toISOString(),
      denominator: '权限范围内全部候选人；未填写渠道单列，不并入其他渠道',
      total,
      unfilled: groups.get(UNFILLED)?.total ?? 0,
      rows,
    };

    if (drillChannel) {
      const items = candidates
        .filter((candidate) => (candidate.channel?.trim() ? candidate.channel.trim() : UNFILLED) === drillChannel)
        .slice(0, 500)
        .map((candidate) => this.toDrillItem(candidate, departmentNames));
      result.drill = { key: drillChannel, items };
    }
    return result;
  }

  /** 三类原因：归档、Offer 拒绝、放弃入职各自独立统计，“未填写”单列。 */
  async reasons(
    actor: AuthenticatedUser,
    type: ReasonReportType,
    filters: ReportFilters,
    drillKey?: string,
  ) {
    if (!REASON_TYPE_LABELS[type]) throw new BadRequestException('原因类型无效');
    const range = this.dateRange(filters, '原因发生时间');
    // 原因报表的时间窗仅按事件发生时间过滤，不叠加过滤候选人申请时间，避免漏统计跨周期候选人
    const candidates = await this.scopedCandidates(actor, { ...filters, from: undefined, to: undefined });
    const candidateIds = candidates.map((candidate) => candidate.id);
    const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));

    const buckets = new Map<
      string,
      {
        label: string;
        count: number;
        items: Array<{ id: string; name: string; jobTitle: string | null; at: string | null; detail: string | null }>;
      }
    >();
    const add = (key: string, label: string, candidateId: string, at: Date | null, detail: string | null) => {
      const candidate = candidateById.get(candidateId);
      if (!candidate) return;
      const bucket = buckets.get(key) ?? { label, count: 0, items: [] };
      bucket.count += 1;
      bucket.items.push({
        id: candidate.id,
        name: candidate.name,
        jobTitle: candidate.job?.title ?? null,
        at: at ? at.toISOString() : null,
        detail,
      });
      buckets.set(key, bucket);
    };

    if (type === 'ARCHIVE') {
      const entries = await this.prisma.candidateTalentPoolEntry.findMany({
        where: {
          candidateId: { in: candidateIds },
          ...(range ? { archivedAt: this.prismaRange(range) } : {}),
        },
        select: { candidateId: true, archivedAt: true, reasonId: true, reasonText: true, reasonMissing: true },
      });
      const reasonIds = [
        ...new Set(entries.map((entry) => entry.reasonId).filter((id): id is string => Boolean(id))),
      ];
      const options = reasonIds.length
        ? await this.prisma.reasonOption.findMany({
            where: { id: { in: reasonIds } },
            select: { id: true, label: true },
          })
        : [];
      const labels = new Map(options.map((option) => [option.id, option.label]));
      for (const entry of entries) {
        const missing = entry.reasonMissing || (!entry.reasonId && !entry.reasonText?.trim());
        const key = missing ? UNFILLED : entry.reasonId ?? entry.reasonText?.trim() ?? UNFILLED;
        const label = missing
          ? UNFILLED_LABEL
          : labels.get(entry.reasonId ?? '') ?? entry.reasonText?.trim() ?? UNFILLED_LABEL;
        add(key, label, entry.candidateId, entry.archivedAt, entry.reasonText);
      }
    }

    if (type === 'OFFER_REJECT') {
      const [offers, historyRows] = candidateIds.length
        ? await Promise.all([
            this.prisma.offerRecord.findMany({
              where: {
                candidateId: { in: candidateIds },
                OR: [{ oralResult: 'REJECTED' }, { writtenResult: 'REJECTED' }],
                ...(range ? { updatedAt: this.prismaRange(range) } : {}),
              },
              select: {
                candidateId: true,
                rejectReasonId: true,
                failureReasonLabel: true,
                failureReasonText: true,
                updatedAt: true,
              },
            }),
            this.prisma.offerRecordHistory.findMany({
              where: {
                candidateId: { in: candidateIds },
                ...(range ? { createdAt: this.prismaRange(range) } : {}),
              },
              select: {
                candidateId: true,
                snapshot: true,
                createdAt: true,
              },
            }),
          ])
        : [[], []];
      const historicalRejects = historyRows
        .map((row) => {
          const snap = (row.snapshot && typeof row.snapshot === 'object' ? row.snapshot : {}) as Record<string, unknown>;
          if (snap.oralResult !== 'REJECTED' && snap.writtenResult !== 'REJECTED') return null;
          return {
            candidateId: row.candidateId,
            rejectReasonId: typeof snap.rejectReasonId === 'string' ? snap.rejectReasonId : null,
            failureReasonLabel: typeof snap.failureReasonLabel === 'string' ? snap.failureReasonLabel : null,
            failureReasonText: typeof snap.failureReasonText === 'string' ? snap.failureReasonText : null,
            updatedAt: row.createdAt,
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);
      const allRejects = [...offers, ...historicalRejects];
      const reasonIds = [
        ...new Set(allRejects.map((offer) => offer.rejectReasonId).filter((id): id is string => Boolean(id))),
      ];
      const options = reasonIds.length
        ? await this.prisma.reasonOption.findMany({
            where: { id: { in: reasonIds } },
            select: { id: true, label: true },
          })
        : [];
      const labels = new Map(options.map((option) => [option.id, option.label]));
      for (const offer of allRejects) {
        const key = offer.rejectReasonId ?? offer.failureReasonLabel ?? offer.failureReasonText ?? UNFILLED;
        const label = offer.rejectReasonId
          ? labels.get(offer.rejectReasonId) ?? UNFILLED_LABEL
          : offer.failureReasonLabel ?? (offer.failureReasonText ? offer.failureReasonText : UNFILLED_LABEL);
        add(key, label, offer.candidateId, offer.updatedAt, offer.failureReasonText);
      }
    }

    if (type === 'ONBOARD_ABANDON') {
      const events = candidateIds.length
        ? await this.prisma.timelineEvent.findMany({
            where: {
              entityType: 'Candidate',
              entityId: { in: candidateIds },
              action: 'onboarding.abandoned',
              ...(range ? { createdAt: this.prismaRange(range) } : {}),
            },
            select: { entityId: true, payload: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
          })
        : [];
      for (const event of events) {
        const payload = (event.payload ?? {}) as {
          reasonId?: string | null;
          reasonLabel?: string | null;
          reasonText?: string | null;
        };
        const missing = !payload.reasonId && !payload.reasonLabel && !payload.reasonText?.trim();
        const key = missing ? UNFILLED : payload.reasonId ?? payload.reasonLabel ?? UNFILLED;
        const label = missing ? UNFILLED_LABEL : payload.reasonLabel?.trim() || UNFILLED_LABEL;
        add(key, label, event.entityId, event.createdAt, payload.reasonText ?? null);
      }
    }

    const total = [...buckets.values()].reduce((sum, bucket) => sum + bucket.count, 0);
    const rows = [...buckets.entries()]
      .map(([key, bucket]) => ({
        key,
        label: bucket.label,
        count: bucket.count,
        share: percentage(bucket.count, total),
        unfilled: key === UNFILLED,
      }))
      .sort((left, right) => right.count - left.count);

    const result: Record<string, unknown> = {
      type,
      label: REASON_TYPE_LABELS[type],
      filters: this.filtersEcho(filters),
      range: this.rangeEcho(range),
      generatedAt: new Date().toISOString(),
      denominator:
        type === 'ARCHIVE'
          ? '权限范围内归档记录（以人才库归档时间为准）'
          : type === 'OFFER_REJECT'
            ? '权限范围内口头/书面 Offer 结果为拒绝的记录（以 Offer 更新时间）'
            : '权限范围内“放弃入职”时间线事件（以事件时间）',
      total,
      unfilled: buckets.get(UNFILLED)?.count ?? 0,
      rows,
    };

    if (drillKey) {
      const bucket = buckets.get(drillKey);
      result.drill = {
        key: drillKey,
        label: bucket?.label ?? UNFILLED_LABEL,
        items: bucket?.items.slice(0, 500) ?? [],
      };
    }
    return result;
  }

  /** 转正率：分子为已转正，分母为已记录试用期结论的人数（含未通过）。 */
  async probation(actor: AuthenticatedUser, filters: ReportFilters, drillGroup?: string) {
    const range = this.dateRange(filters, '试用期结论时间');
    // 转正报表的时间窗仅按试用期结论时间过滤，不叠加过滤候选人申请时间
    const candidates = await this.scopedCandidates(actor, { ...filters, from: undefined, to: undefined });
    const candidateIds = candidates.map((candidate) => candidate.id);
    const records = candidateIds.length
      ? await this.prisma.probationRecord.findMany({
          where: {
            candidateId: { in: candidateIds },
            ...(range ? { createdAt: this.prismaRange(range) } : {}),
          },
          select: { candidateId: true, converted: true, convertedAt: true, createdAt: true },
        })
      : [];

    const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    const departmentNames = await this.departmentNameMap(candidates);
    const groups = new Map<
      string,
      {
        total: number;
        converted: number;
        items: Array<{ id: string; name: string; jobTitle: string | null; converted: boolean; at: string | null }>;
      }
    >();
    for (const record of records) {
      const candidate = candidateById.get(record.candidateId);
      if (!candidate) continue;
      const departmentId = candidate.job?.departmentId ?? UNFILLED;
      const group = groups.get(departmentId) ?? { total: 0, converted: 0, items: [] };
      group.total += 1;
      if (record.converted) group.converted += 1;
      group.items.push({
        id: candidate.id,
        name: candidate.name,
        jobTitle: candidate.job?.title ?? null,
        converted: record.converted,
        at: record.convertedAt ? record.convertedAt.toISOString() : null,
      });
      groups.set(departmentId, group);
    }

    const converted = records.filter((record) => record.converted).length;
    const rows = [...groups.entries()]
      .map(([key, group]) => ({
        key,
        label: key === UNFILLED ? UNFILLED_LABEL : departmentNames.get(key) ?? key,
        total: group.total,
        converted: group.converted,
        rate: percentage(group.converted, group.total),
      }))
      .sort((left, right) => right.total - left.total);

    const result: Record<string, unknown> = {
      filters: this.filtersEcho(filters),
      range: this.rangeEcho(range),
      generatedAt: new Date().toISOString(),
      denominator: '已记录试用期结论的人数（含未通过）；进入试用期但尚无结论的不计入分母',
      total: records.length,
      converted,
      rate: percentage(converted, records.length),
      rows,
    };
    if (drillGroup) {
      const group = groups.get(drillGroup);
      result.drill = { key: drillGroup, items: group?.items.slice(0, 500) ?? [] };
    }
    return result;
  }

  /** 周期：需求级自然日差，排除未关闭与本期不补录的已关闭存量需求。 */
  async cycles(
    actor: AuthenticatedUser,
    filters: ReportFilters,
    dimensions: CycleDimension[],
    drillGroup?: string,
  ) {
    if (!actor.roles.some((role) => role.permissions.includes('requisition:read'))) {
      return {
        accessible: false,
        note: '当前角色没有“查看招聘需求”权限，周期报表不展示数据',
        formula: CYCLE_FORMULA,
        dimensions,
        denominator: null,
        eligible: summarize([]),
        excluded: null,
        rows: [],
      };
    }
    for (const dimension of dimensions) {
      if (!CYCLE_DIMENSIONS.includes(dimension)) throw new BadRequestException('维度无效');
    }
    const unique = [...new Set(dimensions)];
    const closedRange = this.dateRange(filters, '关闭时间');
    const conditions: Prisma.JobRequisitionWhereInput[] = [
      this.authorization.requisitionWhere(actor, 'requisition:read'),
    ];
    if (filters.departmentId) conditions.push({ departmentId: filters.departmentId });
    if (filters.recruiterId) conditions.push({ recruiterId: filters.recruiterId });
    if (filters.requisitionType) {
      conditions.push({ requisitionType: filters.requisitionType === UNFILLED ? null : filters.requisitionType });
    }

    const records = await this.prisma.jobRequisition.findMany({
      where: { AND: conditions },
      select: {
        id: true,
        title: true,
        departmentId: true,
        recruiterId: true,
        requisitionType: true,
        status: true,
        cycleEligible: true,
        recruitmentStartDate: true,
        closedAt: true,
      },
      orderBy: { closedAt: 'desc' },
    });

    const excluded = { active: 0, ineligible: 0, missingDate: 0, closedBeforeStart: 0, outOfPeriod: 0 };
    const eligible: Array<{ record: (typeof records)[number]; days: number; closedAt: Date }> = [];
    for (const record of records) {
      if (record.status !== RequisitionStatus.CLOSED) {
        excluded.active += 1;
        continue;
      }
      if (!record.cycleEligible) {
        excluded.ineligible += 1;
        continue;
      }
      if (!record.recruitmentStartDate || !record.closedAt) {
        excluded.missingDate += 1;
        continue;
      }
      if (isClosedBeforeStart(record.recruitmentStartDate, record.closedAt)) {
        excluded.closedBeforeStart += 1;
        continue;
      }
      if (closedRange && !this.inRange(record.closedAt, closedRange)) {
        excluded.outOfPeriod += 1;
        continue;
      }
      eligible.push({
        record,
        days: calculateCycleDays(record.recruitmentStartDate, record.closedAt),
        closedAt: record.closedAt,
      });
    }

    const departmentNames = await resolveDepartmentNames(
      this.prisma,
      eligible.map((item) => item.record.departmentId),
    );
    const recruiterNames = await resolveUserNames(
      this.prisma,
      eligible.map((item) => item.record.recruiterId),
    );
    const labelFor = (record: (typeof records)[number], dimension: CycleDimension): string => {
      switch (dimension) {
        case 'department':
          return departmentNames.get(record.departmentId) ?? record.departmentId;
        case 'recruiter':
          return record.recruiterId ? recruiterNames.get(record.recruiterId) ?? record.recruiterId : UNFILLED_LABEL;
        case 'requisitionType':
          return record.requisitionType?.trim() || UNFILLED_LABEL;
        case 'period':
          return record.closedAt ? monthKey(record.closedAt) : UNFILLED_LABEL;
        default:
          return UNFILLED_LABEL;
      }
    };

    const groups = new Map<
      string,
      { labels: string[]; days: number[]; items: Array<Record<string, unknown>> }
    >();
    for (const item of eligible) {
      const labels = unique.length ? unique.map((dimension) => labelFor(item.record, dimension)) : ['全部需求'];
      const key = labels.join(' / ');
      const group = groups.get(key) ?? { labels, days: [], items: [] };
      group.days.push(item.days);
      group.items.push({
        id: item.record.id,
        title: item.record.title,
        departmentName: departmentNames.get(item.record.departmentId) ?? null,
        recruiterName: item.record.recruiterId
          ? recruiterNames.get(item.record.recruiterId) ?? null
          : null,
        requisitionType: item.record.requisitionType ?? UNFILLED_LABEL,
        recruitmentStartDate: toDateOnly(item.record.recruitmentStartDate),
        closedAt: toDateOnly(item.closedAt),
        cycleDays: item.days,
      });
      groups.set(key, group);
    }

    const rows = [...groups.entries()]
      .map(([key, group]) => ({ key, labels: group.labels, summary: summarize(group.days) }))
      .sort((left, right) => right.summary.count - left.summary.count);

    const result: Record<string, unknown> = {
      accessible: true,
      formula: CYCLE_FORMULA,
      denominator:
        '已关闭且纳入周期统计的需求；排除进行中需求、本期不补录的存量已关闭需求、缺少日期与关闭早于开始的需求',
      dimensions: unique,
      dimensionLabels: unique.map((dimension) => DIMENSION_LABELS[dimension]),
      filters: this.filtersEcho(filters),
      range: this.rangeEcho(closedRange),
      generatedAt: new Date().toISOString(),
      eligible: summarize(eligible.map((item) => item.days)) as CycleSummary,
      excluded,
      rows,
      unit: '天',
    };
    if (drillGroup) {
      const group = groups.get(drillGroup);
      result.drill = { key: drillGroup, labels: group?.labels ?? [], items: (group?.items ?? []).slice(0, 500) };
    }
    return result;
  }

  /** 报表筛选下拉值：部门、招聘负责人、需求类型（含“未填写”）与可用维度。 */
  async filterOptions() {
    const [departments, users, dictItems] = await Promise.all([
      this.prisma.department
        .findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } })
        .catch(() => []),
      this.prisma.user
        .findMany({
          where: { status: 'ACTIVE' },
          select: { id: true, displayName: true },
          orderBy: { displayName: 'asc' },
        })
        .catch(() => []),
      this.prisma.dictItem
        .findMany({
          where: { type: 'REQUISITION_TYPE', active: true },
          select: { label: true },
          orderBy: { sortOrder: 'asc' },
        })
        .catch(() => []),
    ]);
    return {
      departments,
      recruiters: users.map((user) => ({ id: user.id, name: user.displayName })),
      requisitionTypes: [...dictItems.map((item) => item.label), UNFILLED_LABEL],
      dimensions: CYCLE_DIMENSIONS.map((dimension) => ({ key: dimension, label: DIMENSION_LABELS[dimension] })),
    };
  }

  private candidateWhere(actor: AuthenticatedUser, filters: ReportFilters): Prisma.CandidateWhereInput {
    const clauses: Prisma.CandidateWhereInput[] = [
      this.authorization.candidateWhere(actor, 'candidate:read'),
    ];
    if (filters.departmentId) clauses.push({ job: { is: { departmentId: filters.departmentId } } });
    if (filters.recruiterId) clauses.push({ job: { is: { recruiterId: filters.recruiterId } } });
    if (filters.requisitionType) {
      clauses.push({
        job: {
          is: {
            requisition: {
              is: { requisitionType: filters.requisitionType === UNFILLED ? null : filters.requisitionType },
            },
          },
        },
      });
    }
    return { AND: clauses };
  }

  private async scopedCandidates(
    actor: AuthenticatedUser,
    filters: ReportFilters,
  ): Promise<ScopedCandidate[]> {
    const range = this.dateRange(filters, '申请时间');
    return this.prisma.candidate.findMany({
      where: {
        AND: [this.candidateWhere(actor, filters), ...(range ? [{ appliedAt: this.prismaRange(range) }] : [])],
      },
      select: {
        id: true,
        name: true,
        stage: true,
        channel: true,
        poolType: true,
        appliedAt: true,
        jobId: true,
        job: {
          select: {
            title: true,
            departmentId: true,
            recruiterId: true,
            requisition: { select: { requisitionType: true } },
          },
        },
      },
    });
  }

  private async departmentNameMap(candidates: ScopedCandidate[]): Promise<Map<string, string>> {
    return resolveDepartmentNames(
      this.prisma,
      candidates.map((candidate) => candidate.job?.departmentId),
    );
  }

  private toDrillItem(
    candidate: ScopedCandidate,
    departmentNames: Map<string, string>,
  ): CandidateDrillItem {
    return {
      id: candidate.id,
      name: candidate.name,
      stage: candidate.stage,
      jobTitle: candidate.job?.title ?? null,
      departmentName: candidate.job ? departmentNames.get(candidate.job.departmentId) ?? null : null,
      channel: candidate.channel,
      appliedAt: candidate.appliedAt ? candidate.appliedAt.toISOString() : null,
    };
  }

  private filtersEcho(filters: ReportFilters) {
    return {
      from: filters.from ?? null,
      to: filters.to ?? null,
      departmentId: filters.departmentId ?? null,
      recruiterId: filters.recruiterId ?? null,
      requisitionType: filters.requisitionType ?? null,
    };
  }

  private rangeEcho(range: DateBoundary | null) {
    return {
      from: range?.gte ? toDateOnly(range.gte) : null,
      to: range?.lte ? toDateOnly(range.lte) : null,
    };
  }

  /** 时间口径：纯日期按 UTC 当日零点/当日末，避免时区漂移。 */
  private dateRange(filters: ReportFilters, label: string): DateBoundary | null {
    const start = this.parseBoundary(filters.from, false, label);
    const end = this.parseBoundary(filters.to, true, label);
    if (!start && !end) return null;
    return { gte: start, lte: end };
  }

  private prismaRange(range: DateBoundary): Prisma.DateTimeFilter {
    return {
      ...(range.gte ? { gte: range.gte } : {}),
      ...(range.lte ? { lte: range.lte } : {}),
    };
  }

  private inRange(value: Date, range: DateBoundary): boolean {
    if (range.gte && value < range.gte) return false;
    if (range.lte && value > range.lte) return false;
    return true;
  }

  private parseBoundary(value: string | undefined, endOfDay: boolean, label: string): Date | null {
    if (!value?.trim()) return null;
    const text = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      const date = new Date(`${text}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
      if (Number.isNaN(date.getTime())) throw new BadRequestException(`${label}无效`);
      return date;
    }
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) throw new BadRequestException(`${label}无效`);
    return date;
  }
}

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CandidateStage as DbCandidateStage, Prisma, SensitiveField } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthorizationService } from '../auth/authorization.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { canEnterPendingOnboard, failureReasonType, OFFER_STAGES, type FailureInitiator, type OfferStage } from '../offers/offer-contract.js';
import { resolveDepartmentNames, resolveUserNames } from '../settings/display-names.js';
import { assertDictValue, assertRequiredFields } from '../settings/config-rules.js';

const uiStages = ['new', 'screening', 'interview', 'offer', 'hired', 'rejected'] as const;
type LegacyUiStage = (typeof uiStages)[number];

const legacyStageMap: Record<LegacyUiStage, DbCandidateStage> = {
  new: DbCandidateStage.RECOMMENDED,
  screening: DbCandidateStage.HR_SCREENING,
  interview: DbCandidateStage.INTERVIEWING,
  offer: DbCandidateStage.OFFERING,
  hired: DbCandidateStage.ONBOARDED,
  rejected: DbCandidateStage.ARCHIVED,
};

const stageValues = Object.values(DbCandidateStage) as DbCandidateStage[];
const lockedStateValues = ['NONE', 'OPERABLE', 'INOPERABLE'] as const;
const poolTypeValues = ['NONE', 'UNASSIGNED', 'VIRTUAL'] as const;
type PoolTypeValue = (typeof poolTypeValues)[number];
const screeningResults = ['PASS', 'HOLD', 'REJECT'] as const;

const avatarColors = ['#6675E8', '#19A77C', '#E27D62', '#D58A28', '#BF7BD5'];

type CandidateInput = {
  name?: unknown;
  phone?: unknown;
  email?: unknown;
  jobId?: unknown;
  source?: unknown;
  channel?: unknown;
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

type StageInput = { stage?: unknown; reason?: unknown; reasonId?: unknown };
type CandidateQuery = {
  stage?: string;
  keyword?: string;
  departmentId?: string;
  jobId?: string;
  company?: string;
  channel?: string;
  source?: string;
  tag?: string;
  lockedState?: string;
  updatedBefore?: string;
  poolType?: string;
};

type CandidateWithJob = Prisma.CandidateGetPayload<{ include: { job: true } }>;

@Injectable()
export class CandidatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
  ) {}

  async list(actor: AuthenticatedUser, page = 1, pageSize = 100) {
    return this.listFiltered(actor, page, pageSize, {});
  }

  async listFiltered(actor: AuthenticatedUser, page = 1, pageSize = 20, query: CandidateQuery = {}) {
    const safePage = Number.isInteger(page) && page > 0 ? page : 1;
    const safePageSize = Number.isInteger(pageSize) ? Math.min(Math.max(pageSize, 1), 100) : 20;
    const clauses: Prisma.CandidateWhereInput[] = [this.authorization.candidateWhere(actor, 'candidate:read')];
    if (query.departmentId) clauses.push({ job: { is: { departmentId: query.departmentId } } });
    if (query.jobId) clauses.push({ jobId: query.jobId });
    if (query.company) clauses.push({ currentCompany: { contains: query.company.trim() } });
    if (query.channel) clauses.push({ channel: query.channel });
    if (query.poolType) {
      if (!poolTypeValues.includes(query.poolType as PoolTypeValue)) {
        throw new BadRequestException('人才库类型筛选值无效');
      }
      clauses.push({ poolType: query.poolType as PoolTypeValue });
    }
    if (query.source) clauses.push({ source: query.source });
    if (query.tag) clauses.push({ tags: { contains: query.tag.trim() } });
    if (query.lockedState) {
      if (!lockedStateValues.includes(query.lockedState as (typeof lockedStateValues)[number])) {
        throw new BadRequestException('锁定状态筛选值无效');
      }
      clauses.push({ lockedState: query.lockedState as 'NONE' | 'OPERABLE' | 'INOPERABLE' });
    }
    if (query.updatedBefore) {
      const updatedBefore = new Date(query.updatedBefore);
      if (Number.isNaN(updatedBefore.getTime())) throw new BadRequestException('更新时间筛选值无效');
      clauses.push({ updatedAt: { lte: updatedBefore } });
    }
    if (query.keyword?.trim()) {
      const keyword = query.keyword.trim();
      clauses.push({
        OR: [
          { name: { contains: keyword } },
          { currentCompany: { contains: keyword } },
          { currentTitle: { contains: keyword } },
          { tags: { contains: keyword } },
          { job: { is: { title: { contains: keyword } } } },
        ],
      });
    }
    const baseWhere: Prisma.CandidateWhereInput = { AND: clauses };
    const stageWhere = this.stageFilter(query.stage);
    const where: Prisma.CandidateWhereInput = stageWhere
      ? { AND: [baseWhere, stageWhere] }
      : baseWhere;
    const canReadContacts = await this.authorization.canAccessSensitiveField(
      actor,
      SensitiveField.CANDIDATE_CONTACT,
      'READ',
    );
    // 万级数据：分页取当前页，计数与阶段统计走独立聚合，不因页码/筛选夹带全量数据
    const [items, total, stageGroups] = await Promise.all([
      this.prisma.candidate.findMany({
        where,
        include: { job: true },
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (safePage - 1) * safePageSize,
        take: safePageSize,
      }),
      this.prisma.candidate.count({ where }),
      this.prisma.candidate.groupBy({
        by: ['stage'],
        where: baseWhere,
        _count: { _all: true },
      }),
    ]);

    // 人才库总量：仅受非阶段筛选影响（不受当前阶段 Tab 限制），与阶段 Tab 真实计数区分
    const archivedTotal = await this.prisma.candidate.count({
      where: { AND: [baseWhere, { stage: DbCandidateStage.ARCHIVED }] },
    });

    const counts = Object.fromEntries(stageValues.map((stage) => [stage, 0])) as Record<DbCandidateStage, number>;
    for (const group of stageGroups) counts[group.stage] = group._count._all;

    // 部门名称按当页职位批量补全，避免逐条查询
    const departmentNames = await resolveDepartmentNames(this.prisma, items.map((item) => item.job?.departmentId));

    return {
      items: await Promise.all(
        items.map((candidate) => this.toCandidateDto(candidate, canReadContacts, departmentNames)),
      ),
      page: safePage,
      pageSize: safePageSize,
      total,
      counts: {
        ...counts,
        UNASSIGNED: counts.UNASSIGNED + counts.VIRTUAL_POOL,
      },
      talentPool: { total: archivedTotal },
    };
  }

  private stageFilter(stage?: string): Prisma.CandidateWhereInput | undefined {
    if (!stage) return undefined;
    if (stage === 'UNASSIGNED') {
      return { stage: { in: [DbCandidateStage.UNASSIGNED, DbCandidateStage.VIRTUAL_POOL] } };
    }
    if (!stageValues.includes(stage as DbCandidateStage)) {
      throw new BadRequestException('候选人阶段筛选值无效');
    }
    return { stage: stage as DbCandidateStage };
  }

  async get(id: string, actor: AuthenticatedUser) {
    const candidate = await this.prisma.candidate.findFirst({
      where: {
        AND: [{ id }, this.authorization.candidateWhere(actor, 'candidate:read')],
      },
      include: { job: true },
    });
    if (!candidate) throw new NotFoundException('候选人不存在');
    const canReadContacts = await this.authorization.canAccessSensitiveField(
      actor,
      SensitiveField.CANDIDATE_CONTACT,
      'READ',
    );
    return await this.toCandidateDto(candidate, canReadContacts);
  }

  async timeline(id: string, actor: AuthenticatedUser) {
    const exists = await this.prisma.candidate.findFirst({
      where: {
        AND: [{ id }, this.authorization.candidateWhere(actor, 'candidate:read')],
      },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('候选人不存在');

    const events = await this.prisma.timelineEvent.findMany({
      where: { entityType: 'Candidate', entityId: id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    // 时间线只保存 actorId，这里补全操作人显示名；查不到的按已删除用户/系统标注，不回退为原始 ID
    const actorNames = await resolveUserNames(
      this.prisma,
      events.map((event) => event.actorId),
    );
    return events.map((event) => ({
      id: event.id,
      action: event.action,
      payload: event.payload,
      actor: event.actorId ? (actorNames.get(event.actorId) ?? '已删除用户') : '系统',
      createdAt: event.createdAt.toISOString(),
    }));
  }

  async create(value: unknown, actor: AuthenticatedUser) {
    const input = this.asRecord<CandidateInput>(value);
    const name = this.requiredText(input.name, '候选人姓名不能为空');
    const jobId = this.optionalText(input.jobId);
    const phone = this.optionalText(input.phone);
    const email = this.optionalText(input.email);
    if (phone || email) {
      await this.authorization.assertSensitiveFieldAccess(
        actor,
        SensitiveField.CANDIDATE_CONTACT,
        'WRITE',
      );
    }
    const job = jobId ? await this.prisma.job.findFirst({
        where: {
          AND: [
            { id: jobId },
            this.authorization.jobWhere(actor, 'candidate:create'),
          ],
        },
        select: { id: true, isVirtual: true, status: true },
      }) : null;
    if (jobId && (!job || job.status !== 'ACTIVE')) throw new NotFoundException('职位不存在或已关闭');
    const canReadContacts = await this.authorization.canAccessSensitiveField(
      actor,
      SensitiveField.CANDIDATE_CONTACT,
      'READ',
    );
    const source = this.optionalText(input.source) ?? '未知来源';
    const channel = this.optionalText(input.channel);
    const tags = Array.isArray(input.tags) ? input.tags.filter((tag): tag is string => typeof tag === 'string') : [];
    const rating = typeof input.rating === 'number' && Number.isFinite(input.rating)
      ? Math.min(Math.max(Math.round(input.rating), 0), 5)
      : null;
    // ATS-024：字段必填与渠道取值按后台配置在服务端校验（固定必填条件始终生效）
    await assertRequiredFields(this.prisma, 'CANDIDATE', input as Record<string, unknown>);
    if (channel) await assertDictValue(this.prisma, 'CHANNEL', channel, '渠道');

    return this.prisma.$transaction(async (tx) => {
      const candidate = await tx.candidate.create({
        data: {
          name,
          phone,
          email,
          jobId,
          poolType: !job ? 'UNASSIGNED' : job.isVirtual ? 'VIRTUAL' : 'NONE',
          stage: !job
            ? DbCandidateStage.UNASSIGNED
            : job.isVirtual
              ? DbCandidateStage.VIRTUAL_POOL
              : DbCandidateStage.RECOMMENDED,
          source,
          channel,
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
          createdById: actor.id,
          appliedAt: new Date(),
        },
        include: { job: true },
      });

      await tx.timelineEvent.create({
        data: {
          entityType: 'Candidate',
          entityId: candidate.id,
          actorId: actor.id,
          action: 'candidate.created',
          payload: {
            stage: candidate.stage,
            jobId: candidate.jobId,
            source: candidate.source,
          },
        },
      });

      return await this.toCandidateDto(candidate, canReadContacts);
    });
  }

  async updateStage(id: string, value: unknown, actor: AuthenticatedUser) {
    const input = this.asRecord<StageInput>(value);
    const nextStage = this.parseStage(input.stage);
    const reason = this.optionalText(input.reason);
    const reasonId = this.optionalText(input.reasonId);
    let archivedReasonText = reason;

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.candidate.findFirst({
        where: {
          AND: [
            { id },
            this.authorization.candidateWhere(actor, 'candidate:stage:update'),
          ],
        },
        include: { job: true },
      });
      if (!current) throw new NotFoundException('候选人不存在');
      if (current.stage === nextStage) {
        const canReadContacts = await this.authorization.canAccessSensitiveField(
          actor,
          SensitiveField.CANDIDATE_CONTACT,
          'READ',
        );
        return await this.toCandidateDto(current, canReadContacts);
      }
      if (current.stage === DbCandidateStage.PROBATION && nextStage === DbCandidateStage.ENDED) throw new ConflictException('请通过试用期结论动作记录是否转正');
      this.assertTransition(current.stage, nextStage);
      // Serialize with Offer mutations, which acquire the same candidate row first.
      if ((current.stage === DbCandidateStage.OFFERING || current.stage === DbCandidateStage.PENDING_ONBOARD)) {
        const locked = await tx.candidate.updateMany({ where: { id, stage: current.stage, jobId: current.jobId, lockedState: { not: 'INOPERABLE' } }, data: { stage: current.stage } });
        if (!locked.count) throw new ConflictException('候选人状态已变化，请刷新后重试');
      }
      if (current.stage === DbCandidateStage.OFFERING && nextStage === DbCandidateStage.PENDING_ONBOARD) {
        const offer = await tx.offerRecord.findUnique({ where: { candidateId: id } });
        if (!offer || offer.jobId !== current.jobId ||
            !canEnterPendingOnboard({ stage: offer.workflowStage as OfferStage, status: offer.stageStatus as 'ACCEPTED' }, offer.offerSentAt, offer.onboardDate, offer.writtenResult, offer.backgroundCheckStatus)) {
          throw new ConflictException('须书面 Offer 已发送、候选人已接受且确定入职时间');
        }
      }
      if (nextStage === DbCandidateStage.ARCHIVED && current.stage === DbCandidateStage.OFFERING) {
        const offer = await tx.offerRecord.findUnique({ where: { candidateId: id } });
        if (!offer || offer.jobId !== current.jobId || offer.stageStatus !== 'NOT_PASSED' ||
            !offer.rejectReasonId || !offer.failureReasonLabel || !OFFER_STAGES.includes(offer.workflowStage as OfferStage) ||
            !['COMPANY', 'CANDIDATE'].includes(offer.failureInitiator ?? '') ||
            failureReasonType(offer.workflowStage as OfferStage, offer.failureInitiator as FailureInitiator) !== offer.failureReasonType ||
            (offer.failureReasonLabel.startsWith('其他') && !offer.failureReasonText) ||
            reasonId !== offer.rejectReasonId || reason !== offer.failureReasonText) {
          throw new ConflictException('请通过 Offer 不通过动作记录原因并归档');
        }
      }
      if (nextStage === DbCandidateStage.ARCHIVED && current.stage === DbCandidateStage.PENDING_ONBOARD) {
        const option = reasonId ? await tx.reasonOption.findUnique({ where: { id: reasonId } }) : null;
        if (!option || !option.active || option.type !== 'ONBOARD_ABANDON' || (option.label.startsWith('其他') && !reason)) {
          throw new BadRequestException('请选择有效的放弃入职原因；其他原因须填写说明');
        }
      }
      if (current.stage === DbCandidateStage.PENDING_ONBOARD && nextStage === DbCandidateStage.ARCHIVED) {
        const option = await tx.reasonOption.findUniqueOrThrow({ where: { id: reasonId! } });
        await tx.timelineEvent.create({ data: { entityType: 'Candidate', entityId: id, actorId: actor.id, action: 'onboarding.abandoned', payload: { reasonType: 'ONBOARD_ABANDON', reasonId: option.id, reasonLabel: option.label, reasonText: reason } } });
      }
      if (nextStage === DbCandidateStage.ARCHIVED && current.stage !== DbCandidateStage.OFFERING
        && current.stage !== DbCandidateStage.PENDING_ONBOARD && reasonId) {
        // ATS-024：一般归档原因选填；填写时必须是集 A 启用中的选项，「其他」须补充说明。
        // 未填说明时以选项名称留快照，后续改名或停用不影响历史显示与统计
        const option = await tx.reasonOption.findUnique({ where: { id: reasonId } });
        if (!option || !option.active || option.type !== 'ARCHIVE' || (option.label.startsWith('其他') && !reason)) {
          throw new BadRequestException('归档原因无效或已停用；选择“其他”须填写说明');
        }
        archivedReasonText = reason ?? option.label;
      }
      const result = await this.persistStageChange(tx, current, nextStage, actor, archivedReasonText, reasonId);
      if (current.stage === DbCandidateStage.PENDING_ONBOARD && nextStage === DbCandidateStage.ONBOARDED) {
        if (!current.jobId) throw new ConflictException('候选人未关联职位');
        await tx.job.update({ where: { id: current.jobId }, data: { hiredCount: { increment: 1 } } });
      }
      return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  async onboardingInfo(id: string, actor: AuthenticatedUser) {
    const candidate = await this.prisma.candidate.findFirst({ where: { AND: [{ id }, this.authorization.candidateWhere(actor, 'candidate:stage:update')] } });
    if (!candidate) throw new NotFoundException('候选人不存在');
    const [offer, probation, reasons] = await Promise.all([
      this.prisma.offerRecord.findUnique({ where: { candidateId: id }, select: { jobId: true, onboardDate: true } }),
      this.prisma.probationRecord.findUnique({ where: { candidateId: id } }),
      this.prisma.reasonOption.findMany({ where: { type: 'ONBOARD_ABANDON', active: true }, orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] }),
    ]);
    return { onboardDate: offer?.jobId === candidate.jobId ? offer.onboardDate : null, probation, reasons };
  }

  async rescheduleOnboarding(id: string, value: unknown, actor: AuthenticatedUser) {
    const body = this.asRecord<{ onboardDate?: unknown }>(value);
    const date = new Date(this.requiredText(body.onboardDate, '入职时间必填'));
    if (!Number.isFinite(date.getTime())) throw new BadRequestException('入职时间无效');
    return this.prisma.$transaction(async tx => {
      const current = await this.findOperableCandidate(tx, id, actor);
      if (current.stage !== DbCandidateStage.PENDING_ONBOARD || !current.jobId) throw new ConflictException('仅待入职阶段可改期');
      const locked = await tx.candidate.updateMany({ where: { id, jobId: current.jobId, stage: 'PENDING_ONBOARD', lockedState: { not: 'INOPERABLE' } }, data: { stage: 'PENDING_ONBOARD' } });
      if (!locked.count) throw new ConflictException('候选人状态已变化');
      const offer = await tx.offerRecord.findUnique({ where: { candidateId: id } });
      if (!offer || offer.jobId !== current.jobId || offer.writtenResult !== 'ACCEPTED') throw new ConflictException('有效 Offer 不存在');
      await tx.offerRecord.update({ where: { id: offer.id }, data: { onboardDate: date, workflowVersion: { increment: 1 } } });
      await tx.timelineEvent.create({ data: { entityType: 'Candidate', entityId: id, actorId: actor.id, action: 'onboarding.rescheduled', payload: { before: offer.onboardDate?.toISOString() ?? null, after: date.toISOString() } } });
      return { onboardDate: date };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  async completeProbation(id: string, value: unknown, actor: AuthenticatedUser) {
    const body = this.asRecord<{ converted?: unknown; convertedAt?: unknown }>(value);
    if (typeof body.converted !== 'boolean') throw new BadRequestException('请选择是否转正');
    const convertedAt = body.converted ? new Date(this.requiredText(body.convertedAt, '转正时间必填')) : null;
    if (convertedAt && !Number.isFinite(convertedAt.getTime())) throw new BadRequestException('转正时间无效');
    return this.prisma.$transaction(async tx => {
      const current = await this.findOperableCandidate(tx, id, actor);
      if (current.stage !== DbCandidateStage.PROBATION) throw new ConflictException('仅试用期可记录最终结论');
      const changed = await tx.candidate.updateMany({ where: { id, stage: 'PROBATION', lockedState: { not: 'INOPERABLE' } }, data: { stage: 'ENDED' } });
      if (!changed.count) throw new ConflictException('候选人状态已变化');
      await tx.probationRecord.upsert({ where: { candidateId: id }, create: { candidateId: id, converted: body.converted as boolean, convertedAt }, update: { converted: body.converted as boolean, convertedAt } });
      await tx.timelineEvent.create({ data: { entityType: 'Candidate', entityId: id, actorId: actor.id, action: 'probation.completed', payload: { converted: body.converted as boolean, convertedAt: convertedAt?.toISOString() ?? null } } });
      const updated = await tx.candidate.findUniqueOrThrow({ where: { id }, include: { job: true } });
      return await this.toCandidateDto(updated, await this.canReadContacts(actor));
    });
  }

  async assignJob(id: string, value: unknown, actor: AuthenticatedUser) {
    const input = this.asRecord<{ jobId?: unknown }>(value);
    const jobId = this.requiredText(input.jobId, '请选择职位');
    const job = await this.prisma.job.findFirst({
      where: {
        AND: [
          { id: jobId, status: 'ACTIVE', isVirtual: false },
          this.authorization.jobWhere(actor, 'candidate:stage:update'),
        ],
      },
      select: { id: true, title: true, departmentId: true, recruiterId: true },
    });
    if (!job) throw new NotFoundException('职位不存在、已关闭或无权访问');

    return this.prisma.$transaction(async (tx) => {
      const current = await this.findOperableCandidate(tx, id, actor);
      if (current.stage !== DbCandidateStage.UNASSIGNED && current.stage !== DbCandidateStage.VIRTUAL_POOL) {
        throw new ConflictException('只有待分配池候选人可以分配职位');
      }
      const changed = await tx.candidate.updateMany({
        where: { id, stage: current.stage, jobId: current.jobId, lockedState: { not: 'INOPERABLE' } },
        data: { jobId: job.id, poolType: 'NONE', stage: DbCandidateStage.RECOMMENDED },
      });
      if (changed.count !== 1) throw new ConflictException('候选人状态已变化，请刷新后重试');
      await tx.timelineEvent.create({
        data: {
          entityType: 'Candidate', entityId: id, actorId: actor.id,
          action: 'candidate.stage_changed',
          payload: {
            from: current.stage,
            to: DbCandidateStage.RECOMMENDED,
            action: 'ASSIGN_JOB',
            jobId: job.id,
            jobTitle: job.title,
            previousJobId: current.jobId,
            previousPoolType: current.poolType,
          },
        },
      });
      const updated = await tx.candidate.findUniqueOrThrow({ where: { id }, include: { job: true } });
      return await this.toCandidateDto(updated, await this.canReadContacts(actor));
    });
  }

  /**
   * 人才库激活（FR-POOL-4）：选择职位把已归档候选人回流到 RECOMMENDED。
   * 归档记录不删除，只追加 reactivatedAt/reactivatedJobId，保留全部历史。
   */
  async activateFromPool(id: string, value: unknown, actor: AuthenticatedUser) {
    const input = this.asRecord<{ jobId?: unknown }>(value);
    const jobId = this.requiredText(input.jobId, '请选择职位');
    const job = await this.prisma.job.findFirst({
      where: {
        AND: [
          { id: jobId, status: 'ACTIVE', isVirtual: false },
          this.authorization.jobWhere(actor, 'candidate:stage:update'),
        ],
      },
      select: { id: true, title: true },
    });
    if (!job) throw new NotFoundException('职位不存在、已关闭或无权访问');

    return this.prisma.$transaction(async (tx) => {
      const current = await this.findOperableCandidate(tx, id, actor);
      if (current.stage !== DbCandidateStage.ARCHIVED) {
        throw new ConflictException('只有人才库中已归档的候选人可以激活');
      }
      const now = new Date();
      const changed = await tx.candidate.updateMany({
        where: { id, stage: DbCandidateStage.ARCHIVED, lockedState: { not: 'INOPERABLE' } },
        data: { stage: DbCandidateStage.RECOMMENDED, jobId: job.id, poolType: 'NONE' },
      });
      if (changed.count !== 1) throw new ConflictException('候选人状态已变化，请刷新后重试');
      const openEntry = await tx.candidateTalentPoolEntry.findFirst({
        where: { candidateId: id, reactivatedAt: null },
        orderBy: { archivedAt: 'desc' },
      });
      const poolEntryId = openEntry
        ? (
            await tx.candidateTalentPoolEntry.update({
              where: { id: openEntry.id },
              data: { reactivatedAt: now, reactivatedJobId: job.id, reactivatedById: actor.id },
            })
          ).id
        : null;
      await tx.timelineEvent.create({
        data: {
          entityType: 'Candidate', entityId: id, actorId: actor.id,
          action: 'candidate.stage_changed',
          payload: {
            from: DbCandidateStage.ARCHIVED,
            to: DbCandidateStage.RECOMMENDED,
            action: 'ACTIVATE_FROM_POOL',
            jobId: job.id,
            jobTitle: job.title,
            previousJobId: current.jobId,
            poolEntryId,
            archiveReasonText: current.archiveReasonText,
          },
        },
      });
      const updated = await tx.candidate.findUniqueOrThrow({ where: { id }, include: { job: true } });
      return await this.toCandidateDto(updated, await this.canReadContacts(actor));
    });
  }

  /** 人才库历史：该候选人全部归档/激活记录，供详情抽屉展示「历史不被覆盖」 */
  async listPoolHistory(id: string, actor: AuthenticatedUser) {
    const accessible = await this.prisma.candidate.findFirst({
      where: { AND: [{ id }, this.authorization.candidateWhere(actor, 'candidate:read')] },
      select: { id: true },
    });
    if (!accessible) throw new NotFoundException('候选人不存在');
    const entries = await this.prisma.candidateTalentPoolEntry.findMany({
      where: { candidateId: id },
      orderBy: { archivedAt: 'desc' },
    });
    return {
      items: entries.map((entry) => ({
        id: entry.id,
        archivedAt: entry.archivedAt.toISOString(),
        sourceStage: entry.sourceStage,
        reasonId: entry.reasonId,
        reasonText: entry.reasonText,
        reasonMissing: entry.reasonMissing,
        reactivatedAt: entry.reactivatedAt?.toISOString() ?? null,
        reactivatedJobId: entry.reactivatedJobId,
      })),
    };
  }

  async recordDepartmentScreening(id: string, value: unknown, actor: AuthenticatedUser) {
    const input = this.asRecord<{ result?: unknown; reason?: unknown; availabilitySlots?: unknown }>(value);
    if (typeof input.result !== 'string' || !screeningResults.includes(input.result as (typeof screeningResults)[number])) {
      throw new BadRequestException('部门筛选结论必须是 PASS、HOLD 或 REJECT');
    }
    const result = input.result as 'PASS' | 'HOLD' | 'REJECT';
    const reason = this.optionalText(input.reason);
    if (result === 'PASS' && !reason) {
      throw new BadRequestException('部门筛选 PASS 必须填写筛选原因');
    }
    const availabilitySlots = result === 'PASS' ? this.parseAvailabilitySlots(input.availabilitySlots) : null;

    return this.prisma.$transaction(async (tx) => {
      const current = await this.findOperableCandidate(tx, id, actor);
      if (current.stage !== DbCandidateStage.DEPT_SCREENING) {
        throw new ConflictException('候选人当前不在用人部门筛选阶段');
      }
      const screening = await tx.candidateDepartmentScreening.create({
        data: {
          candidateId: id,
          reviewerId: actor.id,
          result,
          reason,
          ...(availabilitySlots ? { availabilitySlots: availabilitySlots as Prisma.InputJsonValue } : {}),
        },
      });
      const changed = await tx.candidate.updateMany({
        where: { id, stage: DbCandidateStage.DEPT_SCREENING, lockedState: { not: 'INOPERABLE' } },
        data: result === 'PASS'
          ? { stage: DbCandidateStage.INTERVIEWING }
          : { updatedAt: new Date() },
      });
      if (changed.count !== 1) throw new ConflictException('候选人状态已变化，请刷新后重试');
      await tx.timelineEvent.create({
        data: {
          entityType: 'Candidate', entityId: id, actorId: actor.id,
          action: 'candidate.department_screening_recorded',
          payload: { result, reason, screeningId: screening.id, availabilitySlots },
        },
      });
      if (result !== 'PASS') {
        const updated = await tx.candidate.findUniqueOrThrow({ where: { id }, include: { job: true } });
        return await this.toCandidateDto(updated, await this.canReadContacts(actor));
      }
      await tx.timelineEvent.create({
        data: {
          entityType: 'Candidate', entityId: id, actorId: actor.id,
          action: 'candidate.stage_changed',
          payload: {
            from: DbCandidateStage.DEPT_SCREENING,
            to: DbCandidateStage.INTERVIEWING,
            action: 'DEPARTMENT_SCREENING_PASS',
            screeningRecordId: screening.id,
          },
        },
      });
      const updated = await tx.candidate.findUniqueOrThrow({ where: { id }, include: { job: true } });
      return await this.toCandidateDto(updated, await this.canReadContacts(actor));
    });
  }

  async setLockedState(id: string, value: unknown, actor: AuthenticatedUser) {
    const input = this.asRecord<{ lockedState?: unknown }>(value);
    if (typeof input.lockedState !== 'string' || !lockedStateValues.includes(input.lockedState as (typeof lockedStateValues)[number])) {
      throw new BadRequestException('锁定状态无效');
    }
    const nextState = input.lockedState as 'NONE' | 'OPERABLE' | 'INOPERABLE';
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.candidate.findFirst({
        where: { AND: [{ id }, this.authorization.candidateWhere(actor, 'candidate:stage:update')] },
        include: { job: true },
      });
      if (!current) throw new NotFoundException('候选人不存在');
      if (current.lockedState !== nextState) {
        const changed = await tx.candidate.updateMany({
          where: { id, lockedState: current.lockedState },
          data: { lockedState: nextState },
        });
        if (changed.count !== 1) throw new ConflictException('候选人锁定状态已变化，请刷新后重试');
        await tx.timelineEvent.create({
          data: {
            entityType: 'Candidate', entityId: id, actorId: actor.id,
            action: 'candidate.lock_changed', payload: { from: current.lockedState, to: nextState },
          },
        });
      }
      const updated = await tx.candidate.findUniqueOrThrow({ where: { id }, include: { job: true } });
      return await this.toCandidateDto(updated, await this.canReadContacts(actor));
    });
  }

  async undoLatestStageChange(id: string, actor: AuthenticatedUser) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.candidate.findFirst({
        where: { AND: [{ id }, this.authorization.candidateWhere(actor, 'candidate:stage:update')] },
        include: { job: true },
      });
      if (!current) throw new NotFoundException('候选人不存在');
      const event = await tx.timelineEvent.findFirst({
        where: { entityType: 'Candidate', entityId: id, action: 'candidate.stage_changed' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      const payload = this.jsonRecord(event?.payload);
      const from = typeof payload.from === 'string' ? payload.from : '';
      const to = typeof payload.to === 'string' ? payload.to : '';
      if (!event || !stageValues.includes(from as DbCandidateStage) || current.stage !== to) {
        throw new ConflictException('没有可撤销的最近阶段动作，或候选人状态已变化');
      }
      if (current.lockedState === 'INOPERABLE') throw new ConflictException('候选人已锁定为不可操作');

      const data: Prisma.CandidateUncheckedUpdateManyInput = { stage: from as DbCandidateStage };
      if (Object.hasOwn(payload, 'previousJobId')) {
        data.jobId = typeof payload.previousJobId === 'string' ? payload.previousJobId : null;
        data.poolType = typeof payload.previousPoolType === 'string' ? payload.previousPoolType as 'NONE' | 'UNASSIGNED' | 'VIRTUAL' : 'UNASSIGNED';
      }
      if (Object.hasOwn(payload, 'previousArchiveReasonText')) {
        data.archiveReasonText = typeof payload.previousArchiveReasonText === 'string' ? payload.previousArchiveReasonText : null;
        data.archiveReasonId = typeof payload.previousArchiveReasonId === 'string' ? payload.previousArchiveReasonId : null;
        data.archiveChannel = typeof payload.previousArchiveChannel === 'string' ? payload.previousArchiveChannel : null;
      }
      const changed = await tx.candidate.updateMany({
        where: { id, stage: current.stage, lockedState: { not: 'INOPERABLE' } },
        data,
      });
      if (changed.count !== 1) throw new ConflictException('候选人状态已变化，请刷新后重试');
      if (from === 'PENDING_ONBOARD' && to === 'ONBOARDED') {
        if (!current.jobId) throw new ConflictException('候选人未关联职位');
        const job = await tx.job.updateMany({ where: { id: current.jobId, hiredCount: { gt: 0 } }, data: { hiredCount: { decrement: 1 } } });
        if (!job.count) throw new ConflictException('职位入职人数异常，无法撤销');
      }
      const screeningRecordId = typeof payload.screeningRecordId === 'string' ? payload.screeningRecordId : null;
      if (screeningRecordId) {
        await tx.candidateDepartmentScreening.updateMany({
          where: { id: screeningRecordId, candidateId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      // 撤销归档后该次入池记录不再成立，删除本次生成的归档记录（属于撤销同一动作，非覆盖历史）
      const poolEntryId = typeof payload.poolEntryId === 'string' ? payload.poolEntryId : null;
      if (poolEntryId) {
        await tx.candidateTalentPoolEntry.deleteMany({
          where: { id: poolEntryId, candidateId: id, reactivatedAt: null },
        });
      }
      await tx.timelineEvent.create({
        data: {
          entityType: 'Candidate', entityId: id, actorId: actor.id,
          action: 'candidate.stage_reverted',
          payload: { from: to, to: from, revertedEventId: event.id, screeningRecordId },
        },
      });
      const updated = await tx.candidate.findUniqueOrThrow({ where: { id }, include: { job: true } });
      return await this.toCandidateDto(updated, await this.canReadContacts(actor));
    });
  }

  async batchUpdateStage(value: unknown, actor: AuthenticatedUser) {
    const input = this.asRecord<{ candidateIds?: unknown; stage?: unknown; reason?: unknown }>(value);
    if (!Array.isArray(input.candidateIds) || input.candidateIds.length < 1 || input.candidateIds.length > 100
      || input.candidateIds.some((id) => typeof id !== 'string' || !id.trim())) {
      throw new BadRequestException('候选人列表必须包含 1 至 100 个有效 ID');
    }
    const ids = [...new Set(input.candidateIds as string[])];
    const stage = this.parseStage(input.stage);
    const results: { id: string; ok: boolean; error?: string }[] = [];
    for (const id of ids) {
      try {
        await this.updateStage(id, { stage, reason: input.reason }, actor);
        results.push({ id, ok: true });
      } catch (error) {
        results.push({ id, ok: false, error: error instanceof Error ? error.message : '操作失败' });
      }
    }
    return { updated: results.filter((result) => result.ok).length, failed: results.length - results.filter((result) => result.ok).length, results };
  }

  async batchRecordDepartmentScreening(value: unknown, actor: AuthenticatedUser) {
    const input = this.asRecord<{ candidateIds?: unknown; result?: unknown; reason?: unknown; availabilitySlots?: unknown }>(value);
    if (!Array.isArray(input.candidateIds) || input.candidateIds.length < 1 || input.candidateIds.length > 100
      || input.candidateIds.some((id) => typeof id !== 'string' || !id.trim())) {
      throw new BadRequestException('候选人列表必须包含 1 至 100 个有效 ID');
    }
    const ids = [...new Set((input.candidateIds as string[]).map((id) => id.trim()))];
    const results: { id: string; ok: boolean; error?: string }[] = [];
    for (const id of ids) {
      try {
        await this.recordDepartmentScreening(id, {
          result: input.result,
          reason: input.reason,
          availabilitySlots: input.availabilitySlots,
        }, actor);
        results.push({ id, ok: true });
      } catch (error) {
        results.push({ id, ok: false, error: error instanceof Error ? error.message : '操作失败' });
      }
    }
    return {
      updated: results.filter((result) => result.ok).length,
      failed: results.filter((result) => !result.ok).length,
      results,
    };
  }

  async batchUpdateTags(value: unknown, actor: AuthenticatedUser) {
    const input = this.asRecord<{ candidateIds?: unknown; tags?: unknown; mode?: unknown }>(value);
    if (!Array.isArray(input.candidateIds) || input.candidateIds.length < 1 || input.candidateIds.length > 100
      || input.candidateIds.some((id) => typeof id !== 'string' || !id.trim())) {
      throw new BadRequestException('候选人列表必须包含 1 至 100 个有效 ID');
    }
    if (input.mode !== 'ADD' && input.mode !== 'REMOVE' && input.mode !== 'REPLACE') {
      throw new BadRequestException('标签操作必须是 ADD、REMOVE 或 REPLACE');
    }
    if (!Array.isArray(input.tags) || input.tags.length < 1 || input.tags.length > 20
      || input.tags.some((tag) => typeof tag !== 'string' || !tag.trim() || tag.trim().length > 50)) {
      throw new BadRequestException('标签必须包含 1 至 20 个非空值，每个不超过 50 个字符');
    }
    const mode = input.mode;
    const tags = [...new Set((input.tags as string[]).map((tag) => tag.trim()))];
    const ids = [...new Set((input.candidateIds as string[]).map((id) => id.trim()))];
    const results: { id: string; ok: boolean; error?: string }[] = [];

    for (const id of ids) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const current = await tx.candidate.findFirst({
            where: { AND: [{ id }, this.authorization.candidateWhere(actor, 'candidate:stage:update')] },
            select: { id: true, stage: true, jobId: true, tags: true, lockedState: true },
          });
          if (!current) throw new NotFoundException('候选人不存在');
          if (current.lockedState === 'INOPERABLE') throw new ConflictException('候选人已锁定为不可操作');

          const existing = this.parseTags(current.tags);
          const next = mode === 'REPLACE'
            ? tags
            : mode === 'ADD'
              ? [...new Set([...existing, ...tags])]
              : existing.filter((tag) => !tags.includes(tag));
          const changed = await tx.candidate.updateMany({
            where: {
              id,
              stage: current.stage,
              jobId: current.jobId,
              tags: current.tags,
              lockedState: current.lockedState,
            },
            data: { tags: JSON.stringify(next) },
          });
          if (changed.count !== 1) throw new ConflictException('候选人状态已变化，请刷新后重试');
          await tx.timelineEvent.create({
            data: {
              entityType: 'Candidate', entityId: id, actorId: actor.id,
              action: 'candidate.tags_changed',
              payload: { mode, added: next.filter((tag) => !existing.includes(tag)), removed: existing.filter((tag) => !next.includes(tag)), tags: next },
            },
          });
        });
        results.push({ id, ok: true });
      } catch (error) {
        results.push({ id, ok: false, error: error instanceof Error ? error.message : '操作失败' });
      }
    }
    return {
      updated: results.filter((result) => result.ok).length,
      failed: results.filter((result) => !result.ok).length,
      results,
    };
  }

  async listSavedFilters(actor: AuthenticatedUser) {
    return this.prisma.savedCandidateFilter.findMany({
      where: { userId: actor.id },
      orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
    });
  }

  async saveFilter(value: unknown, actor: AuthenticatedUser) {
    const input = this.asRecord<{ name?: unknown; filters?: unknown }>(value);
    const name = this.requiredText(input.name, '筛选名称不能为空').slice(0, 120);
    const source = this.asRecord<Record<string, unknown>>(input.filters);
    const allowed = ['stage', 'keyword', 'departmentId', 'jobId', 'company', 'channel', 'source', 'tag', 'lockedState', 'updatedBefore'];
    const filters = Object.fromEntries(allowed.flatMap((key) => {
      const value = source[key];
      return typeof value === 'string' && value.trim() ? [[key, value.trim().slice(0, 500)]] : [];
    }));
    return this.prisma.savedCandidateFilter.upsert({
      where: { userId_name: { userId: actor.id, name } },
      create: { userId: actor.id, name, filters },
      update: { filters },
    });
  }

  async deleteSavedFilter(id: string, actor: AuthenticatedUser) {
    const result = await this.prisma.savedCandidateFilter.deleteMany({ where: { id, userId: actor.id } });
    if (!result.count) throw new NotFoundException('已保存筛选不存在');
    return { deleted: true };
  }

  private parseStage(value: unknown): DbCandidateStage {
    if (typeof value !== 'string') throw new BadRequestException('候选人阶段不能为空');
    if (stageValues.includes(value as DbCandidateStage)) return value as DbCandidateStage;
    if (uiStages.includes(value as LegacyUiStage)) return legacyStageMap[value as LegacyUiStage];
    throw new BadRequestException(`阶段值无效：${value}`);
  }

  private assertTransition(from: DbCandidateStage, to: DbCandidateStage): void {
    if (from === DbCandidateStage.ARCHIVED) {
      throw new ConflictException('已归档候选人需通过人才库激活动作恢复');
    }
    if (to === DbCandidateStage.ARCHIVED) return;
    if (from === DbCandidateStage.UNASSIGNED || from === DbCandidateStage.VIRTUAL_POOL) {
      throw new ConflictException('待分配候选人需先通过职位分配动作进入人才推荐');
    }
    const next: Partial<Record<DbCandidateStage, DbCandidateStage>> = {
      [DbCandidateStage.RECOMMENDED]: DbCandidateStage.HR_SCREENING,
      [DbCandidateStage.HR_SCREENING]: DbCandidateStage.DEPT_SCREENING,
      [DbCandidateStage.INTERVIEWING]: DbCandidateStage.OFFERING,
      [DbCandidateStage.OFFERING]: DbCandidateStage.PENDING_ONBOARD,
      [DbCandidateStage.PENDING_ONBOARD]: DbCandidateStage.ONBOARDED,
      [DbCandidateStage.ONBOARDED]: DbCandidateStage.PROBATION,
      [DbCandidateStage.PROBATION]: DbCandidateStage.ENDED,
    };
    if (next[from] !== to) {
      if (from === DbCandidateStage.DEPT_SCREENING && to === DbCandidateStage.INTERVIEWING) {
        throw new ConflictException('请通过部门筛选 PASS 动作并提供结构化可约面时间');
      }
      throw new ConflictException(`不允许从 ${from} 直接流转到 ${to}`);
    }
  }

  private async findOperableCandidate(
    tx: Prisma.TransactionClient,
    id: string,
    actor: AuthenticatedUser,
  ): Promise<CandidateWithJob> {
    const candidate = await tx.candidate.findFirst({
      where: { AND: [{ id }, this.authorization.candidateWhere(actor, 'candidate:stage:update')] },
      include: { job: true },
    });
    if (!candidate) throw new NotFoundException('候选人不存在');
    if (candidate.lockedState === 'INOPERABLE') throw new ConflictException('候选人已锁定为不可操作');
    return candidate;
  }

  private async persistStageChange(
    tx: Prisma.TransactionClient,
    current: CandidateWithJob,
    nextStage: DbCandidateStage,
    actor: AuthenticatedUser,
    reason: string | null,
    reasonId: string | null = null,
  ) {
    const isArchive = nextStage === DbCandidateStage.ARCHIVED;
    // 已归档候选人再次归档视为重复动作，沿用现有归档记录，不重复入池
    const alreadyArchived = current.stage === DbCandidateStage.ARCHIVED;
    const changed = await tx.candidate.updateMany({
      where: { id: current.id, stage: current.stage, lockedState: { not: 'INOPERABLE' } },
      data: {
        stage: nextStage,
        ...(isArchive && !alreadyArchived
          ? { archiveReasonText: reason, archiveReasonId: reasonId, archiveChannel: current.channel }
          : {}),
      },
    });
    if (changed.count !== 1) throw new ConflictException('候选人状态已变化，请刷新后重试');
    let poolEntryId: string | null = null;
    if (isArchive && !alreadyArchived) {
      // 归档自动入池：一条归档记录对应一次入池历史，未填写原因以 reasonMissing 单独统计
      const entry = await tx.candidateTalentPoolEntry.create({
        data: {
          candidateId: current.id,
          archivedAt: new Date(),
          sourceStage: current.stage,
          reasonId,
          reasonText: reason,
          reasonMissing: !reason && !reasonId,
        },
      });
      poolEntryId = entry.id;
    }
    await tx.timelineEvent.create({
      data: {
        entityType: 'Candidate', entityId: current.id, actorId: actor.id,
        action: 'candidate.stage_changed',
        payload: {
          from: current.stage,
          to: nextStage,
          databaseFrom: current.stage,
          databaseTo: nextStage,
          reason,
          reasonId,
          ...(isArchive && !alreadyArchived ? { poolEntryId, archiveReasonMissing: !reason && !reasonId } : {}),
          ...(isArchive ? { previousArchiveReasonText: current.archiveReasonText, previousArchiveReasonId: current.archiveReasonId, previousArchiveChannel: current.archiveChannel } : {}),
        },
      },
    });
    const updated = await tx.candidate.findUniqueOrThrow({ where: { id: current.id }, include: { job: true } });
    return await this.toCandidateDto(updated, await this.canReadContacts(actor));
  }

  private async canReadContacts(actor: AuthenticatedUser): Promise<boolean> {
    return this.authorization.canAccessSensitiveField(actor, SensitiveField.CANDIDATE_CONTACT, 'READ');
  }

  private parseAvailabilitySlots(value: unknown): { startAt: string; endAt: string }[] {
    if (!Array.isArray(value) || value.length === 0 || value.length > 20) {
      throw new BadRequestException('PASS 结论必须提供 1 至 20 个可约时间段');
    }
    const now = Date.now();
    return value.map((entry) => {
      const item = this.asRecord<{ startAt?: unknown; endAt?: unknown }>(entry);
      if (typeof item.startAt !== 'string' || typeof item.endAt !== 'string') {
        throw new BadRequestException('可约时间段必须包含 startAt 与 endAt');
      }
      const startAt = new Date(item.startAt);
      const endAt = new Date(item.endAt);
      if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || startAt.getTime() <= now || endAt <= startAt) {
        throw new BadRequestException('可约时间必须为未来的有效时间段，结束时间晚于开始时间');
      }
      return { startAt: startAt.toISOString(), endAt: endAt.toISOString() };
    });
  }

  private jsonRecord(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
  }

  private async toCandidateDto(
    candidate: CandidateWithJob,
    canReadContacts: boolean,
    departmentNames?: Map<string, string>,
  ) {
    const departmentId = candidate.job?.departmentId ?? '';
    const names = departmentNames ?? (await resolveDepartmentNames(this.prisma, [departmentId]));
    return {
      id: candidate.id,
      name: candidate.name,
      phone: canReadContacts ? candidate.phone ?? '待补充' : '已隐藏',
      email: canReadContacts ? candidate.email ?? '待补充' : '已隐藏',
      jobId: candidate.jobId ?? '',
      jobTitle: candidate.job?.title ?? '',
      jobLocation: candidate.job?.location ?? '',
      departmentId: candidate.job?.departmentId ?? '',
      departmentName: names.get(departmentId) ?? '',
      departmentColor: '#8390A5',
      stage: candidate.stage,
      poolType: candidate.poolType,
      lockedState: candidate.lockedState,
      source: candidate.source ?? '未知来源',
      channel: candidate.channel ?? '',
      archiveReasonText: candidate.archiveReasonText ?? '',
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

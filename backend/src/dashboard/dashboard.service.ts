import { Injectable, NotFoundException } from '@nestjs/common';
import { AuthorizationService } from '../auth/authorization.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { resolveDepartmentNames, resolveUserNames } from '../settings/display-names.js';

const READ_KEY_PREFIX = 'dashboard.notifications.read.';

const TODO_LABELS = {
  UNASSIGNED: { label: '待分配', page: 'candidates', detail: '待分配职位的候选人' },
  HR_SCREENING: { label: '待筛选', page: 'candidates', detail: 'HR 初筛待处理' },
  INTERVIEW_TO_SCHEDULE: { label: '待安排面试', page: 'interviews', detail: '面试待定时间' },
  FEEDBACK_PENDING: { label: '待评价', page: 'interviews', detail: '面试完成待填评价' },
  BG_CONFIRM: { label: '背调待确认', page: 'candidates', detail: '背调结果待确认' },
  OFFER_TO_SEND: { label: '待发书面 offer', page: 'candidates', detail: '口头已通过，书面 offer 待发送' },
  PENDING_ONBOARD: { label: '待确认入职', page: 'candidates', detail: '待确认到岗' },
} as const;

type TodoKey = keyof typeof TODO_LABELS;

type NotificationCategory = 'MENTION' | 'FOLLOW_UP' | 'FEEDBACK' | 'OFFER';

const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  MENTION: '@我',
  FOLLOW_UP: '跟进提醒',
  FEEDBACK: '评价相关',
  OFFER: 'offer 相关',
};

type NotificationItem = {
  id: string;
  category: NotificationCategory;
  title: string;
  detail: string;
  at: string | null;
  page: string;
  candidateId: string | null;
  read: boolean;
};

type ReadState = { ids: string[]; allReadAt: string | null };

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
  ) {}

  /** 工作台：七类待办 + 今日指标，全部来自权限内真实数据。 */
  async summary(actor: AuthenticatedUser) {
    const scope = this.authorization.candidateWhere(actor, 'candidate:read');
    const now = new Date();
    const { start, end } = this.todayRange();
    const offeringCandidates = await this.prisma.candidate.findMany({
      where: { AND: [scope, { stage: { in: ['OFFERING', 'PENDING_ONBOARD'] } }] },
      select: { id: true },
    });
    const offeringIds = offeringCandidates.map((candidate) => candidate.id);

    const [
      unassigned,
      screening,
      activeInterviews,
      pendingOnboard,
      bgConfirm,
      offerToSend,
      screeningToday,
      interviewsTodayCount,
      interviewsToday,
    ] = await Promise.all([
      this.prisma.candidate.count({ where: { AND: [scope, { stage: 'UNASSIGNED' }] } }),
      this.prisma.candidate.count({ where: { AND: [scope, { stage: 'HR_SCREENING' }] } }),
      this.prisma.interview.findMany({
        where: { AND: [{ status: { in: ['TO_SCHEDULE', 'FEEDBACK_PENDING'] } }, { candidate: scope }] },
        select: { id: true, status: true, time: true, endTime: true },
      }),
      this.prisma.candidate.count({ where: { AND: [scope, { stage: 'PENDING_ONBOARD' }] } }),
      offeringIds.length
        ? this.prisma.offerRecord.count({
            where: {
              candidateId: { in: offeringIds },
              OR: [
                { workflowStage: 'BACKGROUND_APPROVAL', stageStatus: 'PENDING' },
                { workflowStage: null, stage: 'BG_IN_PROGRESS' },
              ],
            },
          })
        : 0,
      offeringIds.length
        ? this.prisma.offerRecord.count({
            where: {
              candidateId: { in: offeringIds },
              OR: [
                { workflowStage: 'WRITTEN_OFFER', stageStatus: 'PENDING', offerSentAt: null },
                { workflowStage: null, stage: 'OFFER_TO_SEND' },
              ],
            },
          })
        : 0,
      this.prisma.candidate.count({
        where: {
          AND: [scope, { stage: 'HR_SCREENING' }, { appliedAt: { gte: start, lte: end } }],
        },
      }),
      this.prisma.interview.count({
        where: {
          AND: [{ time: { gte: start, lte: end } }, { status: { not: 'CANCELLED' } }, { candidate: scope }],
        },
      }),
      this.prisma.interview.findMany({
        where: {
          AND: [{ time: { gte: start, lte: end } }, { status: { not: 'CANCELLED' } }, { candidate: scope }],
        },
        select: {
          id: true,
          candidateId: true,
          round: true,
          mode: true,
          time: true,
          candidate: { select: { name: true, job: { select: { title: true } } } },
        },
        orderBy: { time: 'asc' },
        take: 50,
      }),
    ]);

    const { toSchedule, feedbackPending: feedback } = await this.classifyInterviews(activeInterviews, now);

    const counts: Record<TodoKey, number> = {
      UNASSIGNED: unassigned,
      HR_SCREENING: screening,
      INTERVIEW_TO_SCHEDULE: toSchedule,
      FEEDBACK_PENDING: feedback,
      BG_CONFIRM: bgConfirm,
      OFFER_TO_SEND: offerToSend,
      PENDING_ONBOARD: pendingOnboard,
    };

    return {
      generatedAt: now.toISOString(),
      date: start.toISOString().slice(0, 10),
      timezone: 'UTC 日期口径（与周期报表一致）',
      todos: (Object.keys(TODO_LABELS) as TodoKey[]).map((key) => ({
        key,
        ...TODO_LABELS[key],
        count: counts[key],
      })),
      today: {
        screening: {
          count: screeningToday,
          label: '今日待筛选申请',
          denominator: '今日新增且当前处于 HR 初筛的候选人',
        },
        interviews: {
          count: interviewsTodayCount,
          label: '今日面试',
          items: interviewsToday.map((interview) => ({
            id: interview.id,
            candidateId: interview.candidateId,
            candidateName: interview.candidate?.name ?? null,
            jobTitle: interview.candidate?.job?.title ?? null,
            round: interview.round,
            mode: interview.mode,
            time: interview.time.toISOString(),
          })),
        },
      },
      note: '待办与今日指标按当前账号数据权限实时聚合，不使用预置样例数据',
    };
  }

  /** 职位 360 的职位选择列表（权限内）。 */
  async jobs(actor: AuthenticatedUser) {
    const jobs = await this.prisma.job.findMany({
      where: this.authorization.jobWhere(actor, 'job:read'),
      select: {
        id: true,
        code: true,
        title: true,
        departmentId: true,
        headcount: true,
        hiredCount: true,
        status: true,
        isVirtual: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const departmentNames = await resolveDepartmentNames(
      this.prisma,
      jobs.map((job) => job.departmentId),
    );
    return jobs.map((job) => ({
      ...job,
      departmentName: departmentNames.get(job.departmentId) ?? null,
    }));
  }

  /** 职位 360：进展与 HC 详情。 */
  async job360(actor: AuthenticatedUser, jobId: string) {
    if (!(await this.authorization.canAccessJob(actor, 'job:read', jobId))) {
      throw new NotFoundException('职位不存在或不在数据权限范围内');
    }
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        code: true,
        title: true,
        departmentId: true,
        recruiterId: true,
        headcount: true,
        hiredCount: true,
        status: true,
        isVirtual: true,
        requisition: {
          select: {
            id: true,
            title: true,
            status: true,
            headcount: true,
            requisitionType: true,
            submittedAt: true,
            recruitmentStartDate: true,
            closedAt: true,
            cycleDays: true,
          },
        },
      },
    });
    if (!job) throw new NotFoundException('职位不存在');

    const scope = this.authorization.candidateWhere(actor, 'candidate:read');
    const now = new Date();
    const [stageRows, allJobInterviews, candidates] = await Promise.all([
      this.prisma.candidate.groupBy({
        by: ['stage'],
        where: { AND: [scope, { jobId }] },
        _count: { _all: true },
      }),
      this.prisma.interview.findMany({
        where: { AND: [{ jobId }, { status: { in: ['TO_SCHEDULE', 'FEEDBACK_PENDING'] } }, { candidate: scope }] },
        select: { id: true, candidateId: true, status: true, time: true, endTime: true, round: true },
        orderBy: { time: 'asc' },
      }),
      this.prisma.candidate.findMany({
        where: { AND: [scope, { jobId }] },
        select: { id: true, channel: true },
      }),
    ]);

    const interviewSummary = await this.classifyInterviews(allJobInterviews, now);
    const offerRecords = candidates.length
      ? await this.prisma.offerRecord.findMany({
          where: { candidateId: { in: candidates.map((candidate) => candidate.id) } },
          select: { workflowStage: true, stage: true },
        })
      : [];
    const offerBuckets: Record<string, number> = {};
    for (const offer of offerRecords) {
      const key = offer.workflowStage ?? offer.stage;
      offerBuckets[key] = (offerBuckets[key] ?? 0) + 1;
    }

    const [departmentNames, recruiterNames] = await Promise.all([
      resolveDepartmentNames(this.prisma, [job.departmentId]),
      resolveUserNames(this.prisma, [job.recruiterId]),
    ]);

    const stageCounts = Object.fromEntries(stageRows.map((row) => [row.stage, row._count._all]));
    const total = stageRows.reduce((sum, row) => sum + row._count._all, 0);
    const reached = (stage: string) => {
      const order = [
        'RECOMMENDED',
        'HR_SCREENING',
        'DEPT_SCREENING',
        'INTERVIEWING',
        'OFFERING',
        'PENDING_ONBOARD',
        'ONBOARDED',
        'PROBATION',
        'ENDED',
      ];
      const target = order.indexOf(stage);
      return order
        .slice(target)
        .reduce((sum, key) => sum + (stageCounts[key] ?? 0), 0);
    };

    return {
      job: {
        ...job,
        departmentName: departmentNames.get(job.departmentId) ?? null,
        recruiterName: job.recruiterId ? recruiterNames.get(job.recruiterId) ?? null : null,
      },
      hc: {
        headcount: job.headcount,
        hiredCount: job.hiredCount,
        gap: Math.max(0, job.headcount - job.hiredCount),
        inProcess: Math.max(0, total - (stageCounts.ARCHIVED ?? 0)),
      },
      stageCounts,
      progress: {
        total,
        interviewed: reached('INTERVIEWING'),
        offered: reached('OFFERING'),
        onboarded: reached('ONBOARDED'),
      },
      interviews: {
        toSchedule: interviewSummary.toSchedule,
        feedbackPending: interviewSummary.feedbackPending,
        items: interviewSummary.items.slice(0, 20).map((interview) => ({
          id: interview.id,
          candidateId: interview.candidateId,
          status: interview.effectiveStatus,
          time: interview.time,
          round: interview.round,
        })),
      },
      offers: offerBuckets,
      channels: this.groupChannels(candidates),
    };
  }

  /** 分类通知（@我 / 跟进提醒 / 评价相关 / offer 相关）与已读状态。 */
  async notifications(actor: AuthenticatedUser) {
    const scope = this.authorization.candidateWhere(actor, 'candidate:read');
    const now = new Date();
    const items: NotificationItem[] = [];

    const interviews = await this.prisma.interview.findMany({
      where: {
        AND: [
          { interviewerIds: { contains: `|${actor.id}|` } },
          { status: { in: ['TO_SCHEDULE', 'FEEDBACK_PENDING'] } },
          { candidate: scope },
        ],
      },
      select: {
        id: true,
        status: true,
        time: true,
        endTime: true,
        round: true,
        candidateId: true,
        candidate: { select: { name: true, job: { select: { title: true } } } },
      },
      orderBy: { time: 'desc' },
      take: 100,
    });
    const interviewFeedbackRows = interviews.length
      ? await this.prisma.interviewFeedback.findMany({
          where: { interviewId: { in: interviews.map((item) => item.id) }, interviewerId: actor.id },
          select: { interviewId: true },
        })
      : [];
    const mySubmittedFeedback = new Set(interviewFeedbackRows.map((row) => row.interviewId));
    for (const interview of interviews) {
      const ended = (interview.endTime ?? interview.time).getTime() <= now.getTime();
      const isFeedback =
        interview.status === 'FEEDBACK_PENDING' || (ended && !mySubmittedFeedback.has(interview.id));
      if (ended && mySubmittedFeedback.has(interview.id)) continue;
      items.push({
        id: `${isFeedback ? 'feedback' : 'mention'}:${interview.id}`,
        category: isFeedback ? 'FEEDBACK' : 'MENTION',
        title: isFeedback
          ? `待填写评价：${interview.candidate?.name ?? '候选人'} 第 ${interview.round} 轮`
          : `面试邀约：${interview.candidate?.name ?? '候选人'} 第 ${interview.round} 轮待安排`,
        detail: interview.candidate?.job?.title ?? '未关联职位',
        at: interview.time.toISOString(),
        page: 'interviews',
        candidateId: interview.candidateId,
        read: false,
      });
    }

    const reminders = await this.prisma.onboardingReminder.findMany({
      where: { recipientId: actor.id, readAt: null, dueAt: { lte: new Date(now.getTime() + 7 * 86_400_000) } },
      select: { id: true, candidateId: true, onboardDate: true, dueAt: true },
      orderBy: { dueAt: 'asc' },
      take: 50,
    });
    if (reminders.length) {
      const candidates = await this.prisma.candidate.findMany({
        where: { AND: [scope, { id: { in: reminders.map((reminder) => reminder.candidateId) } }] },
        select: { id: true, name: true },
      });
      const names = new Map(candidates.map((candidate) => [candidate.id, candidate.name]));
      for (const reminder of reminders) {
        const name = names.get(reminder.candidateId);
        if (!name) continue;
        items.push({
          id: `reminder:${reminder.id}`,
          category: 'FOLLOW_UP',
          title: `入职跟进：${name}`,
          detail: `预计入职 ${reminder.onboardDate.toISOString().slice(0, 10)}`,
          at: reminder.dueAt.toISOString(),
          page: 'candidates',
          candidateId: reminder.candidateId,
          read: false,
        });
      }
    }

    const offerCandidates = await this.prisma.candidate.findMany({
      where: { AND: [scope, { stage: { in: ['OFFERING', 'PENDING_ONBOARD'] } }] },
      select: { id: true, name: true, job: { select: { title: true } } },
    });
    if (offerCandidates.length) {
      const offers = await this.prisma.offerRecord.findMany({
        where: {
          candidateId: { in: offerCandidates.map((candidate) => candidate.id) },
          OR: [
            { workflowStage: 'BACKGROUND_APPROVAL', stageStatus: 'PENDING' },
            { workflowStage: 'WRITTEN_OFFER', stageStatus: 'PENDING' },
            { workflowStage: null, stage: { in: ['BG_IN_PROGRESS', 'OFFER_TO_SEND', 'OFFER_SENT'] } },
          ],
        },
        select: {
          candidateId: true,
          stage: true,
          workflowStage: true,
          stageStatus: true,
          offerSentAt: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: 'desc' },
      });
      const byId = new Map(offerCandidates.map((candidate) => [candidate.id, candidate]));
      for (const offer of offers) {
        const candidate = byId.get(offer.candidateId);
        if (!candidate) continue;
        const bucket =
          offer.workflowStage === 'BACKGROUND_APPROVAL' || (!offer.workflowStage && offer.stage === 'BG_IN_PROGRESS')
            ? { key: 'BG_CONFIRM', label: '背调待确认' }
            : (offer.workflowStage === 'WRITTEN_OFFER' && !offer.offerSentAt) ||
                (!offer.workflowStage && offer.stage === 'OFFER_TO_SEND')
              ? { key: 'OFFER_TO_SEND', label: '书面 offer 待发送' }
              : { key: 'OFFER_SENT', label: 'offer 已发送待回执' };
        items.push({
          id: `offer:${offer.candidateId}:${bucket.key}`,
          category: 'OFFER',
          title: `${bucket.label}：${candidate.name}`,
          detail: candidate.job?.title ?? '未关联职位',
          at: offer.updatedAt.toISOString(),
          page: 'candidates',
          candidateId: candidate.id,
          read: false,
        });
      }
    }

    const state = await this.getReadState(actor.id);
    const allReadAt = state.allReadAt ? new Date(state.allReadAt).getTime() : 0;
    for (const item of items) {
      item.read =
        state.ids.includes(item.id) || (item.at ? new Date(item.at).getTime() <= allReadAt : false);
    }

    const categories = (Object.keys(CATEGORY_LABELS) as NotificationCategory[]).map((category) => {
      const categoryItems = items
        .filter((item) => item.category === category)
        .sort((left, right) => (right.at ?? '').localeCompare(left.at ?? ''));
      return {
        key: category,
        label: CATEGORY_LABELS[category],
        count: categoryItems.length,
        unread: categoryItems.filter((item) => !item.read).length,
        items: categoryItems,
      };
    });

    return {
      generatedAt: new Date().toISOString(),
      categories,
      total: items.length,
      unreadTotal: items.filter((item) => !item.read).length,
      source: '面试邀约/待评价、入职提醒、offer 待办实时聚合',
    };
  }

  /** 全部已读或按 id 已读。 */
  async markNotificationsRead(
    actor: AuthenticatedUser,
    payload: { ids?: string[]; all?: boolean },
  ) {
    const state = await this.getReadState(actor.id);
    const incoming = Array.isArray(payload.ids)
      ? payload.ids.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 128)
      : [];
    const mergedIds = [...new Set([...state.ids, ...incoming])].slice(-500);
    const next: ReadState = payload.all
      ? { ids: [], allReadAt: new Date().toISOString() }
      : { ids: mergedIds, allReadAt: state.allReadAt };
    await this.prisma.systemSetting.upsert({
      where: { key: `${READ_KEY_PREFIX}${actor.id}` },
      create: { key: `${READ_KEY_PREFIX}${actor.id}`, value: JSON.stringify(next) },
      update: { value: JSON.stringify(next) },
    });
    return { allReadAt: next.allReadAt, readIds: next.ids.length };
  }

  /**
   * 面试表只落库 TO_SCHEDULE / CANCELLED，待评价（FEEDBACK_PENDING）由结束时间与面评记录共同决定。
   */
  private async classifyInterviews<
    T extends { id: string; status: string; time: Date; endTime: Date | null },
  >(rows: T[], now: Date) {
    const endedIds = rows
      .filter((row) => row.status === 'TO_SCHEDULE' && (row.endTime ?? row.time).getTime() <= now.getTime())
      .map((row) => row.id);
    const feedbackRows = endedIds.length
      ? await this.prisma.interviewFeedback.findMany({
          where: { interviewId: { in: endedIds } },
          select: { interviewId: true },
          distinct: ['interviewId'],
        })
      : [];
    const hasFeedback = new Set(feedbackRows.map((row) => row.interviewId));

    let toSchedule = 0;
    let feedbackPending = 0;
    const items: Array<T & { effectiveStatus: 'TO_SCHEDULE' | 'FEEDBACK_PENDING' }> = [];
    for (const row of rows) {
      const ended = (row.endTime ?? row.time).getTime() <= now.getTime();
      if (row.status === 'FEEDBACK_PENDING' || (ended && !hasFeedback.has(row.id))) {
        feedbackPending += 1;
        items.push({ ...row, effectiveStatus: 'FEEDBACK_PENDING' });
      } else if (!ended) {
        toSchedule += 1;
        items.push({ ...row, effectiveStatus: 'TO_SCHEDULE' });
      }
    }
    return { toSchedule, feedbackPending, items };
  }

  private async getReadState(userId: string): Promise<ReadState> {
    const row = await this.prisma.systemSetting.findUnique({
      where: { key: `${READ_KEY_PREFIX}${userId}` },
      select: { value: true },
    });
    if (!row?.value) return { ids: [], allReadAt: null };
    try {
      const parsed = JSON.parse(row.value) as Partial<ReadState>;
      return {
        ids: Array.isArray(parsed.ids) ? parsed.ids.filter((id): id is string => typeof id === 'string') : [],
        allReadAt: typeof parsed.allReadAt === 'string' ? parsed.allReadAt : null,
      };
    } catch {
      return { ids: [], allReadAt: null };
    }
  }

  private todayRange(): { start: Date; end: Date } {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const end = new Date(start.getTime() + 86_400_000 - 1);
    return { start, end };
  }

  private groupChannels(candidates: Array<{ channel: string | null }>) {
    const groups = new Map<string, number>();
    for (const candidate of candidates) {
      const key = candidate.channel?.trim() || '未填写';
      groups.set(key, (groups.get(key) ?? 0) + 1);
    }
    return [...groups.entries()]
      .map(([channel, count]) => ({ channel, count }))
      .sort((left, right) => right.count - left.count);
  }
}

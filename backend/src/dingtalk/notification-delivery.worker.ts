import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { IdentityProvider } from '@prisma/client';
import { AuthorizationService } from '../auth/authorization.service.js';
import { OnboardingRemindersService, reminderDueAt } from '../candidates/onboarding-reminders.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationPreferenceService } from '../settings/notification-preference.service.js';
import { DingTalkApiClient, DingTalkApiError } from './dingtalk-api.client.js';
import { DingTalkWorkNoticeClient, WorkNoticeError } from './dingtalk-work-notice.client.js';
import { NotificationOutboxService } from './notification-outbox.service.js';
import { interviewReminderMinutes, RESUME_TIMEOUT_STAGES, resumeTimeoutHours } from './notification-timing.js';

type Delivery = { id: string; eventKey: string; sourceKey: string; recipientId: string };
/** Explicitly opt-in and worker-only. No channel call takes place while the switch is off. */
@Injectable()
export class NotificationDeliveryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationDeliveryWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;
  constructor(private readonly db: PrismaService, private readonly outbox: NotificationOutboxService, private readonly api: DingTalkApiClient, private readonly notice: DingTalkWorkNoticeClient, private readonly auth: AuthorizationService, private readonly reminders: OnboardingRemindersService, private readonly prefs: NotificationPreferenceService) {}

  onModuleInit() {
    if (process.env.APP_PROCESS_ROLE !== 'worker' || process.env.DINGTALK_NOTIFICATION_DELIVERY_ENABLED !== 'true') return;
    const tick = () => {
      if (this.inFlight) return;
      this.inFlight = this.run().catch(() => this.logger.warn('通知投递任务失败，稍后重试')).finally(() => { this.inFlight = null; });
    };
    tick(); this.timer = setInterval(tick, 60_000); this.timer.unref();
  }
  async onModuleDestroy() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.inFlight) await this.inFlight;
  }

  async run(now = new Date()) {
    if (process.env.DINGTALK_NOTIFICATION_DELIVERY_ENABLED !== 'true') return;
    if (!/^[1-9]\d*$/.test(process.env.DINGTALK_AGENT_ID ?? '') || !Number.isSafeInteger(Number(process.env.DINGTALK_AGENT_ID))) {
      this.logger.warn('钉钉工作通知 agentId 未配置，待投递记录保持待处理');
      return;
    }
    await this.outbox.markAbandonedUnknown(new Date(now.getTime() - 5 * 60_000), now);
    for (const row of await this.outbox.pending(now)) await this.process(row, now);
    for (const row of await this.outbox.submittedPending()) await this.readResult(row, now);
  }

  async process(row: Delivery, now = new Date()) {
    if (process.env.DINGTALK_NOTIFICATION_DELIVERY_ENABLED !== 'true' || !await this.outbox.claim(row.id, now)) return;
    let submitting = false;
    try {
      let content: string;
      if (row.eventKey === 'interview.FEEDBACK_REMINDER') {
        const separator = row.sourceKey.indexOf(':');
        const id = row.sourceKey.slice(0, separator);
        const expectedEnd = row.sourceKey.slice(separator + 1);
        if (separator < 1) { await this.outbox.cancel(row.id, now); return; }
        const [interview, feedback] = await Promise.all([
          this.db.interview.findUnique({ where: { id }, select: { status: true, endTime: true, interviewerIds: true } }),
          this.db.interviewFeedback.findFirst({ where: { interviewId: id, interviewerId: row.recipientId }, select: { id: true } }),
        ]);
        if (!interview || interview.status === 'CANCELLED' || !interview.endTime || interview.endTime.toISOString() !== expectedEnd || interview.endTime.getTime() + 1_800_000 > now.getTime() || !(interview.interviewerIds ?? '').split('|').includes(row.recipientId) || feedback) { await this.outbox.cancel(row.id, now); return; }
        content = `您有待填写的面试评价，请登录招聘系统处理。面试编号：${id}`;
      } else if (row.eventKey === 'interview.FEEDBACK_NUDGE') {
        const [id, changeId, extra] = row.sourceKey.split('|');
        if (!id || !changeId || extra !== undefined) { await this.outbox.cancel(row.id, now); return; }
        const [interview, feedback, change] = await Promise.all([
          this.db.interview.findUnique({ where: { id }, select: { status: true, endTime: true, interviewerIds: true } }),
          this.db.interviewFeedback.findFirst({ where: { interviewId: id, interviewerId: row.recipientId }, select: { id: true } }),
          this.db.interviewChange.findUnique({ where: { id: changeId }, select: { interviewId: true, action: true } }),
        ]);
        if (!interview || interview.status === 'CANCELLED' || !interview.endTime || interview.endTime > now || !(interview.interviewerIds ?? '').split('|').includes(row.recipientId) || feedback || change?.interviewId !== id || change.action !== 'FEEDBACK_NUDGE') { await this.outbox.cancel(row.id, now); return; }
        content = `人事提醒您填写面试评价，请登录招聘系统处理。面试编号：${id}，提醒编号：${changeId}`;
      } else if (row.eventKey === 'interview.START') {
        const [id, expectedStart, expectedLead, extra] = row.sourceKey.split('|');
        const lead = interviewReminderMinutes();
        if (!id || !expectedStart || expectedLead !== String(lead) || extra !== undefined) { await this.outbox.cancel(row.id, now); return; }
        const interview = await this.db.interview.findUnique({ where: { id }, select: { status: true, time: true, interviewerIds: true, responses: true } });
        const responses = interview?.responses && typeof interview.responses === 'object' && !Array.isArray(interview.responses) ? interview.responses : {};
        if (!interview || interview.status === 'CANCELLED' || interview.time.toISOString() !== expectedStart || interview.time.getTime() <= now.getTime() || interview.time.getTime() - lead * 60_000 > now.getTime() || !(interview.interviewerIds ?? '').split('|').includes(row.recipientId) || responses[row.recipientId] === 'DECLINED') { await this.outbox.cancel(row.id, now); return; }
        content = `您有即将开始的面试，请登录招聘系统查看。面试编号：${id}`;
      } else if (row.eventKey === 'candidate.TIMEOUT') {
        const [id, expectedUpdate, expectedHours, extra] = row.sourceKey.split('|');
        const hours = resumeTimeoutHours();
        const updatedAt = new Date(expectedUpdate ?? '');
        if (!id || !Number.isFinite(updatedAt.getTime()) || updatedAt.toISOString() !== expectedUpdate || expectedHours !== String(hours) || extra !== undefined || updatedAt.getTime() + hours * 3_600_000 > now.getTime()) { await this.outbox.cancel(row.id, now); return; }
        const actor = await this.auth.loadUserContext(row.recipientId);
        const [candidate, preferences] = await Promise.all([
          this.db.candidate.findFirst({ where: { AND: [{ id, updatedAt, stage: { in: [...RESUME_TIMEOUT_STAGES] }, lockedState: { not: 'INOPERABLE' }, job: { is: { recruiterId: row.recipientId } } }, this.auth.candidateWhere(actor, 'candidate:read')] }, select: { id: true } }),
          this.prefs.get(row.recipientId),
        ]);
        if (!candidate || preferences.muted.includes(row.eventKey)) { await this.outbox.cancel(row.id, now); return; }
        content = `您有长时间未处理的简历，请登录招聘系统查看。记录编号：${id}`;
      } else if (row.eventKey === 'onboarding.REMINDER') {
        const actor = await this.auth.loadUserContext(row.recipientId);
        const [reminder, preferences] = await Promise.all([this.reminders.current(row.sourceKey, actor), this.prefs.get(row.recipientId)]);
        if (!reminder || preferences.muted.includes(row.eventKey) || reminderDueAt(reminder.onboardDate, now)?.getTime() !== reminder.dueAt.getTime()) { await this.outbox.cancel(row.id, now); return; }
        content = `您有待处理的待入职保温事项，请登录招聘系统查看。提醒编号：${row.sourceKey}`;
      } else if (row.eventKey === 'interview.DECLINED') {
        const separator = row.sourceKey.indexOf(':');
        const id = row.sourceKey.slice(0, separator);
        const declinedUserId = row.sourceKey.slice(separator + 1);
        if (separator < 1 || !declinedUserId) { await this.outbox.cancel(row.id, now); return; }
        const interview = await this.db.interview.findUnique({ where: { id }, select: { status: true, interviewerIds: true, responses: true } });
        const responses = interview?.responses && typeof interview.responses === 'object' && !Array.isArray(interview.responses) ? (interview.responses as Record<string, unknown>) : {};
        if (!interview || interview.status === 'CANCELLED' || !(interview.interviewerIds ?? '').split('|').includes(declinedUserId) || responses[declinedUserId] !== 'DECLINED') { await this.outbox.cancel(row.id, now); return; }
        content = `面试官已拒绝面试日程，请登录招聘系统改期或重新协调。面试编号：${id}`;
      } else { await this.outbox.cancel(row.id, now); return; }
      const identity = await this.db.identityLink.findUnique({ where: { provider_userId: { provider: IdentityProvider.DINGTALK, userId: row.recipientId } }, select: { subject: true, user: { select: { status: true } } } });
      if (!identity || identity.user.status !== 'ACTIVE') { await this.outbox.cancel(row.id, now); return; }
      const agentId = process.env.DINGTALK_AGENT_ID ?? '';
      let token: string;
      try { token = await this.api.getAppAccessToken(); }
      catch (error) { throw new WorkNoticeError('token_unavailable', error instanceof DingTalkApiError && error.retryable ? 'RETRYABLE' : 'REJECTED'); }
      submitting = true;
      const taskId = await this.notice.send(token, agentId, identity.subject, content);
      await this.outbox.submitted(row.id, taskId, identity.subject, now);
    } catch (error) {
      await this.outbox.failure(row.id, !submitting && !(error instanceof WorkNoticeError) ? new WorkNoticeError('preflight_unavailable', 'RETRYABLE') : error, now);
    }
  }

  async readResult(row: { id: string; taskId: string; platformRecipient: string }, now = new Date()) {
    try {
      const data = await this.notice.result(await this.api.getAppAccessToken(), process.env.DINGTALK_AGENT_ID ?? '', row.taskId);
      const result = data.send_result;
      if (!result || typeof result !== 'object' || Array.isArray(result)) return;
      const record = result as Record<string, unknown>;
      const contains = (key: string) => Array.isArray(record[key]) && (record[key] as unknown[]).includes(row.platformRecipient);
      if (contains('invalid_user_id_list')) await this.outbox.resolved(row.id, 'FAILED', 'invalid_user', now);
      else if (contains('forbidden_user_id_list')) await this.outbox.resolved(row.id, 'FAILED', 'rate_limited', now);
      else if (contains('failed_user_id_list')) await this.outbox.resolved(row.id, 'FAILED', 'delivery_failed', now);
      else if (contains('read_user_id_list') || contains('unread_user_id_list')) await this.outbox.resolved(row.id, 'SENT', null, now);
    } catch { /* Read failures can be retried without resubmitting the notice. */ }
    finally { await this.outbox.touchSubmitted(row.id, now); }
  }
}

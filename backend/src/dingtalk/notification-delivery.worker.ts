import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { IdentityProvider } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { DingTalkApiClient, DingTalkApiError } from './dingtalk-api.client.js';
import { DingTalkWorkNoticeClient, WorkNoticeError } from './dingtalk-work-notice.client.js';
import { NotificationOutboxService } from './notification-outbox.service.js';

type Delivery = { id: string; eventKey: string; sourceKey: string; recipientId: string };
/** Explicitly opt-in and worker-only. No channel call takes place while the switch is off. */
@Injectable()
export class NotificationDeliveryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationDeliveryWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  constructor(private readonly db: PrismaService, private readonly outbox: NotificationOutboxService, private readonly api: DingTalkApiClient, private readonly notice: DingTalkWorkNoticeClient) {}

  onModuleInit() {
    if (process.env.APP_PROCESS_ROLE !== 'worker' || process.env.DINGTALK_NOTIFICATION_DELIVERY_ENABLED !== 'true') return;
    const tick = () => {
      if (this.running) return;
      this.running = true;
      void this.run().catch(() => this.logger.warn('通知投递任务失败，稍后重试')).finally(() => { this.running = false; });
    };
    tick(); this.timer = setInterval(tick, 60_000); this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

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
    try {
      // Only this fixed rule is currently implemented; other event types fail closed.
      if (row.eventKey !== 'interview.FEEDBACK_REMINDER') { await this.outbox.cancel(row.id, now); return; }
      const separator = row.sourceKey.indexOf(':');
      const id = row.sourceKey.slice(0, separator);
      const expectedEnd = row.sourceKey.slice(separator + 1);
      if (separator < 1) { await this.outbox.cancel(row.id, now); return; }
      const [interview, feedback, identity] = await Promise.all([
        this.db.interview.findUnique({ where: { id }, select: { status: true, endTime: true, interviewerIds: true } }),
        this.db.interviewFeedback.findFirst({ where: { interviewId: id, interviewerId: row.recipientId }, select: { id: true } }),
        this.db.identityLink.findUnique({ where: { provider_userId: { provider: IdentityProvider.DINGTALK, userId: row.recipientId } }, select: { subject: true, user: { select: { status: true } } } }),
      ]);
      if (!interview || interview.status === 'CANCELLED' || !interview.endTime || interview.endTime.toISOString() !== expectedEnd || interview.endTime.getTime() + 1_800_000 > now.getTime() || !(interview.interviewerIds ?? '').split('|').includes(row.recipientId) || feedback || !identity || identity.user.status !== 'ACTIVE') {
        await this.outbox.cancel(row.id, now); return;
      }
      const agentId = process.env.DINGTALK_AGENT_ID ?? '';
      let token: string;
      try { token = await this.api.getAppAccessToken(); }
      catch (error) { throw new WorkNoticeError('token_unavailable', error instanceof DingTalkApiError && error.retryable ? 'RETRYABLE' : 'REJECTED'); }
      const taskId = await this.notice.send(token, agentId, identity.subject, `您有待填写的面试评价，请登录招聘系统处理。面试编号：${id}`);
      await this.outbox.submitted(row.id, taskId, identity.subject, now);
    } catch (error) {
      await this.outbox.failure(row.id, error, now);
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

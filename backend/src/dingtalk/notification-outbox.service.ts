import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { WorkNoticeError } from './dingtalk-work-notice.client.js';

/** Durable submission state. This class never chooses recipients or sends on its own. */
@Injectable()
export class NotificationOutboxService {
  constructor(private readonly db: PrismaService) {}

  async enqueue(eventKey: string, sourceKey: string, recipientId: string, dueAt: Date) {
    if (!eventKey || !sourceKey || !recipientId || [eventKey, sourceKey, recipientId].some(v => v.length > 191) || !Number.isFinite(dueAt.getTime())) throw new Error('invalid_notification_event');
    const id = randomUUID();
    await this.db.$executeRaw`INSERT INTO notification_deliveries (id, eventKey, sourceKey, recipientId, status, attempts, dueAt, createdAt, updatedAt)
      VALUES (${id}, ${eventKey}, ${sourceKey}, ${recipientId}, 'PENDING', 0, ${dueAt}, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
      ON DUPLICATE KEY UPDATE id = id`;
  }

  async claim(id: string, now = new Date()): Promise<boolean> {
    const changed = await this.db.$executeRaw`UPDATE notification_deliveries SET status = 'SENDING', attempts = attempts + 1, startedAt = ${now}, updatedAt = ${now}
      WHERE id = ${id} AND status = 'PENDING' AND dueAt <= ${now} AND (nextRetryAt IS NULL OR nextRetryAt <= ${now})`;
    return changed === 1;
  }

  async pending(now = new Date()) {
    return this.db.$queryRaw<{ id: string; eventKey: string; sourceKey: string; recipientId: string }[]>`SELECT id, eventKey, sourceKey, recipientId FROM notification_deliveries
      WHERE status = 'PENDING' AND dueAt <= ${now} AND (nextRetryAt IS NULL OR nextRetryAt <= ${now}) ORDER BY dueAt, id LIMIT 50`;
  }

  async cancel(id: string, now = new Date()) {
    return this.db.$executeRaw`UPDATE notification_deliveries SET status = 'CANCELLED', updatedAt = ${now} WHERE id = ${id} AND status = 'SENDING'`;
  }

  async submitted(id: string, taskId: string, platformRecipient: string, now = new Date()) {
    if (!/^[1-9]\d{0,18}$/.test(taskId) || !platformRecipient || platformRecipient.length > 191) throw new Error('invalid_submission');
    return this.db.$executeRaw`UPDATE notification_deliveries SET status = 'SUBMITTED', taskId = ${taskId}, platformRecipient = ${platformRecipient}, lastError = NULL, updatedAt = ${now} WHERE id = ${id} AND (status = 'SENDING' OR (status = 'UNKNOWN' AND lastError = 'worker_interrupted'))`;
  }

  async submittedPending() {
    return this.db.$queryRaw<{ id: string; taskId: string; platformRecipient: string }[]>`SELECT id, taskId, platformRecipient FROM notification_deliveries WHERE status = 'SUBMITTED' AND taskId IS NOT NULL AND platformRecipient IS NOT NULL ORDER BY updatedAt, id LIMIT 50`;
  }

  async resolved(id: string, status: 'SENT' | 'FAILED', code: string | null, now = new Date()) {
    if (code !== null && !/^[a-z_]{1,80}$/.test(code)) throw new Error('invalid_result_code');
    return this.db.$executeRaw`UPDATE notification_deliveries SET status = ${status}, lastError = ${code}, sentAt = ${status === 'SENT' ? now : null}, updatedAt = ${now} WHERE id = ${id} AND status = 'SUBMITTED'`;
  }

  async touchSubmitted(id: string, now = new Date()) {
    return this.db.$executeRaw`UPDATE notification_deliveries SET updatedAt = ${now} WHERE id = ${id} AND status = 'SUBMITTED'`;
  }

  async recent() {
    // Source keys may reveal business data; administration needs delivery state only.
    return this.db.$queryRaw<{ id: string; eventKey: string; recipientId: string; status: string; attempts: number; dueAt: Date; lastError: string | null; createdAt: Date; updatedAt: Date }[]>`SELECT id, eventKey, recipientId, status, attempts, dueAt, lastError, createdAt, updatedAt FROM notification_deliveries ORDER BY createdAt DESC, id DESC LIMIT 100`;
  }

  async retryFailed(id: string, now = new Date()) {
    const changed = await this.db.$executeRaw`UPDATE notification_deliveries SET status = 'PENDING', attempts = 0, nextRetryAt = NULL, lastError = NULL, taskId = NULL, platformRecipient = NULL, updatedAt = ${now} WHERE id = ${id} AND status = 'FAILED'`;
    if (changed !== 1) throw new ConflictException('仅明确失败的通知可以重试；结果未知的通知不能自动重发');
    return { ok: true };
  }

  async failure(id: string, error: unknown, now = new Date()) {
    const classified = error instanceof WorkNoticeError ? error : null;
    const code = classified?.code && /^[a-zA-Z0-9_-]{1,80}$/.test(classified.code) ? classified.code : 'unknown_error';
    if (classified?.outcome === 'RETRYABLE') {
      const next = new Date(now.getTime() + 60_000);
      return this.db.$executeRaw`UPDATE notification_deliveries SET status = IF(attempts >= 5, 'FAILED', 'PENDING'), nextRetryAt = ${next}, lastError = ${code}, updatedAt = ${now} WHERE id = ${id} AND status = 'SENDING'`;
    }
    const status = classified?.outcome === 'REJECTED' ? 'FAILED' : 'UNKNOWN';
    return this.db.$executeRaw`UPDATE notification_deliveries SET status = ${status}, lastError = ${code}, updatedAt = ${now} WHERE id = ${id} AND status = 'SENDING'`;
  }

  async markAbandonedUnknown(before: Date, now = new Date()) {
    // A crashed process may have sent the request; never convert it back to PENDING.
    return this.db.$executeRaw`UPDATE notification_deliveries SET status = 'UNKNOWN', lastError = 'worker_interrupted', updatedAt = ${now} WHERE status = 'SENDING' AND startedAt < ${before}`;
  }
}

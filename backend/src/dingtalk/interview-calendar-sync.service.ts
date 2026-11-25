import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export type CalendarSyncRow = { interviewId: string; organizerId: string; organizerUnionId: string | null; createToken: string; eventId: string | null; desiredVersion: number; claimedVersion: number | null; appliedVersion: number; status: string; attempts: number };

@Injectable()
export class InterviewCalendarSyncService {
  constructor(private readonly db: PrismaService) {}
  async enqueue(tx: Prisma.TransactionClient, interviewId: string, organizerId: string) {
    const token = randomUUID();
    await tx.$executeRaw`INSERT INTO interview_calendar_sync (interviewId, organizerId, createToken, desiredVersion, appliedVersion, status, attempts, createdAt, updatedAt)
      VALUES (${interviewId}, ${organizerId}, ${token}, 1, 0, 'PENDING', 0, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
      ON DUPLICATE KEY UPDATE desiredVersion = desiredVersion + 1, status = IF(status IN ('SENDING', 'UNKNOWN'), status, 'PENDING'), attempts = IF(status = 'SENDING', attempts, 0), nextRetryAt = NULL, lastError = IF(status = 'UNKNOWN', lastError, NULL), updatedAt = CURRENT_TIMESTAMP(3)`;
  }
  async pending(now = new Date()) {
    return this.db.$queryRaw<{ interviewId: string }[]>`SELECT interviewId FROM interview_calendar_sync WHERE status = 'PENDING' AND (nextRetryAt IS NULL OR nextRetryAt <= ${now}) ORDER BY updatedAt, interviewId LIMIT 30`;
  }
  async claim(id: string, now = new Date()) {
    const changed = await this.db.$executeRaw`UPDATE interview_calendar_sync SET status = 'SENDING', claimedVersion = desiredVersion, attempts = attempts + 1, startedAt = ${now}, updatedAt = ${now} WHERE interviewId = ${id} AND status = 'PENDING' AND (nextRetryAt IS NULL OR nextRetryAt <= ${now})`;
    if (changed !== 1) return null;
    const rows = await this.db.$queryRaw<CalendarSyncRow[]>`SELECT interviewId, organizerId, organizerUnionId, createToken, eventId, desiredVersion, claimedVersion, appliedVersion, status, attempts FROM interview_calendar_sync WHERE interviewId = ${id} AND status = 'SENDING'`;
    return rows[0] ?? null;
  }
  async finish(row: CalendarSyncRow, eventId: string | null, organizerUnionId: string | null, now = new Date()) {
    return this.db.$transaction(async tx => {
      const updated = await tx.$executeRaw`UPDATE interview_calendar_sync SET eventId = ${eventId}, organizerUnionId = ${organizerUnionId}, appliedVersion = ${row.claimedVersion}, status = IF(desiredVersion > ${row.claimedVersion}, 'PENDING', 'SYNCED'), attempts = 0, lastError = NULL, eventCreatedAt = IF(eventCreatedAt IS NULL AND ${eventId} IS NOT NULL, ${now}, eventCreatedAt), updatedAt = ${now} WHERE interviewId = ${row.interviewId} AND (status = 'SENDING' OR (status = 'UNKNOWN' AND lastError = 'worker_interrupted')) AND claimedVersion = ${row.claimedVersion}`;
      if (updated && eventId) await tx.interview.updateMany({ where: { id: row.interviewId }, data: { calendarEventId: eventId } });
      return updated;
    });
  }
  async fail(row: CalendarSyncRow, code: string, retryable: boolean, unknown: boolean, now = new Date()) {
    const safeCode = /^[a-zA-Z0-9_-]{1,80}$/.test(code) ? code : 'calendar_error';
    const status = unknown ? 'UNKNOWN' : retryable && row.attempts < 5 ? 'PENDING' : 'FAILED';
    const retry = status === 'PENDING' ? new Date(now.getTime() + Math.min(3_600_000, 60_000 * 2 ** Math.max(0, row.attempts - 1))) : null;
    return this.db.$executeRaw`UPDATE interview_calendar_sync SET status = ${status}, nextRetryAt = ${retry}, lastError = ${safeCode}, updatedAt = ${now} WHERE interviewId = ${row.interviewId} AND status = 'SENDING' AND claimedVersion = ${row.claimedVersion}`;
  }
  async recoverUnknown(before: Date, now = new Date()) {
    return this.db.$executeRaw`UPDATE interview_calendar_sync SET status = 'UNKNOWN', lastError = 'worker_interrupted', updatedAt = ${now} WHERE status = 'SENDING' AND startedAt < ${before}`;
  }

  /** 已同步且未取消的日程，按上次回读时间轮转，用于回读参会人应答。 */
  async dueForReadback(now = new Date(), olderThanMs = 5 * 60_000, limit = 20) {
    const before = new Date(now.getTime() - olderThanMs);
    return this.db.$queryRaw<{ interviewId: string; organizerId: string; organizerUnionId: string; eventId: string }[]>`
      SELECT s.interviewId, s.organizerId, s.organizerUnionId, s.eventId
      FROM interview_calendar_sync s JOIN interviews i ON i.id = s.interviewId
      WHERE s.status = 'SYNCED' AND s.eventId IS NOT NULL AND s.organizerUnionId IS NOT NULL
        AND i.status <> 'CANCELLED' AND (s.checkedAt IS NULL OR s.checkedAt <= ${before})
      ORDER BY s.checkedAt, s.interviewId LIMIT ${limit}`;
  }

  async markChecked(interviewId: string, now = new Date()) {
    return this.db.$executeRaw`UPDATE interview_calendar_sync SET checkedAt = ${now} WHERE interviewId = ${interviewId}`;
  }

  /** 该组织者当日已成功新建的远端日程数；改期与取消不计入。 */
  async createdBetween(organizerId: string, from: Date, to: Date) {
    const rows = await this.db.$queryRaw<{ total: bigint | number }[]>`
      SELECT COUNT(*) AS total FROM interview_calendar_sync
      WHERE organizerId = ${organizerId} AND eventCreatedAt >= ${from} AND eventCreatedAt < ${to}`;
    return Number(rows[0]?.total ?? 0);
  }

  /** 管理端可见的日历同步失败项；只输出标识、错误码与时间，不含远端 payload。 */
  async failures(limit = 20) {
    return this.db.$queryRaw<{ interviewId: string; status: string; lastError: string | null; attempts: number; updatedAt: Date }[]>`
      SELECT interviewId, status, lastError, attempts, updatedAt FROM interview_calendar_sync
      WHERE status IN ('FAILED', 'UNKNOWN') ORDER BY updatedAt DESC LIMIT ${limit}`;
  }

  /** 只有明确失败的同步可以人工重试；结果未知的不得自动重发，避免重复建日程。 */
  async retryFailed(interviewId: string, now = new Date()) {
    const changed = await this.db.$executeRaw`
      UPDATE interview_calendar_sync SET status = 'PENDING', attempts = 0, nextRetryAt = NULL, lastError = NULL, updatedAt = ${now}
      WHERE interviewId = ${interviewId} AND status = 'FAILED'`;
    return changed === 1;
  }
}

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
      const updated = await tx.$executeRaw`UPDATE interview_calendar_sync SET eventId = ${eventId}, organizerUnionId = ${organizerUnionId}, appliedVersion = ${row.claimedVersion}, status = IF(desiredVersion > ${row.claimedVersion}, 'PENDING', 'SYNCED'), attempts = 0, lastError = NULL, updatedAt = ${now} WHERE interviewId = ${row.interviewId} AND (status = 'SENDING' OR (status = 'UNKNOWN' AND lastError = 'worker_interrupted')) AND claimedVersion = ${row.claimedVersion}`;
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
}

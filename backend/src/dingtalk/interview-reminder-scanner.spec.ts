import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { NotificationOutboxService } from './notification-outbox.service.js';
import { InterviewReminderScanner } from './interview-reminder-scanner.js';

describe('evaluation reminder scheduling', () => {
  it('uses the interview end plus 30 minutes and selects only active interviewers without feedback', async () => {
    const end = new Date('2026-11-24T04:00:00Z');
    const findMany = vi.fn().mockResolvedValue([{ id: 'i1', endTime: end, interviewerIds: '|u1|u2|inactive|' }]);
    const db = { interview: { findMany }, interviewFeedback: { findMany: vi.fn().mockResolvedValue([{ interviewerId: 'u1' }]) }, user: { findMany: vi.fn().mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]) } };
    const outbox = { enqueue: vi.fn().mockResolvedValue(undefined) };
    const scanner = new InterviewReminderScanner(db as unknown as PrismaService, outbox as unknown as NotificationOutboxService);
    await scanner.scan(new Date('2026-11-24T04:30:00Z'));
    expect(findMany.mock.calls[0][0].where).toMatchObject({ status: { not: 'CANCELLED' }, endTime: { lte: end } });
    expect(outbox.enqueue).toHaveBeenCalledOnce();
    expect(outbox.enqueue).toHaveBeenCalledWith('interview.FEEDBACK_REMINDER', `i1:${end.toISOString()}`, 'u2', new Date('2026-11-24T04:30:00Z'));
  });
});

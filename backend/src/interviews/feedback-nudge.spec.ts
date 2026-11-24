import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import type { AuthorizationService } from '../auth/authorization.service.js';
import type { NotificationOutboxService } from '../dingtalk/notification-outbox.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { InterviewsService } from './interviews.service.js';

describe('manual feedback nudge', () => {
  it('records the authorized action and queues only active interviewers without feedback in the same transaction', async () => {
    const transaction = { interviewChange: { create: vi.fn().mockResolvedValue({ id: 'change-1' }) } };
    const db = {
      interview: { findUnique: vi.fn().mockResolvedValue({ id: 'i1', candidateId: 'c', jobId: 'j', status: 'TO_SCHEDULE', endTime: new Date(0), interviewerIds: '|u1|u2|' }) },
      candidate: { findFirst: vi.fn().mockResolvedValue({ id: 'c' }) },
      interviewFeedback: { findMany: vi.fn().mockResolvedValue([{ interviewerId: 'u1' }]) },
      user: { findMany: vi.fn().mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]) },
      $transaction: vi.fn(async (callback: (value: unknown) => unknown) => callback(transaction)),
    };
    const auth = { scopesFor: vi.fn().mockReturnValue(['ALL']), candidateWhere: vi.fn().mockReturnValue({}) };
    const outbox = { enqueue: vi.fn() };
    const service = new InterviewsService(db as unknown as PrismaService, auth as unknown as AuthorizationService, { notify: vi.fn() }, { conflicts: vi.fn() }, outbox as unknown as NotificationOutboxService);
    expect(await service.nudgeFeedback('i1', { id: 'hr' } as AuthenticatedUser)).toEqual({ queued: 1 });
    expect(transaction.interviewChange.create).toHaveBeenCalledOnce();
    expect(outbox.enqueue).toHaveBeenCalledWith('interview.FEEDBACK_NUDGE', 'i1|change-1', 'u2', expect.any(Date), transaction);
  });
});

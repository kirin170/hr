import { describe, expect, it, vi } from 'vitest';
import { InterviewsService } from './interviews.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuthorizationService } from '../auth/authorization.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';

describe('interview calendar failure isolation', () => {
  it('saves an interview and reports unknown availability when the calendar fails', async () => {
    const create = vi.fn(async ({ data }) => ({ id: 'interview', ...data }));
    const db = { candidate: { findFirst: vi.fn().mockResolvedValue({ id: 'candidate' }) }, user: { count: vi.fn().mockResolvedValue(1) }, interview: { create } };
    const auth = { candidateWhere: vi.fn().mockReturnValue({}) };
    const notify = vi.fn().mockRejectedValue(new Error('notification offline'));
    const calendar = { conflicts: vi.fn().mockRejectedValue(new Error('calendar offline')) };
    const service = new InterviewsService(db as unknown as PrismaService, auth as unknown as AuthorizationService, { notify }, calendar);
    const result = await service.create({ candidateId: 'candidate', jobId: 'job', round: 1, mode: 'VIDEO', interviewerIds: ['interviewer'], startAt: '2026-12-01T09:00:00Z', endAt: '2026-12-01T10:00:00Z' }, {} as AuthenticatedUser);
    expect(create).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ availabilityStatus: 'UNAVAILABLE', conflicts: [], interview: { id: 'interview' } });
    expect(notify).toHaveBeenCalledOnce();
  });
});

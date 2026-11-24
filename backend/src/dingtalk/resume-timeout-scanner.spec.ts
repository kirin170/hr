import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthorizationService } from '../auth/authorization.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { NotificationPreferenceService } from '../settings/notification-preference.service.js';
import type { NotificationOutboxService } from './notification-outbox.service.js';
import { ResumeTimeoutScanner } from './resume-timeout-scanner.js';

describe('resume timeout notifications', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('queues only for the authorized current recruiter and honors their preference', async () => {
    vi.stubEnv('DINGTALK_RESUME_TIMEOUT_HOURS', '72');
    const updatedAt = new Date('2026-11-21T04:00:00Z'); const now = new Date('2026-11-24T04:00:00Z');
    const db = { candidate: { findMany: vi.fn().mockResolvedValue([{ id: 'c', updatedAt, job: { recruiterId: 'hr' } }]), findFirst: vi.fn().mockResolvedValue({ id: 'c' }) } };
    const auth = { loadUserContext: vi.fn().mockResolvedValue({ id: 'hr' }), candidateWhere: vi.fn().mockReturnValue({ scope: 'allowed' }) };
    const prefs = { get: vi.fn().mockResolvedValueOnce({ muted: ['candidate.TIMEOUT'] }).mockResolvedValueOnce({ muted: [] }) };
    const outbox = { enqueue: vi.fn() };
    const scanner = new ResumeTimeoutScanner(db as unknown as PrismaService, auth as unknown as AuthorizationService, prefs as unknown as NotificationPreferenceService, outbox as unknown as NotificationOutboxService);
    await scanner.scan(now); expect(outbox.enqueue).not.toHaveBeenCalled();
    await scanner.scan(now); expect(outbox.enqueue).toHaveBeenCalledWith('candidate.TIMEOUT', `c|${updatedAt.toISOString()}|72`, 'hr', now);
    expect(db.candidate.findFirst.mock.calls[0][0].where.AND[1]).toEqual({ scope: 'allowed' });
  });
});

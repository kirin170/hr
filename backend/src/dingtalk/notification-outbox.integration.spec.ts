import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationOutboxService } from './notification-outbox.service.js';
import { WorkNoticeError } from './dingtalk-work-notice.client.js';
import { InterviewReminderScanner } from './interview-reminder-scanner.js';
import { NotificationDeliveryWorker } from './notification-delivery.worker.js';
import type { DingTalkApiClient } from './dingtalk-api.client.js';
import type { DingTalkWorkNoticeClient } from './dingtalk-work-notice.client.js';
import type { AuthorizationService } from '../auth/authorization.service.js';
import type { OnboardingRemindersService } from '../candidates/onboarding-reminders.service.js';
import type { NotificationPreferenceService } from '../settings/notification-preference.service.js';
import { AuthorizationService as RealAuthorizationService } from '../auth/authorization.service.js';
import { InterviewsService } from '../interviews/interviews.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { DataScope } from '@prisma/client';

const database = new URL(process.env.DATABASE_URL || 'mysql://invalid/invalid').pathname.slice(1);
const isolated = process.env.ATS018_ISOLATED_TEST === '1' && /^ats018_tmp_[a-f0-9]+$/.test(database);
describe.skipIf(!isolated)('ATS-018 notification outbox isolated MySQL', () => {
  const db = new PrismaService();
  const outbox = new NotificationOutboxService(db);
  beforeAll(async () => { await db.$connect(); });
  afterAll(async () => { await db.$disconnect(); });
  it('deduplicates concurrent enqueue, claims once, and quarantines an uncertain outcome', async () => {
    const now = new Date();
    await Promise.all(Array.from({ length: 4 }, () => outbox.enqueue('interview.FEEDBACK_REMINDER', 'interview-1', 'user-1', now)));
    const rows = await db.$queryRaw<{ id: string; status: string; attempts: number }[]>`SELECT id, status, attempts FROM notification_deliveries`;
    expect(rows).toHaveLength(1);
    const claims = await Promise.all(Array.from({ length: 4 }, () => outbox.claim(rows[0].id, now)));
    expect(claims.filter(Boolean)).toHaveLength(1);
    await outbox.failure(rows[0].id, new WorkNoticeError('network_error', 'UNKNOWN'), now);
    expect(await outbox.claim(rows[0].id, now)).toBe(false);
    await expect(outbox.retryFailed(rows[0].id, now)).rejects.toThrow();
    const updated = await db.$queryRaw<{ status: string; attempts: number }[]>`SELECT status, attempts FROM notification_deliveries WHERE id = ${rows[0].id}`;
    expect(updated[0]).toMatchObject({ status: 'UNKNOWN', attempts: 1 });
  });
  it('enqueues one reminder after 30 minutes for the active interviewer without feedback', async () => {
    await db.user.createMany({ data: [{ id: 'scan-u1', displayName: 'U1' }, { id: 'scan-u2', displayName: 'U2' }] });
    await db.job.create({ data: { id: 'scan-job', code: 'scan-job', title: 'Job', departmentId: 'scan-dept' } });
    await db.candidate.create({ data: { id: 'scan-candidate', name: 'Candidate', jobId: 'scan-job', stage: 'INTERVIEWING' } });
    const end = new Date('2026-11-24T04:00:00.000Z');
    await db.interview.create({ data: { id: 'scan-interview', candidateId: 'scan-candidate', jobId: 'scan-job', mode: 'VIDEO', time: new Date('2026-11-24T03:00:00.000Z'), endTime: end, interviewerIds: '|scan-u1|scan-u2|' } });
    await db.interviewFeedback.create({ data: { interviewId: 'scan-interview', interviewerId: 'scan-u1', filledById: 'scan-u1', content: '已评价' } });
    const scanner = new InterviewReminderScanner(db, outbox);
    await scanner.scan(new Date('2026-11-24T04:29:59.000Z'));
    const before = await db.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*) AS count FROM notification_deliveries WHERE sourceKey LIKE 'scan-interview:%'`;
    expect(Number(before[0].count)).toBe(0);
    await Promise.all([scanner.scan(new Date('2026-11-24T04:30:00.000Z')), scanner.scan(new Date('2026-11-24T04:30:00.000Z'))]);
    const after = await db.$queryRaw<{ recipientId: string }[]>`SELECT recipientId FROM notification_deliveries WHERE sourceKey LIKE 'scan-interview:%'`;
    expect(after).toEqual([{ recipientId: 'scan-u2' }]);
  });
  it('revalidates the real database record before submitting through a fake sender', async () => {
    await db.identityLink.create({ data: { provider: 'DINGTALK', userId: 'scan-u2', subject: 'local-fake-id' } });
    const rows = await db.$queryRaw<{ id: string; eventKey: string; sourceKey: string; recipientId: string }[]>`SELECT id, eventKey, sourceKey, recipientId FROM notification_deliveries WHERE sourceKey LIKE 'scan-interview:%'`;
    const sender = { send: vi.fn().mockResolvedValue('987') };
    const api = { getAppAccessToken: vi.fn().mockResolvedValue('fake-token') };
    const worker = new NotificationDeliveryWorker(db, outbox, api as unknown as DingTalkApiClient, sender as unknown as DingTalkWorkNoticeClient, {} as AuthorizationService, {} as OnboardingRemindersService, {} as NotificationPreferenceService);
    vi.stubEnv('DINGTALK_NOTIFICATION_DELIVERY_ENABLED', 'true');
    vi.stubEnv('DINGTALK_AGENT_ID', '42');
    try {
      await worker.process(rows[0], new Date('2026-11-24T04:30:00.000Z'));
      expect(sender.send).toHaveBeenCalledOnce();
      const result = await db.$queryRaw<{ status: string; taskId: string }[]>`SELECT status, taskId FROM notification_deliveries WHERE id = ${rows[0].id}`;
      expect(result[0]).toMatchObject({ status: 'SUBMITTED', taskId: '987' });
      await outbox.resolved(rows[0].id, 'FAILED', 'delivery_failed', new Date());
      await outbox.retryFailed(rows[0].id, new Date());
      const retried = await db.$queryRaw<{ status: string; taskId: string | null }[]>`SELECT status, taskId FROM notification_deliveries WHERE id = ${rows[0].id}`;
      expect(retried[0]).toMatchObject({ status: 'PENDING', taskId: null });
    } finally { vi.unstubAllEnvs(); }
  });
  it('records the manual action and nudge atomically for only the remaining interviewer', async () => {
    await db.interview.update({ where: { id: 'scan-interview' }, data: { endTime: new Date('2000-01-01T02:00:00Z') } });
    const actor: AuthenticatedUser = { id: 'hr', displayName: 'HR', departmentId: null, departmentIds: [], groupIds: [], roles: [{ code: 'HR', name: 'HR', dataScope: DataScope.ALL, permissions: ['candidate:read', 'candidate:stage:update'] }] };
    const service = new InterviewsService(db, new RealAuthorizationService(db), { notify: vi.fn() }, { conflicts: vi.fn() }, outbox);
    expect(await service.nudgeFeedback('scan-interview', actor)).toEqual({ queued: 1 });
    const changes = await db.interviewChange.findMany({ where: { interviewId: 'scan-interview', action: 'FEEDBACK_NUDGE' } });
    expect(changes).toHaveLength(1);
    const source = `scan-interview|${changes[0].id}`;
    const deliveries = await db.$queryRaw<{ recipientId: string }[]>`SELECT recipientId FROM notification_deliveries WHERE eventKey = 'interview.FEEDBACK_NUDGE' AND sourceKey = ${source}`;
    expect(deliveries).toEqual([{ recipientId: 'scan-u2' }]);
  });
});

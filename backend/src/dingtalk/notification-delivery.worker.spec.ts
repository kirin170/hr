import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { DingTalkApiClient } from './dingtalk-api.client.js';
import type { DingTalkWorkNoticeClient } from './dingtalk-work-notice.client.js';
import type { NotificationOutboxService } from './notification-outbox.service.js';
import type { AuthorizationService } from '../auth/authorization.service.js';
import type { OnboardingRemindersService } from '../candidates/onboarding-reminders.service.js';
import type { NotificationPreferenceService } from '../settings/notification-preference.service.js';
import { NotificationDeliveryWorker } from './notification-delivery.worker.js';

const now = new Date('2026-11-24T04:30:00.000Z');
const row = { id: 'delivery', eventKey: 'interview.FEEDBACK_REMINDER', sourceKey: 'interview:2026-11-24T04:00:00.000Z', recipientId: 'interviewer' };
function setup(feedback: unknown = null) {
  const db = {
    interview: { findUnique: vi.fn().mockResolvedValue({ status: 'TO_SCHEDULE', endTime: new Date('2026-11-24T04:00:00Z'), interviewerIds: '|interviewer|' }) },
    interviewFeedback: { findFirst: vi.fn().mockResolvedValue(feedback) },
    identityLink: { findUnique: vi.fn().mockResolvedValue({ subject: 'ding-user', user: { status: 'ACTIVE' } }) },
  };
  const outbox = { claim: vi.fn().mockResolvedValue(true), cancel: vi.fn(), submitted: vi.fn(), failure: vi.fn(), resolved: vi.fn(), touchSubmitted: vi.fn() };
  const api = { getAppAccessToken: vi.fn().mockResolvedValue('token') };
  const notice = { send: vi.fn().mockResolvedValue('123'), result: vi.fn() };
  const auth = { loadUserContext: vi.fn().mockResolvedValue({ id: 'interviewer' }) };
  const reminders = { current: vi.fn() };
  const prefs = { get: vi.fn().mockResolvedValue({ muted: [] }) };
  return { db, outbox, api, notice, auth, reminders, prefs, worker: new NotificationDeliveryWorker(db as unknown as PrismaService, outbox as unknown as NotificationOutboxService, api as unknown as DingTalkApiClient, notice as unknown as DingTalkWorkNoticeClient, auth as unknown as AuthorizationService, reminders as unknown as OnboardingRemindersService, prefs as unknown as NotificationPreferenceService) };
}
describe('notification delivery safety', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('does nothing when delivery is disabled', async () => {
    vi.stubEnv('DINGTALK_NOTIFICATION_DELIVERY_ENABLED', 'false');
    const { worker, outbox, notice } = setup();
    await worker.process(row, now);
    expect(outbox.claim).not.toHaveBeenCalled();
    expect(notice.send).not.toHaveBeenCalled();
  });
  it('cancels an already completed evaluation instead of notifying', async () => {
    vi.stubEnv('DINGTALK_NOTIFICATION_DELIVERY_ENABLED', 'true');
    const { worker, outbox, notice } = setup({ id: 'feedback' });
    await worker.process(row, now);
    expect(outbox.cancel).toHaveBeenCalledWith('delivery', now);
    expect(notice.send).not.toHaveBeenCalled();
  });
  it('submits only to the active mapped interviewer when the fact remains current', async () => {
    vi.stubEnv('DINGTALK_NOTIFICATION_DELIVERY_ENABLED', 'true'); vi.stubEnv('DINGTALK_AGENT_ID', '42');
    const { worker, outbox, notice } = setup();
    await worker.process(row, now);
    expect(notice.send).toHaveBeenCalledWith('token', '42', 'ding-user', expect.any(String));
    expect(outbox.submitted).toHaveBeenCalledWith('delivery', '123', 'ding-user', now);
  });
  it('reads platform results without resubmitting the message', async () => {
    const { worker, outbox, notice } = setup();
    vi.stubEnv('DINGTALK_AGENT_ID', '42');
    notice.result.mockResolvedValue({ send_result: { unread_user_id_list: ['ding-user'] } });
    await worker.readResult({ id: 'delivery', taskId: '123', platformRecipient: 'ding-user' }, now);
    expect(outbox.resolved).toHaveBeenCalledWith('delivery', 'SENT', null, now);
    expect(outbox.touchSubmitted).toHaveBeenCalledOnce();
    expect(notice.send).not.toHaveBeenCalled();
  });
  it('cancels a muted onboarding reminder before sending', async () => {
    vi.stubEnv('DINGTALK_NOTIFICATION_DELIVERY_ENABLED', 'true');
    const { worker, outbox, notice, prefs } = setup();
    prefs.get.mockResolvedValue({ muted: ['onboarding.REMINDER'] });
    await worker.process({ ...row, eventKey: 'onboarding.REMINDER', sourceKey: 'r1' }, now);
    expect(outbox.cancel).toHaveBeenCalledWith('delivery', now);
    expect(notice.send).not.toHaveBeenCalled();
  });
  it('does not send a start reminder after an interviewer declines', async () => {
    vi.stubEnv('DINGTALK_NOTIFICATION_DELIVERY_ENABLED', 'true');
    vi.stubEnv('DINGTALK_INTERVIEW_REMINDER_MINUTES', '60');
    const { worker, outbox, notice, db } = setup();
    db.interview.findUnique.mockResolvedValue({ status: 'TO_SCHEDULE', time: new Date('2026-11-24T05:00:00Z'), interviewerIds: '|interviewer|', responses: { interviewer: 'DECLINED' } } as never);
    await worker.process({ ...row, eventKey: 'interview.START', sourceKey: 'interview|2026-11-24T05:00:00.000Z|60' }, now);
    expect(outbox.cancel).toHaveBeenCalledWith('delivery', now);
    expect(notice.send).not.toHaveBeenCalled();
  });
  it('delivers interview.DECLINED reschedule notification to organizer while decline stands', async () => {
    vi.stubEnv('DINGTALK_NOTIFICATION_DELIVERY_ENABLED', 'true');
    vi.stubEnv('DINGTALK_AGENT_ID', '42');
    const { worker, outbox, notice, db } = setup();
    db.interview.findUnique.mockResolvedValue({
      status: 'TO_SCHEDULE',
      interviewerIds: '|interviewer|',
      responses: { interviewer: 'DECLINED' },
    } as never);
    await worker.process(
      { id: 'delivery', eventKey: 'interview.DECLINED', sourceKey: 'interview:interviewer', recipientId: 'organizer' },
      now,
    );
    expect(notice.send).toHaveBeenCalledWith('token', '42', 'ding-user', expect.stringContaining('拒绝面试日程'));
    expect(outbox.submitted).toHaveBeenCalledWith('delivery', '123', 'ding-user', now);
    expect(outbox.cancel).not.toHaveBeenCalled();
  });
});

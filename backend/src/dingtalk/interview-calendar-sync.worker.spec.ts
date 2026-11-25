import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { DingTalkApiClient } from './dingtalk-api.client.js';
import type { DingTalkCalendarClient } from './dingtalk-calendar.client.js';
import type { DingTalkCalendarIdentities } from './dingtalk-calendar-identities.js';
import type { InterviewCalendarSyncService } from './interview-calendar-sync.service.js';
import type { NotificationOutboxService } from './notification-outbox.service.js';
import { InterviewCalendarSyncWorker } from './interview-calendar-sync.worker.js';

const now = new Date('2026-11-25T06:00:00.000Z');
const due = { interviewId: 'iv1', organizerId: 'hr1', organizerUnionId: 'union-hr', eventId: 'ev1' };

function setup(opts: {
  responses?: Record<string, string>;
  attendees?: { id?: string; responseStatus?: string }[];
  status?: string;
  attendeesError?: boolean;
} = {}) {
  const db = {
    interview: {
      findUnique: vi.fn().mockResolvedValue({
        status: opts.status ?? 'TO_SCHEDULE',
        interviewerIds: '|u1|u2|',
        responses: opts.responses ?? { u1: 'PENDING', u2: 'PENDING' },
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const queue = {
    dueForReadback: vi.fn().mockResolvedValue([due]),
    markChecked: vi.fn().mockResolvedValue(1),
    recoverUnknown: vi.fn().mockResolvedValue(0),
    pending: vi.fn().mockResolvedValue([]),
    claim: vi.fn().mockResolvedValue(null),
  };
  const api = { getAppAccessToken: vi.fn().mockResolvedValue('token') };
  const client = {
    attendees: opts.attendeesError
      ? vi.fn().mockRejectedValue(new Error('transport'))
      : vi.fn().mockResolvedValue(opts.attendees ?? []),
  };
  const identities = { resolve: vi.fn().mockResolvedValue(new Map([['u1', 'union-1'], ['u2', 'union-2']])) };
  const outbox = { enqueue: vi.fn().mockResolvedValue(undefined) };
  const worker = new InterviewCalendarSyncWorker(
    db as unknown as PrismaService,
    queue as unknown as InterviewCalendarSyncService,
    api as unknown as DingTalkApiClient,
    client as unknown as DingTalkCalendarClient,
    identities as unknown as DingTalkCalendarIdentities,
    outbox as unknown as NotificationOutboxService,
  );
  return { db, queue, api, client, identities, outbox, worker };
}

describe('calendar response readback', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('does nothing when readback is disabled', async () => {
    vi.stubEnv('DINGTALK_CALENDAR_READBACK_ENABLED', 'false');
    const { worker, queue, client } = setup();
    await worker.readback(now);
    expect(queue.dueForReadback).not.toHaveBeenCalled();
    expect(client.attendees).not.toHaveBeenCalled();
  });

  it('records an accepted attendee as occupying the slot', async () => {
    vi.stubEnv('DINGTALK_CALENDAR_READBACK_ENABLED', 'true');
    const { worker, db, outbox, queue } = setup({ attendees: [{ id: 'union-1', responseStatus: 'accepted' }] });
    await worker.readback(now);
    expect(db.interview.updateMany).toHaveBeenCalledWith({
      where: { id: 'iv1', status: { not: 'CANCELLED' } },
      data: { responses: { u1: 'ACCEPTED', u2: 'PENDING' } },
    });
    expect(outbox.enqueue).not.toHaveBeenCalled();
    expect(queue.markChecked).toHaveBeenCalledWith('iv1', now);
  });

  it('treats tentative and needsAction as not occupying and never downgrades a local answer', async () => {
    vi.stubEnv('DINGTALK_CALENDAR_READBACK_ENABLED', 'true');
    const { worker, db } = setup({
      responses: { u1: 'ACCEPTED', u2: 'PENDING' },
      attendees: [{ id: 'union-1', responseStatus: 'needsAction' }, { id: 'union-2', responseStatus: 'tentative' }],
    });
    await worker.readback(now);
    expect(db.interview.updateMany).not.toHaveBeenCalled();
  });

  it('notifies the organizer once when an attendee declines', async () => {
    vi.stubEnv('DINGTALK_CALENDAR_READBACK_ENABLED', 'true');
    const { worker, db, outbox } = setup({ attendees: [{ id: 'union-2', responseStatus: 'declined' }] });
    await worker.readback(now);
    expect(db.interview.updateMany).toHaveBeenCalledWith({
      where: { id: 'iv1', status: { not: 'CANCELLED' } },
      data: { responses: { u1: 'PENDING', u2: 'DECLINED' } },
    });
    expect(outbox.enqueue).toHaveBeenCalledTimes(1);
    expect(outbox.enqueue).toHaveBeenCalledWith('interview.DECLINED', 'iv1:u2', 'hr1', now);
  });

  it('does not notify again for a decline already recorded', async () => {
    vi.stubEnv('DINGTALK_CALENDAR_READBACK_ENABLED', 'true');
    const { worker, outbox, db } = setup({
      responses: { u1: 'PENDING', u2: 'DECLINED' },
      attendees: [{ id: 'union-2', responseStatus: 'declined' }],
    });
    await worker.readback(now);
    expect(outbox.enqueue).not.toHaveBeenCalled();
    expect(db.interview.updateMany).not.toHaveBeenCalled();
  });

  it('ignores attendees that do not map to a local interviewer', async () => {
    vi.stubEnv('DINGTALK_CALENDAR_READBACK_ENABLED', 'true');
    const { worker, db, outbox } = setup({ attendees: [{ id: 'union-stranger', responseStatus: 'declined' }] });
    await worker.readback(now);
    expect(db.interview.updateMany).not.toHaveBeenCalled();
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  it('skips a cancelled interview without calling the calendar', async () => {
    vi.stubEnv('DINGTALK_CALENDAR_READBACK_ENABLED', 'true');
    const { worker, client, queue } = setup({ status: 'CANCELLED' });
    await worker.readback(now);
    expect(client.attendees).not.toHaveBeenCalled();
    expect(queue.markChecked).toHaveBeenCalledWith('iv1', now);
  });

  it('keeps the sync state and retries later when readback fails', async () => {
    vi.stubEnv('DINGTALK_CALENDAR_READBACK_ENABLED', 'true');
    const { worker, queue, db } = setup({ attendeesError: true });
    await expect(worker.readback(now)).resolves.toBeUndefined();
    expect(queue.markChecked).not.toHaveBeenCalled();
    expect(db.interview.updateMany).not.toHaveBeenCalled();
  });

  it('reads back even when calendar writes stay disabled', async () => {
    vi.stubEnv('DINGTALK_CALENDAR_WRITE_ENABLED', 'false');
    vi.stubEnv('DINGTALK_CALENDAR_READBACK_ENABLED', 'true');
    const { worker, queue, client } = setup({ attendees: [{ id: 'union-1', responseStatus: 'accepted' }] });
    await worker.run(now);
    expect(queue.pending).not.toHaveBeenCalled();
    expect(queue.recoverUnknown).not.toHaveBeenCalled();
    expect(client.attendees).toHaveBeenCalled();
  });
});
describe('daily create quota', () => {
  afterEach(() => vi.unstubAllEnvs());

  function writeSetup(used: number, existingEventId: string | null = null) {
    const db = {
      interview: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'iv1', round: 1, status: 'TO_SCHEDULE',
          time: new Date('2026-11-26T02:00:00Z'), endTime: new Date('2026-11-26T03:00:00Z'),
          location: null, interviewerIds: '|u1|',
        }),
        updateMany: vi.fn(),
      },
    };
    const queue = {
      createdBetween: vi.fn().mockResolvedValue(used),
      finish: vi.fn().mockResolvedValue(1),
      fail: vi.fn().mockResolvedValue(1),
      dueForReadback: vi.fn().mockResolvedValue([]),
    };
    const api = { getAppAccessToken: vi.fn().mockResolvedValue('token') };
    const client = { create: vi.fn().mockResolvedValue('ev-new'), update: vi.fn(), cancel: vi.fn(), attendees: vi.fn() };
    const identities = { resolve: vi.fn().mockResolvedValue(new Map([['hr1', 'union-hr'], ['u1', 'union-1']])) };
    const worker = new InterviewCalendarSyncWorker(
      db as unknown as PrismaService, queue as unknown as InterviewCalendarSyncService,
      api as unknown as DingTalkApiClient, client as unknown as DingTalkCalendarClient,
      identities as unknown as DingTalkCalendarIdentities, undefined,
    );
    const row = { interviewId: 'iv1', organizerId: 'hr1', organizerUnionId: 'union-hr', createToken: 'tok', eventId: existingEventId, desiredVersion: 1, claimedVersion: 1, appliedVersion: 0, status: 'SENDING', attempts: 1 };
    return { worker, queue, client, row };
  }

  it('keeps the local interview and fails the sync when the daily create limit is reached', async () => {
    vi.stubEnv('DINGTALK_CALENDAR_WRITE_ENABLED', 'true');
    const { worker, client, queue, row } = writeSetup(100);
    await worker.process(row, now);
    expect(client.create).not.toHaveBeenCalled();
    expect(queue.fail).toHaveBeenCalledWith(row, 'daily_create_limit', false, false, now);
    expect(queue.finish).not.toHaveBeenCalled();
  });

  it('creates when below the limit', async () => {
    vi.stubEnv('DINGTALK_CALENDAR_WRITE_ENABLED', 'true');
    const { worker, client, queue, row } = writeSetup(99);
    await worker.process(row, now);
    expect(client.create).toHaveBeenCalled();
    expect(queue.finish).toHaveBeenCalled();
  });

  it('does not consume create quota when rescheduling an existing event', async () => {
    vi.stubEnv('DINGTALK_CALENDAR_WRITE_ENABLED', 'true');
    const { worker, client, queue, row } = writeSetup(100, 'ev-existing');
    await worker.process(row, now);
    expect(queue.createdBetween).not.toHaveBeenCalled();
    expect(client.update).toHaveBeenCalled();
  });

  it('honours a configured limit', async () => {
    vi.stubEnv('DINGTALK_CALENDAR_WRITE_ENABLED', 'true');
    vi.stubEnv('DINGTALK_CALENDAR_DAILY_CREATE_LIMIT', '5');
    const { worker, client, queue, row } = writeSetup(5);
    await worker.process(row, now);
    expect(client.create).not.toHaveBeenCalled();
    expect(queue.fail).toHaveBeenCalledWith(row, 'daily_create_limit', false, false, now);
  });
});

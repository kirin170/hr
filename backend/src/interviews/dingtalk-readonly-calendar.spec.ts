import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DingTalkApiClient } from '../dingtalk/dingtalk-api.client.js';
import type { DingTalkCalendarClient } from '../dingtalk/dingtalk-calendar.client.js';
import type { DingTalkCalendarIdentities } from '../dingtalk/dingtalk-calendar-identities.js';
import { DingTalkReadonlyInterviewCalendar } from './dingtalk-readonly-calendar.js';

describe('read-only DingTalk availability', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('maps internal users to unionIds and returns internal conflict IDs', async () => {
    vi.stubEnv('DINGTALK_CALENDAR_OPERATOR_UNION_ID', 'operator');
    const api = { getAppAccessToken: vi.fn().mockResolvedValue('token') };
    const client = { busy: vi.fn().mockResolvedValue(['union-2']) };
    const identities = { resolve: vi.fn().mockResolvedValue(new Map([['user-1', 'union-1'], ['user-2', 'union-2']])) };
    const calendar = new DingTalkReadonlyInterviewCalendar(api as unknown as DingTalkApiClient, client as unknown as DingTalkCalendarClient, identities as unknown as DingTalkCalendarIdentities);
    const start = new Date('2026-12-01T08:00:00Z'); const end = new Date('2026-12-01T09:00:00Z');
    expect(await calendar.conflicts(['user-1', 'user-2'], start, end)).toEqual(['user-2']);
    expect(client.busy).toHaveBeenCalledWith('token', 'operator', ['union-1', 'union-2'], start, end);
    expect(Object.keys(client)).toEqual(['busy']);
  });
  it('refuses to query without an operator or a complete identity mapping', async () => {
    vi.stubEnv('DINGTALK_CALENDAR_OPERATOR_UNION_ID', '');
    const calendar = new DingTalkReadonlyInterviewCalendar({} as DingTalkApiClient, {} as DingTalkCalendarClient, {} as DingTalkCalendarIdentities);
    await expect(calendar.conflicts(['user'], new Date(), new Date())).rejects.toMatchObject({ code: 'missing_calendar_operator' });
  });
});

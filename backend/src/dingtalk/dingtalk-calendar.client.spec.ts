import { afterEach, describe, expect, it, vi } from 'vitest';
import { DingTalkCalendarClient } from './dingtalk-calendar.client.js';

const start = new Date('2026-12-01T01:00:00Z');
const end = new Date('2026-12-01T02:00:00Z');
const event = { summary: '面试', start, end, attendees: ['union-1', 'union-1'] };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

describe('DingTalk calendar REST client', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('sends an idempotency key, participant unionIds and times on create', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ id: 'event-1' })); vi.stubGlobal('fetch', fetch);
    expect(await new DingTalkCalendarClient().create('secret', 'organizer', 'request-1', event)).toBe('event-1');
    const [url, options] = fetch.mock.calls[0];
    expect(url).toContain('/users/organizer/calendars/primary/events');
    expect(options.headers['x-client-token']).toBe('request-1');
    expect(JSON.parse(options.body)).toMatchObject({ attendees: [{ id: 'union-1' }], start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() } });
  });
  it('updates by event id and notifies participants on cancellation', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ id: 'event' })).mockResolvedValueOnce(new Response(null, { status: 200 })); vi.stubGlobal('fetch', fetch);
    const client = new DingTalkCalendarClient();
    await client.update('secret', 'organizer', 'event', event);
    await client.cancel('secret', 'organizer', 'event');
    expect(JSON.parse(fetch.mock.calls[0][1].body).id).toBe('event');
    expect(fetch.mock.calls[1][0]).toContain('/events/event?pushNotification=true');
    expect(fetch.mock.calls[1][1].method).toBe('DELETE');
  });
  it('reads all response pages and rejects pagination loops', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ attendees: [{ id: 'a', responseStatus: 'accepted' }], nextToken: 'next' })).mockResolvedValueOnce(json({ attendees: [{ id: 'b', responseStatus: 'declined' }] })); vi.stubGlobal('fetch', fetch);
    expect(await new DingTalkCalendarClient().attendees('secret', 'organizer', 'event')).toHaveLength(2);
    fetch.mockReset().mockImplementation(async () => json({ attendees: [], nextToken: 'loop' }));
    await expect(new DingTalkCalendarClient().attendees('secret', 'organizer', 'event')).rejects.toMatchObject({ code: 'invalid_cursor' });
  });
  it('never treats a failed or missing busy result as free', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ scheduleInformation: [{ userId: 'a', scheduleItems: [{ status: 'BUSY' }] }, { userId: 'b', scheduleItems: [] }] })).mockResolvedValueOnce(json({ scheduleInformation: [{ userId: 'a', error: '无权限' }] })).mockResolvedValueOnce(json({ scheduleInformation: [{ userId: 'a', scheduleItems: [{ status: 'UNKNOWN' }] }] })); vi.stubGlobal('fetch', fetch);
    const client = new DingTalkCalendarClient();
    expect(await client.busy('secret', 'organizer', ['a', 'b'], start, end)).toEqual(['a']);
    await expect(client.busy('secret', 'organizer', ['a'], start, end)).rejects.toMatchObject({ code: 'availability_unavailable' });
    await expect(client.busy('secret', 'organizer', ['a'], start, end)).rejects.toMatchObject({ code: 'availability_unavailable' });
  });
  it('classifies rate limits without retaining sensitive response content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ code: 'flowLimit', message: 'private content' }, 400)));
    await expect(new DingTalkCalendarClient().create('secret', 'organizer', 'request', event)).rejects.toMatchObject({ code: 'flowLimit', retryable: true, message: '钉钉日历接口调用失败' });
  });
});

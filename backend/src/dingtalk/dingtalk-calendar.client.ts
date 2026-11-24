/** 钉钉日历 OpenAPI 的薄客户端。调用方负责身份映射、持久化和重试。 */
export class DingTalkCalendarError extends Error {
  constructor(readonly code: string, readonly retryable: boolean) {
    super('钉钉日历接口调用失败');
  }
}

type EventInput = { summary: string; start: Date; end: Date; attendees: string[]; location?: string };
type Schedule = { userId?: string; error?: string; scheduleItems?: { status?: string }[] };
type Attendee = { id?: string; responseStatus?: string };

export class DingTalkCalendarClient {
  private eventPath(organizer: string, eventId?: string) {
    if (!organizer || (eventId !== undefined && !eventId)) throw new DingTalkCalendarError('invalid_identity', false);
    const base = `/v1.0/calendar/users/${encodeURIComponent(organizer)}/calendars/primary/events`;
    return eventId === undefined ? base : `${base}/${encodeURIComponent(eventId)}`;
  }

  private eventBody(input: EventInput) {
    if (!input.summary || !Number.isFinite(input.start.getTime()) || !Number.isFinite(input.end.getTime()) || input.end <= input.start || input.attendees.some(id => !id)) {
      throw new DingTalkCalendarError('invalid_event', false);
    }
    return {
      summary: input.summary,
      start: { dateTime: input.start.toISOString(), timeZone: 'Asia/Shanghai' },
      end: { dateTime: input.end.toISOString(), timeZone: 'Asia/Shanghai' },
      attendees: [...new Set(input.attendees)].map(id => ({ id })),
      ...(input.location ? { location: { displayName: input.location } } : {}),
    };
  }

  async create(token: string, organizer: string, clientToken: string, input: EventInput): Promise<string> {
    if (!clientToken) throw new DingTalkCalendarError('missing_idempotency_key', false);
    const result = await this.request('POST', this.eventPath(organizer), token, this.eventBody(input), clientToken);
    if (typeof result?.id !== 'string' || !result.id) throw new DingTalkCalendarError('invalid_response', false);
    return result.id;
  }

  async update(token: string, organizer: string, eventId: string, input: EventInput): Promise<void> {
    await this.request('PUT', this.eventPath(organizer, eventId), token, { id: eventId, ...this.eventBody(input) });
  }

  async cancel(token: string, organizer: string, eventId: string, clientToken: string): Promise<void> {
    if (!clientToken) throw new DingTalkCalendarError('missing_idempotency_key', false);
    await this.request('POST', `${this.eventPath(organizer, eventId)}/cancel`, token, undefined, clientToken);
  }

  async attendees(token: string, organizer: string, eventId: string): Promise<Attendee[]> {
    const result: Attendee[] = [];
    const seen = new Set<string>();
    let cursor = '';
    do {
      if (seen.has(cursor) || seen.size >= 100) throw new DingTalkCalendarError('invalid_cursor', false);
      seen.add(cursor);
      const query = new URLSearchParams({ maxResults: '500' });
      if (cursor) query.set('nextToken', cursor);
      const page = await this.request('GET', `${this.eventPath(organizer, eventId)}/attendees?${query}`, token);
      if (!Array.isArray(page?.attendees)) throw new DingTalkCalendarError('invalid_response', false);
      result.push(...page.attendees as Attendee[]);
      if (page.nextToken != null && typeof page.nextToken !== 'string') throw new DingTalkCalendarError('invalid_response', false);
      cursor = (page.nextToken as string | undefined) ?? '';
    } while (cursor);
    return result;
  }

  async busy(token: string, operator: string, users: string[], start: Date, end: Date): Promise<string[]> {
    if (!operator || !users.length || users.some(id => !id) || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) throw new DingTalkCalendarError('invalid_query', false);
    const userIds = [...new Set(users)];
    // The API requires UTC at minute precision; expand the interval to avoid missing overlaps.
    const utcMinute = (millis: number) => new Date(millis).toISOString().slice(0, 16) + 'Z';
    const startTime = utcMinute(Math.floor(start.getTime() / 60_000) * 60_000);
    const endTime = utcMinute(Math.ceil(end.getTime() / 60_000) * 60_000);
    const data = await this.request('POST', `/v1.0/calendar/users/${encodeURIComponent(operator)}/querySchedule`, token, { userIds, startTime, endTime });
    if (!Array.isArray(data?.scheduleInformation)) throw new DingTalkCalendarError('invalid_response', false);
    const rows = data.scheduleInformation as Schedule[];
    return userIds.filter(id => {
      const row = rows.find(value => value.userId === id);
      if (!row || row.error || !Array.isArray(row.scheduleItems)) throw new DingTalkCalendarError('availability_unavailable', false);
      if (row.scheduleItems.some(item => !item || !['FREE', 'BUSY'].includes(item.status ?? ''))) throw new DingTalkCalendarError('availability_unavailable', false);
      return row.scheduleItems.some(item => item.status === 'BUSY');
    });
  }

  private async request(method: string, path: string, token: string, body?: unknown, clientToken?: string): Promise<Record<string, unknown> | null> {
    if (!token) throw new DingTalkCalendarError('missing_token', false);
    let response: Response;
    try {
      response = await fetch(`https://api.dingtalk.com${path}`, {
        method,
        headers: { 'x-acs-dingtalk-access-token': token, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(clientToken ? { 'x-client-token': clientToken } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(8_000),
      });
    } catch { throw new DingTalkCalendarError('network_error', true); }
    if (!response.ok) {
      let code = `http_${response.status}`;
      try { const json: unknown = await response.json(); if (json && typeof json === 'object' && 'code' in json && typeof json.code === 'string') code = json.code.slice(0, 120); } catch { /* only persist a safe code */ }
      throw new DingTalkCalendarError(code, response.status === 429 || response.status >= 500 || code === 'idempotencyProcessing' || code === 'flowLimit');
    }
    if (response.status === 204 || method === 'DELETE') return null;
    let value: unknown;
    try { value = await response.json(); } catch { throw new DingTalkCalendarError('invalid_response', false); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DingTalkCalendarError('invalid_response', false);
    return value as Record<string, unknown>;
  }
}

import { createHash } from 'node:crypto';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { DingTalkApiClient, DingTalkApiError } from './dingtalk-api.client.js';
import { DingTalkCalendarClient, DingTalkCalendarError } from './dingtalk-calendar.client.js';
import { DingTalkCalendarIdentities } from './dingtalk-calendar-identities.js';
import { InterviewCalendarSyncService, type CalendarSyncRow } from './interview-calendar-sync.service.js';
import { NotificationOutboxService } from './notification-outbox.service.js';

/** 钉钉参会人应答 → 本地应答；tentative/needsAction 不算占用，保持 PENDING。 */
function localResponse(remote?: string): 'ACCEPTED' | 'DECLINED' | null {
  const value = (remote ?? '').toLowerCase();
  if (value === 'accepted') return 'ACCEPTED';
  if (value === 'declined') return 'DECLINED';
  return null;
}

/** 钉钉按自然日限制每用户新建日程数；日程时区为 Asia/Shanghai，配额窗口与之对齐。 */
function shanghaiDayWindow(now: Date) {
  const offset = 8 * 3_600_000;
  const shifted = new Date(now.getTime() + offset);
  const start = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - offset;
  return { from: new Date(start), to: new Date(start + 86_400_000) };
}

function dailyCreateLimit() {
  const raw = Number(process.env.DINGTALK_CALENDAR_DAILY_CREATE_LIMIT);
  return Number.isInteger(raw) && raw > 0 ? raw : 100;
}

function versionToken(id: string, version: number) {
  const hex = createHash('sha256').update(`${id}:${version}`).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}

@Injectable()
export class InterviewCalendarSyncWorker implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly logger = new Logger(InterviewCalendarSyncWorker.name);
  constructor(private readonly db: PrismaService, private readonly queue: InterviewCalendarSyncService, private readonly api: DingTalkApiClient, private readonly client: DingTalkCalendarClient, private readonly identities: DingTalkCalendarIdentities, @Optional() private readonly outbox?: NotificationOutboxService) {}
  onModuleInit() {
    if (process.env.APP_PROCESS_ROLE !== 'worker') return;
    if (process.env.DINGTALK_CALENDAR_WRITE_ENABLED !== 'true' && process.env.DINGTALK_CALENDAR_READBACK_ENABLED !== 'true') return;
    const tick = () => {
      if (this.running) return;
      this.running = true;
      void this.run().catch(() => this.logger.warn('日历同步失败，稍后重试')).finally(() => { this.running = false; });
    };
    tick(); this.timer = setInterval(tick, 30_000); this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  async run(now = new Date()) {
    if (process.env.DINGTALK_CALENDAR_WRITE_ENABLED === 'true') {
      await this.queue.recoverUnknown(new Date(now.getTime() - 5 * 60_000), now);
      for (const { interviewId } of await this.queue.pending(now)) {
        const row = await this.queue.claim(interviewId, now);
        if (row) await this.process(row, now);
      }
    }
    await this.readback(now);
  }

  /**
   * 回读参会人应答：邀请不等于占用，只有 accepted 才算接受。
   * 远端明确的 accepted/declined 覆盖本地；远端未应答不会把本地已有应答降级。
   * 有人拒绝时给组织者（人事）排一条改期提醒，按 面试+拒绝人 去重，不重复打扰。
   */
  async readback(now = new Date()) {
    if (process.env.DINGTALK_CALENDAR_READBACK_ENABLED !== 'true') return;
    for (const row of await this.queue.dueForReadback(now)) {
      try {
        const interview = await this.db.interview.findUnique({ where: { id: row.interviewId }, select: { status: true, interviewerIds: true, responses: true } });
        if (!interview || interview.status === 'CANCELLED') { await this.queue.markChecked(row.interviewId, now); continue; }
        const people = [...new Set((interview.interviewerIds ?? '').split('|').filter(Boolean))];
        if (!people.length) { await this.queue.markChecked(row.interviewId, now); continue; }
        const mapping = await this.identities.resolve(people);
        const byUnion = new Map<string, string>();
        for (const [userId, unionId] of mapping) byUnion.set(unionId, userId);
        const token = await this.api.getAppAccessToken();
        const attendees = await this.client.attendees(token, row.organizerUnionId, row.eventId);
        const current = interview.responses && typeof interview.responses === 'object' && !Array.isArray(interview.responses)
          ? interview.responses as Record<string, unknown> : {};
        const next: Record<string, unknown> = { ...current };
        const declined: string[] = [];
        for (const attendee of attendees) {
          const userId = attendee.id ? byUnion.get(attendee.id) : undefined;
          if (!userId) continue;
          const response = localResponse(attendee.responseStatus);
          if (!response) continue;
          if (current[userId] !== response) next[userId] = response;
          if (response === 'DECLINED' && current[userId] !== 'DECLINED') declined.push(userId);
        }
        if (JSON.stringify(next) !== JSON.stringify(current)) {
          await this.db.interview.updateMany({ where: { id: row.interviewId, status: { not: 'CANCELLED' } }, data: { responses: next as never } });
        }
        if (declined.length && this.outbox) {
          for (const userId of declined) {
            await this.outbox.enqueue('interview.DECLINED', `${row.interviewId}:${userId}`, row.organizerId, now);
          }
        }
        await this.queue.markChecked(row.interviewId, now);
      } catch {
        // 回读失败不影响已同步状态，也不改写入状态；下一轮按 checkedAt 继续重试。
        this.logger.warn('日历应答回读失败，稍后重试');
      }
    }
  }
  async process(row: CalendarSyncRow, now = new Date()) {
    if (process.env.DINGTALK_CALENDAR_WRITE_ENABLED !== 'true') return;
    let writing = false;
    try {
      if (!row.claimedVersion) throw new DingTalkCalendarError('invalid_version', false);
      const interview = await this.db.interview.findUnique({ where: { id: row.interviewId }, select: { id: true, round: true, status: true, time: true, endTime: true, location: true, interviewerIds: true } });
      if (!interview || interview.status === 'CANCELLED') {
        if (row.eventId) {
          if (!row.organizerUnionId) throw new DingTalkCalendarError('missing_organizer', false);
          const token = await this.api.getAppAccessToken();
          writing = true;
          await this.client.cancel(token, row.organizerUnionId, row.eventId, versionToken(row.interviewId, row.claimedVersion));
        }
        await this.queue.finish(row, row.eventId, row.organizerUnionId, now);
        return;
      }
      if (!interview.endTime || interview.endTime <= interview.time) throw new DingTalkCalendarError('invalid_event', false);
      const people = [...new Set((interview.interviewerIds ?? '').split('|').filter(Boolean))];
      if (!people.length) throw new DingTalkCalendarError('missing_attendees', false);
      const mapping = await this.identities.resolve(row.organizerUnionId ? people : [row.organizerId, ...people]);
      const organizer = row.organizerUnionId ?? mapping.get(row.organizerId);
      const attendees = people.map(id => mapping.get(id));
      if (!organizer || attendees.some(id => !id)) throw new DingTalkCalendarError('identity_not_mapped', false);
      const input = { summary: `面试 · 第 ${interview.round} 轮`, start: interview.time, end: interview.endTime, attendees: attendees as string[], ...(interview.location ? { location: interview.location } : {}) };
      const token = await this.api.getAppAccessToken();
      let eventId = row.eventId;
      if (!eventId) {
        // 超出当日新建上限时保留本地面试安排，只把同步标记为明确失败，由人事分批重试。
        const window = shanghaiDayWindow(now);
        const used = await this.queue.createdBetween(row.organizerId, window.from, window.to);
        if (used >= dailyCreateLimit()) throw new DingTalkCalendarError('daily_create_limit', false);
      }
      writing = true;
      if (eventId) await this.client.update(token, organizer, eventId, input);
      else eventId = await this.client.create(token, organizer, row.createToken, input);
      await this.queue.finish(row, eventId, organizer, now);
    } catch (error) {
      const failure = error instanceof DingTalkCalendarError || error instanceof DingTalkApiError ? error : null;
      const code = failure ? String(failure.code) : 'calendar_error';
      // A transport error after a write began can represent a successful remote write.
      const unknown = writing;
      await this.queue.fail(row, code, failure?.retryable ?? !writing, unknown, now);
    }
  }
}

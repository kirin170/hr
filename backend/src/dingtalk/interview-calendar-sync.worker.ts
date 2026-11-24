import { createHash } from 'node:crypto';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { DingTalkApiClient, DingTalkApiError } from './dingtalk-api.client.js';
import { DingTalkCalendarClient, DingTalkCalendarError } from './dingtalk-calendar.client.js';
import { DingTalkCalendarIdentities } from './dingtalk-calendar-identities.js';
import { InterviewCalendarSyncService, type CalendarSyncRow } from './interview-calendar-sync.service.js';

function versionToken(id: string, version: number) {
  const hex = createHash('sha256').update(`${id}:${version}`).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}

@Injectable()
export class InterviewCalendarSyncWorker implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly logger = new Logger(InterviewCalendarSyncWorker.name);
  constructor(private readonly db: PrismaService, private readonly queue: InterviewCalendarSyncService, private readonly api: DingTalkApiClient, private readonly client: DingTalkCalendarClient, private readonly identities: DingTalkCalendarIdentities) {}
  onModuleInit() {
    if (process.env.APP_PROCESS_ROLE !== 'worker' || process.env.DINGTALK_CALENDAR_WRITE_ENABLED !== 'true') return;
    const tick = () => {
      if (this.running) return;
      this.running = true;
      void this.run().catch(() => this.logger.warn('日历同步失败，稍后重试')).finally(() => { this.running = false; });
    };
    tick(); this.timer = setInterval(tick, 30_000); this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  async run(now = new Date()) {
    if (process.env.DINGTALK_CALENDAR_WRITE_ENABLED !== 'true') return;
    await this.queue.recoverUnknown(new Date(now.getTime() - 5 * 60_000), now);
    for (const { interviewId } of await this.queue.pending(now)) {
      const row = await this.queue.claim(interviewId, now);
      if (row) await this.process(row, now);
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

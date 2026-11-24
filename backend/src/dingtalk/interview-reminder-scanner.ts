import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationOutboxService } from './notification-outbox.service.js';
import { interviewReminderMinutes } from './notification-timing.js';

/** Creates durable evaluation reminders only; it never calls a notification channel. */
@Injectable()
export class InterviewReminderScanner implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly logger = new Logger(InterviewReminderScanner.name);
  constructor(private readonly db: PrismaService, private readonly outbox: NotificationOutboxService) {}

  onModuleInit() {
    if (process.env.APP_PROCESS_ROLE !== 'worker' || process.env.DINGTALK_NOTIFICATION_SCAN_ENABLED !== 'true') return;
    const tick = () => {
      if (this.running) return;
      this.running = true;
      void this.scan().catch(() => this.logger.warn('评价提醒扫描失败，稍后重试')).finally(() => { this.running = false; });
    };
    tick(); this.timer = setInterval(tick, 60_000); this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async scan(now = new Date()) {
    const endedBy = new Date(now.getTime() - 30 * 60_000);
    let cursor: string | undefined;
    do {
      const interviews = await this.db.interview.findMany({
        where: { status: { not: 'CANCELLED' }, endTime: { lte: endedBy } },
        select: { id: true, endTime: true, interviewerIds: true },
        orderBy: { id: 'asc' }, take: 100,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      for (const interview of interviews) {
        if (!interview.endTime) continue;
        const ids = [...new Set((interview.interviewerIds ?? '').split('|').filter(Boolean))];
        if (!ids.length) continue;
        const [feedback, active] = await Promise.all([
          this.db.interviewFeedback.findMany({ where: { interviewId: interview.id, interviewerId: { in: ids } }, select: { interviewerId: true } }),
          this.db.user.findMany({ where: { id: { in: ids }, status: 'ACTIVE' }, select: { id: true } }),
        ]);
        const completed = new Set(feedback.map(row => row.interviewerId));
        const source = `${interview.id}:${interview.endTime.toISOString()}`;
        const dueAt = new Date(interview.endTime.getTime() + 30 * 60_000);
        for (const { id } of active) if (!completed.has(id)) await this.outbox.enqueue('interview.FEEDBACK_REMINDER', source, id, dueAt);
      }
      cursor = interviews.length === 100 ? interviews[interviews.length - 1].id : undefined;
    } while (cursor);
    await this.scanStarts(now);
  }

  private async scanStarts(now: Date) {
    const lead = interviewReminderMinutes();
    const max = new Date(now.getTime() + lead * 60_000);
    let cursor: string | undefined;
    do {
      const rows = await this.db.interview.findMany({ where: { status: { not: 'CANCELLED' }, time: { gt: now, lte: max } }, select: { id: true, time: true, interviewerIds: true, responses: true }, orderBy: { id: 'asc' }, take: 100, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
      for (const row of rows) {
        const ids = [...new Set((row.interviewerIds ?? '').split('|').filter(Boolean))];
        if (!ids.length) continue;
        const responses = row.responses && typeof row.responses === 'object' && !Array.isArray(row.responses) ? row.responses : {};
        const active = await this.db.user.findMany({ where: { id: { in: ids }, status: 'ACTIVE' }, select: { id: true } });
        for (const { id } of active) if (responses[id] !== 'DECLINED') await this.outbox.enqueue('interview.START', `${row.id}|${row.time.toISOString()}|${lead}`, id, new Date(row.time.getTime() - lead * 60_000));
      }
      cursor = rows.length === 100 ? rows[rows.length - 1].id : undefined;
    } while (cursor);
  }
}

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AuthorizationService } from '../auth/authorization.service.js';
import { OnboardingRemindersService, reminderDueAt } from '../candidates/onboarding-reminders.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationPreferenceService } from '../settings/notification-preference.service.js';
import { NotificationOutboxService } from './notification-outbox.service.js';

@Injectable()
export class OnboardingNotificationScanner implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;
  private readonly logger = new Logger(OnboardingNotificationScanner.name);
  constructor(private readonly db: PrismaService, private readonly auth: AuthorizationService, private readonly reminders: OnboardingRemindersService, private readonly prefs: NotificationPreferenceService, private readonly outbox: NotificationOutboxService) {}
  onModuleInit() {
    if (process.env.APP_PROCESS_ROLE !== 'worker' || process.env.DINGTALK_NOTIFICATION_SCAN_ENABLED !== 'true') return;
    const tick = () => {
      if (this.inFlight) return;
      this.inFlight = this.scan().catch(() => this.logger.warn('保温通知扫描失败，稍后重试')).finally(() => { this.inFlight = null; });
    };
    tick(); this.timer = setInterval(tick, 60_000); this.timer.unref();
  }
  async onModuleDestroy() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.inFlight) await this.inFlight;
  }
  async scan(now = new Date()) {
    let cursor: string | undefined;
    const earliest = new Date(now.getTime() - 7 * 86_400_000);
    do {
      const rows = await this.db.onboardingReminder.findMany({ where: { dueAt: { gte: earliest, lte: now } }, select: { id: true, recipientId: true }, orderBy: { id: 'asc' }, take: 100, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
      for (const row of rows) {
        try {
          const actor = await this.auth.loadUserContext(row.recipientId);
          const [reminder, preferences] = await Promise.all([this.reminders.current(row.id, actor), this.prefs.get(actor.id)]);
          if (!reminder || preferences.muted.includes('onboarding.REMINDER') || reminderDueAt(reminder.onboardDate, now)?.getTime() !== reminder.dueAt.getTime()) continue;
          await this.outbox.enqueue('onboarding.REMINDER', row.id, actor.id, reminder.dueAt);
        } catch { this.logger.warn('保温通知记录暂不可处理，将在下一轮重试'); }
      }
      cursor = rows.length === 100 ? rows[rows.length - 1].id : undefined;
    } while (cursor);
  }
}

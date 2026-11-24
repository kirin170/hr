import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AuthorizationService } from '../auth/authorization.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationPreferenceService } from '../settings/notification-preference.service.js';
import { NotificationOutboxService } from './notification-outbox.service.js';
import { RESUME_TIMEOUT_STAGES, resumeTimeoutHours } from './notification-timing.js';

@Injectable()
export class ResumeTimeoutScanner implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly logger = new Logger(ResumeTimeoutScanner.name);
  constructor(private readonly db: PrismaService, private readonly auth: AuthorizationService, private readonly prefs: NotificationPreferenceService, private readonly outbox: NotificationOutboxService) {}
  onModuleInit() {
    if (process.env.APP_PROCESS_ROLE !== 'worker' || process.env.DINGTALK_NOTIFICATION_SCAN_ENABLED !== 'true') return;
    const tick = () => {
      if (this.running) return;
      this.running = true;
      void this.scan().catch(() => this.logger.warn('简历超时扫描失败，稍后重试')).finally(() => { this.running = false; });
    };
    tick(); this.timer = setInterval(tick, 60_000); this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  async scan(now = new Date()) {
    const hours = resumeTimeoutHours();
    const cutoff = new Date(now.getTime() - hours * 3_600_000);
    let cursor: string | undefined;
    do {
      const rows = await this.db.candidate.findMany({ where: { stage: { in: [...RESUME_TIMEOUT_STAGES] }, lockedState: { not: 'INOPERABLE' }, updatedAt: { lte: cutoff }, job: { is: { recruiterId: { not: null } } } }, select: { id: true, updatedAt: true, job: { select: { recruiterId: true } } }, orderBy: { id: 'asc' }, take: 100, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
      for (const row of rows) {
        const recipientId = row.job?.recruiterId;
        if (!recipientId) continue;
        try {
          const actor = await this.auth.loadUserContext(recipientId);
          const [candidate, preferences] = await Promise.all([
            this.db.candidate.findFirst({ where: { AND: [{ id: row.id, updatedAt: row.updatedAt, stage: { in: [...RESUME_TIMEOUT_STAGES] }, lockedState: { not: 'INOPERABLE' }, job: { is: { recruiterId: recipientId } } }, this.auth.candidateWhere(actor, 'candidate:read')] }, select: { id: true } }),
            this.prefs.get(recipientId),
          ]);
          if (!candidate || preferences.muted.includes('candidate.TIMEOUT')) continue;
          await this.outbox.enqueue('candidate.TIMEOUT', `${row.id}|${row.updatedAt.toISOString()}|${hours}`, recipientId, new Date(row.updatedAt.getTime() + hours * 3_600_000));
        } catch { this.logger.warn('简历超时通知暂不可处理，将在下一轮重试'); }
      }
      cursor = rows.length === 100 ? rows[rows.length - 1].id : undefined;
    } while (cursor);
  }
}

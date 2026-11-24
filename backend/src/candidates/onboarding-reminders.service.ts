import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { OnboardingReminder } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { AuthorizationService } from '../auth/authorization.service.js';
import { canEnterPendingOnboard, type OfferStage, type OfferStatus } from '../offers/offer-contract.js';
import { PrismaService } from '../prisma/prisma.service.js';

const DAY = 86_400_000;
/** Weekly periods are anchored to the onboarding date in China local calendar days. */
export function reminderDueAt(onboardDate: Date, now: Date): Date | null {
  const chinaDay = (d: Date) => Math.floor((d.getTime() + 8 * 3_600_000) / DAY);
  const remaining = chinaDay(onboardDate) - chinaDay(now);
  if (remaining < 0) return null;
  const dateDay = chinaDay(onboardDate);
  const dueDay = dateDay - Math.ceil(remaining / 7) * 7;
  return new Date(dueDay * DAY - 8 * 3_600_000);
}

@Injectable()
export class OnboardingRemindersService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly logger = new Logger(OnboardingRemindersService.name);
  constructor(private readonly db: PrismaService, private readonly auth: AuthorizationService) {}
  onModuleInit() {
    if (process.env.APP_PROCESS_ROLE !== 'worker') return;
    const tick = () => { if (!this.running) { this.running = true; void this.dispatch().catch(() => this.logger.error('保温提醒处理失败，将在下一次扫描重试')).finally(() => { this.running = false }); } };
    tick(); this.timer = setInterval(tick, 60_000); this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  async dispatch(now = new Date()) {
    let cursor: string | undefined;
    do {
      const rows = await this.db.candidate.findMany({ where: { stage: 'PENDING_ONBOARD', jobId: { not: null } }, orderBy: { id: 'asc' }, take: 100, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: { id: true, jobId: true, job: { select: { recruiterId: true } } } });
      for (const row of rows) {
        const recipientId = row.job?.recruiterId;
        if (!recipientId || !row.jobId) continue;
        try {
          const actor = await this.auth.loadUserContext(recipientId);
          if (!actor.roles.some(r => r.code === 'RECRUITER' && r.permissions.includes('candidate:stage:update'))) continue;
          await this.db.$transaction(async tx => {
            // Same lock order as Offer and onboarding mutations; stale scans cannot enqueue.
            await tx.$queryRaw`SELECT id FROM candidates WHERE id = ${row.id} FOR UPDATE`;
            const guard = await tx.candidate.findFirst({ where: { AND: [{ id: row.id, jobId: row.jobId, stage: 'PENDING_ONBOARD', job: { is: { recruiterId: recipientId } } }, this.auth.candidateWhere(actor, 'candidate:stage:update')] }, select: { id: true } });
            if (!guard) return;
            const offer = await tx.offerRecord.findUnique({ where: { candidateId: row.id } });
            if (!offer || offer.jobId !== row.jobId || !offer.onboardDate || !canEnterPendingOnboard({ stage: offer.workflowStage as OfferStage, status: offer.stageStatus as OfferStatus }, offer.offerSentAt, offer.onboardDate, offer.writtenResult, offer.backgroundCheckStatus)) return;
            const dueAt = reminderDueAt(offer.onboardDate, now);
            if (!dueAt) return;
            await tx.onboardingReminder.createMany({ data: [{ candidateId: row.id, jobId: row.jobId!, recipientId, onboardDate: offer.onboardDate, dueAt }], skipDuplicates: true });
          }, { isolationLevel: 'ReadCommitted' });
        } catch { this.logger.warn('保温提醒候选记录暂不可处理，将在下一次扫描重试'); }
      }
      cursor = rows.length === 100 ? rows[rows.length - 1].id : undefined;
    } while (cursor);
  }
  async list(actor: AuthenticatedUser) {
    if (!actor.roles.some(r => r.code === 'RECRUITER' && r.permissions.includes('candidate:stage:update'))) return [];
    const rows = await this.db.onboardingReminder.findMany({ where: { recipientId: actor.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100 });
    const result: { id: string; candidateId: string; name: string; onboardDate: Date; dueAt: Date; readAt: Date | null }[] = [];
    for (const row of rows) {
      const current = await this.currentRecord(row, actor);
      if (current) result.push(current);
    }
    return result;
  }
  /** The same authorization and persisted facts used by the inbox, for external adapters. */
  async current(id: string, actor: AuthenticatedUser) {
    if (!actor.roles.some(r => r.code === 'RECRUITER' && r.permissions.includes('candidate:stage:update'))) return null;
    const row = await this.db.onboardingReminder.findUnique({ where: { id } });
    return row && row.recipientId === actor.id ? this.currentRecord(row, actor) : null;
  }
  private async currentRecord(row: OnboardingReminder, actor: AuthenticatedUser) {
    const [candidate, offer] = await Promise.all([
      this.db.candidate.findFirst({ where: { AND: [{ id: row.candidateId, jobId: row.jobId, stage: 'PENDING_ONBOARD', job: { is: { recruiterId: actor.id } } }, this.auth.candidateWhere(actor, 'candidate:stage:update')] }, select: { name: true } }),
      this.db.offerRecord.findUnique({ where: { candidateId: row.candidateId } }),
    ]);
    if (!candidate || !offer || offer.jobId !== row.jobId || !offer.onboardDate || offer.onboardDate.getTime() !== row.onboardDate.getTime() || !canEnterPendingOnboard({ stage: offer.workflowStage as OfferStage, status: offer.stageStatus as OfferStatus }, offer.offerSentAt, offer.onboardDate, offer.writtenResult, offer.backgroundCheckStatus)) return null;
    return { id: row.id, candidateId: row.candidateId, name: candidate.name, onboardDate: row.onboardDate, dueAt: row.dueAt, readAt: row.readAt };
  }
  async markRead(id: string, actor: AuthenticatedUser) {
    await this.db.onboardingReminder.updateMany({ where: { id, recipientId: actor.id, readAt: null }, data: { readAt: new Date() } });
    return { ok: true };
  }
}

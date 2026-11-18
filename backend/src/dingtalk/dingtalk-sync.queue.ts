import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service.js';
import { redisConnection } from '../ai/parse.queue.js';

export const DINGTALK_SYNC_QUEUE = 'dingtalk-organization-sync';
export const DINGTALK_SYNC_JOB = 'process-sync-event';

export type DingTalkSyncJob = { eventId: string };

@Injectable()
export class DingTalkSyncQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(DingTalkSyncQueueService.name);
  private readonly queue = new Queue<DingTalkSyncJob>(DINGTALK_SYNC_QUEUE, {
    connection: redisConnection(),
  });

  constructor(private readonly prisma: PrismaService) {}

  async dispatch(eventId: string): Promise<void> {
    const event = await this.prisma.dingTalkSyncEvent.findUnique({
      where: { id: eventId },
    });
    if (!event || !['RECEIVED', 'QUEUED'].includes(event.status)) return;

    try {
      await this.queue.add(
        DINGTALK_SYNC_JOB,
        { eventId },
        {
          jobId: this.jobId(event.id, event.attempts),
          attempts: this.positiveInt(process.env.DINGTALK_SYNC_MAX_ATTEMPTS, 5, 20),
          backoff: {
            type: 'exponential',
            delay: this.positiveInt(process.env.DINGTALK_SYNC_RETRY_DELAY_MS, 1_000, 60_000),
          },
          removeOnComplete: 500,
          removeOnFail: 1_000,
        },
      );
      await this.prisma.dingTalkSyncEvent.updateMany({
        where: { id: eventId, status: { in: ['RECEIVED', 'QUEUED'] } },
        data: { status: 'QUEUED' },
      });
    } catch (error) {
      this.logger.error(`Failed to enqueue DingTalk sync event ${eventId}: ${this.safeError(error)}`);
      throw error;
    }
  }

  async dispatchPending(limit = 50): Promise<number> {
    const pending = await this.prisma.dingTalkSyncEvent.findMany({
      where: { status: 'RECEIVED' },
      orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
      take: limit,
      select: { id: true },
    });
    let dispatched = 0;
    for (const event of pending) {
      try {
        await this.dispatch(event.id);
        dispatched += 1;
      } catch {
        // Leave the event RECEIVED; a later poll retries the outbox dispatch.
      }
    }
    return dispatched;
  }

  async retryFailed(eventId: string) {
    const changed = await this.prisma.dingTalkSyncEvent.updateMany({
      where: { id: eventId, status: 'FAILED' },
      data: { status: 'RECEIVED', lastError: null, processedAt: null },
    });
    if (!changed.count) {
      const exists = await this.prisma.dingTalkSyncEvent.findUnique({
        where: { id: eventId },
        select: { id: true },
      });
      if (!exists) throw new NotFoundException('同步事件不存在');
      throw new ConflictException('只有失败的同步事件可以重试');
    }
    await this.dispatch(eventId);
    return this.prisma.dingTalkSyncEvent.findUnique({ where: { id: eventId } });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }

  private jobId(eventId: string, attempts: number): string {
    return `dingtalk-${eventId}-${attempts}`;
  }

  private positiveInt(value: string | undefined, fallback: number, max: number): number {
    if (value === undefined || value === '') return fallback;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
  }

  private safeError(error: unknown): string {
    if (error && typeof error === 'object' && 'code' in error) {
      return String((error as { code: unknown }).code).slice(0, 80);
    }
    return 'queue_unavailable';
  }
}

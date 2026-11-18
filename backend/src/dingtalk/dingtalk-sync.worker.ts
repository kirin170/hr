import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Worker } from 'bullmq';
import { redisConnection } from '../ai/parse.queue.js';
import {
  DINGTALK_SYNC_QUEUE,
  type DingTalkSyncJob,
  DingTalkSyncQueueService,
} from './dingtalk-sync.queue.js';
import { DingTalkSyncService } from './dingtalk-sync.service.js';

@Injectable()
export class DingTalkSyncWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DingTalkSyncWorker.name);
  private worker: Worker<DingTalkSyncJob> | null = null;
  private outboxTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly sync: DingTalkSyncService,
    private readonly queue: DingTalkSyncQueueService,
  ) {}

  onModuleInit(): void {
    if (process.env.APP_PROCESS_ROLE !== 'worker') {
      this.logger.log('DingTalk organization worker is disabled for this process');
      return;
    }

    this.worker = new Worker<DingTalkSyncJob>(
      DINGTALK_SYNC_QUEUE,
      async (job) => this.sync.processEvent(job.data.eventId),
      {
        connection: redisConnection(),
        concurrency: 1,
      },
    );
    this.worker.on('failed', (job, error) => {
      if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;
      void this.sync.markFailed(job.data.eventId, error).catch((markError: unknown) => {
        this.logger.error(`Failed to mark DingTalk event ${job.data.eventId}: ${this.safeError(markError)}`);
      });
    });
    this.worker.on('error', (error) => {
      this.logger.error(`DingTalk sync worker error: ${this.safeError(error)}`);
    });

    void this.queue.dispatchPending().catch((error: unknown) => {
      this.logger.warn(`DingTalk outbox dispatch failed: ${this.safeError(error)}`);
    });
    this.outboxTimer = setInterval(() => {
      void this.queue.dispatchPending().catch((error: unknown) => {
        this.logger.warn(`DingTalk outbox dispatch failed: ${this.safeError(error)}`);
      });
    }, 5_000);
    this.outboxTimer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.outboxTimer) clearInterval(this.outboxTimer);
    await this.worker?.close();
  }

  private safeError(error: unknown): string {
    if (error && typeof error === 'object' && 'code' in error) {
      return String((error as { code: unknown }).code).slice(0, 80);
    }
    return 'sync_failed';
  }
}

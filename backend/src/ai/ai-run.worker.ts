import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Worker } from 'bullmq';
import { AiRunService } from './ai-run.service.js';
import { redisConnection } from './parse.queue.js';
import { AI_EVAL_QUEUE, type EvalJobData } from './eval.queue.js';

/** 评估 Worker 仅在独立 Worker 进程启动，避免 API 进程重复消费。 */
@Injectable()
export class AiEvalWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiEvalWorkerService.name);
  private worker: Worker<EvalJobData> | null = null;

  constructor(private readonly aiRunService: AiRunService) {}

  onModuleInit(): void {
    if (process.env.APP_PROCESS_ROLE !== 'worker' || process.env.AI_EVAL_WORKER_DISABLED === 'true') {
      this.logger.log('AI eval worker is disabled for this process');
      return;
    }

    this.worker = new Worker<EvalJobData>(
      AI_EVAL_QUEUE,
      async (job) => this.aiRunService.processEvalTask(job.data.runId),
      {
        connection: redisConnection(),
        concurrency: Number(process.env.AI_EVAL_CONCURRENCY ?? process.env.QUEUE_CONCURRENCY ?? 2),
      },
    );

    this.worker.on('failed', (job, error) => {
      if (!job) return;
      const attempts = job.opts.attempts ?? 1;
      if (job.attemptsMade >= attempts) {
        void this.aiRunService.markEvalFailed(job.data.runId, error);
      }
    });

    this.worker.on('error', (error) => {
      this.logger.error(`AI eval worker error: ${error.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}

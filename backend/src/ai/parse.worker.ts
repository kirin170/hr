import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Worker } from 'bullmq';
import { AiRunService } from './ai-run.service.js';
import {
  RESUME_PARSE_QUEUE,
  redisConnection,
  type ParseJobData,
} from './parse.queue.js';

/**
 * 解析 Worker。本期与 API 同进程启动，保持“异步消费 + 重试 + 幂等”的边界；
 * 独立进程部署时复用同一 AiRunService 即可。
 */
@Injectable()
export class ParseWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ParseWorkerService.name);
  private worker: Worker<ParseJobData> | null = null;

  constructor(private readonly aiRunService: AiRunService) {}

  onModuleInit(): void {
    if (process.env.PARSE_WORKER_DISABLED === 'true') {
      this.logger.warn('Parse worker disabled by PARSE_WORKER_DISABLED');
      return;
    }

    this.worker = new Worker<ParseJobData>(
      RESUME_PARSE_QUEUE,
      async (job) => this.aiRunService.processParseTask(job.data.intakeId),
      {
        connection: redisConnection(),
        concurrency: Number(process.env.QUEUE_CONCURRENCY ?? 2),
      },
    );

    this.worker.on('failed', (job, error) => {
      if (!job) {
        return;
      }
      const attempts = job.opts.attempts ?? 1;
      if (job.attemptsMade >= attempts) {
        void this.aiRunService.markParseFailed(job.data.intakeId, error);
      }
    });

    this.worker.on('error', (error) => {
      this.logger.error(`Parse worker error: ${error.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}

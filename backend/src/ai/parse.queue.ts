import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';

export const RESUME_PARSE_QUEUE = 'resume-parse';
export const RESUME_PARSE_JOB = 'parse-resume';

export interface ParseJobData {
  intakeId: string;
  airRunId: string;
}

/** Redis 连接参数（技术设计 §9.4：REDIS_URL） */
export function redisConnection() {
  const url = new URL(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    maxRetriesPerRequest: null,
  };
}

@Injectable()
export class ParseQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(ParseQueueService.name);
  private readonly queue = new Queue<ParseJobData>(RESUME_PARSE_QUEUE, {
    connection: redisConnection(),
  });

  async enqueue(
    intakeId: string,
    airRunId: string,
    options: { retry?: boolean } = {},
  ): Promise<boolean> {
    try {
      await this.queue.add(
        RESUME_PARSE_JOB,
        { intakeId, airRunId },
        {
          // 同一 AIRun 的首次投递保持稳定 jobId，避免重复入队（BullMQ 不允许 ':'）
          jobId: options.retry
            ? `parse-${airRunId}-retry-${Date.now()}`
            : `parse-${airRunId}`,
          attempts: Number(process.env.PARSE_MAX_ATTEMPTS ?? 3),
          backoff: {
            type: 'exponential',
            delay: Number(process.env.PARSE_RETRY_DELAY_MS ?? 1000),
          },
          removeOnComplete: 200,
          removeOnFail: 500,
        },
      );
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to enqueue parse task for intake ${intakeId}: ${(error as Error).message}`,
      );
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}

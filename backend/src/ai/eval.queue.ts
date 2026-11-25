import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { redisConnection } from './parse.queue.js';

export const AI_EVAL_QUEUE = 'ai-eval';
export const AI_EVAL_JOB = 'evaluate';

export interface EvalJobData {
  runId: string;
}

/** 评估任务队列：简历评估与面试评估共用，失败不阻断主流程（AI-4）。 */
@Injectable()
export class AiEvalQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(AiEvalQueueService.name);
  private readonly queue = new Queue<EvalJobData>(AI_EVAL_QUEUE, {
    connection: redisConnection(),
  });

  async enqueue(runId: string, options: { retry?: boolean } = {}): Promise<boolean> {
    try {
      await this.queue.add(
        AI_EVAL_JOB,
        { runId },
        {
          jobId: options.retry ? `eval-${runId}-retry-${Date.now()}` : `eval-${runId}`,
          attempts: Number(process.env.AI_EVAL_MAX_ATTEMPTS ?? 2),
          backoff: {
            type: 'exponential',
            delay: Number(process.env.AI_EVAL_RETRY_DELAY_MS ?? 2000),
          },
          removeOnComplete: 200,
          removeOnFail: 500,
        },
      );
      return true;
    } catch (error) {
      this.logger.error(`Failed to enqueue eval run ${runId}: ${(error as Error).message}`);
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { MailConfigService } from './mail-config.service.js';
import { MailPollService } from './mail-poll.service.js';

/**
 * 邮箱轮询调度（ATS-022 / 技术设计 §6.3）：
 * 仅在 worker 进程运行，按各邮箱的 pollIntervalSeconds 判定到期；
 * 不使用固定 cron 表达式，避免与业务并发上限脱节。
 */
@Injectable()
export class MailPollRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MailPollRunner.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly configs: MailConfigService,
    private readonly poll: MailPollService,
  ) {}

  onModuleInit(): void {
    if (process.env.APP_PROCESS_ROLE !== 'worker') {
      this.logger.log('邮箱轮询调度在当前进程禁用（仅 worker 进程运行）');
      return;
    }

    void this.tick(true);
    this.timer = setInterval(() => {
      void this.tick(false);
    }, 30_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(initial: boolean): Promise<void> {
    try {
      if (initial) await this.configs.bootstrapFromEnv();
      const summary = await this.poll.pollAll();
      if (summary.polled > 0) {
        this.logger.log(
          `邮箱轮询完成：${summary.polled} 个邮箱，失败 ${summary.failed} 个`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'mail_poll_failed';
      this.logger.warn(`邮箱轮询调度异常：${message}`);
    }
  }
}

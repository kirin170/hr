import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { RetentionService } from './retention/retention.service.js';

for (const envFile of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(envFile);
  } catch {
    // 文件不存在时忽略，部署环境由运行时注入变量
  }
}

process.env.APP_PROCESS_ROLE = 'worker';

/**
 * 到期清理独立入口，供 cron / 计划任务调用（技术设计 §13.2）：
 * `node dist/retention.runner.js`，可用 RETENTION_DRY_RUN=true 只统计。
 */
const app = await NestFactory.createApplicationContext(AppModule);
try {
  const result = await app.get(RetentionService).purgeExpired({
    dryRun: process.env.RETENTION_DRY_RUN === 'true',
  });
  console.info(JSON.stringify(result));
} finally {
  await app.close();
}

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { MailConfigService } from './mail-config.service.js';
import { MailPollService } from './mail-poll.service.js';

for (const envFile of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(envFile);
  } catch {
    // 文件不存在时忽略，回退到进程环境变量
  }
}

// 手工触发一次抓取：不启动 worker 调度，避免与定时轮询重复
process.env.APP_PROCESS_ROLE = 'cli';

const app = await NestFactory.createApplicationContext(AppModule, {
  logger: ['error', 'warn'],
});

try {
  const configs = app.get(MailConfigService);
  const poll = app.get(MailPollService);

  await configs.bootstrapFromEnv();
  const mailboxes = (await configs.list()).filter(
    (item) => item.active && item.provider === 'IMAP',
  );
  if (mailboxes.length === 0) {
    console.log('[INFO] 没有可轮询的 IMAP 邮箱配置');
  }

  const testOnly = process.argv.includes('--test');
  for (const mailbox of mailboxes) {
    const result = testOnly
      ? await configs.testConnection(mailbox.id)
      : await poll.pollOne(mailbox.id);
    console.log(JSON.stringify(result, null, 2));
  }
} finally {
  await app.close();
}

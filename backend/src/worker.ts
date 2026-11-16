import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

for (const envFile of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(envFile);
  } catch {
    // 文件不存在时忽略，部署环境由运行时注入变量
  }
}

process.env.APP_PROCESS_ROLE = 'worker';

const app = await NestFactory.createApplicationContext(AppModule);
app.enableShutdownHooks();

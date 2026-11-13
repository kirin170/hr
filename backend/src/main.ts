import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

for (const envFile of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(envFile);
  } catch {
    // 文件不存在时忽略，生产环境由部署系统注入变量
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: process.env.EXTENSION_ALLOWED_ORIGINS?.split(',') ?? true,
  });
  app.enableShutdownHooks();
  await app.listen(process.env.APP_PORT ?? process.env.PORT ?? 3000);
}
await bootstrap();

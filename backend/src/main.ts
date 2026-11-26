import { NestFactory } from '@nestjs/core';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module.js';

for (const envFile of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(envFile);
  } catch {
    // 文件不存在时忽略，生产环境由部署系统注入变量
  }
}

process.env.APP_PROCESS_ROLE = 'api';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const isLocal = process.env.APP_ENV === 'local' || process.env.APP_ENV === 'test';
  const httpServer = app.getHttpAdapter().getInstance() as { disable?: (key: string) => void };
  httpServer.disable?.('x-powered-by');
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (!isLocal) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });
  const allowedOrigins = (process.env.EXTENSION_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  app.enableCors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : isLocal,
    credentials: true,
  });
  app.enableShutdownHooks();
  const host = process.env.APP_ENV === 'local' ? '127.0.0.1' : '0.0.0.0';
  await app.listen(process.env.APP_PORT ?? process.env.PORT ?? 3000, host);
}
await bootstrap();

import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { RATE_LIMIT_RULE, type RateLimitOptions } from './auth.decorators.js';

type CounterBucket = {
  count: number;
  resetAt: number;
};

const MAX_TRACKED_BUCKETS = 10_000;

/**
 * 轻量级路由限流守卫（零外部依赖）：
 * 保护公开写接口与认证入口免受暴力探测、存储放大与 LLM 计费 DoS。
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, CounterBucket>();

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (process.env.RATE_LIMIT_DISABLED === 'true' || process.env.APP_ENV === 'test') {
      return true;
    }

    const rule = this.reflector.getAllAndOverride<RateLimitOptions>(RATE_LIMIT_RULE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!rule) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const ip = this.clientIp(request);
    const routeKey = `${request.method}:${request.baseUrl || ''}${request.route?.path?.toString() ?? request.path}`;
    const key = `${routeKey}:${ip}`;
    const now = Date.now();

    if (this.buckets.size >= MAX_TRACKED_BUCKETS) {
      this.prune(now);
    }

    const existing = this.buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + rule.windowMs });
      return true;
    }

    existing.count += 1;
    if (existing.count > rule.max) {
      throw new HttpException('请求过于频繁，请稍后再试', HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }

  private clientIp(request: Request): string {
    return request.ip || request.socket?.remoteAddress || 'unknown';
  }

  private prune(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key);
      }
    }
    if (this.buckets.size >= MAX_TRACKED_BUCKETS) {
      this.buckets.clear();
    }
  }
}

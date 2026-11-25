import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { AuthenticatedRequest, AuthenticatedUser } from './auth.types.js';

export const IS_PUBLIC_ROUTE = 'auth:isPublic';
export const REQUIRED_PERMISSION = 'auth:requiredPermission';
export const ALLOW_SYSTEM_TOKEN = 'auth:allowSystemToken';
export const RATE_LIMIT_RULE = 'auth:rateLimit';
export const AUDIT_ACTION = 'audit:action';

export type RateLimitOptions = {
  max: number;
  windowMs: number;
};

export type AuditActionMetadata = {
  action: string;
  resourceType: string;
};

export const PublicRoute = () => SetMetadata(IS_PUBLIC_ROUTE, true);

export const RequirePermission = (permission: string) =>
  SetMetadata(REQUIRED_PERMISSION, permission);

/** 显式允许短期系统令牌访问的路由，并绑定允许的令牌用途（purpose）。 */
export const AllowSystemToken = (purpose = 'BROWSER_IMPORT') =>
  SetMetadata(ALLOW_SYSTEM_TOKEN, purpose);

/** 为公开入口或敏感认证接口启用按 IP 限流。 */
export const RateLimit = (max: number, windowMs: number) =>
  SetMetadata(RATE_LIMIT_RULE, { max, windowMs } satisfies RateLimitOptions);

export const AuditAction = (action: string, resourceType: string) =>
  SetMetadata(AUDIT_ACTION, { action, resourceType } satisfies AuditActionMetadata);

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser | undefined => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.user;
  },
);

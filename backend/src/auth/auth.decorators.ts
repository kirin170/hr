import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { AuthenticatedRequest, AuthenticatedUser } from './auth.types.js';

export const IS_PUBLIC_ROUTE = 'auth:isPublic';
export const REQUIRED_PERMISSION = 'auth:requiredPermission';
export const AUDIT_ACTION = 'audit:action';

export type AuditActionMetadata = {
  action: string;
  resourceType: string;
};

export const PublicRoute = () => SetMetadata(IS_PUBLIC_ROUTE, true);

export const RequirePermission = (permission: string) =>
  SetMetadata(REQUIRED_PERMISSION, permission);

export const AuditAction = (action: string, resourceType: string) =>
  SetMetadata(AUDIT_ACTION, { action, resourceType } satisfies AuditActionMetadata);

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser | undefined => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.user;
  },
);

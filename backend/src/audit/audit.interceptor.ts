import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuditOutcome, Prisma } from '@prisma/client';
import { catchError, from, mergeMap, throwError } from 'rxjs';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { AUDIT_ACTION, type AuditActionMetadata } from '../auth/auth.decorators.js';
import { AuditService } from './audit.service.js';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const metadata = this.reflector.getAllAndOverride<AuditActionMetadata>(AUDIT_ACTION, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!metadata) return next.handle();

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return next.handle().pipe(
      mergeMap(async (result: unknown) => {
        const safeSummary = this.safeSummary(result);
        await this.audit.write({
          actorId: this.actorId(request, result, metadata.action),
          action: metadata.action,
          resourceType: metadata.resourceType,
          resourceId: this.resourceId(request, result),
          requestId: this.audit.requestId(request),
          beforeSummary: undefined,
          afterSummary: safeSummary,
          ip: request.ip,
          userAgent: request.headers['user-agent'],
          outcome: AuditOutcome.SUCCESS,
        });
        return result;
      }),
      catchError((error: unknown) =>
        from(
          this.audit
            .write({
              actorId: request.user?.id ?? request.auditActorId,
              action: metadata.action,
              resourceType: metadata.resourceType,
              resourceId: this.resourceId(request),
              requestId: this.audit.requestId(request),
              ip: request.ip,
              userAgent: request.headers['user-agent'],
              outcome: AuditOutcome.DENIED,
            })
            .catch(() => undefined),
        ).pipe(mergeMap(() => throwError(() => error))),
      ),
    );
  }

  private resourceId(request: AuthenticatedRequest, result?: unknown): string | undefined {
    const routeId = [request.params.id, request.params.userId, request.params.groupId].find(
      (value): value is string => typeof value === 'string',
    );
    if (routeId) return routeId;
    if (result && typeof result === 'object' && 'id' in result) {
      const id = (result as { id?: unknown }).id;
      if (typeof id === 'string') return id;
    }
    return undefined;
  }

  private actorId(
    request: AuthenticatedRequest,
    result: unknown,
    action: string,
  ): string | undefined {
    if (request.user?.id || request.auditActorId) {
      return request.user?.id ?? request.auditActorId;
    }
    if (!action.startsWith('auth.') || !result || typeof result !== 'object') {
      return undefined;
    }
    const value = result as { user?: { id?: unknown } };
    return typeof value.user?.id === 'string' ? value.user.id : undefined;
  }

  private safeSummary(result: unknown): Prisma.InputJsonValue | undefined {
    if (!result || typeof result !== 'object') return undefined;
    const value = result as Record<string, unknown>;
    const summary: Record<string, string | number | boolean> = {};
    for (const key of [
      'id',
      'stage',
      'status',
      'field',
      'roleCode',
      'userId',
      'userGroupId',
      'groupId',
      'departmentId',
      'parentId',
      'canRead',
      'canWrite',
      'revoked',
      'code',
    ]) {
      const item = value[key];
      if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
        summary[key] = item;
      }
    }
    if (Array.isArray(value.roles)) {
      const roleCodes = value.roles.flatMap((role) => {
        if (!role || typeof role !== 'object' || Array.isArray(role)) return [];
        const roleCode = (role as Record<string, unknown>).roleCode;
        return typeof roleCode === 'string' ? [roleCode] : [];
      });
      if (roleCodes.length) summary.roleCodes = roleCodes.join(',');
    }
    return Object.keys(summary).length ? summary : undefined;
  }
}

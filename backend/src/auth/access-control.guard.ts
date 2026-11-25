import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuditOutcome } from '@prisma/client';
import type { AuthenticatedRequest } from './auth.types.js';
import { AccessTokenService } from './access-token.service.js';
import { AuthorizationService } from './authorization.service.js';
import {
  ALLOW_SYSTEM_TOKEN,
  IS_PUBLIC_ROUTE,
  REQUIRED_PERMISSION,
} from './auth.decorators.js';
import { AuditService } from '../audit/audit.service.js';
import { SystemTokenService } from './system-token.service.js';

/** 浏览器扩展等系统调用方使用的短期令牌请求头（ATS-010） */
export const SYSTEM_TOKEN_HEADER = 'x-system-token';

@Injectable()
export class AccessControlGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: AccessTokenService,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
    private readonly systemTokens: SystemTokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const metadata = {
      action: this.reflector.getAllAndOverride<string>(REQUIRED_PERMISSION, [
        context.getHandler(),
        context.getClass(),
      ]),
      resourceType: request.route?.path?.toString() ?? 'API',
    };
    const allowedSystemTokenPurpose = this.reflector.getAllAndOverride<string>(
      ALLOW_SYSTEM_TOKEN,
      [context.getHandler(), context.getClass()],
    );
    const authHeader = request.headers.authorization;
    const bearer = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : '';
    const systemToken =
      typeof request.headers[SYSTEM_TOKEN_HEADER] === 'string'
        ? (request.headers[SYSTEM_TOKEN_HEADER] as string).trim()
        : '';
    try {
      if (!bearer && systemToken) {
        if (!allowedSystemTokenPurpose) {
          throw new UnauthorizedException('该接口不支持系统令牌，请使用登录会话');
        }
        // 短期系统令牌路径（ATS-010）：仅在显式声明 @AllowSystemToken 的路由生效，且仍须经过下方 RBAC 权限校验
        request.user = await this.systemTokens.authenticate(
          systemToken,
          allowedSystemTokenPurpose,
        );
      } else {
        if (!bearer) throw new UnauthorizedException('需要登录后继续');
        const claims = this.tokens.verify(bearer);
        request.user = await this.authorization.loadUserContext(claims.sub);
      }
      if (metadata.action) {
        request.grantedScopes = this.authorization.scopesFor(request.user, metadata.action);
      }
      return true;
    } catch (error) {
      const status =
        error instanceof UnauthorizedException || error instanceof ForbiddenException
          ? error.getStatus()
          : 500;
      if (status === 401 || status === 403) {
        const routeId = request.params.id;
        await this.audit
          .write({
            actorId: request.user?.id,
            action: status === 401 ? 'auth.denied' : `permission.denied:${metadata.action ?? 'unannotated'}`,
            resourceType: metadata.resourceType,
            resourceId: typeof routeId === 'string' ? routeId : routeId?.[0],
            requestId: this.audit.requestId(request),
            ip: request.ip,
            userAgent: request.headers['user-agent'],
            outcome: AuditOutcome.DENIED,
          })
          .catch(() => undefined);
      }
      throw error;
    }
  }
}

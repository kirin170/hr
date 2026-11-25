import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DataScope } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { AccessControlGuard, SYSTEM_TOKEN_HEADER } from './access-control.guard.js';
import {
  ALLOW_SYSTEM_TOKEN,
  IS_PUBLIC_ROUTE,
  REQUIRED_PERMISSION,
} from './auth.decorators.js';
import type { AccessTokenService } from './access-token.service.js';
import type { AuthenticatedRequest, AuthenticatedUser } from './auth.types.js';
import type { AuthorizationService } from './authorization.service.js';
import type { SystemTokenService } from './system-token.service.js';
import type { AuditService } from '../audit/audit.service.js';

const recruiter: AuthenticatedUser = {
  id: 'user-recruiter',
  displayName: '招聘专员',
  departmentId: 'dept-1',
  departmentIds: ['dept-1'],
  groupIds: [],
  roles: [
    {
      code: 'RECRUITER',
      name: '招聘专员',
      dataScope: DataScope.OWN_JOBS,
      permissions: ['intake:manage', 'job:read'],
    },
  ],
};

function makeContext(headers: Record<string, string>) {
  const request = {
    headers,
    params: {},
    route: { path: '/api/v1/authz/users/:userId/roles' },
    ip: '127.0.0.1',
  } as unknown as AuthenticatedRequest;
  const context = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

function makeGuard(meta: { isPublic?: boolean; action?: string; allowSystemToken?: string }) {
  const reflector = {
    getAllAndOverride: vi.fn((key: string) => {
      if (key === IS_PUBLIC_ROUTE) return meta.isPublic ?? false;
      if (key === REQUIRED_PERMISSION) return meta.action;
      if (key === ALLOW_SYSTEM_TOKEN) return meta.allowSystemToken;
      return undefined;
    }),
  } as unknown as Reflector;
  const tokens = { verify: vi.fn() } as unknown as AccessTokenService;
  const scopesFor = vi.fn((user: AuthenticatedUser, action: string) => {
    const allowed = user.roles.some((role) => role.permissions.includes(action));
    if (!allowed) throw new ForbiddenException(`缺少权限 ${action}`);
    return [DataScope.OWN_JOBS];
  });
  const authorization = {
    loadUserContext: vi.fn().mockResolvedValue(recruiter),
    scopesFor,
  } as unknown as AuthorizationService;
  const audit = {
    requestId: vi.fn().mockReturnValue('req-1'),
    write: vi.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;
  const authenticate = vi.fn().mockResolvedValue(recruiter);
  const systemTokens = {
    authenticate,
  } as unknown as SystemTokenService;
  const guard = new AccessControlGuard(reflector, tokens, authorization, audit, systemTokens);
  return { guard, scopesFor, authenticate, audit };
}

describe('AccessControlGuard 系统令牌边界与 RBAC 校验', () => {
  it('未标注 @AllowSystemToken 的路由拒绝 X-System-Token（阻止越权调 authz:admin / 续签）', async () => {
    const { guard, authenticate } = makeGuard({ action: 'authz:admin' });
    const { context } = makeContext({ [SYSTEM_TOKEN_HEADER]: 'valid-sys-token' });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('标注 @AllowSystemToken 的路由仍强制校验 @RequirePermission，不可越权', async () => {
    const { guard, scopesFor, authenticate } = makeGuard({
      action: 'authz:admin',
      allowSystemToken: 'BROWSER_IMPORT',
    });
    const { context } = makeContext({ [SYSTEM_TOKEN_HEADER]: 'valid-sys-token' });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
    expect(authenticate).toHaveBeenCalledWith('valid-sys-token', 'BROWSER_IMPORT');
    expect(scopesFor).toHaveBeenCalledWith(recruiter, 'authz:admin');
  });

  it('标注 @AllowSystemToken 且具备权限时放行并注入 grantedScopes', async () => {
    const { guard, authenticate } = makeGuard({
      action: 'intake:manage',
      allowSystemToken: 'BROWSER_IMPORT',
    });
    const { context, request } = makeContext({ [SYSTEM_TOKEN_HEADER]: 'valid-sys-token' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(authenticate).toHaveBeenCalledWith('valid-sys-token', 'BROWSER_IMPORT');
    expect(request.grantedScopes).toEqual([DataScope.OWN_JOBS]);
  });
});

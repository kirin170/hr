import type { DataScope } from '@prisma/client';
import type { Request } from 'express';

export type RoleGrant = {
  code: string;
  name: string;
  dataScope: DataScope;
  permissions: string[];
};

export type AuthenticatedUser = {
  id: string;
  displayName: string;
  departmentId: string | null;
  departmentIds: string[];
  groupIds: string[];
  roles: RoleGrant[];
};

export type AuthenticatedRequest = Request & {
  user?: AuthenticatedUser;
  auditActorId?: string;
  requestId?: string;
  grantedScopes?: DataScope[];
};

export type AccessTokenClaims = {
  iss: string;
  aud: string;
  sub: string;
  iat: number;
  exp: number;
  jti: string;
};

export type SensitiveAction = 'READ' | 'WRITE';

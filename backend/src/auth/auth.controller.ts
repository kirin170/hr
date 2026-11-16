import {
  BadRequestException,
  Body,
  Controller,
  Header,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { IdentityProvider } from '@prisma/client';
import { AuditAction, PublicRoute } from './auth.decorators.js';
import type { AuthenticatedRequest } from './auth.types.js';
import { AuthService } from './auth.service.js';

const REFRESH_COOKIE = 'talentflow_refresh';
const REFRESH_COOKIE_PATH = '/api/v1/auth';

@Controller('api/v1/auth')
@PublicRoute()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('bootstrap')
  @Header('Cache-Control', 'no-store')
  @AuditAction('auth.initial_admin.bootstrap', 'User')
  async bootstrap(@Body() body: Record<string, unknown> = {}) {
    if (typeof body?.setupToken !== 'string' || !body.setupToken) {
      throw new BadRequestException('setupToken 为必填项');
    }
    if (
      typeof body.identityProvider !== 'string' ||
      !Object.values(IdentityProvider).includes(
        body.identityProvider as IdentityProvider,
      )
    ) {
      throw new BadRequestException('identityProvider 必须为 LOCAL 或 DINGTALK');
    }
    if (typeof body.displayName !== 'string' || !body.displayName.trim()) {
      throw new BadRequestException('displayName 为必填项');
    }
    if (
      typeof body.identitySubject !== 'string' ||
      !body.identitySubject.trim()
    ) {
      throw new BadRequestException('identitySubject 为必填项');
    }
    const user = await this.auth.bootstrapInitialAdmin(body.setupToken, {
      employeeNo: this.optionalText(body.employeeNo),
      displayName: body.displayName.trim(),
      email: this.optionalText(body.email),
      departmentId: this.optionalText(body.departmentId),
      identityProvider: body.identityProvider as IdentityProvider,
      identitySubject: body.identitySubject.trim(),
    });
    return { bootstrapped: true, user };
  }

  @Post('local')
  @Header('Cache-Control', 'no-store')
  @AuditAction('auth.local_login', 'User')
  async loginLocal(
    @Body() body: { identifier?: unknown; secret?: unknown },
    @Res({ passthrough: true }) response: Response,
  ) {
    if (
      typeof body?.identifier !== 'string' ||
      typeof body.secret !== 'string' ||
      !body.identifier.trim() ||
      !body.secret
    ) {
      throw new BadRequestException('identifier 和 secret 为必填项');
    }
    const session = await this.auth.loginLocal(body.identifier.trim(), body.secret);
    this.setRefreshCookie(response, session.refreshToken, session.refreshExpiresIn);
    return {
      accessToken: session.accessToken,
      tokenType: 'Bearer',
      expiresIn: session.expiresIn,
      user: session.user,
    };
  }

  @Post('refresh')
  @Header('Cache-Control', 'no-store')
  @AuditAction('auth.refresh', 'RefreshSession')
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const refreshToken = this.cookie(request, REFRESH_COOKIE);
    if (!refreshToken) throw new BadRequestException('刷新令牌 Cookie 缺失');
    const session = await this.auth.rotateRefreshToken(refreshToken);
    this.setRefreshCookie(response, session.refreshToken, session.refreshExpiresIn);
    return {
      accessToken: session.accessToken,
      tokenType: 'Bearer',
      expiresIn: session.expiresIn,
      user: session.user,
    };
  }

  @Post('logout')
  @Header('Cache-Control', 'no-store')
  @AuditAction('auth.logout', 'RefreshSession')
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const actorId = await this.auth.logout(this.cookie(request, REFRESH_COOKIE));
    if (actorId) (request as AuthenticatedRequest).auditActorId = actorId;
    response.clearCookie(REFRESH_COOKIE, this.cookieOptions());
    return { loggedOut: true };
  }

  private setRefreshCookie(response: Response, token: string, maxAge: number): void {
    response.cookie(REFRESH_COOKIE, token, {
      ...this.cookieOptions(),
      maxAge,
    });
  }

  private cookieOptions() {
    return {
      httpOnly: true,
      secure: process.env.APP_ENV !== 'local',
      sameSite: 'lax' as const,
      path: REFRESH_COOKIE_PATH,
    };
  }

  private cookie(request: Request, name: string): string | undefined {
    const header = request.headers.cookie;
    if (!header) return undefined;
    for (const part of header.split(';')) {
      const separator = part.indexOf('=');
      if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
      try {
        return decodeURIComponent(part.slice(separator + 1).trim());
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  private optionalText(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const text = value.trim();
    return text || undefined;
  }
}

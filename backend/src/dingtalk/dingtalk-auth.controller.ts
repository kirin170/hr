import {
  Controller,
  Get,
  UnauthorizedException,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { AuthService } from '../auth/auth.service.js';
import { AuditAction, PublicRoute } from '../auth/auth.decorators.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { DingTalkApiClient } from './dingtalk-api.client.js';

const STATE_COOKIE = 'talentflow_dingtalk_state';
const DINGTALK_AUTH_PATH = '/api/v1/auth/dingtalk';
const STATE_TTL_MS = 5 * 60 * 1000;
const REFRESH_COOKIE = 'talentflow_refresh';

@Controller('api/v1/auth/dingtalk')
@PublicRoute()
export class DingTalkAuthController {
  constructor(
    private readonly dingtalk: DingTalkApiClient,
    private readonly auth: AuthService,
  ) {}

  @Get('login')
  start(@Res() response: Response): void {
    const state = randomBytes(32).toString('base64url');
    const authorizationUrl = this.dingtalk.getAuthorizationUrl(state);
    response.setHeader('Cache-Control', 'no-store');
    response.cookie(STATE_COOKIE, state, {
      httpOnly: true,
      secure: process.env.APP_ENV !== 'local',
      sameSite: 'lax',
      path: DINGTALK_AUTH_PATH,
      maxAge: STATE_TTL_MS,
    });
    response.redirect(302, authorizationUrl);
  }

  @Get('callback')
  @AuditAction('auth.dingtalk.login', 'User')
  async callback(
    @Query() query: Record<string, unknown>,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    response.setHeader('Cache-Control', 'no-store');
    const code = this.text(query.authCode) ?? this.text(query.code);
    const state = this.text(query.state);
    const cookieState = this.cookie(request, STATE_COOKIE);
    response.clearCookie(STATE_COOKIE, {
      httpOnly: true,
      secure: process.env.APP_ENV !== 'local',
      sameSite: 'lax',
      path: DINGTALK_AUTH_PATH,
    });

    if (query.error || !code || !state || !cookieState || !this.safeEquals(state, cookieState)) {
      throw new UnauthorizedException('钉钉登录授权无效或已过期');
    }

    const userId = await this.dingtalk.resolveUserIdFromAuthorizationCode(code);
    const session = await this.auth.loginDingTalk({ userId, verifiedAt: new Date() });
    (request as AuthenticatedRequest).auditActorId = session.user.id;
    response.cookie(REFRESH_COOKIE, session.refreshToken, {
      httpOnly: true,
      secure: process.env.APP_ENV !== 'local',
      sameSite: 'lax',
      path: '/api/v1/auth',
      maxAge: session.refreshExpiresIn,
    });
    response.redirect(303, process.env.DINGTALK_LOGIN_SUCCESS_REDIRECT ?? '/');
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

  private text(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private safeEquals(left: string, right: string): boolean {
    const leftBytes = Buffer.from(left);
    const rightBytes = Buffer.from(right);
    return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
  }
}

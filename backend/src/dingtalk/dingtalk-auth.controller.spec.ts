import { describe, expect, it, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import type { AuthService } from '../auth/auth.service.js';
import type { DingTalkApiClient } from './dingtalk-api.client.js';
import { DingTalkAuthController } from './dingtalk-auth.controller.js';

describe('DingTalkAuthController', () => {
  it('starts OAuth with an HttpOnly state cookie', () => {
    const dingtalk = { getAuthorizationUrl: vi.fn((state: string) => `https://login.example/?state=${state}`) };
    const auth = {};
    const response = {
      setHeader: vi.fn(),
      cookie: vi.fn(),
      redirect: vi.fn(),
    };
    const controller = new DingTalkAuthController(
      dingtalk as unknown as DingTalkApiClient,
      auth as AuthService,
    );

    controller.start(response as never);

    const [cookieName, state, options] = response.cookie.mock.calls[0]!;
    expect(cookieName).toBe('talentflow_dingtalk_state');
    expect(state).toHaveLength(43);
    expect(options).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/api/v1/auth/dingtalk' });
    expect(dingtalk.getAuthorizationUrl).toHaveBeenCalledWith(state);
    expect(response.redirect).toHaveBeenCalledWith(302, `https://login.example/?state=${state}`);
  });

  it('exchanges only a callback bound to the state cookie and issues the rotated-session cookie', async () => {
    const dingtalk = { resolveUserIdFromAuthorizationCode: vi.fn().mockResolvedValue('dt-user-1') };
    const auth = {
      loginDingTalk: vi.fn().mockResolvedValue({
        refreshToken: 'refresh-secret',
        refreshExpiresIn: 60_000,
        user: { id: 'ats-user-1', displayName: '招聘 HR' },
      }),
    };
    const response = {
      setHeader: vi.fn(),
      clearCookie: vi.fn(),
      cookie: vi.fn(),
      redirect: vi.fn(),
    };
    const request = { headers: { cookie: 'other=x; talentflow_dingtalk_state=bound-state' } };
    const controller = new DingTalkAuthController(
      dingtalk as unknown as DingTalkApiClient,
      auth as unknown as AuthService,
    );

    await controller.callback(
      { authCode: 'one-time-code', state: 'bound-state' },
      request as never,
      response as never,
    );

    expect(dingtalk.resolveUserIdFromAuthorizationCode).toHaveBeenCalledWith('one-time-code');
    expect(auth.loginDingTalk).toHaveBeenCalledWith(expect.objectContaining({ userId: 'dt-user-1' }));
    expect(response.cookie).toHaveBeenCalledWith('talentflow_refresh', 'refresh-secret', expect.objectContaining({
      httpOnly: true,
      sameSite: 'lax',
      path: '/api/v1/auth',
      maxAge: 60_000,
    }));
    expect(response.redirect).toHaveBeenCalledWith(303, '/');
  });

  it('rejects a mismatched state before exchanging the authorization code', async () => {
    const dingtalk = { resolveUserIdFromAuthorizationCode: vi.fn() };
    const auth = { loginDingTalk: vi.fn() };
    const response = { setHeader: vi.fn(), clearCookie: vi.fn(), cookie: vi.fn(), redirect: vi.fn() };
    const request = { headers: { cookie: 'talentflow_dingtalk_state=expected' } };
    const controller = new DingTalkAuthController(
      dingtalk as unknown as DingTalkApiClient,
      auth as unknown as AuthService,
    );

    await expect(controller.callback(
      { authCode: 'one-time-code', state: 'wrong' },
      request as never,
      response as never,
    )).rejects.toBeInstanceOf(UnauthorizedException);
    expect(dingtalk.resolveUserIdFromAuthorizationCode).not.toHaveBeenCalled();
    expect(auth.loginDingTalk).not.toHaveBeenCalled();
  });

  it('accepts the standard code callback parameter', async () => {
    const dingtalk = { resolveUserIdFromAuthorizationCode: vi.fn().mockResolvedValue('dt-user-2') };
    const auth = {
      loginDingTalk: vi.fn().mockResolvedValue({
        refreshToken: 'refresh-secret',
        refreshExpiresIn: 60_000,
        user: { id: 'ats-user-2', displayName: 'Recruiter' },
      }),
    };
    const response = {
      setHeader: vi.fn(),
      clearCookie: vi.fn(),
      cookie: vi.fn(),
      redirect: vi.fn(),
    };
    const request = { headers: { cookie: 'talentflow_dingtalk_state=bound-state' } };
    const controller = new DingTalkAuthController(
      dingtalk as unknown as DingTalkApiClient,
      auth as unknown as AuthService,
    );

    await controller.callback(
      { code: 'standard-code', state: 'bound-state' },
      request as never,
      response as never,
    );

    expect(dingtalk.resolveUserIdFromAuthorizationCode).toHaveBeenCalledWith('standard-code');
  });
});

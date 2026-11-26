import { afterEach, describe, expect, it, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { DingTalkApiClient } from './dingtalk-api.client.js';

const apiConfig = () => {
  vi.stubEnv('DINGTALK_CLIENT_ID', 'app-key');
  vi.stubEnv('DINGTALK_CLIENT_SECRET', 'app-secret');
  vi.stubEnv('DINGTALK_CORP_ID', 'corp-1');
  vi.stubEnv('DINGTALK_REDIRECT_URI', 'https://ats.example/api/v1/auth/dingtalk/callback');
  vi.stubEnv('APP_ENV', 'production');
};

const json = (value: unknown) =>
  new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('DingTalkApiClient', () => {
  it('builds an OAuth URL with fixed tenant, code flow, scopes and state', () => {
    apiConfig();
    const url = new URL(new DingTalkApiClient().getAuthorizationUrl('csrf-state'));
    expect(url.origin + url.pathname).toBe('https://login.dingtalk.com/oauth2/auth');
    expect(url.searchParams.get('client_id')).toBe('app-key');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('openid corpid');
    expect(url.searchParams.get('corpId')).toBe('corp-1');
    expect(url.searchParams.get('state')).toBe('csrf-state');
    expect(url.searchParams.get('redirect_uri')).toBe('https://ats.example/api/v1/auth/dingtalk/callback');
  });

  it('exchanges authCode, validates corpId and resolves the directory userId', async () => {
    apiConfig();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ accessToken: 'user-token', corpId: 'corp-1' }))
      .mockResolvedValueOnce(json({ unionId: 'union-7' }))
      .mockResolvedValueOnce(json({ accessToken: 'app-token', expireIn: 7_200 }))
      .mockResolvedValueOnce(json({ errcode: 0, result: { userid: 'user-7' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(new DingTalkApiClient().resolveUserIdFromAuthorizationCode('one-time-code'))
      .resolves.toBe('user-7');

    const exchange = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(exchange).toEqual({
      clientId: 'app-key',
      clientSecret: 'app-secret',
      code: 'one-time-code',
      grantType: 'authorization_code',
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://api.dingtalk.com/v1.0/contact/users/me');
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toEqual({
      'x-acs-dingtalk-access-token': 'user-token',
    });
    expect(String(fetchMock.mock.calls[2]?.[0])).toBe('https://api.dingtalk.com/v1.0/oauth2/accessToken');
    expect(fetchMock.mock.calls[2]?.[1]?.method).toBe('POST');
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({
      appKey: 'app-key',
      appSecret: 'app-secret',
    });
    expect(String(fetchMock.mock.calls[3]?.[0])).toContain('access_token=app-token');
    expect(String(fetchMock.mock.calls[3]?.[1]?.body)).toContain('unionid=union-7');
  });

  it('rejects authorization codes from another company before resolving an identity', async () => {
    apiConfig();
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ accessToken: 'user-token', corpId: 'other-corp' }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new DingTalkApiClient();

    await expect(client.resolveUserIdFromAuthorizationCode('one-time-code'))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('normalizes string pagination fields and string department IDs', async () => {
    apiConfig();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ accessToken: 'app-token', expireIn: 7_200 }))
      .mockResolvedValueOnce(json({
        errcode: 0,
        result: {
          list: {
            userid: 'user-1',
            name: '测试用户',
            dept_id_list: '["1", "12"]',
          },
          has_more: 'true',
          next_cursor: '100',
        },
      }))
      .mockResolvedValueOnce(json({
        errcode: 0,
        result: {
          list: [{ userid: 'user-2', name: '另一用户', dept_id_list: [12] }],
          has_more: false,
          next_cursor: 100,
        },
      }));
    vi.stubGlobal('fetch', fetchMock);

    const users = await new DingTalkApiClient().listDepartmentUsers(12);
    expect(users.map(({ userid, dept_id_list }) => [userid, dept_id_list])).toEqual([
      ['user-1', [1, 12]],
      ['user-2', [12]],
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[2]?.[1]?.body)).toContain('cursor=100');
  });

  it('does not auto-retry non-idempotent POST requests on network failure or 5xx', async () => {
    apiConfig();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ accessToken: 'app-token', expireIn: 7_200 }))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(new Response('{}', { status: 502 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new DingTalkApiClient();

    await expect(
      client.requestOpenApi('POST', '/v1.0/workflow/processInstances', { body: { a: 1 } }),
    ).rejects.toMatchObject({ code: 'network_error' });
    await expect(
      client.requestOpenApi('POST', '/v1.0/workflow/processInstances', { body: { a: 1 } }),
    ).rejects.toMatchObject({ code: 'http_502' });
    // 1 token request + 1 failed network POST + 1 failed 502 POST (zero retries)
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

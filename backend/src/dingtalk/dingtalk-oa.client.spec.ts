import { ServiceUnavailableException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DingTalkApiClient } from './dingtalk-api.client.js';
import { DingTalkOaClient, parseApprovalInstanceRef } from './dingtalk-oa.client.js';

const INSTANCE_ID = 'ad253df6-e175caf-xxxxxxxxxxxx';

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

const tokenResponse = () => json({ accessToken: 'app-token', expireIn: 7_200 });

type FetchMock = ReturnType<typeof vi.fn>;

/** 第 index 次 fetch 的请求参数；缺失时直接失败，避免测试里出现不安全的可选链。 */
function sentInit(fetchMock: FetchMock, index = 1): RequestInit & { headers: Record<string, string> } {
  const init = fetchMock.mock.calls[index]?.[1] as RequestInit | undefined;
  if (!init) throw new Error(`fetch 未被第 ${index} 次调用`);
  return init as RequestInit & { headers: Record<string, string> };
}

function sentBody(fetchMock: FetchMock, index = 1): unknown {
  const body = sentInit(fetchMock, index).body;
  return JSON.parse(typeof body === 'string' ? body : '');
}

function configure() {
  vi.stubEnv('DINGTALK_CLIENT_ID', 'app-key');
  vi.stubEnv('DINGTALK_CLIENT_SECRET', 'app-secret');
  vi.stubEnv('DINGTALK_CORP_ID', 'corp-1');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('parseApprovalInstanceRef', () => {
  it('accepts a bare instance id and DingTalk detail links', () => {
    expect(parseApprovalInstanceRef(INSTANCE_ID)).toBe(INSTANCE_ID);
    expect(parseApprovalInstanceRef(` https://aflow.dingtalk.com/proc?procInstId=${INSTANCE_ID}&from=X `)).toBe(INSTANCE_ID);
    expect(parseApprovalInstanceRef(`https://oa.dingtalk.com/process/processInstances/${INSTANCE_ID}`)).toBe(INSTANCE_ID);
  });

  it('rejects anything that is not a strict instance id', () => {
    expect(parseApprovalInstanceRef('')).toBeNull();
    expect(parseApprovalInstanceRef('short')).toBeNull();
    expect(parseApprovalInstanceRef('../../v1.0/oauth2/accessToken?x=1')).toBeNull();
    expect(parseApprovalInstanceRef(`${INSTANCE_ID}?access_token=abc`)).toBeNull();
    expect(parseApprovalInstanceRef(`https://evil.example/?procInstId=abc`)).toBeNull();
    expect(parseApprovalInstanceRef(123)).toBeNull();
  });
});

describe('DingTalkOaClient.getInstance', () => {
  it('reads the official instance endpoint with the app token and no request body', async () => {
    configure();
    const fetchMock = vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(
      json({
        title: '张三提交的招聘需求',
        status: 'COMPLETED',
        result: 'agree',
        createTime: '2026-11-01T09:30Z',
        finishTime: '2026-11-02T10:00Z',
        originatorUserId: 'manager1',
        originatorDeptId: '-1',
        originatorDeptName: '测试',
        businessId: '111',
        formComponentValues: [
          { name: '需求名称', value: '后端工程师', id: 'TextField-1', componentType: 'TextField', bizAlias: '' },
          { name: '招聘人数', value: '3', id: 'NumberField-2', componentType: 'DDNumberField' },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const instance = await new DingTalkOaClient(new DingTalkApiClient()).getInstance(INSTANCE_ID);

    const url = String(fetchMock.mock.calls[1]?.[0]);
    expect(url).toBe(`https://api.dingtalk.com/v1.0/workflow/processInstances?processInstanceId=${INSTANCE_ID}`);
    expect(sentInit(fetchMock).method).toBe('GET');
    expect(sentInit(fetchMock).body).toBeUndefined();
    expect(sentInit(fetchMock).headers['x-acs-dingtalk-access-token']).toBe('app-token');
    expect(instance).toMatchObject({
      processInstanceId: INSTANCE_ID,
      title: '张三提交的招聘需求',
      status: 'COMPLETED',
      result: 'agree',
      originatorUserId: 'manager1',
      originatorDeptId: -1,
      businessId: '111',
    });
    expect(instance?.createTime?.toISOString()).toBe('2026-11-01T09:30:00.000Z');
    expect(instance?.form).toHaveLength(2);
    expect(instance?.form[0]).toMatchObject({ name: '需求名称', value: '后端工程师', id: 'TextField-1', componentType: 'TextField' });
  });

  it('unwraps the result object shape and the legacy formComponents props shape', async () => {
    configure();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(
        json({
          success: true,
          result: {
            title: '审批',
            status: 'running',
            result: 'refuse',
            formComponents: [
              { componentType: 'TextField', props: { id: 'TextField-k2', title: '需求部门' }, value: '研发部' },
            ],
          },
        }),
      ),
    );

    const instance = await new DingTalkOaClient(new DingTalkApiClient()).getInstance(INSTANCE_ID);

    expect(instance.status).toBe('RUNNING');
    expect(instance.result).toBe('refuse');
    expect(instance.form[0]).toMatchObject({ name: '需求部门', value: '研发部', id: 'TextField-k2' });
  });

  it('maps permission, not-found, throttling and unconfigured outcomes without leaking responses', async () => {
    configure();
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(json({ code: 'Forbidden.AccessDenied.AccessTokenPermissionDenied', message: 'secret detail', requestid: 'r1' }, 403))
        .mockResolvedValueOnce(json({ code: 'invalidParameter.paramName', message: 'secret detail' }, 400))
        .mockResolvedValueOnce(new Response('not json', { status: 404 })),
    );
    const client = new DingTalkOaClient(new DingTalkApiClient());

    const denied = await client.getInstance(INSTANCE_ID).catch((error: unknown) => error);
    expect(denied).toMatchObject({ kind: 'DENIED', code: 'Forbidden.AccessDenied.AccessTokenPermissionDenied' });
    expect(String((denied as Error).message)).not.toContain('secret detail');
    await expect(client.getInstance(INSTANCE_ID)).rejects.toMatchObject({ kind: 'INVALID', code: 'invalidParameter.paramName' });
    await expect(client.getInstance(INSTANCE_ID)).rejects.toMatchObject({ kind: 'NOT_FOUND', code: 'http_404' });
  });

  it('reports unconfigured deployments instead of calling DingTalk', async () => {
    vi.stubEnv('DINGTALK_CLIENT_ID', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(new DingTalkOaClient(new DingTalkApiClient()).getInstance(INSTANCE_ID)).rejects.toMatchObject({
      kind: 'NOT_CONFIGURED',
      code: 'OA_NOT_CONFIGURED',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses malformed instance ids before any request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(new DingTalkOaClient(new DingTalkApiClient()).getInstance('../token')).rejects.toMatchObject({
      kind: 'INVALID',
      code: 'OA_INSTANCE_ID_INVALID',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('DingTalkOaClient.startInstance', () => {
  const input = {
    processCode: 'PROC-OFFER',
    originatorUserId: 'manager1',
    deptId: 100,
    formComponentValues: [{ name: '简历信息', value: '姓名：张三' }],
    approvers: [
      { actionType: 'NONE' as const, userIds: ['mgr'] },
      { actionType: 'AND' as const, userIds: ['dir1', 'dir2'] },
    ],
  };

  it('posts to the official start endpoint and returns the instance id', async () => {
    configure();
    const fetchMock = vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(json({ id: INSTANCE_ID }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(new DingTalkOaClient(new DingTalkApiClient()).startInstance(input)).resolves.toEqual({ id: INSTANCE_ID });

    expect(String(fetchMock.mock.calls[1]?.[0])).toBe('https://api.dingtalk.com/v1.0/workflow/processInstances');
    expect(sentInit(fetchMock).method).toBe('POST');
    expect(sentBody(fetchMock)).toEqual(input);
  });

  it('omits approvers so the OA template flow applies when no level is configured', async () => {
    configure();
    const fetchMock = vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(json({ id: INSTANCE_ID }));
    vi.stubGlobal('fetch', fetchMock);

    await new DingTalkOaClient(new DingTalkApiClient()).startInstance({ ...input, approvers: [] });

    expect(sentBody(fetchMock)).not.toHaveProperty('approvers');
  });

  it('turns explicit platform rejections and malformed success payloads into typed errors', async () => {
    configure();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(json({ code: 'Forbidden.AccessDenied', message: 'x' }, 403))
      .mockResolvedValueOnce(json({ something: 'else' }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new DingTalkOaClient(new DingTalkApiClient());

    await expect(client.startInstance(input)).rejects.toMatchObject({ kind: 'DENIED', code: 'Forbidden.AccessDenied' });
    await expect(client.startInstance(input)).rejects.toMatchObject({ kind: 'INVALID', code: 'OA_START_RESPONSE_INVALID' });
  });

  it('retries throttling with backoff and ends as unavailable, which callers must treat as an unknown outcome', async () => {
    configure();
    vi.useFakeTimers();
    try {
      // 每次重试都要返回新的 Response：同一响应体只能被读取一次。
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(tokenResponse())
        .mockImplementation(async () => json({ code: 'Throttling', message: 'x' }, 429));
      vi.stubGlobal('fetch', fetchMock);
      const client = new DingTalkOaClient(new DingTalkApiClient());

      const rejection = expect(client.startInstance(input)).rejects.toMatchObject({ kind: 'UNAVAILABLE', code: 'Throttling' });
      await vi.runAllTimersAsync();
      await rejection;
      // 1 次取令牌 + 首次请求 + 2 次退避重试
      expect(fetchMock.mock.calls).toHaveLength(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('surfaces missing credentials as not configured', async () => {
    vi.stubEnv('DINGTALK_CLIENT_ID', 'app-key');
    vi.stubEnv('DINGTALK_CLIENT_SECRET', '');
    vi.stubEnv('DINGTALK_CORP_ID', 'corp-1');
    const api = new DingTalkApiClient();
    vi.spyOn(api, 'requestOpenApi').mockRejectedValue(new ServiceUnavailableException('钉钉正式接入尚未配置'));

    await expect(new DingTalkOaClient(api).startInstance(input)).rejects.toMatchObject({
      kind: 'NOT_CONFIGURED',
      code: 'OA_NOT_CONFIGURED',
    });
  });
});

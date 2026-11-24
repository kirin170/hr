import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DingTalkMinutesClient,
  MinutesSourceError,
  parseMinutesLink,
} from './dingtalk-minutes.client.js';

const ENV_KEYS = ['DINGTALK_MINUTES_GATEWAY_URL', 'DINGTALK_MINUTES_GATEWAY_TOKEN', 'APP_ENV'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  process.env.APP_ENV = 'local';
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const configureGateway = () => {
  process.env.DINGTALK_MINUTES_GATEWAY_URL = 'http://127.0.0.1:9/minutes';
  process.env.DINGTALK_MINUTES_GATEWAY_TOKEN = 'test-token';
};

describe('parseMinutesLink（DT-4 听记来源识别）', () => {
  it('识别钉钉听记链接、查询参数与原始听记 ID', () => {
    const id = 'a1b2c3d4e5f60718';
    expect(parseMinutesLink(`https://shanji.dingtalk.com/app/transcribes/${id}`)).toEqual({ minutesId: id });
    expect(parseMinutesLink(`https://shanji.dingtalk.com/app/transcriptions/${id}/detail`)).toEqual({ minutesId: id });
    expect(parseMinutesLink(`https://shanji.dingtalk.com/app/home?minutesId=${id}`)).toEqual({ minutesId: id });
    expect(parseMinutesLink(id)).toEqual({ minutesId: id });
  });

  it('识别带下划线分段的线上听记链接', () => {
    const real = '7632756964353431303231313937313138315f323433313835333732355f35';
    expect(parseMinutesLink(`https://shanji.dingtalk.com/app/transcribes/${real}`)).toEqual({ minutesId: real });
    expect(parseMinutesLink(real)).toEqual({ minutesId: real });
    expect(parseMinutesLink('https://shanji.dingtalk.com/app/transcribes/not_a_valid')).toBeNull();
  });

  it('拒绝非钉钉听记域名与无法识别的内容，避免按外部链接回源', () => {
    expect(parseMinutesLink('https://example.org/app/transcribes/a1b2c3d4e5f60718')).toBeNull();
    expect(parseMinutesLink('https://shanji.dingtalk.com/app/home')).toBeNull();
    expect(parseMinutesLink('not-a-link')).toBeNull();
    expect(parseMinutesLink('ftp://shanji.dingtalk.com/app/transcribes/a1b2c3d4e5f60718')).toBeNull();
  });
});

describe('DingTalkMinutesClient 能力与权限边界', () => {
  it('未配置网关时显式报告 UNSUPPORTED，不伪造素材', async () => {
    delete process.env.DINGTALK_MINUTES_GATEWAY_URL;
    delete process.env.DINGTALK_MINUTES_GATEWAY_TOKEN;
    const capability = await new DingTalkMinutesClient().capability();
    expect(capability).toMatchObject({ state: 'UNSUPPORTED', configured: false, code: 'MINUTES_GATEWAY_NOT_CONFIGURED' });
    await expect(new DingTalkMinutesClient().fetch('a1b2c3d4e5f60718', 'user-1'))
      .rejects.toMatchObject({ kind: 'UNSUPPORTED', code: 'MINUTES_GATEWAY_NOT_CONFIGURED' });
  });

  it('网关可用时报告 AVAILABLE，权限拒绝时报告 DENIED', async () => {
    configureGateway();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    expect(await new DingTalkMinutesClient().capability()).toMatchObject({ state: 'AVAILABLE', configured: true });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 403 })));
    const denied = await new DingTalkMinutesClient().capability();
    expect(denied.state).toBe('DENIED');
    expect(denied.code).toBe('MINUTES_HTTP_403');
  });

  it('读取时把 401/403 映射为越权，错误信息不携带原文或令牌', async () => {
    configureGateway();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"summary":"机密内容"}', { status: 403 })));
    const client = new DingTalkMinutesClient();
    const error = await client.fetch('a1b2c3d4e5f60718', 'user-1').catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(MinutesSourceError);
    expect((error as MinutesSourceError).kind).toBe('DENIED');
    expect((error as MinutesSourceError).code).toBe('MINUTES_HTTP_403');
    expect((error as Error).message).not.toContain('机密内容');
    expect((error as Error).message).not.toContain('test-token');
  });

  it('按操作者身份请求素材并归一化摘要、原文与分段', async () => {
    configureGateway();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      minutesId: 'a1b2c3d4e5f60718',
      title: '一面听记',
      summary: '候选人介绍了项目经历',
      originalText: '面试官：请介绍项目\n候选人：负责订单系统',
      segments: [
        { startMs: 0, endMs: 1200, speaker: '面试官', text: '请介绍项目' },
        { startTime: '1200', endTime: '3000', speaker: '候选人', text: '负责订单系统' },
        { speaker: '候选人', text: '   ' },
      ],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const material = await new DingTalkMinutesClient().fetch('a1b2c3d4e5f60718', 'ding-user-1');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:9/minutes/v1/minutes/transcripts',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ minutesId: 'a1b2c3d4e5f60718', operatorUserId: 'ding-user-1' }),
      }),
    );
    expect(material.summary).toBe('候选人介绍了项目经历');
    expect(material.segments).toEqual([
      { index: 0, startMs: 0, endMs: 1200, speaker: '面试官', text: '请介绍项目' },
      { index: 1, startMs: 1200, endMs: 3000, speaker: '候选人', text: '负责订单系统' },
    ]);
  });

  it('素材为空、听记 ID 不一致或响应异常时拒绝写入', async () => {
    configureGateway();
    const client = new DingTalkMinutesClient();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      minutesId: 'a1b2c3d4e5f60718', summary: '', originalText: '',
    }), { status: 200 })));
    await expect(client.fetch('a1b2c3d4e5f60718', 'user-1')).rejects.toMatchObject({ kind: 'INVALID', code: 'MINUTES_EMPTY_MATERIAL' });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      minutesId: 'ffffffffffffffff', summary: '摘要',
    }), { status: 200 })));
    await expect(client.fetch('a1b2c3d4e5f60718', 'user-1')).rejects.toMatchObject({ kind: 'INVALID', code: 'MINUTES_ID_MISMATCH' });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>', { status: 200 })));
    await expect(client.fetch('a1b2c3d4e5f60718', 'user-1')).rejects.toMatchObject({ kind: 'INVALID', code: 'MINUTES_INVALID_JSON' });
  });

  it('超时或网络失败按可重试处理，重试后仍失败返回 UNAVAILABLE', async () => {
    configureGateway();
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(new DingTalkMinutesClient().fetch('a1b2c3d4e5f60718', 'user-1'))
      .rejects.toMatchObject({ kind: 'UNAVAILABLE', code: 'MINUTES_NETWORK_ERROR' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('非 local 环境拒绝明文网关地址', async () => {
    configureGateway();
    process.env.APP_ENV = 'production';
    const capability = await new DingTalkMinutesClient().capability();
    expect(capability).toMatchObject({ state: 'UNSUPPORTED', configured: false });
  });
});

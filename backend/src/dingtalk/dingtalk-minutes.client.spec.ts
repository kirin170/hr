import { execFile } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DingTalkMinutesClient,
  MinutesSourceError,
  parseMinutesLink,
} from './dingtalk-minutes.client.js';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));

const execMock = vi.mocked(execFile);
type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void;

const ENV_KEYS = ['DINGTALK_MINUTES_DWS_BIN', 'DINGTALK_MINUTES_DWS_TIMEOUT_MS'] as const;
const saved: Record<string, string | undefined> = {};
let stdoutByCommand: Record<string, string> = {};
let errorsByCommand: Record<string, { error: Error; stderr?: string }> = {};

const route = (args: readonly string[]) => {
  const command = args[1] ?? '';
  return errorsByCommand[command] ? { ...errorsByCommand[command] } : { error: null, stderr: '' };
};

beforeEach(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  process.env.DINGTALK_MINUTES_DWS_BIN = 'dws';
  stdoutByCommand = {
    '+list-mine': JSON.stringify({ success: true, data: { items: [] } }),
    '+detail': JSON.stringify({ success: true, data: { taskUuid: 'a1b2c3d4e5f60718', title: '一面听记', summary: '候选人介绍了项目经历' } }),
    '+transcript': JSON.stringify({
      success: true,
      data: {
        complete: true,
        segments: [
          { startMs: 0, endMs: 1200, speaker: '面试官', text: '请介绍项目' },
          { startTime: '1200', endTime: '3000', speakerName: '候选人', content: '负责订单系统' },
          { speaker: '候选人', text: '   ' },
        ],
      },
    }),
  };
  errorsByCommand = {};
  execMock.mockImplementation(((bin: string, args: readonly string[], opts: unknown, callback: ExecCallback) => {
    const command = args[1] ?? '';
    const { error, stderr } = route(args);
    if (error) callback(error, '', stderr ?? '');
    else callback(null, stdoutByCommand[command] ?? '{}', '');
    return { kill: vi.fn() } as unknown as ReturnType<typeof execFile>;
  }) as typeof execFile);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.restoreAllMocks();
});

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

describe('DingTalkMinutesClient dws 适配边界', () => {
  it('未配置 dws 时显式报告 UNSUPPORTED，不伪造素材', async () => {
    delete process.env.DINGTALK_MINUTES_DWS_BIN;
    expect(await new DingTalkMinutesClient().capability()).toMatchObject({
      state: 'UNSUPPORTED',
      configured: false,
      code: 'MINUTES_CLI_NOT_CONFIGURED',
    });
    await expect(new DingTalkMinutesClient().fetch('a1b2c3d4e5f60718', 'hr-1'))
      .rejects.toMatchObject({ kind: 'UNSUPPORTED', code: 'MINUTES_CLI_NOT_CONFIGURED' });
  });

  it('能力探测用只读预览命令，认证失败与二进制缺失分别归类', async () => {
    expect(await new DingTalkMinutesClient().capability()).toMatchObject({ state: 'AVAILABLE', configured: true, code: null });

    errorsByCommand['+list-mine'] = { error: Object.assign(new Error('exit 1'), { code: 1 }), stderr: 'please login first' };
    expect(await new DingTalkMinutesClient().capability()).toMatchObject({ state: 'DENIED', code: 'MINUTES_CLI_DENIED' });

    errorsByCommand['+list-mine'] = { error: Object.assign(new Error('spawn failed'), { code: 'ENOENT' }) };
    expect(await new DingTalkMinutesClient().capability()).toMatchObject({ state: 'UNAVAILABLE', code: 'MINUTES_CLI_NOT_INSTALLED' });
  });

  it('按命令读取摘要与逐字稿并归一化分段', async () => {
    const material = await new DingTalkMinutesClient().fetch('a1b2c3d4e5f60718', 'hr-1');
    expect(material.summary).toBe('候选人介绍了项目经历');
    expect(material.transcriptUnavailable).toBeNull();
    expect(material.segments).toEqual([
      { index: 0, startMs: 0, endMs: 1200, speaker: '面试官', text: '请介绍项目' },
      { index: 1, startMs: 1200, endMs: 3000, speaker: '候选人', text: '负责订单系统' },
    ]);
    const detailArgs = execMock.mock.calls.find((call) => (call[1] as string[]).includes('+detail'))?.[1] as string[];
    expect(detailArgs).toEqual(['minutes', '+detail', '--id', 'a1b2c3d4e5f60718', '--artifacts', 'basic,summary', '--format', 'json']);
  });

  it('逐字稿失败但摘要可读时部分成功并带上错误码', async () => {
    errorsByCommand['+transcript'] = { error: Object.assign(new Error('exit 1'), { code: 1 }), stderr: 'service unavailable' };
    const material = await new DingTalkMinutesClient().fetch('a1b2c3d4e5f60718', 'hr-1');
    expect(material.summary).toBe('候选人介绍了项目经历');
    expect(material.segments).toEqual([]);
    expect(material.transcriptUnavailable).toBe('MINUTES_CLI_EXIT_1');
  });

  it('摘要也失败时整体失败，错误信息不携带内容', async () => {
    errorsByCommand['+detail'] = { error: Object.assign(new Error('exit 1'), { code: 1 }), stderr: 'noPermission denied' };
    const error = await new DingTalkMinutesClient().fetch('a1b2c3d4e5f60718', 'hr-1').catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(MinutesSourceError);
    expect((error as MinutesSourceError).kind).toBe('DENIED');
    expect((error as Error).message).not.toContain('候选人介绍了项目经历');
    expect((error as Error).message).not.toContain('noPermission denied');
  });

  it('ID 不一致、素材为空与结构未识别时拒绝写入', async () => {
    stdoutByCommand['+detail'] = JSON.stringify({ success: true, data: { taskUuid: 'ffffffffffffffff', summary: '摘要' } });
    await expect(new DingTalkMinutesClient().fetch('a1b2c3d4e5f60718', 'hr-1'))
      .rejects.toMatchObject({ kind: 'INVALID', code: 'MINUTES_ID_MISMATCH' });

    stdoutByCommand['+detail'] = JSON.stringify({ success: true, data: { taskUuid: 'a1b2c3d4e5f60718' } });
    stdoutByCommand['+transcript'] = JSON.stringify({ success: true, data: { complete: true, segments: [] } });
    await expect(new DingTalkMinutesClient().fetch('a1b2c3d4e5f60718', 'hr-1'))
      .rejects.toMatchObject({ kind: 'INVALID', code: 'MINUTES_EMPTY_MATERIAL' });

    stdoutByCommand['+detail'] = JSON.stringify({ success: true, data: { taskUuid: 'a1b2c3d4e5f60718', summary: '摘要' } });
    stdoutByCommand['+transcript'] = JSON.stringify({ success: true, data: { complete: true, blob: { shape: 'unknown' } } });
    const degraded = await new DingTalkMinutesClient().fetch('a1b2c3d4e5f60718', 'hr-1');
    expect(degraded.transcriptUnavailable).toBe('MINUTES_TRANSCRIPT_SHAPE_UNSUPPORTED');
    expect(degraded.segments).toEqual([]);

    stdoutByCommand['+detail'] = JSON.stringify({ success: true, data: { taskUuid: 'a1b2c3d4e5f60718' } });
    await expect(new DingTalkMinutesClient().fetch('a1b2c3d4e5f60718', 'hr-1'))
      .rejects.toMatchObject({ kind: 'UNSUPPORTED', code: 'MINUTES_TRANSCRIPT_SHAPE_UNSUPPORTED' });
  });

  it('逐字稿未追完分页时降级为摘要部分成功并如实记录错误码', async () => {
    stdoutByCommand['+transcript'] = JSON.stringify({ success: true, data: { complete: false, segments: [{ text: '只读到第一页' }] } });
    const material = await new DingTalkMinutesClient().fetch('a1b2c3d4e5f60718', 'hr-1');
    expect(material.segments).toEqual([]);
    expect(material.transcriptUnavailable).toBe('MINUTES_TRANSCRIPT_INCOMPLETE');
  });

  it('超时按可重试类失败归类', async () => {
    errorsByCommand['+detail'] = { error: Object.assign(new Error('timeout'), { killed: true }) };
    await expect(new DingTalkMinutesClient().fetch('a1b2c3d4e5f60718', 'hr-1'))
      .rejects.toMatchObject({ kind: 'UNAVAILABLE', code: 'MINUTES_CLI_TIMEOUT' });
  });
});

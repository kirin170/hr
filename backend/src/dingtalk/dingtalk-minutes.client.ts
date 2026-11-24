import { execFile, type ExecFileException } from 'node:child_process';
import { Injectable } from '@nestjs/common';

/** 只允许读取钉钉听记域名，避免把任意 URL 当作听记素材来源 */
const MINUTES_HOSTS = new Set(['shanji.dingtalk.com']);
/** 真实听记 ID 形如 <16 位以上十六进制>_<十六进制>_<十六进制>，分段之间用下划线连接 */
const MINUTES_ID_SOURCE = '[0-9a-f]{16,128}(?:_[0-9a-f]+)*';
const MINUTES_ID_PATTERN = new RegExp(`^${MINUTES_ID_SOURCE}$`, 'i');
const MINUTES_PATH_PATTERN = new RegExp(`\\/(?:transcribes?|transcriptions?|minutes)\\/(${MINUTES_ID_SOURCE})(?:\\/|$)`, 'i');
/** dws 单次调用的进程超时：逐字稿追分页可能耗时，留足余量 */
const DEFAULT_TIMEOUT_MS = 30_000;
/** 能力探测结果缓存，避免面试详情页每次打开都启动一次 CLI */
const CAPABILITY_TTL_MS = 60_000;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
/** 单条听记素材上限，避免异常响应把数据库写满 */
const MAX_MATERIAL_CHARS = 2_000_000;
const MAX_SEGMENTS = 20_000;
/** dws 的认证/权限失败只按关键字归类，错误文本本身不落库、不进日志 */
const DENIED_PATTERN = /(auth|login|token|expired|permission|forbidden|unauthor|no.?permission|403)/i;
const NOT_FOUND_PATTERN = /(not.?found|not.?exist|deleted|404)/i;
const SAFE_CODE_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;
/** 逐字稿容器字段：dws 1.0.x 用 paragraphList，其余为兼容旧输出 */
const SEGMENT_KEYS = ['paragraphList', 'segments', 'paragraphs', 'sentences', 'sentencesList', 'items'] as const;
/** 时间戳超过该阈值视为绝对时间（epoch 毫秒），需换算成相对录音起点的偏移 */
const ABSOLUTE_TIME_THRESHOLD = 1e11;

export type MinutesSegment = {
  index: number;
  startMs: number | null;
  endMs: number | null;
  speaker: string | null;
  text: string;
};

export type MinutesMaterial = {
  minutesId: string;
  title: string | null;
  summary: string | null;
  originalText: string | null;
  segments: MinutesSegment[];
  /** 摘要成功但逐字稿未取到时的错误码，便于业务侧如实标注部分成功 */
  transcriptUnavailable: string | null;
};

export type MinutesCapabilityState = 'AVAILABLE' | 'DENIED' | 'UNSUPPORTED' | 'UNAVAILABLE';

export type MinutesCapability = {
  state: MinutesCapabilityState;
  configured: boolean;
  checkedAt: string;
  code: string | null;
};

export type MinutesFailureKind = 'DENIED' | 'NOT_FOUND' | 'UNAVAILABLE' | 'INVALID' | 'UNSUPPORTED';

/** 听记读取失败：只保留错误码，绝不携带原文、摘要或令牌 */
export class MinutesSourceError extends Error {
  constructor(
    readonly kind: MinutesFailureKind,
    readonly code: string,
  ) {
    super('听记素材读取失败');
    this.name = 'MinutesSourceError';
  }
}

export const MINUTES_SOURCE = Symbol('MINUTES_SOURCE');

export interface MinutesSource {
  capability(): Promise<MinutesCapability>;
  /**
   * @param operator ATS 操作者 ID，仅用于审计归属；钉钉侧身份由服务账号的 dws 授权决定
   */
  fetch(minutesId: string, operator: string): Promise<MinutesMaterial>;
}

/** 从听记地址解析听记 ID；非钉钉听记域名返回 null，绝不按外部链接回源 */
export function parseMinutesLink(raw: string): { minutesId: string } | null {
  const value = raw.trim();
  if (!value) return null;
  if (MINUTES_ID_PATTERN.test(value)) return { minutesId: value };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol)) return null;
  if (!MINUTES_HOSTS.has(url.hostname.toLowerCase())) return null;
  const fromPath = MINUTES_PATH_PATTERN.exec(url.pathname)?.[1];
  if (fromPath) return { minutesId: fromPath };
  for (const key of ['minutesId', 'minutes_id', 'taskUuid', 'uuid', 'id']) {
    const candidate = url.searchParams.get(key);
    if (candidate && MINUTES_ID_PATTERN.test(candidate)) return { minutesId: candidate };
  }
  return null;
}

/**
 * 钉钉听记素材读取适配器（DT-4）。
 *
 * 钉钉未向企业内部应用开放 AI 听记读取的 REST 接口，官方通道是 dws CLI 的用户授权。
 * 因此本适配器在部署机（单实例固定主机）上以服务账号执行 dws 命令：
 * - 读取基础信息与摘要：`dws minutes +detail --id <id> --artifacts basic,summary --format json`
 * - 读取完整逐字稿：`dws minutes +transcript --id <id> --format json`
 *
 * 授权凭证绑定设备，换机器或重建容器需要重新执行 `dws auth login --device`。
 * 未配置 dws 或输出结构无法识别时显式失败，业务侧保留人工录入降级，不伪造听记内容。
 */
@Injectable()
export class DingTalkMinutesClient implements MinutesSource {
  private cache: { value: MinutesCapability; expiresAt: number } | null = null;

  async capability(): Promise<MinutesCapability> {
    const checkedAt = new Date().toISOString();
    const binary = this.binary();
    if (!binary) {
      return {
        state: 'UNSUPPORTED',
        configured: false,
        checkedAt,
        code: 'MINUTES_CLI_NOT_CONFIGURED',
      };
    }
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.value;

    let value: MinutesCapability;
    try {
      // 只读预览命令：验证二进制可用且服务账号已授权，不读取任何具体听记内容
      await this.run(binary, ['minutes', '+list-mine', '--format', 'json']);
      value = { state: 'AVAILABLE', configured: true, checkedAt, code: null };
    } catch (error) {
      const failure = this.classify(error);
      value = {
        state: failure.kind === 'DENIED' ? 'DENIED' : 'UNAVAILABLE',
        configured: true,
        checkedAt,
        code: failure.code,
      };
    }
    this.cache = { value, expiresAt: Date.now() + CAPABILITY_TTL_MS };
    return value;
  }

  async fetch(minutesId: string, operator: string): Promise<MinutesMaterial> {
    if (!MINUTES_ID_PATTERN.test(minutesId)) {
      throw new MinutesSourceError('INVALID', 'MINUTES_ID_INVALID');
    }
    if (!operator) {
      throw new MinutesSourceError('DENIED', 'MINUTES_OPERATOR_REQUIRED');
    }
    const binary = this.binary();
    if (!binary) throw new MinutesSourceError('UNSUPPORTED', 'MINUTES_CLI_NOT_CONFIGURED');

    const detail = await this.run(binary, [
      'minutes', '+detail', '--id', minutesId, '--artifacts', 'basic,summary', '--format', 'json',
    ]);
    const detailData = this.data(detail);
    this.assertSameId(detailData, minutesId);
    const title = this.text(
      detailData.title ?? this.deep(detailData, ['basic', 'result', 'title']) ?? this.deep(detailData, ['basic', 'title']),
      191,
    );
    const summary = this.summary(detailData);

    let segments: MinutesSegment[] = [];
    let transcriptUnavailable: string | null = null;
    try {
      const transcript = await this.run(binary, ['minutes', '+transcript', '--id', minutesId, '--format', 'json']);
      segments = this.segments(this.data(transcript));
    } catch (error) {
      const failure = this.classify(error);
      // 逐字稿失败但摘要可读时按部分成功返回，并如实带上错误码；摘要也没有才整体失败
      if (failure.kind === 'DENIED' || failure.kind === 'NOT_FOUND' || !summary) throw failure;
      transcriptUnavailable = failure.code;
    }

    const originalText = this.originalText(detailData, segments);
    if (!summary && !originalText) {
      throw new MinutesSourceError('INVALID', 'MINUTES_EMPTY_MATERIAL');
    }
    return { minutesId, title, summary, originalText, segments, transcriptUnavailable };
  }

  private binary(): string | null {
    const value = process.env.DINGTALK_MINUTES_DWS_BIN?.trim();
    return value ? value : null;
  }

  private timeout(): number {
    const raw = Number(process.env.DINGTALK_MINUTES_DWS_TIMEOUT_MS);
    return Number.isSafeInteger(raw) && raw >= 1_000 && raw <= 300_000 ? raw : DEFAULT_TIMEOUT_MS;
  }

  private run(binary: string, args: string[]): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      execFile(
        binary,
        args,
        { timeout: this.timeout(), maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true, encoding: 'utf8' },
        (error, stdout, stderr) => {
          if (error) {
            reject(this.cliError(error, stderr));
            return;
          }
          let payload: unknown;
          try {
            payload = JSON.parse(stdout);
          } catch {
            reject(new MinutesSourceError('INVALID', 'MINUTES_CLI_INVALID_JSON'));
            return;
          }
          const record = this.asRecord(payload);
          if (!record) {
            reject(new MinutesSourceError('INVALID', 'MINUTES_CLI_INVALID_JSON'));
            return;
          }
          const envelope = this.envelopeError(record);
          if (envelope) reject(envelope);
          else resolve(record);
        },
      );
    });
  }

  private cliError(error: ExecFileException, stderr: string | undefined): MinutesSourceError {
    if (error.code === 'ENOENT') return new MinutesSourceError('UNSUPPORTED', 'MINUTES_CLI_NOT_INSTALLED');
    if (error.killed) return new MinutesSourceError('UNAVAILABLE', 'MINUTES_CLI_TIMEOUT');
    const text = stderr ?? '';
    if (DENIED_PATTERN.test(text)) return new MinutesSourceError('DENIED', 'MINUTES_CLI_DENIED');
    if (NOT_FOUND_PATTERN.test(text)) return new MinutesSourceError('NOT_FOUND', 'MINUTES_NOT_FOUND');
    const exit = typeof error.code === 'number' && Number.isInteger(error.code) ? error.code : null;
    return new MinutesSourceError('UNAVAILABLE', exit === null ? 'MINUTES_CLI_FAILED' : `MINUTES_CLI_EXIT_${String(exit)}`);
  }

  /** dws 以 success/ok=false 或 error 对象报告业务失败时，按错误码归类 */
  private envelopeError(record: Record<string, unknown>): MinutesSourceError | null {
    const failure = this.asRecord(record.error);
    const failed = record.success === false || record.ok === false || failure !== null;
    if (!failed) return null;
    const raw = failure?.code ?? record.errcode ?? record.code;
    const code = this.scalar(raw) ?? 'unknown';
    const label = SAFE_CODE_PATTERN.test(code) ? code : 'unknown';
    const message = this.scalar(failure?.message) ?? this.scalar(failure?.kind) ?? '';
    if (DENIED_PATTERN.test(label) || DENIED_PATTERN.test(message)) {
      return new MinutesSourceError('DENIED', `MINUTES_CLI_${label}`);
    }
    if (NOT_FOUND_PATTERN.test(label) || NOT_FOUND_PATTERN.test(message)) {
      return new MinutesSourceError('NOT_FOUND', 'MINUTES_NOT_FOUND');
    }
    return new MinutesSourceError('UNAVAILABLE', `MINUTES_CLI_${label}`);
  }

  /** dws 输出通常是 { success, data, meta }，兼容直接返回业务对象的情况 */
  private data(record: Record<string, unknown>): Record<string, unknown> {
    return this.asRecord(record.data) ?? record;
  }

  private assertSameId(data: Record<string, unknown>, minutesId: string) {
    const resolved = data.taskUuid ?? data.minutesId ?? data.uuid;
    if (typeof resolved === 'string' && resolved && resolved !== minutesId) {
      throw new MinutesSourceError('INVALID', 'MINUTES_ID_MISMATCH');
    }
  }

  private summary(data: Record<string, unknown>): string | null {
    const direct = this.text(data.summary, MAX_MATERIAL_CHARS);
    if (direct) return direct;
    const nested = this.asRecord(data.summary) ?? this.asRecord(this.asRecord(data.artifacts)?.summary);
    if (!nested) return null;
    return this.text(
      nested.content ?? nested.text ?? nested.markdown ?? this.deep(nested, ['result', 'fullSummary']),
      MAX_MATERIAL_CHARS,
    );
  }

  private originalText(data: Record<string, unknown>, segments: MinutesSegment[]): string | null {
    const transcript = typeof data.transcript === 'string' ? data.transcript : null;
    const direct = this.text(data.originalText ?? data.transcriptText ?? transcript ?? data.text, MAX_MATERIAL_CHARS);
    if (direct) return direct;
    if (!segments.length) return null;
    return segments
      .map((item) => (item.speaker ? `${item.speaker}：${item.text}` : item.text))
      .join('\n')
      .slice(0, MAX_MATERIAL_CHARS);
  }

  private segments(data: Record<string, unknown>): MinutesSegment[] {
    if (data.complete === false) {
      throw new MinutesSourceError('UNAVAILABLE', 'MINUTES_TRANSCRIPT_INCOMPLETE');
    }
    const container = this.asRecord(data.transcript);
    const list = SEGMENT_KEYS
      .map((key) => data[key] ?? container?.[key])
      .find((value): value is unknown[] => Array.isArray(value));
    if (!list) {
      // 输出里完全没有逐字稿容器：结构未识别，不能当成“没有发言”
      if (this.hasAnySegmentKey(data, container)) return [];
      throw new MinutesSourceError('UNSUPPORTED', 'MINUTES_TRANSCRIPT_SHAPE_UNSUPPORTED');
    }
    const rows = list.slice(0, MAX_SEGMENTS).flatMap((item, index) => {
      const record = this.asRecord(item);
      const text = this.text(record?.text ?? record?.paragraph ?? record?.content ?? record?.sentence, 20_000);
      if (!record || !text) return [];
      return [{
        index,
        startMs: this.milliseconds(record.startMs ?? record.startTime ?? record.beginTime ?? record.start),
        endMs: this.milliseconds(record.endMs ?? record.endTime ?? record.end ?? record.stop),
        speaker: this.text(
          record.speaker ?? record.speakerName ?? record.nickName ?? this.deep(record, ['speakerDisplay', 'nickName']) ?? record.name,
          191,
        ),
        text,
      }];
    });
    return this.relativeTimes(rows);
  }

  /** 逐字稿时间轴按“相对录音起点”存库；若输出给的是绝对时间则统一减去最早起点 */
  private relativeTimes(rows: MinutesSegment[]): MinutesSegment[] {
    const base = rows.reduce<number | null>((min, row) => {
      const value = row.startMs;
      if (value === null || value < ABSOLUTE_TIME_THRESHOLD) return min;
      return min === null ? value : Math.min(min, value);
    }, null);
    if (base === null) return rows;
    return rows.map((row) => ({
      ...row,
      startMs: row.startMs === null ? null : Math.max(0, row.startMs - base),
      endMs: row.endMs === null ? null : Math.max(0, row.endMs - base),
    }));
  }

  private hasAnySegmentKey(data: Record<string, unknown>, container: Record<string, unknown> | null) {
    return SEGMENT_KEYS.some((key) => key in data || (container !== null && key in container));
  }

  private classify(error: unknown): MinutesSourceError {
    return error instanceof MinutesSourceError
      ? error
      : new MinutesSourceError('UNAVAILABLE', 'MINUTES_UNKNOWN_ERROR');
  }

  private scalar(value: unknown): string | null {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return null;
  }

  private deep(record: Record<string, unknown> | null, path: readonly string[]): unknown {
    let current: unknown = record;
    for (const key of path) {
      const node = this.asRecord(current);
      if (!node) return undefined;
      current = node[key];
    }
    return current;
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private text(value: unknown, maxLength: number): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.length > maxLength) {
      throw new MinutesSourceError('INVALID', 'MINUTES_CONTENT_TOO_LARGE');
    }
    return trimmed;
  }

  private milliseconds(value: unknown): number | null {
    const number = typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+$/.test(value)
        ? Number(value)
        : Number.NaN;
    return Number.isSafeInteger(number) && number >= 0 ? number : null;
  }
}

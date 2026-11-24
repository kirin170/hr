import { Injectable } from '@nestjs/common';

/** 通用 API 客户端单请求超时（钉钉集成技术设计 §5） */
const REQUEST_TIMEOUT_MS = 8_000;
/** 只允许读取钉钉听记域名，避免把任意 URL 当作听记素材来源 */
const MINUTES_HOSTS = new Set(['shanji.dingtalk.com']);
/** 真实听记 ID 形如 <16 位以上十六进制>_<十六进制>_<十六进制>，分段之间用下划线连接 */
const MINUTES_ID_SOURCE = '[0-9a-f]{16,128}(?:_[0-9a-f]+)*';
const MINUTES_ID_PATTERN = new RegExp(`^${MINUTES_ID_SOURCE}$`, 'i');
const MINUTES_PATH_PATTERN = new RegExp(`\\/(?:transcribes?|transcriptions?|minutes)\\/(${MINUTES_ID_SOURCE})(?:\\/|$)`, 'i');
const PERMISSION_CODES = new Set(['403', '401', 'Forbidden', 'Forbidden.AccessDenied', 'noPermission', 'MINUTES_ACCESS_DENIED']);
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
/** 单条听记素材上限，避免异常响应把数据库写满 */
const MAX_MATERIAL_CHARS = 2_000_000;
const MAX_SEGMENTS = 20_000;

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
  fetch(minutesId: string, operatorUserId: string): Promise<MinutesMaterial>;
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
 * 钉钉当前未向企业内部应用开放听记读取 REST 接口，官方通道是 CLI/MCP 的用户授权。
 * 因此本适配器对接部署环境注入的听记网关（`DINGTALK_MINUTES_GATEWAY_URL`），
 * 网关负责在租户侧按操作者权限读取原文/摘要；未配置网关时显式返回 UNSUPPORTED，
 * 业务侧保留人工录入降级，不伪造听记内容。
 */
@Injectable()
export class DingTalkMinutesClient implements MinutesSource {
  async capability(): Promise<MinutesCapability> {
    const checkedAt = new Date().toISOString();
    const config = this.configuration();
    if (!config) {
      return {
        state: 'UNSUPPORTED',
        configured: false,
        checkedAt,
        code: 'MINUTES_GATEWAY_NOT_CONFIGURED',
      };
    }
    try {
      await this.request(`${config.base}/v1/minutes/capability`, config, { method: 'GET' });
      return { state: 'AVAILABLE', configured: true, checkedAt, code: null };
    } catch (error) {
      const failure = this.classify(error);
      return {
        state: failure.kind === 'DENIED' ? 'DENIED' : 'UNAVAILABLE',
        configured: true,
        checkedAt,
        code: failure.code,
      };
    }
  }

  async fetch(minutesId: string, operatorUserId: string): Promise<MinutesMaterial> {
    if (!MINUTES_ID_PATTERN.test(minutesId)) {
      throw new MinutesSourceError('INVALID', 'MINUTES_ID_INVALID');
    }
    if (!operatorUserId) {
      throw new MinutesSourceError('DENIED', 'MINUTES_OPERATOR_REQUIRED');
    }
    const config = this.configuration();
    if (!config) throw new MinutesSourceError('UNSUPPORTED', 'MINUTES_GATEWAY_NOT_CONFIGURED');
    const payload = await this.request(`${config.base}/v1/minutes/transcripts`, config, {
      method: 'POST',
      body: JSON.stringify({ minutesId, operatorUserId }),
    });
    return this.normalize(payload, minutesId);
  }

  private configuration(): { base: string; token: string } | null {
    const base = process.env.DINGTALK_MINUTES_GATEWAY_URL?.trim();
    const token = process.env.DINGTALK_MINUTES_GATEWAY_TOKEN?.trim();
    if (!base || !token) return null;
    try {
      const url = new URL(base);
      if (!['http:', 'https:'].includes(url.protocol)) return null;
      if (url.protocol === 'http:' && process.env.APP_ENV !== 'local') return null;
      return { base: base.replace(/\/+$/, ''), token };
    } catch {
      return null;
    }
  }

  private async request(
    url: string,
    config: { token: string },
    init: { method: string; body?: string },
  ): Promise<unknown> {
    let lastError: MinutesSourceError | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await this.send(url, config, init);
      } catch (error) {
        const failure = this.classify(error);
        if (failure.kind !== 'UNAVAILABLE' || attempt === 1) throw failure;
        lastError = failure;
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    }
    throw lastError ?? new MinutesSourceError('UNAVAILABLE', 'MINUTES_REQUEST_FAILED');
  }

  private async send(
    url: string,
    config: { token: string },
    init: { method: string; body?: string },
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: init.method,
        headers: {
          authorization: `Bearer ${config.token}`,
          ...(init.body ? { 'content-type': 'application/json' } : {}),
        },
        body: init.body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new MinutesSourceError('UNAVAILABLE', 'MINUTES_NETWORK_ERROR');
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new MinutesSourceError('DENIED', `MINUTES_HTTP_${response.status}`);
      }
      if (response.status === 404) {
        throw new MinutesSourceError('NOT_FOUND', 'MINUTES_NOT_FOUND');
      }
      throw new MinutesSourceError(
        RETRYABLE_STATUS.has(response.status) || response.status >= 500 ? 'UNAVAILABLE' : 'INVALID',
        `MINUTES_HTTP_${response.status}`,
      );
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new MinutesSourceError('INVALID', 'MINUTES_INVALID_JSON');
    }
    const record = this.asRecord(payload);
    if (!record) throw new MinutesSourceError('INVALID', 'MINUTES_INVALID_RESPONSE');
    const code = record.errcode === undefined ? null : this.errorCode(record.errcode);
    if (code && code !== '0') {
      throw new MinutesSourceError(
        PERMISSION_CODES.has(code) ? 'DENIED' : 'UNAVAILABLE',
        `MINUTES_ERRCODE_${code}`,
      );
    }
    return record;
  }

  private normalize(payload: unknown, minutesId: string): MinutesMaterial {
    const record = this.asRecord(payload);
    if (!record) throw new MinutesSourceError('INVALID', 'MINUTES_INVALID_RESPONSE');
    const resolvedId = typeof record.minutesId === 'string' && record.minutesId ? record.minutesId : minutesId;
    if (resolvedId !== minutesId) {
      throw new MinutesSourceError('INVALID', 'MINUTES_ID_MISMATCH');
    }
    const title = this.text(record.title, 191);
    const summary = this.text(record.summary, MAX_MATERIAL_CHARS);
    const originalText = this.text(record.originalText, MAX_MATERIAL_CHARS);
    if (!summary && !originalText) {
      throw new MinutesSourceError('INVALID', 'MINUTES_EMPTY_MATERIAL');
    }
    const segments = this.segments(record.segments);
    return { minutesId, title, summary, originalText, segments };
  }

  private segments(value: unknown): MinutesSegment[] {
    if (!Array.isArray(value)) return [];
    return value.slice(0, MAX_SEGMENTS).flatMap((item, index) => {
      const record = this.asRecord(item);
      const text = this.text(record?.text, 20_000);
      if (!record || !text) return [];
      return [{
        index,
        startMs: this.milliseconds(record.startMs ?? record.startTime),
        endMs: this.milliseconds(record.endMs ?? record.endTime),
        speaker: this.text(record.speaker, 191),
        text,
      }];
    });
  }

  private classify(error: unknown): MinutesSourceError {
    return error instanceof MinutesSourceError
      ? error
      : new MinutesSourceError('UNAVAILABLE', 'MINUTES_UNKNOWN_ERROR');
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

  private errorCode(value: unknown): string {
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : 'invalid_error_code';
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

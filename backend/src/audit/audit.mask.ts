import type { Prisma } from '@prisma/client';

/**
 * 审计脱敏（ATS-024 / PRD §9.2）：凭据不进入审计内容，联系方式在查询与导出时脱敏。
 * 该规则只作用于审计摘要，不改变业务数据本身。
 */
const SECRET_KEY =
  /pass(word|wd)?|secret|token|cipher|credential|authorization|cookie|pepper|api[_-]?key|private[_-]?key|session[_-]?id/i;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const MAINLAND_PHONE = /(?<!\d)(1[3-9]\d)(\d{4})(\d{4})(?!\d)/g;

const MAX_DEPTH = 4;
const MAX_ITEMS = 50;
const MAX_TEXT = 200;

/** 邮箱保留首字符与域名，手机号保留前三位与后四位。 */
export function maskText(text: string): string {
  return text
    .replace(EMAIL, (matched) => {
      const at = matched.indexOf('@');
      return `${matched.slice(0, 1)}***${matched.slice(at)}`;
    })
    .replace(MAINLAND_PHONE, '$1****$3');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function truncate(text: string): string {
  const masked = maskText(text);
  return masked.length > MAX_TEXT ? `${masked.slice(0, MAX_TEXT)}…` : masked;
}

/**
 * 写入审计前整理变更内容：丢弃凭据类键、脱敏联系方式、限制深度与长度。
 * 始终返回可落库的 JSON 值；空对象返回 undefined 以便省略。
 */
export function sanitizeForAudit(value: unknown, depth = 0): Prisma.InputJsonValue | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return truncate(value);
  if (typeof value === 'number' || typeof value === 'boolean') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value !== 'object') return undefined;
  if (depth >= MAX_DEPTH) return undefined;

  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_ITEMS)
      .map((item) => sanitizeForAudit(item, depth + 1))
      .filter((item): item is Prisma.InputJsonValue => item !== undefined);
    return items.length ? items : undefined;
  }

  const output: Record<string, Prisma.InputJsonValue> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, MAX_ITEMS)) {
    if (SECRET_KEY.test(key)) continue;
    const safe = sanitizeForAudit(item, depth + 1);
    if (safe !== undefined) output[key] = safe;
  }
  return Object.keys(output).length ? output : undefined;
}

/** 读取/导出审计时再脱敏一次：兼容 ATS-024 之前写入的历史摘要。 */
export function maskAuditValue(value: unknown): unknown {
  if (typeof value === 'string') return maskText(value);
  if (Array.isArray(value)) return value.map(maskAuditValue);
  if (!isPlainObject(value)) return value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = SECRET_KEY.test(key) ? '***' : maskAuditValue(item);
  }
  return output;
}

export function hasSecretKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasSecretKey);
  if (!isPlainObject(value)) return false;
  return Object.entries(value).some(
    ([key, item]) => SECRET_KEY.test(key) || hasSecretKey(item),
  );
}

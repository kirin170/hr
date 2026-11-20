/**
 * 浏览器导入 API 契约（ATS-010 / FR-EXT-6、7、9，PRD §5.12）。
 *
 * 契约冻结原则：
 * - 导入入口统一返回 202 + 任务资源，不在请求内完成解析；
 * - 同一操作者同一 requestId 幂等，重放返回同一任务；
 * - 任务只对所有者与其可见职位可见；
 * - 来源页面 URL 只保留协议与主机，路径/查询串/片段一律丢弃；
 * - 附件必须走字节上传，URL 下载不进入服务端；
 * - 第三方平台凭据一律不落库，出现即拒绝。
 */

/** 标准错误码：扩展端按 code 分支，文案可本地化 */
export const BROWSER_IMPORT_ERROR = {
  /** 缺少或无效的短期系统令牌 */
  TOKEN_INVALID: 'TOKEN_INVALID',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  /** 令牌无权代表该操作者 */
  TOKEN_OWNER_MISMATCH: 'TOKEN_OWNER_MISMATCH',
  /** requestId 缺失或格式非法 */
  REQUEST_ID_REQUIRED: 'REQUEST_ID_REQUIRED',
  /** 来源站点不在支持范围 */
  SOURCE_SITE_UNSUPPORTED: 'SOURCE_SITE_UNSUPPORTED',
  /** 来源页面 URL 非法或含不可接受的协议 */
  SOURCE_URL_INVALID: 'SOURCE_URL_INVALID',
  /** 请求携带第三方平台凭据或 Cookie */
  THIRD_PARTY_CREDENTIAL_REJECTED: 'THIRD_PARTY_CREDENTIAL_REJECTED',
  /** 既无附件字节也无页面结构化数据 */
  PAYLOAD_REQUIRED: 'PAYLOAD_REQUIRED',
  /** 附件不可用：未上传字节 / 内容为空 / 传输中断 */
  ATTACHMENT_UNAVAILABLE: 'ATTACHMENT_UNAVAILABLE',
  /** 附件格式或大小不合规，沿用统一上传校验的错误码 */
  ATTACHMENT_INVALID: 'ATTACHMENT_INVALID',
  /** 目标职位不存在或无权访问 */
  JOB_NOT_FOUND: 'JOB_NOT_FOUND',
  /** 任务不存在或不属于当前操作者（对外统一为 NOT_FOUND，避免探测） */
  TASK_NOT_FOUND: 'TASK_NOT_FOUND',
} as const;

export type BrowserImportErrorCode =
  (typeof BROWSER_IMPORT_ERROR)[keyof typeof BROWSER_IMPORT_ERROR];

/** 任务状态：与 BrowserImportStatus 枚举同值，避免扩展端依赖前端语言枚举 */
export const BROWSER_IMPORT_STATUS = {
  RECEIVED: 'RECEIVED',
  PARSING: 'PARSING',
  SUCCESS: 'SUCCESS',
  DUPLICATE: 'DUPLICATE',
  FAILED: 'FAILED',
} as const;

/** 失败阶段：定位任务在哪一步中断 */
export const BROWSER_IMPORT_STAGE = {
  VALIDATE: 'VALIDATE',
  UPLOAD: 'UPLOAD',
  PARSE: 'PARSE',
  CONFIRM: 'CONFIRM',
} as const;

export type BrowserImportStage =
  (typeof BROWSER_IMPORT_STAGE)[keyof typeof BROWSER_IMPORT_STAGE];

/** 已支持的来源站点；未列入的站点必须显式新增并补脱敏样本 */
export const SUPPORTED_SOURCE_SITES = new Set(['BOSS_ZHIPIN', 'LIEPIN', 'OTHER']);

/** 页面结构化数据中允许的字段，其余一律丢弃（不信任扩展端任意字段） */
export const ALLOWED_PAGE_FIELDS = new Set([
  'name',
  'phone',
  'email',
  'currentCompany',
  'currentTitle',
  'education',
  'school',
  'experience',
  'expectedCity',
  'summary',
]);

/** 凭据类字段名（不区分大小写）：出现即拒绝，且绝不落库 */
export const CREDENTIAL_FIELD_PATTERNS = [
  /cookie/i,
  /authorization/i,
  /access[_-]?token/i,
  /refresh[_-]?token/i,
  /session[_-]?id/i,
  /csrf/i,
  /x[_-]?srf/i,
  /password/i,
  /secret/i,
] as const;

/** 查询串中不应落库的敏感参数名 */
export const SENSITIVE_QUERY_PARAMS = [
  'token',
  'access_token',
  'refresh_token',
  'sig',
  'signature',
  'key',
  'auth',
  'session',
  'code',
] as const;

export interface BrowserImportRequest {
  requestId?: string;
  sourceSite?: string;
  sourceCandidateId?: string;
  sourcePageUrl?: string;
  targetJobId?: string;
  pagePayload?: Record<string, unknown>;
}

/** 任务查询返回体：不含页面原 URL、不含平台凭据 */
export interface BrowserImportTaskView {
  taskId: string;
  requestId: string;
  status: string;
  sourceSite: string;
  sourceCandidateId: string | null;
  sourcePageHost: string | null;
  targetJobId: string | null;
  fileName: string | null;
  fileHash: string | null;
  candidateId: string | null;
  duplicateOfCandidateId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  errorStage: string | null;
  createdAt: string;
  completedAt: string | null;
}

/**
 * 来源页面脱敏：只保留协议 + 主机（端口保留），其余全部丢弃。
 * 非 http/https 协议、非法 URL、缺失一律返回 null 并标记 invalid。
 */
export function sanitizeSourcePageUrl(value?: string | null): {
  host: string | null;
  invalid: boolean;
} {
  const raw = value?.trim();
  if (!raw) return { host: null, invalid: false };
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { host: null, invalid: true };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { host: null, invalid: true };
  }
  return { host: parsed.origin, invalid: false };
}

/** 深度扫描请求体中是否出现凭据类字段名 */
export function containsCredentialField(value: unknown, depth = 0): boolean {
  if (depth > 6 || value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) {
    return value.some((item) => containsCredentialField(item, depth + 1));
  }
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => {
    if (CREDENTIAL_FIELD_PATTERNS.some((pattern) => pattern.test(key))) return true;
    return containsCredentialField(child, depth + 1);
  });
}

/** 页面结构化数据只保留白名单字段，并按字符串截断 */
export function pickPagePayload(
  payload: Record<string, unknown> | undefined,
  maxLength = 500,
): Record<string, string> {
  if (!payload || typeof payload !== 'object') return {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!ALLOWED_PAGE_FIELDS.has(key)) continue;
    if (typeof value !== 'string') continue;
    const text = value.trim().slice(0, maxLength);
    if (text) result[key] = text;
  }
  return result;
}

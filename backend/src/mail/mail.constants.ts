/** 邮箱渠道常量（ATS-022 / FR-ENT-1、FR-ENT-10） */

export const MAIL_PROVIDER = {
  /** 历史模拟配置，不参与真实轮询 */
  MOCK: 'MOCK',
  /** 真实 IMAP 轮询 */
  IMAP: 'IMAP',
} as const;

export type MailProvider = (typeof MAIL_PROVIDER)[keyof typeof MAIL_PROVIDER];

/** 单封邮件的处理结论，用于抓取监控与断点恢复排查 */
export const MAIL_OUTCOME = {
  /** 已登记、处理中：进程中断会留下该状态，重启后可见并可人工重放 */
  PROCESSING: 'PROCESSING',
  /** 已建档（含部分附件被拒绝的情况，详见 detail） */
  INGESTED: 'INGESTED',
  /** 附件哈希命中既有简历，按查重跳过 */
  DUPLICATE: 'DUPLICATE',
  /** 无附件，不建简历 */
  NO_ATTACHMENT: 'NO_ATTACHMENT',
  /** 附件格式不在本期解析范围 */
  UNSUPPORTED: 'UNSUPPORTED',
  /** 含 Excel 附件：走独立表格导入，不进 AI 解析 */
  EXCEL: 'EXCEL',
  /** 解析或入库异常，转人工 */
  ERROR: 'ERROR',
} as const;

export type MailOutcome = (typeof MAIL_OUTCOME)[keyof typeof MAIL_OUTCOME];

/** PDF / Word / 图片：走统一 AI 解析（PRD §6.4） */
export const EMAIL_RESUME_EXTENSIONS = new Set([
  '.pdf',
  '.doc',
  '.docx',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
]);

/** Excel：独立表格导入，不进入 AI 解析管道 */
export const EMAIL_EXCEL_EXTENSIONS = new Set(['.xls', '.xlsx', '.csv']);

/** 邮件容器：解包后再分流，避免 BOSS/猎聘等渠道的 .eml 被误判为格式不支持 */
export const EMAIL_WRAPPER_EXTENSIONS = new Set(['.eml']);

/** 解包嵌套邮件的最大层数，防止恶意/异常邮件无限递归 */
export const EMAIL_WRAPPER_MAX_DEPTH = 2;

export const DEFAULT_POLL_INTERVAL_SECONDS = 300;
export const MIN_POLL_INTERVAL_SECONDS = 30;
export const MAX_POLL_INTERVAL_SECONDS = 86_400;

/** 首次抓取（无游标）时回看的最大邮件数，避免一次性拉取整个邮箱 */
export const FIRST_POLL_MAX_MESSAGES = 20;

/** 自动抓取使用的系统身份：不可登录，仅用于审计归属与数据范围判定 */
export const MAIL_SYSTEM_EMPLOYEE_NO = 'SYSTEM-INGEST';
export const MAIL_SYSTEM_ROLE_CODE = 'SYSTEM_INTEGRATION';
export const MAIL_SYSTEM_ROLE_NAME = '邮箱抓取机器人';
export const MAIL_SYSTEM_PERMISSIONS = [
  'intake:read',
  'intake:manage',
  'candidate:read',
  'candidate:create',
  'ai:read',
] as const;

/** 业务来源（PRD §3.2 Candidate.source） */
export const INTAKE_SOURCE = {
  JOB_BOARD: 'JOB_BOARD',
  CAMPUS: 'CAMPUS',
  REFERRAL: 'REFERRAL',
  EMAIL: 'EMAIL',
  UPLOAD: 'UPLOAD',
  MANUAL: 'MANUAL',
} as const;

/** 进入方式（PRD §3.2 Candidate.entryMode，稳定 key） */
export const ENTRY_MODE = {
  APPLICATION: 'APPLICATION',
  EMAIL_AUTO: 'EMAIL_AUTO',
  BATCH_UPLOAD: 'BATCH_UPLOAD',
  SINGLE_UPLOAD: 'SINGLE_UPLOAD',
  MANUAL: 'MANUAL',
  BROWSER_EXTENSION: 'BROWSER_EXTENSION',
} as const;

export type IntakeSource = (typeof INTAKE_SOURCE)[keyof typeof INTAKE_SOURCE];
export type EntryMode = (typeof ENTRY_MODE)[keyof typeof ENTRY_MODE];

export const ALLOWED_SOURCES = new Set<string>(Object.values(INTAKE_SOURCE));
export const ALLOWED_ENTRY_MODES = new Set<string>(Object.values(ENTRY_MODE));

/** 本期解析范围：PDF / Word / 图片（PRD §6.4） */
export const ALLOWED_RESUME_EXTENSIONS = new Set([
  '.pdf',
  '.doc',
  '.docx',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
]);

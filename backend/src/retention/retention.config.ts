import { SensitiveField } from '@prisma/client';

/**
 * 附件保留期限配置（NFR-2 / 技术设计 §13.2）。
 * 具体天数仍待业务确认，先以可配置默认值运行，上线前必须复核。
 */
export const DEFAULT_RETENTION_RESUME_DAYS = 365;
export const DEFAULT_RETENTION_SENSITIVE_DAYS = 180;
export const DEFAULT_RETENTION_BATCH_SIZE = 200;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RetentionPolicy {
  resumeDays: number;
  sensitiveDays: number;
  batchSize: number;
}

export function loadRetentionPolicy(env: NodeJS.ProcessEnv = process.env): RetentionPolicy {
  return {
    resumeDays: positiveInt(env.RETENTION_RESUME_DAYS, DEFAULT_RETENTION_RESUME_DAYS),
    sensitiveDays: positiveInt(
      env.RETENTION_SENSITIVE_DAYS,
      DEFAULT_RETENTION_SENSITIVE_DAYS,
    ),
    batchSize: positiveInt(env.RETENTION_BATCH_SIZE, DEFAULT_RETENTION_BATCH_SIZE),
  };
}

/** 敏感材料（背调、流水）使用更短的独立保留期限。 */
export function retentionDaysFor(
  category: SensitiveField | null | undefined,
  policy: RetentionPolicy = loadRetentionPolicy(),
): number {
  if (category === SensitiveField.BACKGROUND_MATERIALS || category === SensitiveField.BANK_STATEMENTS) {
    return policy.sensitiveDays;
  }
  return policy.resumeDays;
}

export function expiryFor(
  createdAt: Date,
  category: SensitiveField | null | undefined,
  policy: RetentionPolicy = loadRetentionPolicy(),
): Date {
  return new Date(createdAt.getTime() + retentionDaysFor(category, policy) * DAY_MS);
}

/** 到期判定：写入时记录的 expiresAt 与当前配置的较短者生效，配置收紧立即生效。 */
export function isExpired(
  file: {
    createdAt: Date;
    expiresAt: Date | null;
    category: SensitiveField | null;
  },
  now: Date,
  policy: RetentionPolicy = loadRetentionPolicy(),
): boolean {
  const configured = expiryFor(file.createdAt, file.category, policy);
  const due = file.expiresAt && file.expiresAt < configured ? file.expiresAt : configured;
  return due.getTime() <= now.getTime();
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

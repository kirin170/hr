import { extname } from 'node:path';
import { ALLOWED_RESUME_EXTENSIONS } from './intake.constants.js';

/** 邮箱规范化：去空格、统一小写（PRD §6.4 查重口径） */
export function normalizeEmail(email?: string | null): string | null {
  const value = email?.trim().toLowerCase();
  return value ? value : null;
}

/** 手机号规范化：只保留数字，去掉 +86 / 86 前缀 */
export function normalizePhone(phone?: string | null): string | null {
  if (!phone) {
    return null;
  }
  const digits = phone.replace(/\D/g, '');
  if (!digits) {
    return null;
  }
  return digits.length === 13 && digits.startsWith('86')
    ? digits.slice(2)
    : digits;
}

export function isSupportedResumeFile(fileName: string): boolean {
  return ALLOWED_RESUME_EXTENSIONS.has(extname(fileName).toLowerCase());
}

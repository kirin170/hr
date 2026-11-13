import { describe, expect, it } from 'vitest';
import {
  isSupportedResumeFile,
  normalizeEmail,
  normalizePhone,
} from './dedup.util.js';

describe('normalizePhone', () => {
  it('keeps digits only and strips the +86 prefix', () => {
    expect(normalizePhone('+86 138-0000-0001')).toBe('13800000001');
    expect(normalizePhone('8613800000001')).toBe('13800000001');
    expect(normalizePhone('138 0000 0001')).toBe('13800000001');
  });

  it('returns null when no digits are present', () => {
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone('---')).toBeNull();
  });
});

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  ZhangSan@Example.COM ')).toBe(
      'zhangsan@example.com',
    );
  });

  it('returns null for empty input', () => {
    expect(normalizeEmail(undefined)).toBeNull();
    expect(normalizeEmail('   ')).toBeNull();
  });
});

describe('isSupportedResumeFile', () => {
  it('accepts PDF, Word and image resumes', () => {
    expect(isSupportedResumeFile('简历.pdf')).toBe(true);
    expect(isSupportedResumeFile('RESUME.DOCX')).toBe(true);
    expect(isSupportedResumeFile('photo.jpeg')).toBe(true);
  });

  it('rejects Excel and unknown formats', () => {
    expect(isSupportedResumeFile('batch.xlsx')).toBe(false);
    expect(isSupportedResumeFile('notes.txt')).toBe(false);
  });
});

import { extname } from 'node:path';

/**
 * 统一上传校验（NFR-11 / 技术设计 §8.1/§13.3）：
 * 扩展名、声明 MIME 与文件头三者一致才允许入库，不信任浏览器声明。
 */
export const UPLOAD_ERROR = {
  EMPTY_FILE: 'EMPTY_FILE',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  UNSUPPORTED_FORMAT: 'UNSUPPORTED_FORMAT',
  MIME_MISMATCH: 'MIME_MISMATCH',
  CONTENT_MISMATCH: 'CONTENT_MISMATCH',
} as const;

export type UploadErrorCode = (typeof UPLOAD_ERROR)[keyof typeof UPLOAD_ERROR];

export type DetectedFileKind = 'pdf' | 'doc' | 'docx' | 'png' | 'jpg' | 'webp';

export interface UploadCandidate {
  fileName: string;
  mimeType?: string | null;
  size?: number;
  buffer: Buffer;
}

export interface UploadLimits {
  maxBytes: number;
  allowedExtensions: ReadonlySet<string>;
  allowedKinds?: ReadonlySet<DetectedFileKind>;
}

export type UploadValidationResult =
  | {
      ok: true;
      extension: string;
      kind: DetectedFileKind;
      mimeType: string;
      size: number;
    }
  | {
      ok: false;
      code: UploadErrorCode;
      message: string;
    };

const KIND_BY_EXTENSION: Record<string, DetectedFileKind> = {
  '.pdf': 'pdf',
  '.doc': 'doc',
  '.docx': 'docx',
  '.png': 'png',
  '.jpg': 'jpg',
  '.jpeg': 'jpg',
  '.webp': 'webp',
};

const OCTET_STREAM = 'application/octet-stream';

const ALLOWED_MIME_BY_KIND: Record<DetectedFileKind, ReadonlySet<string>> = {
  pdf: new Set(['application/pdf', OCTET_STREAM]),
  doc: new Set(['application/msword', 'application/x-msword', OCTET_STREAM]),
  docx: new Set([
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/zip',
    'application/x-zip-compressed',
    OCTET_STREAM,
  ]),
  png: new Set(['image/png', OCTET_STREAM]),
  jpg: new Set(['image/jpeg', 'image/jpg', OCTET_STREAM]),
  webp: new Set(['image/webp', OCTET_STREAM]),
};

const DEFAULT_RESUME_MAX_MB = 20;

export function resumeMaxBytes(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.RESUME_MAX_MB ?? DEFAULT_RESUME_MAX_MB);
  const maxMb = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RESUME_MAX_MB;
  return Math.floor(maxMb * 1024 * 1024);
}

export function normalizeMimeType(mimeType?: string | null): string {
  const value = (mimeType ?? '').split(';')[0]?.trim().toLowerCase();
  return value || OCTET_STREAM;
}

export function detectFileKind(buffer: Buffer): DetectedFileKind | null {
  if (startsWith(buffer, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'pdf';
  if (startsWith(buffer, [0x50, 0x4b, 0x03, 0x04])) return 'docx';
  if (startsWith(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'doc';
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return 'jpg';
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buffer.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

export function validateUpload(
  file: UploadCandidate,
  limits: UploadLimits,
): UploadValidationResult {
  const size = file.buffer?.length ?? 0;
  if (size === 0) {
    return reject(UPLOAD_ERROR.EMPTY_FILE, `文件 ${file.fileName} 内容为空`);
  }
  if (size > limits.maxBytes) {
    const limitMb = Math.round((limits.maxBytes / (1024 * 1024)) * 10) / 10;
    return reject(
      UPLOAD_ERROR.FILE_TOO_LARGE,
      `文件 ${file.fileName} 超过大小上限 ${limitMb} MB`,
    );
  }

  const extension = extname(file.fileName ?? '').toLowerCase();
  if (!extension || !limits.allowedExtensions.has(extension)) {
    return reject(UPLOAD_ERROR.UNSUPPORTED_FORMAT, `不支持的文件类型: ${file.fileName}`);
  }
  const kind = KIND_BY_EXTENSION[extension];
  if (!kind || (limits.allowedKinds && !limits.allowedKinds.has(kind))) {
    return reject(UPLOAD_ERROR.UNSUPPORTED_FORMAT, `不支持的文件类型: ${file.fileName}`);
  }

  const mimeType = normalizeMimeType(file.mimeType);
  if (!ALLOWED_MIME_BY_KIND[kind].has(mimeType)) {
    return reject(
      UPLOAD_ERROR.MIME_MISMATCH,
      `文件 ${file.fileName} 声明的类型 ${mimeType} 与扩展名不符`,
    );
  }

  const detected = detectFileKind(file.buffer);
  if (!detected) {
    return reject(UPLOAD_ERROR.CONTENT_MISMATCH, `无法识别文件 ${file.fileName} 的内容类型`);
  }
  if (detected !== kind) {
    return reject(
      UPLOAD_ERROR.CONTENT_MISMATCH,
      `文件 ${file.fileName} 的实际内容与扩展名不符（识别为 ${detected}）`,
    );
  }

  return { ok: true, extension, kind, mimeType, size };
}

function startsWith(buffer: Buffer, signature: number[]): boolean {
  if (buffer.length < signature.length) return false;
  return signature.every((byte, index) => buffer[index] === byte);
}

function reject(code: UploadErrorCode, message: string): UploadValidationResult {
  return { ok: false, code, message };
}

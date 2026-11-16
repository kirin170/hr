/** 附件存储统一接口（技术设计 §8.1）：上传、私有读、删除、存在性检查。 */

export interface StoragePutInput {
  key: string;
  body: Buffer;
  contentType: string;
}

export interface StorageReadUrlInput {
  key: string;
  ttlSeconds: number;
  /** 签发对象；本地签名驱动会把它绑定进签名，对象存储驱动忽略。 */
  actorId?: string | null;
}

export interface StorageReadUrl {
  url: string;
  expiresAt: Date;
}

export interface SignedReadRequest {
  key: string;
  expires: number;
  actorId: string | null;
  signature: string;
}

export interface StorageDriver {
  readonly name: string;
  /** 是否由本服务校验签名并回源读取（本地磁盘开发驱动）。 */
  readonly supportsSignedReadVerification: boolean;
  put(input: StoragePutInput): Promise<void>;
  createReadUrl(input: StorageReadUrlInput): Promise<StorageReadUrl>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  read(key: string): Promise<Buffer>;
  verifyReadRequest?(request: SignedReadRequest, now?: Date): boolean;
}

/** 存储 key 统一格式：resumes/<sha256><ext>，便于按前缀做生命周期清理。 */
export const RESUME_STORAGE_PREFIX = 'resumes';

const STORAGE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,255}$/;

export function buildResumeStorageKey(sha256: string, extension: string): string {
  const normalized = extension.startsWith('.') ? extension : `.${extension}`;
  return `${RESUME_STORAGE_PREFIX}/${sha256}${normalized.toLowerCase()}`;
}

export function isSafeStorageKey(key: string): boolean {
  return (
    STORAGE_KEY_PATTERN.test(key) &&
    !key.includes('..') &&
    !key.startsWith('/') &&
    !key.includes('\\')
  );
}

import { Injectable, Logger } from '@nestjs/common';
import OSS from 'ali-oss';
import type {
  StorageDriver,
  StoragePutInput,
  StorageReadUrl,
  StorageReadUrlInput,
} from './storage.types.js';

export interface OssStorageOptions {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  accessKeySecret: string;
  internal: boolean;
  secure: boolean;
}

export function ossStorageOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): OssStorageOptions {
  const bucket = env.OSS_BUCKET?.trim();
  const region = env.OSS_REGION?.trim();
  const accessKeyId = env.OSS_ACCESS_KEY_ID?.trim();
  const accessKeySecret = env.OSS_ACCESS_KEY_SECRET?.trim();
  const missing = [
    ['OSS_BUCKET', bucket],
    ['OSS_REGION', region],
    ['OSS_ACCESS_KEY_ID', accessKeyId],
    ['OSS_ACCESS_KEY_SECRET', accessKeySecret],
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length) {
    throw new Error(`OSS 存储驱动缺少环境变量: ${missing.join(', ')}`);
  }
  return {
    bucket: bucket!,
    region: region!,
    endpoint: env.OSS_ENDPOINT?.trim() || undefined,
    accessKeyId: accessKeyId!,
    accessKeySecret: accessKeySecret!,
    internal: env.OSS_INTERNAL === 'true',
    secure: env.OSS_SECURE !== 'false',
  };
}

/**
 * 测试与生产环境的阿里云 OSS 驱动（技术设计 §8.1/§13.2）。
 * Bucket 私有：读操作只返回短期签名 URL，不生成公开链接。
 */
@Injectable()
export class OssStorageDriver implements StorageDriver {
  readonly name = 'oss';
  readonly supportsSignedReadVerification = false;
  private readonly logger = new Logger(OssStorageDriver.name);
  private readonly client: OSS;

  constructor(options: OssStorageOptions = ossStorageOptionsFromEnv()) {
    this.client = new OSS({
      bucket: options.bucket,
      region: options.region,
      endpoint: options.endpoint,
      accessKeyId: options.accessKeyId,
      accessKeySecret: options.accessKeySecret,
      internal: options.internal,
      secure: options.secure,
    });
  }

  async put(input: StoragePutInput): Promise<void> {
    await this.client.put(input.key, input.body, {
      mime: input.contentType,
      headers: { 'x-oss-object-acl': 'private' },
    });
  }

  async createReadUrl(input: StorageReadUrlInput): Promise<StorageReadUrl> {
    const ttlSeconds = Math.max(1, Math.floor(input.ttlSeconds));
    const url = this.client.signatureUrl(input.key, { expires: ttlSeconds });
    return { url, expiresAt: new Date(Date.now() + ttlSeconds * 1000) };
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.delete(key);
    } catch (error) {
      if (this.isNotFound(error)) {
        this.logger.debug(`Object ${key} already absent`);
        return;
      }
      throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.head(key);
      return true;
    } catch (error) {
      if (this.isNotFound(error)) return false;
      throw error;
    }
  }

  async read(key: string): Promise<Buffer> {
    const result = await this.client.get(key);
    return Buffer.isBuffer(result.content) ? result.content : Buffer.from(result.content);
  }

  private isNotFound(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const status = (error as { status?: number }).status;
    const code = (error as { code?: string }).code;
    return status === 404 || code === 'NoSuchKey';
  }
}

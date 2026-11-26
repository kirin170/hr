import { Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type {
  SignedReadRequest,
  StorageDriver,
  StoragePutInput,
  StorageReadUrl,
  StorageReadUrlInput,
} from './storage.types.js';
import { isSafeStorageKey } from './storage.types.js';

export const LOCAL_SIGNED_READ_PATH = '/api/v1/attachments/content';

export interface LocalStorageOptions {
  baseDir: string;
  signingSecret: string;
  publicBaseUrl: string;
}

const DEV_SIGNING_SECRET = 'local-dev-only-attachment-signing-secret';

export function localStorageOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): LocalStorageOptions {
  const baseDir = resolve(env.LOCAL_STORAGE_DIR ?? '.storage');
  const secret = env.STORAGE_SIGNING_SECRET?.trim() || env.JWT_ACCESS_SECRET?.trim();
  const isLocal = env.APP_ENV === 'local';
  if (!isLocal && (!secret || Buffer.byteLength(secret) < 32)) {
    throw new Error('STORAGE_SIGNING_SECRET 未配置或长度不足 32 字节：非本地环境必须提供附件签名密钥');
  }
  const port = env.APP_PORT ?? env.PORT ?? '3000';
  const publicBaseUrl = (env.API_BASE_URL?.trim() || `http://127.0.0.1:${port}`).replace(
    /\/+$/,
    '',
  );
  return { baseDir, signingSecret: secret || DEV_SIGNING_SECRET, publicBaseUrl };
}

/**
 * 开发环境本地磁盘驱动（技术设计 §8.1）。
 * 目录不在 Git 跟踪范围内；读取只通过短期签名链接，不暴露静态目录。
 */
@Injectable()
export class LocalStorageDriver implements StorageDriver {
  readonly name = 'local';
  readonly supportsSignedReadVerification = true;
  private readonly logger = new Logger(LocalStorageDriver.name);
  private readonly options: LocalStorageOptions;

  constructor(options: LocalStorageOptions = localStorageOptionsFromEnv()) {
    this.options = options;
  }

  async put(input: StoragePutInput): Promise<void> {
    const target = this.resolvePath(input.key);
    await mkdir(dirname(target), { recursive: true });
    try {
      await writeFile(target, input.body, { flag: 'wx' });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') {
        throw error;
      }
      this.logger.debug(`Reuse stored object ${input.key}`);
    }
  }

  async createReadUrl(input: StorageReadUrlInput): Promise<StorageReadUrl> {
    const expires = Date.now() + Math.max(1, Math.floor(input.ttlSeconds)) * 1000;
    const signature = this.sign(input.key, expires, input.actorId ?? null);
    const query = new URLSearchParams({
      key: input.key,
      expires: String(expires),
      actor: input.actorId ?? '',
      signature,
    });
    return {
      url: `${this.options.publicBaseUrl}${LOCAL_SIGNED_READ_PATH}?${query.toString()}`,
      expiresAt: new Date(expires),
    };
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.resolvePath(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  async exists(key: string): Promise<boolean> {
    if (!isSafeStorageKey(key)) return false;
    try {
      await stat(this.resolvePath(key));
      return true;
    } catch {
      return false;
    }
  }

  async read(key: string): Promise<Buffer> {
    return readFile(this.resolvePath(key));
  }

  verifyReadRequest(request: SignedReadRequest, now: Date = new Date()): boolean {
    if (!isSafeStorageKey(request.key)) return false;
    if (!Number.isFinite(request.expires) || request.expires <= now.getTime()) {
      return false;
    }
    const expected = this.sign(request.key, request.expires, request.actorId);
    const received = request.signature.toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(received)) return false;
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex'));
  }

  private sign(key: string, expires: number, actorId: string | null): string {
    return createHmac('sha256', this.options.signingSecret)
      .update(`${key}\n${expires}\n${actorId ?? ''}`)
      .digest('hex');
  }

  private resolvePath(key: string): string {
    if (!isSafeStorageKey(key)) {
      throw new Error(`非法存储 key: ${key}`);
    }
    const target = resolve(this.options.baseDir, key);
    if (!target.startsWith(`${this.options.baseDir}${sep}`)) {
      throw new Error(`存储 key 越界: ${key}`);
    }
    return target;
  }
}

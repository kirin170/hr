import { Injectable } from '@nestjs/common';
import { LocalStorageDriver, localStorageOptionsFromEnv } from './local-storage.driver.js';
import { OssStorageDriver, ossStorageOptionsFromEnv } from './oss-storage.driver.js';
import type {
  SignedReadRequest,
  StorageDriver,
  StoragePutInput,
  StorageReadUrl,
  StorageReadUrlInput,
} from './storage.types.js';

export const DEFAULT_SIGNED_URL_TTL_SECONDS = 300;
export const MIN_SIGNED_URL_TTL_SECONDS = 30;
export const MAX_SIGNED_URL_TTL_SECONDS = 3600;

export function createStorageDriver(env: NodeJS.ProcessEnv = process.env): StorageDriver {
  const driver = (env.STORAGE_DRIVER ?? 'local').trim().toLowerCase();
  if (driver === 'local') return new LocalStorageDriver(localStorageOptionsFromEnv(env));
  if (driver === 'oss') return new OssStorageDriver(ossStorageOptionsFromEnv(env));
  throw new Error(`不支持的 STORAGE_DRIVER: ${driver}（可选 local / oss）`);
}

/** 签名读链接有效期：默认 5 分钟，限制在 30 秒至 1 小时之间（NFR-1）。 */
export function resolveSignedUrlTtlSeconds(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.SIGNED_URL_TTL_SECONDS ?? DEFAULT_SIGNED_URL_TTL_SECONDS);
  if (!Number.isFinite(parsed)) return DEFAULT_SIGNED_URL_TTL_SECONDS;
  return Math.min(
    MAX_SIGNED_URL_TTL_SECONDS,
    Math.max(MIN_SIGNED_URL_TTL_SECONDS, Math.floor(parsed)),
  );
}

@Injectable()
export class StorageService {
  readonly driverName: string;
  private readonly driver: StorageDriver;

  constructor(driver: StorageDriver) {
    this.driver = driver;
    this.driverName = this.driver.name;
  }

  get supportsSignedReadVerification(): boolean {
    return this.driver.supportsSignedReadVerification;
  }

  putObject(input: StoragePutInput): Promise<void> {
    return this.driver.put(input);
  }

  createReadUrl(input: StorageReadUrlInput): Promise<StorageReadUrl> {
    return this.driver.createReadUrl(input);
  }

  deleteObject(key: string): Promise<void> {
    return this.driver.delete(key);
  }

  objectExists(key: string): Promise<boolean> {
    return this.driver.exists(key);
  }

  readObject(key: string): Promise<Buffer> {
    return this.driver.read(key);
  }

  verifySignedRead(request: SignedReadRequest, now?: Date): boolean {
    return this.driver.verifyReadRequest?.(request, now) ?? false;
  }
}

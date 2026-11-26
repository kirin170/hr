import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  LOCAL_SIGNED_READ_PATH,
  LocalStorageDriver,
  localStorageOptionsFromEnv,
} from './local-storage.driver.js';

let baseDir: string;
let driver: LocalStorageDriver;

beforeAll(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'ats005-storage-'));
  driver = new LocalStorageDriver({
    baseDir,
    signingSecret: 'test-signing-secret',
    publicBaseUrl: 'http://api.local:3000',
  });
});

afterAll(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

describe('LocalStorageDriver 私有读写（技术设计 §8.1）', () => {
  it('按 key 写入、读取并删除，重复写入复用同一对象', async () => {
    const key = 'resumes/abc123.pdf';
    await driver.put({ key, body: Buffer.from('%PDF-1.7'), contentType: 'application/pdf' });
    await driver.put({ key, body: Buffer.from('%PDF-1.7'), contentType: 'application/pdf' });

    await expect(driver.exists(key)).resolves.toBe(true);
    await expect(driver.read(key)).resolves.toEqual(Buffer.from('%PDF-1.7'));

    await driver.delete(key);
    await expect(driver.exists(key)).resolves.toBe(false);
    await expect(driver.delete(key)).resolves.toBeUndefined();
  });

  it('签发短期签名链接，并校验有效期、签名与访问人', async () => {
    const key = 'resumes/signed.pdf';
    const signed = await driver.createReadUrl({ key, ttlSeconds: 120, actorId: 'user-1' });
    const url = new URL(signed.url);
    const expires = Number(url.searchParams.get('expires'));
    const signature = url.searchParams.get('signature') ?? '';

    expect(url.pathname).toBe(LOCAL_SIGNED_READ_PATH);
    expect(url.searchParams.get('key')).toBe(key);
    expect(url.searchParams.get('actor')).toBe('user-1');
    expect(signed.expiresAt.getTime()).toBe(expires);

    const request = { key, expires, actorId: 'user-1', signature };
    expect(driver.verifyReadRequest(request)).toBe(true);
    expect(driver.verifyReadRequest({ ...request, signature: 'f'.repeat(64) })).toBe(false);
    expect(driver.verifyReadRequest({ ...request, actorId: 'user-2' })).toBe(false);
    expect(driver.verifyReadRequest({ ...request, key: 'resumes/other.pdf' })).toBe(false);
    expect(
      driver.verifyReadRequest(request, new Date(expires + 1)),
    ).toBe(false);
    expect(
      driver.verifyReadRequest({ ...request, expires: expires + 60_000 }),
    ).toBe(false);
  });

  it('拒绝目录穿越与非法 key', async () => {
    await expect(driver.exists('../secrets.txt')).resolves.toBe(false);
    await expect(driver.read('../secrets.txt')).rejects.toThrow();
    await expect(
      driver.put({ key: '/etc/passwd', body: Buffer.from('x'), contentType: 'text/plain' }),
    ).rejects.toThrow();
  });

  it('非本地环境（含未设置 APP_ENV）缺少或过短的签名密钥时拒绝启动', () => {
    expect(() => localStorageOptionsFromEnv({ APP_ENV: 'production' })).toThrow(
      /STORAGE_SIGNING_SECRET/,
    );
    expect(() => localStorageOptionsFromEnv({})).toThrow(/STORAGE_SIGNING_SECRET/);
    expect(() =>
      localStorageOptionsFromEnv({ APP_ENV: 'production', STORAGE_SIGNING_SECRET: 'too-short' }),
    ).toThrow(/STORAGE_SIGNING_SECRET/);
    expect(
      localStorageOptionsFromEnv({ APP_ENV: 'local', JWT_ACCESS_SECRET: 'jwt-secret' })
        .signingSecret,
    ).toBe('jwt-secret');
  });
});

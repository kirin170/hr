import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  assertSafeOutboundHost,
  assertSafeOutboundUrl,
  isPrivateOrReservedIp,
} from './outbound-url.js';

describe('outbound-url SSRF 校验', () => {
  const prodEnv = { APP_ENV: 'production' } as NodeJS.ProcessEnv;

  it('识别 IPv4/IPv6 私网、回环、云元数据与 IPv4-mapped 地址', () => {
    expect(isPrivateOrReservedIp('127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('10.0.0.5')).toBe(true);
    expect(isPrivateOrReservedIp('172.16.1.1')).toBe(true);
    expect(isPrivateOrReservedIp('192.168.1.10')).toBe(true);
    expect(isPrivateOrReservedIp('169.254.169.254')).toBe(true);
    expect(isPrivateOrReservedIp('::1')).toBe(true);
    expect(isPrivateOrReservedIp('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('::ffff:7f00:1')).toBe(true);
    expect(isPrivateOrReservedIp('fe80::1')).toBe(true);
    expect(isPrivateOrReservedIp('fc00::1')).toBe(true);
    expect(isPrivateOrReservedIp('8.8.8.8')).toBe(false);
    expect(isPrivateOrReservedIp('223.5.5.5')).toBe(false);
  });

  it('生产环境拦截 http、内网地址、URL 凭据与白名单外域名', () => {
    expect(() =>
      assertSafeOutboundUrl('http://dashscope.aliyuncs.com/v1', 'baseUrl', { env: prodEnv }),
    ).toThrow(BadRequestException);
    expect(() =>
      assertSafeOutboundUrl('https://169.254.169.254/latest', 'baseUrl', { env: prodEnv }),
    ).toThrow(BadRequestException);
    expect(() =>
      assertSafeOutboundUrl('https://user:pass@dashscope.aliyuncs.com/v1', 'baseUrl', {
        env: prodEnv,
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      assertSafeOutboundUrl('https://evil.example.com/v1', 'baseUrl', {
        allowedHostsEnv: 'AI_ALLOWED_BASE_URL_HOSTS',
        env: { ...prodEnv, AI_ALLOWED_BASE_URL_HOSTS: 'dashscope.aliyuncs.com,.openai.com' },
      }),
    ).toThrow(BadRequestException);

    expect(
      assertSafeOutboundUrl('https://api.openai.com/v1', 'baseUrl', {
        allowedHostsEnv: 'AI_ALLOWED_BASE_URL_HOSTS',
        env: { ...prodEnv, AI_ALLOWED_BASE_URL_HOSTS: 'dashscope.aliyuncs.com,.openai.com' },
      }).hostname,
    ).toBe('api.openai.com');
  });

  it('生产环境拦截 localhost 和私网 IMAP 主机', () => {
    expect(() =>
      assertSafeOutboundHost('localhost', 'IMAP 主机', { allowPrivateInLocal: true, env: prodEnv }),
    ).toThrow(BadRequestException);
    expect(() =>
      assertSafeOutboundHost('10.1.2.3', 'IMAP 主机', { allowPrivateInLocal: true, env: prodEnv }),
    ).toThrow(BadRequestException);
    expect(
      assertSafeOutboundHost('imap.exmail.qq.com', 'IMAP 主机', {
        allowPrivateInLocal: true,
        env: prodEnv,
      }),
    ).toBe('imap.exmail.qq.com');
  });
});

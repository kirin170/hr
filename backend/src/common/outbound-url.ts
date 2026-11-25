import { BadRequestException } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * 出站网络目标校验（防 SSRF 与凭据外泄）：
 * - 生产/未设置 APP_ENV 时严格按非本地处理（fail-closed）；
 * - 拦截私网、回环、链路本地、云元数据及保留段 IP；
 * - 可通过环境变量配置白名单主机（支持精确匹配或 .suffix 后缀）。
 */
export function isLocalOrTestEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.APP_ENV === 'local' || env.APP_ENV === 'test';
}

function parseIpv4(ip: string): number[] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const nums: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (!Number.isInteger(value) || value < 0 || value > 255) return null;
    nums.push(value);
  }
  return nums;
}

function isPrivateIpv4(nums: number[]): boolean {
  const [a, b] = nums;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local / metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 0 && nums[2] === 0) return true; // 192.0.0.0/24
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmark
  if (a >= 224) return true; // multicast & reserved
  return false;
}

export function isPrivateOrReservedIp(rawIp: string): boolean {
  const ip = rawIp.trim().replace(/^\[|\]$/g, '').split('%')[0].toLowerCase();
  const family = isIP(ip);
  if (family === 4) {
    const nums = parseIpv4(ip);
    return nums ? isPrivateIpv4(nums) : true;
  }
  if (family === 6) {
    if (ip === '::' || ip === '::1') return true;
    // IPv4-mapped IPv6: ::ffff:127.0.0.1 或 ::ffff:7f00:1
    if (ip.startsWith('::ffff:')) {
      const tail = ip.slice('::ffff:'.length);
      const dotted = parseIpv4(tail);
      if (dotted) return isPrivateIpv4(dotted);
      const hexParts = tail.split(':');
      if (hexParts.length === 2 && /^[0-9a-f]{1,4}$/.test(hexParts[0]) && /^[0-9a-f]{1,4}$/.test(hexParts[1])) {
        const hi = parseInt(hexParts[0], 16);
        const lo = parseInt(hexParts[1], 16);
        return isPrivateIpv4([(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff]);
      }
      return true;
    }
    const firstSegment = ip.split(':')[0] || '0';
    const firstWord = parseInt(firstSegment, 16);
    if (!Number.isFinite(firstWord)) return true;
    if ((firstWord & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
    if ((firstWord & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((firstWord & 0xff00) === 0xff00) return true; // ff00::/8 multicast
    return false;
  }
  return false;
}

export function isBlockedHostname(rawHost: string): boolean {
  const host = rawHost.trim().replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (isIP(host)) return isPrivateOrReservedIp(host);
  return false;
}

export function matchesAllowedHostList(host: string, allowedListRaw?: string): boolean {
  const entries = (allowedListRaw ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase().replace(/\.$/, ''))
    .filter(Boolean);
  if (entries.length === 0) return true;
  const normalized = host.trim().replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  return entries.some((entry) => {
    if (entry.startsWith('.')) {
      return normalized.endsWith(entry) && normalized.length > entry.length;
    }
    return normalized === entry;
  });
}

export function assertSafeOutboundHost(
  rawHost: string,
  label: string,
  options: {
    allowPrivateInLocal?: boolean;
    allowedHostsEnv?: string;
    env?: NodeJS.ProcessEnv;
  } = {},
): string {
  const env = options.env ?? process.env;
  const host = rawHost.trim();
  if (!host || /[\s/@\\]/.test(host)) {
    throw new BadRequestException(`${label} 格式无效`);
  }
  const allowPrivate = Boolean(options.allowPrivateInLocal && isLocalOrTestEnv(env));
  if (!allowPrivate && isBlockedHostname(host)) {
    throw new BadRequestException(`${label} 不允许指向本机、内网或保留地址`);
  }
  if (options.allowedHostsEnv) {
    const allowlist = env[options.allowedHostsEnv];
    if (allowlist?.trim() && !matchesAllowedHostList(host, allowlist)) {
      throw new BadRequestException(`${label} 不在允许的主机白名单（${options.allowedHostsEnv}）中`);
    }
  }
  return host;
}

export function assertSafeOutboundUrl(
  rawUrl: string,
  label: string,
  options: {
    allowedHostsEnv?: string;
    env?: NodeJS.ProcessEnv;
  } = {},
): URL {
  const env = options.env ?? process.env;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BadRequestException(`${label} 必须是合法 URL`);
  }
  if (url.username || url.password) {
    throw new BadRequestException(`${label} 不允许在 URL 中包含账号或密码`);
  }
  const localOrTest = isLocalOrTestEnv(env);
  if (localOrTest) {
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new BadRequestException(`${label} 仅支持 http/https`);
    }
  } else if (url.protocol !== 'https:') {
    throw new BadRequestException(`${label} 在非本地环境仅支持 https`);
  }
  assertSafeOutboundHost(url.hostname, label, {
    allowPrivateInLocal: true,
    allowedHostsEnv: options.allowedHostsEnv,
    env,
  });
  return url;
}

/**
 * 连接前二次 DNS 解析校验，防止 DNS 重绑定或公网域名解析到内网/云元数据 IP。
 */
export async function assertResolvedHostIsPublic(
  rawHost: string,
  label: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (isLocalOrTestEnv(env)) return;
  const host = rawHost.trim().replace(/^\[|\]$/g, '');
  if (isBlockedHostname(host)) {
    throw new BadRequestException(`${label} 不允许指向本机、内网或保留地址`);
  }
  if (isIP(host)) return;
  const records = await lookup(host, { all: true }).catch(() => {
    throw new BadRequestException(`${label} 域名解析失败`);
  });
  if (records.length === 0) {
    throw new BadRequestException(`${label} 域名未解析到有效地址`);
  }
  for (const record of records) {
    if (isPrivateOrReservedIp(record.address)) {
      throw new BadRequestException(`${label} 解析到内网或保留地址，已拒绝连接`);
    }
  }
}

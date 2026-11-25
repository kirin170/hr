import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { MailInboxConfig } from '@prisma/client';
import {
  assertResolvedHostIsPublic,
  assertSafeOutboundHost,
  isLocalOrTestEnv,
} from '../common/outbound-url.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { withImapClient, type MailboxConnection } from './imap.client.js';
import { MailCredentialService } from './mail-credential.service.js';
import {
  DEFAULT_POLL_INTERVAL_SECONDS,
  MAIL_PROVIDER,
  MAX_POLL_INTERVAL_SECONDS,
  MIN_POLL_INTERVAL_SECONDS,
} from './mail.constants.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type MailInboxView = {
  id: string;
  address: string;
  provider: string;
  active: boolean;
  host: string | null;
  port: number | null;
  secure: boolean;
  username: string | null;
  folder: string;
  pollIntervalSeconds: number;
  /** 只暴露是否已配置凭据，绝不返回明文或密文（技术设计 §5.1） */
  hasCredential: boolean;
  lastPolledAt: string | null;
  lastPollStatus: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  consecutiveFailures: number;
  lastFetchedCount: number;
  lastCreatedCount: number;
  lastDuplicateCount: number;
  lastSkippedCount: number;
};

export type MailInboxInput = {
  address?: string;
  provider?: string;
  active?: boolean;
  host?: string;
  port?: number | string;
  secure?: boolean;
  username?: string;
  password?: string;
  folder?: string;
  pollIntervalSeconds?: number | string;
};

@Injectable()
export class MailConfigService {
  private readonly logger = new Logger(MailConfigService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: MailCredentialService,
  ) {}

  async list(): Promise<MailInboxView[]> {
    const configs = await this.prisma.mailInboxConfig.findMany({
      orderBy: { createdAt: 'asc' },
    });
    return configs.map((config) => this.toView(config));
  }

  async get(id: string): Promise<MailInboxView> {
    return this.toView(await this.requireConfig(id));
  }

  async create(input: MailInboxInput): Promise<MailInboxView> {
    const address = this.normalizeAddress(input.address);
    const provider = this.normalizeProvider(input.provider);
    const existing = await this.prisma.mailInboxConfig.findUnique({ where: { address } });
    if (existing) {
      throw new BadRequestException(`邮箱 ${address} 已关联，请直接编辑该配置`);
    }

    const connection = this.normalizeConnection(input, provider);
    const config = await this.prisma.mailInboxConfig.create({
      data: {
        address,
        provider,
        active: input.active ?? true,
        folder: this.normalizeFolder(input.folder),
        pollIntervalSeconds: this.normalizeInterval(input.pollIntervalSeconds),
        ...connection.fields,
        secretCipher: connection.password ? this.credentials.encrypt(connection.password) : null,
      },
    });
    return this.toView(config);
  }

  async update(id: string, input: MailInboxInput): Promise<MailInboxView> {
    const current = await this.requireConfig(id);
    const provider = input.provider ? this.normalizeProvider(input.provider) : current.provider;

    const data: Record<string, unknown> = {
      provider,
      folder: input.folder === undefined ? current.folder : this.normalizeFolder(input.folder),
      pollIntervalSeconds:
        input.pollIntervalSeconds === undefined
          ? current.pollIntervalSeconds
          : this.normalizeInterval(input.pollIntervalSeconds),
    };
    if (input.active !== undefined) data.active = Boolean(input.active);
    if (input.host !== undefined) {
      const rawHost = this.optionalText(input.host);
      data.host = rawHost ? this.normalizeHost(rawHost) : null;
    }
    if (input.username !== undefined) data.username = this.optionalText(input.username);
    if (input.port !== undefined) data.port = this.normalizePort(input.port);
    if (input.secure !== undefined) data.secure = this.normalizeSecure(Boolean(input.secure));
    if (input.address !== undefined) {
      const address = this.normalizeAddress(input.address);
      if (address !== current.address) data.address = address;
    }
    const nextPassword = input.password?.trim() || null;
    if (nextPassword) {
      data.secretCipher = this.credentials.encrypt(nextPassword);
    }
    if (provider === MAIL_PROVIDER.IMAP) {
      const host = (data.host !== undefined ? data.host : current.host) as string | null;
      const port = (data.port !== undefined ? data.port : current.port) as number | null;
      const username = (data.username !== undefined ? data.username : current.username) as string | null;
      const secure = (data.secure !== undefined ? data.secure : current.secure) as boolean;
      const targetChanged =
        (data.host !== undefined && host !== current.host) ||
        (data.port !== undefined && port !== current.port) ||
        (data.username !== undefined && username !== current.username) ||
        (data.secure !== undefined && secure !== current.secure);
      if (targetChanged && !nextPassword) {
        throw new BadRequestException('修改 IMAP 主机、端口、用户名或加密方式时必须重新提供授权码');
      }
      if (host) this.normalizeHost(host);
      this.normalizeSecure(secure);
      if (port !== null) this.normalizePort(port);
      const secret = (data.secretCipher as string | null | undefined) ?? current.secretCipher;
      if (!host || !username || !secret) {
        throw new BadRequestException('IMAP 邮箱必须提供 host、username 与授权码');
      }
    }

    const config = await this.prisma.mailInboxConfig.update({ where: { id }, data });
    return this.toView(config);
  }

  async remove(id: string): Promise<{ deleted: true }> {
    await this.requireConfig(id);
    await this.prisma.mailInboxConfig.delete({ where: { id } });
    return { deleted: true };
  }

  /** 连接测试：只读打开收件箱，不拉取邮件、不改变游标 */
  async testConnection(id: string): Promise<{
    ok: boolean;
    mailbox?: string;
    messageCount?: number;
    uidValidity?: string | null;
    error?: string;
    elapsedMs: number;
  }> {
    const config = await this.requireConfig(id);
    const startedAt = Date.now();
    try {
      const connection = this.toConnection(config);
      await assertResolvedHostIsPublic(connection.host, 'IMAP 主机');
      const result = await withImapClient(connection, async (client) => {
        const lock = await client.getMailboxLock(config.folder);
        try {
          const mailbox = client.mailbox;
          if (!mailbox) throw new Error('收件箱不可用');
          return {
            messageCount: mailbox.exists ?? 0,
            uidValidity:
              mailbox.uidValidity === undefined ? null : String(mailbox.uidValidity),
          };
        } finally {
          lock.release();
        }
      });
      await this.prisma.mailInboxConfig.update({
        where: { id },
        data: { lastError: null, lastErrorAt: null, consecutiveFailures: 0 },
      });
      return {
        ok: true,
        mailbox: config.folder,
        messageCount: result.messageCount,
        uidValidity: result.uidValidity,
        elapsedMs: Date.now() - startedAt,
      };
    } catch (error) {
      const message = this.safeError(error);
      await this.prisma.mailInboxConfig.update({
        where: { id },
        data: { lastError: message, lastErrorAt: new Date() },
      });
      return { ok: false, error: message, elapsedMs: Date.now() - startedAt };
    }
  }

  /** 轮询需要的连接参数；凭据仅在内存中解密使用 */
  toConnection(config: MailInboxConfig): MailboxConnection {
    if (config.provider !== MAIL_PROVIDER.IMAP) {
      throw new BadRequestException(`邮箱 ${config.address} 不是 IMAP 配置`);
    }
    if (!config.host || !config.username || !config.secretCipher) {
      throw new BadRequestException(`邮箱 ${config.address} 缺少 IMAP 连接参数`);
    }
    return {
      host: config.host,
      port: config.port ?? 993,
      secure: config.secure,
      user: config.username,
      password: this.credentials.decrypt(config.secretCipher),
    };
  }

  async listDue(): Promise<MailInboxConfig[]> {
    const configs = await this.prisma.mailInboxConfig.findMany({
      where: { active: true, provider: MAIL_PROVIDER.IMAP },
    });
    const now = Date.now();
    return configs.filter((config) => {
      if (!config.lastPolledAt) return true;
      const intervalMs = Math.max(config.pollIntervalSeconds, MIN_POLL_INTERVAL_SECONDS) * 1000;
      return now - config.lastPolledAt.getTime() >= intervalMs;
    });
  }

  async requireConfig(id: string): Promise<MailInboxConfig> {
    const config = await this.prisma.mailInboxConfig.findUnique({ where: { id } });
    if (!config) throw new NotFoundException('邮箱配置不存在');
    return config;
  }

  /**
   * 本地引导：MAIL_PROVIDER=imap 时把 .env 中的测试邮箱登记为一条配置。
   * 正式多邮箱仍通过管理接口维护，环境变量只做开发便利入口。
   */
  async bootstrapFromEnv(): Promise<void> {
    const provider = (process.env.MAIL_PROVIDER ?? 'mock').trim().toLowerCase();
    if (provider !== 'imap') return;

    const host = process.env.MAIL_INBOX_HOST?.trim();
    const username = process.env.MAIL_INBOX_USER?.trim();
    const password = process.env.MAIL_INBOX_PASSWORD;
    if (!host || !username || !password) return;

    const address = username.toLowerCase();
    const existing = await this.prisma.mailInboxConfig.findUnique({ where: { address } });
    const port = Number(process.env.MAIL_INBOX_PORT ?? 993) || 993;
    const secure = (process.env.MAIL_INBOX_SECURE ?? 'true').trim().toLowerCase() !== 'false';

    if (!existing) {
      await this.prisma.mailInboxConfig.create({
        data: {
          address,
          provider: MAIL_PROVIDER.IMAP,
          active: true,
          host,
          port,
          secure,
          username,
          secretCipher: this.credentials.encrypt(password),
          pollIntervalSeconds: this.normalizeInterval(process.env.MAIL_POLL_INTERVAL_SECONDS),
        },
      });
      this.logger.log(`已从环境变量登记邮箱配置 ${address}`);
      return;
    }

    const unchanged =
      existing.provider === MAIL_PROVIDER.IMAP &&
      existing.host === host &&
      existing.port === port &&
      existing.secure === secure &&
      existing.username === username &&
      this.safeDecrypt(existing.secretCipher) === password;
    if (unchanged) return;

    await this.prisma.mailInboxConfig.update({
      where: { id: existing.id },
      data: {
        provider: MAIL_PROVIDER.IMAP,
        host,
        port,
        secure,
        username,
        secretCipher: this.credentials.encrypt(password),
      },
    });
    this.logger.log(`已按环境变量更新邮箱配置 ${address}`);
  }

  toView(config: MailInboxConfig): MailInboxView {
    return {
      id: config.id,
      address: config.address,
      provider: config.provider,
      active: config.active,
      host: config.host,
      port: config.port,
      secure: config.secure,
      username: config.username,
      folder: config.folder,
      pollIntervalSeconds: config.pollIntervalSeconds,
      hasCredential: Boolean(config.secretCipher),
      lastPolledAt: config.lastPolledAt?.toISOString() ?? null,
      lastPollStatus: config.lastPollStatus,
      lastError: config.lastError,
      lastErrorAt: config.lastErrorAt?.toISOString() ?? null,
      consecutiveFailures: config.consecutiveFailures,
      lastFetchedCount: config.lastFetchedCount,
      lastCreatedCount: config.lastCreatedCount,
      lastDuplicateCount: config.lastDuplicateCount,
      lastSkippedCount: config.lastSkippedCount,
    };
  }

  private normalizeConnection(
    input: MailInboxInput,
    provider: string,
  ): { fields: Record<string, unknown>; password: string | null } {
    if (provider !== MAIL_PROVIDER.IMAP) {
      return { fields: {}, password: null };
    }
    const rawHost = this.optionalText(input.host);
    const username = this.optionalText(input.username);
    const password = input.password?.trim() || null;
    if (!rawHost || !username || !password) {
      throw new BadRequestException('IMAP 邮箱必须提供 host、username 与授权码');
    }
    const host = this.normalizeHost(rawHost);
    const secure = this.normalizeSecure(input.secure === undefined ? true : Boolean(input.secure));
    return {
      fields: {
        host,
        port: this.normalizePort(input.port),
        secure,
        username,
      },
      password,
    };
  }

  private normalizeHost(value: string): string {
    return assertSafeOutboundHost(value, 'IMAP 主机', {
      allowPrivateInLocal: true,
      allowedHostsEnv: 'MAIL_ALLOWED_IMAP_HOSTS',
    });
  }

  private normalizeSecure(secure: boolean): boolean {
    if (!secure && !isLocalOrTestEnv()) {
      throw new BadRequestException('非本地环境必须启用 IMAP TLS 加密（secure=true）');
    }
    return secure;
  }

  private normalizeAddress(value?: string): string {
    const address = value?.trim().toLowerCase();
    if (!address || !EMAIL_PATTERN.test(address)) {
      throw new BadRequestException('邮箱地址格式不正确');
    }
    return address;
  }

  private normalizeProvider(value?: string): string {
    const provider = (value ?? MAIL_PROVIDER.IMAP).trim().toUpperCase();
    if (provider !== MAIL_PROVIDER.IMAP && provider !== MAIL_PROVIDER.MOCK) {
      throw new BadRequestException('provider 仅支持 IMAP 或 MOCK');
    }
    return provider;
  }

  private normalizePort(value?: number | string): number {
    const port = Number(value ?? 993);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new BadRequestException('端口必须是 1-65535 的整数');
    }
    if (!isLocalOrTestEnv() && process.env.MAIL_ALLOW_CUSTOM_PORTS !== 'true' && port !== 993 && port !== 143) {
      throw new BadRequestException('非本地环境仅允许标准 IMAP 端口（993 或 143）');
    }
    return port;
  }

  private normalizeInterval(value?: number | string): number {
    const parsed = Number(value ?? DEFAULT_POLL_INTERVAL_SECONDS);
    if (!Number.isFinite(parsed)) return DEFAULT_POLL_INTERVAL_SECONDS;
    return Math.min(Math.max(Math.floor(parsed), MIN_POLL_INTERVAL_SECONDS), MAX_POLL_INTERVAL_SECONDS);
  }

  private normalizeFolder(value?: string): string {
    const folder = value?.trim();
    return folder || 'INBOX';
  }

  private optionalText(value?: string | null): string | null {
    const text = value?.trim();
    return text ? text : null;
  }

  private safeDecrypt(cipher: string | null): string | null {
    if (!cipher) return null;
    try {
      return this.credentials.decrypt(cipher);
    } catch {
      return null;
    }
  }

  private safeError(error: unknown): string {
    if (!error || typeof error !== 'object') return 'unknown_error';
    const code = 'code' in error ? String((error as { code: unknown }).code) : '';
    const message = error instanceof Error ? error.message : '';
    return `${code ? `${code}: ` : ''}${message || 'mail_error'}`.slice(0, 300);
  }
}

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthorizationService } from './authorization.service.js';
import type { AuthenticatedUser } from './auth.types.js';
import { BROWSER_IMPORT_ERROR } from '../intake/browser-import.contract.js';

/** 短期系统令牌默认有效期 30 分钟，可通过环境变量调整（60 秒～24 小时） */
const DEFAULT_TTL_SECONDS = 30 * 60;
const MIN_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 24 * 60 * 60;

export interface IssuedSystemToken {
  token: string;
  expiresAt: string;
}

/**
 * 短期系统令牌（ATS-010 / NFR-9）：
 * 供浏览器扩展等非交互调用方代表已登录操作者访问导入 API。
 * - 令牌为 256 位随机串，库中只存加盐哈希；
 * - 有效期可配置，过期或吊销即失效；
 * - 令牌不代表任何新权限，鉴权仍按签发操作者的角色与数据范围。
 */
@Injectable()
export class SystemTokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
  ) {}

  async issue(actorId: string, purpose = 'BROWSER_IMPORT'): Promise<IssuedSystemToken> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.ttlSeconds() * 1000);
    await this.prisma.systemToken.create({
      data: { tokenHash: this.hash(token), operatorId: actorId, purpose, expiresAt },
    });
    return { token, expiresAt: expiresAt.toISOString() };
  }

  /** 校验令牌并返回其代表的操作者上下文；失败统一 401，不泄露具体原因 */
  async authenticate(rawToken: string, expectedPurpose?: string): Promise<AuthenticatedUser> {
    const token = rawToken?.trim();
    if (!token) throw new UnauthorizedException(BROWSER_IMPORT_ERROR.TOKEN_INVALID);
    const record = await this.prisma.systemToken.findUnique({
      where: { tokenHash: this.hash(token) },
    });
    if (!record) throw new UnauthorizedException(BROWSER_IMPORT_ERROR.TOKEN_INVALID);
    if (expectedPurpose && record.purpose !== expectedPurpose) {
      throw new UnauthorizedException(BROWSER_IMPORT_ERROR.TOKEN_INVALID);
    }
    if (record.revokedAt || record.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException(BROWSER_IMPORT_ERROR.TOKEN_EXPIRED);
    }
    const actor = await this.authorization.loadUserContext(record.operatorId);
    await this.prisma.systemToken.update({
      where: { id: record.id },
      data: { lastUsedAt: new Date() },
    });
    return actor;
  }

  /** 吊销某操作者名下全部有效令牌 */
  async revokeAll(operatorId: string): Promise<number> {
    const result = await this.prisma.systemToken.updateMany({
      where: { operatorId, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  private hash(token: string): string {
    const pepper = process.env.SYSTEM_TOKEN_PEPPER ?? process.env.JWT_ACCESS_SECRET ?? '';
    if (Buffer.byteLength(pepper) < 32) {
      throw new Error('SYSTEM_TOKEN_PEPPER（或 JWT_ACCESS_SECRET）必须至少 32 字节');
    }
    return createHash('sha256').update(`${pepper}:${token}`).digest('hex');
  }

  private ttlSeconds(): number {
    const parsed = Number(process.env.SYSTEM_TOKEN_TTL ?? DEFAULT_TTL_SECONDS);
    if (!Number.isInteger(parsed) || parsed < MIN_TTL_SECONDS || parsed > MAX_TTL_SECONDS) {
      throw new Error(
        `SYSTEM_TOKEN_TTL 必须为 ${MIN_TTL_SECONDS} 至 ${MAX_TTL_SECONDS} 秒的整数`,
      );
    }
    return parsed;
  }
}

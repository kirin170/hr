import {
  ConflictException,
  InternalServerErrorException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { IdentityProvider, Prisma, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AccessTokenService } from './access-token.service.js';
import { AuthorizationService } from './authorization.service.js';
import { DingTalkIdentityMapper, LocalIdentityAdapter, type VerifiedDingTalkIdentity } from './identity.adapters.js';

export type SessionTokens = {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresIn: number;
  user: { id: string; displayName: string };
};

export type BootstrapAdminInput = {
  employeeNo?: string;
  displayName: string;
  email?: string;
  departmentId?: string;
  identityProvider: IdentityProvider;
  identitySubject: string;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: AccessTokenService,
    private readonly localIdentity: LocalIdentityAdapter,
    private readonly dingTalkIdentity: DingTalkIdentityMapper,
    private readonly authorization: AuthorizationService,
  ) {}

  async loginLocal(identifier: string, secret: string): Promise<SessionTokens> {
    const user = await this.localIdentity.authenticate(identifier, secret);
    return this.createSession(user.id);
  }

  async bootstrapInitialAdmin(
    setupToken: string,
    input: BootstrapAdminInput,
  ): Promise<{ id: string; displayName: string }> {
    if (
      await this.prisma.systemSetting.findUnique({
        where: { key: 'auth.initial-admin-created-at' },
        select: { key: true },
      })
    ) {
      throw new ConflictException('初始管理员已创建');
    }
    const configuredToken = process.env.INITIAL_ADMIN_SECRET;
    if (!configuredToken || Buffer.byteLength(configuredToken) < 32) {
      throw new InternalServerErrorException(
        'INITIAL_ADMIN_SECRET 必须配置为至少 32 字节的随机值',
      );
    }
    if (!this.constantTimeEquals(configuredToken, setupToken)) {
      throw new UnauthorizedException('初始化凭据无效');
    }
    if (!input.displayName.trim() || !input.identitySubject.trim()) {
      throw new UnauthorizedException('管理员姓名和身份标识不能为空');
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.systemSetting.create({
          data: {
            key: 'auth.initial-admin-created-at',
            value: new Date().toISOString(),
          },
        });

        const adminRole = await tx.role.findUnique({
          where: { code: 'ADMIN' },
          include: { permissions: { select: { permissionId: true } } },
        });
        if (!adminRole?.permissions.length) {
          throw new InternalServerErrorException(
            '管理员权限未初始化，请先执行 npm run db:seed --prefix backend',
          );
        }
        if (
          input.departmentId &&
          !(await tx.department.findUnique({
            where: { id: input.departmentId },
            select: { id: true },
          }))
        ) {
          throw new NotFoundException('部门不存在');
        }

        const user = await tx.user.create({
          data: {
            employeeNo: input.employeeNo?.trim() || undefined,
            displayName: input.displayName.trim(),
            email: input.email?.trim() || undefined,
            departmentId: input.departmentId || undefined,
            status: UserStatus.ACTIVE,
          },
          select: { id: true, displayName: true },
        });
        await tx.identityLink.create({
          data: {
            provider: input.identityProvider,
            subject: input.identitySubject.trim(),
            userId: user.id,
            verifiedAt:
              input.identityProvider === IdentityProvider.LOCAL
                ? new Date()
                : undefined,
          },
        });
        await tx.userRole.create({
          data: { userId: user.id, roleId: adminRole.id },
        });
        return user;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          '初始管理员已创建，或管理员身份标识已被使用',
        );
      }
      throw error;
    }
  }

  async loginDingTalk(identity: VerifiedDingTalkIdentity): Promise<SessionTokens> {
    const user = await this.dingTalkIdentity.resolve(identity);
    await this.prisma.identityLink.update({
      where: { provider_subject: { provider: 'DINGTALK', subject: identity.userId } },
      data: { verifiedAt: identity.verifiedAt },
    });
    return this.createSession(user.id);
  }

  async rotateRefreshToken(rawToken: string): Promise<SessionTokens> {
    const tokenHash = this.tokens.hashRefreshToken(rawToken);
    const current = await this.prisma.refreshSession.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    const now = new Date();
    if (!current) throw new UnauthorizedException('刷新令牌无效');
    if (current.consumedAt) {
      await this.prisma.refreshSession.updateMany({
        where: { familyId: current.familyId, revokedAt: null },
        data: { revokedAt: now },
      });
      throw new UnauthorizedException('刷新令牌已重复使用，登录会话已撤销');
    }
    if (
      current.revokedAt ||
      current.expiresAt <= now ||
      current.user.status !== UserStatus.ACTIVE
    ) {
      throw new UnauthorizedException('刷新令牌已失效');
    }

    const nextRawToken = randomBytes(48).toString('base64url');
    const nextExpiresAt = new Date(now.getTime() + this.tokens.refreshTtlMilliseconds());
    const rotated = await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.refreshSession.updateMany({
        where: {
          id: current.id,
          tokenHash,
          consumedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { consumedAt: now },
      });
      if (!consumed.count) return false;
      await tx.refreshSession.create({
        data: {
          tokenHash: this.tokens.hashRefreshToken(nextRawToken),
          familyId: current.familyId,
          userId: current.userId,
          expiresAt: nextExpiresAt,
        },
      });
      return true;
    });
    if (!rotated) {
      await this.prisma.refreshSession.updateMany({
        where: { familyId: current.familyId, revokedAt: null },
        data: { revokedAt: now },
      });
      throw new UnauthorizedException('刷新令牌已失效');
    }
    return this.sessionResult(current.userId, nextRawToken, nextExpiresAt);
  }

  async logout(rawToken?: string): Promise<string | undefined> {
    if (!rawToken) return undefined;
    const tokenHash = this.tokens.hashRefreshToken(rawToken);
    const session = await this.prisma.refreshSession.findUnique({
      where: { tokenHash },
      select: { userId: true },
    });
    await this.prisma.refreshSession.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return session?.userId;
  }

  async profile(userId: string) {
    const user = await this.authorization.loadUserContext(userId);
    return {
      id: user.id,
      displayName: user.displayName,
      departmentId: user.departmentId,
      roles: user.roles.map(({ code, name, dataScope, permissions }) => ({
        code,
        name,
        dataScope,
        permissions,
      })),
    };
  }

  private async createSession(userId: string): Promise<SessionTokens> {
    const refreshToken = randomBytes(48).toString('base64url');
    const refreshExpiresAt = new Date(Date.now() + this.tokens.refreshTtlMilliseconds());
    await this.prisma.refreshSession.create({
      data: {
        tokenHash: this.tokens.hashRefreshToken(refreshToken),
        familyId: randomUUID(),
        userId,
        expiresAt: refreshExpiresAt,
      },
    });
    return this.sessionResult(userId, refreshToken, refreshExpiresAt);
  }

  private async sessionResult(
    userId: string,
    refreshToken: string,
    refreshExpiresAt: Date,
  ): Promise<SessionTokens> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, displayName: true, status: true },
    });
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('用户不存在或已停用');
    }
    const token = this.tokens.issue(user.id);
    return {
      accessToken: token.token,
      expiresIn: token.expiresIn,
      refreshToken,
      refreshExpiresIn: Math.max(0, refreshExpiresAt.getTime() - Date.now()),
      user: { id: user.id, displayName: user.displayName },
    };
  }

  private constantTimeEquals(left: string, right: string): boolean {
    const leftHash = createHash('sha256').update(left).digest();
    const rightHash = createHash('sha256').update(right).digest();
    return timingSafeEqual(leftHash, rightHash);
  }
}

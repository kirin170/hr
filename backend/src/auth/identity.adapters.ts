import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { IdentityProvider, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export type VerifiedDingTalkIdentity = {
  userId: string;
  verifiedAt: Date;
};

@Injectable()
export class LocalIdentityAdapter {
  constructor(private readonly prisma: PrismaService) {}

  async authenticate(identifier: string, suppliedSecret: string) {
    if (process.env.APP_ENV !== 'local' || process.env.LOCAL_AUTH_ENABLED !== 'true') {
      throw new UnauthorizedException('本地身份登录未启用');
    }

    const configuredSecret = process.env.LOCAL_AUTH_SECRET;
    if (!configuredSecret || !this.constantTimeEquals(configuredSecret, suppliedSecret)) {
      throw new UnauthorizedException('本地身份凭据无效');
    }

    const identity = await this.prisma.identityLink.findUnique({
      where: {
        provider_subject: { provider: IdentityProvider.LOCAL, subject: identifier },
      },
      include: { user: true },
    });
    if (!identity || identity.user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('本地用户不存在或已停用');
    }
    return identity.user;
  }

  private constantTimeEquals(left: string, right: string): boolean {
    const leftHash = createHash('sha256').update(left).digest();
    const rightHash = createHash('sha256').update(right).digest();
    return timingSafeEqual(leftHash, rightHash);
  }
}

@Injectable()
export class DingTalkIdentityMapper {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(identity: VerifiedDingTalkIdentity) {
    if (!identity.userId || !(identity.verifiedAt instanceof Date)) {
      throw new UnauthorizedException('钉钉身份尚未验证');
    }
    const link = await this.prisma.identityLink.findUnique({
      where: {
        provider_subject: {
          provider: IdentityProvider.DINGTALK,
          subject: identity.userId,
        },
      },
      include: { user: true },
    });
    if (!link || link.user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('钉钉身份未绑定或已停用');
    }
    return link.user;
  }
}

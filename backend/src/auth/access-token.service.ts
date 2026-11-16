import {
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { AccessTokenClaims } from './auth.types.js';

const TOKEN_ISSUER = 'talentflow-api';
const TOKEN_AUDIENCE = 'talentflow-web';
const DEFAULT_ACCESS_TTL_SECONDS = 15 * 60;

@Injectable()
export class AccessTokenService {
  issue(userId: string): { token: string; expiresIn: number } {
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = this.accessTtlSeconds();
    const header = this.encode({ alg: 'HS256', typ: 'JWT' });
    const claims: AccessTokenClaims = {
      iss: TOKEN_ISSUER,
      aud: TOKEN_AUDIENCE,
      sub: userId,
      iat: now,
      exp: now + expiresIn,
      jti: randomUUID(),
    };
    const payload = this.encode(claims);
    const signingInput = `${header}.${payload}`;
    return {
      token: `${signingInput}.${this.signature(signingInput).toString('base64url')}`,
      expiresIn,
    };
  }

  verify(token: string): AccessTokenClaims {
    const parts = token.split('.');
    if (parts.length !== 3) throw new UnauthorizedException('访问令牌无效');

    try {
      const header = this.decode(parts[0]) as { alg?: unknown; typ?: unknown };
      if (header.alg !== 'HS256' || header.typ !== 'JWT') {
        throw new UnauthorizedException('访问令牌算法无效');
      }

      const signingInput = `${parts[0]}.${parts[1]}`;
      const expected = this.signature(signingInput);
      const actual = Buffer.from(parts[2], 'base64url');
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        throw new UnauthorizedException('访问令牌签名无效');
      }

      const claims = this.decode(parts[1]) as Partial<AccessTokenClaims>;
      const now = Math.floor(Date.now() / 1000);
      if (
        claims.iss !== TOKEN_ISSUER ||
        claims.aud !== TOKEN_AUDIENCE ||
        typeof claims.sub !== 'string' ||
        !claims.sub ||
        typeof claims.iat !== 'number' ||
        claims.iat > now + 30 ||
        typeof claims.exp !== 'number' ||
        claims.exp <= now ||
        claims.exp <= claims.iat ||
        typeof claims.jti !== 'string'
      ) {
        throw new UnauthorizedException('访问令牌已失效');
      }
      return claims as AccessTokenClaims;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('访问令牌无效');
    }
  }

  hashRefreshToken(token: string): string {
    const pepper = process.env.REFRESH_TOKEN_PEPPER;
    if (!pepper || Buffer.byteLength(pepper) < 32) {
      throw new InternalServerErrorException('REFRESH_TOKEN_PEPPER 必须至少为 32 字节');
    }
    return createHmac('sha256', pepper).update(token).digest('hex');
  }

  refreshTtlMilliseconds(): number {
    const days = Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 14);
    if (!Number.isInteger(days) || days < 1 || days > 90) {
      throw new InternalServerErrorException('REFRESH_TOKEN_TTL_DAYS 必须为 1 至 90 的整数');
    }
    return days * 24 * 60 * 60 * 1000;
  }

  private accessTtlSeconds(): number {
    const ttl = Number(process.env.TOKEN_TTL ?? DEFAULT_ACCESS_TTL_SECONDS);
    if (!Number.isInteger(ttl) || ttl < 60 || ttl > 60 * 60) {
      throw new InternalServerErrorException('TOKEN_TTL 必须为 60 至 3600 秒的整数');
    }
    return ttl;
  }

  private signature(value: string): Buffer {
    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret || Buffer.byteLength(secret) < 32) {
      throw new InternalServerErrorException('JWT_ACCESS_SECRET 必须至少为 32 字节');
    }
    return createHmac('sha256', secret).update(value).digest();
  }

  private encode(value: object): string {
    return Buffer.from(JSON.stringify(value)).toString('base64url');
  }

  private decode(value: string): unknown {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
  }
}

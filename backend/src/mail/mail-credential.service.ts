import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

/**
 * 邮箱凭据加密（技术设计 §5.1 / NFR-4）：
 * 授权码只以密文入库，接口仅返回配置状态；密钥不落库、不写日志。
 */
@Injectable()
export class MailCredentialService {
  private cachedKey: Buffer | null = null;

  encrypt(plaintext: string): string {
    if (!plaintext) {
      throw new InternalServerErrorException('邮箱授权码不能为空');
    }
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key(), iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('base64')}.${tag.toString('base64')}.${encrypted.toString('base64')}`;
  }

  decrypt(payload: string): string {
    const [ivPart, tagPart, dataPart] = payload.split('.');
    if (!ivPart || !tagPart || !dataPart) {
      throw new InternalServerErrorException('邮箱凭据密文格式无效');
    }
    const iv = Buffer.from(ivPart, 'base64');
    const tag = Buffer.from(tagPart, 'base64');
    if (iv.length !== IV_BYTES || tag.length !== 16) {
      throw new InternalServerErrorException('邮箱凭据密文格式无效');
    }
    const decipher = createDecipheriv(ALGORITHM, this.key(), iv, { authTagLength: 16 });
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(dataPart, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  private key(): Buffer {
    if (this.cachedKey) return this.cachedKey;

    const configured = process.env.MAIL_CREDENTIAL_KEY?.trim();
    if (configured) {
      const decoded = this.decodeKey(configured);
      if (!decoded) {
        throw new InternalServerErrorException('MAIL_CREDENTIAL_KEY 必须是 32 字节的 base64 或 hex');
      }
      this.cachedKey = decoded;
      return decoded;
    }

    if (process.env.APP_ENV !== 'local' || process.env.NODE_ENV === 'production') {
      throw new InternalServerErrorException('非本地环境必须配置 MAIL_CREDENTIAL_KEY');
    }

    // 本地开发回退：从已有 JWT 密钥派生，避免为本地调试额外维护密钥
    const fallback = process.env.JWT_ACCESS_SECRET?.trim();
    if (!fallback) {
      throw new InternalServerErrorException('本地环境缺少 MAIL_CREDENTIAL_KEY 与 JWT_ACCESS_SECRET');
    }
    this.cachedKey = createHash('sha256').update(`mail-credential:${fallback}`).digest();
    return this.cachedKey;
  }

  private decodeKey(value: string): Buffer | null {
    const base64 = Buffer.from(value, 'base64');
    if (base64.length === 32) return base64;
    if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, 'hex');
    return null;
  }
}

import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import { MailConfigService } from './mail-config.service.js';
import { MailCredentialService } from './mail-credential.service.js';
import { classifyMailAttachments } from './mail-attachment.js';

const PDF_BASE64 = 'JVBERi0xLjQK';

function buildEml(attachments: Array<{ name: string; type: string; base64: string }>): Buffer {
  const boundary = 'BOUNDARY-ATS022';
  const parts = attachments.map(
    (item) =>
      `--${boundary}\r\nContent-Type: ${item.type}; name="${item.name}"\r\nContent-Disposition: attachment; filename="${item.name}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${item.base64}\r\n`,
  );
  return Buffer.from(
    [
      'From: hr@example.com',
      'To: ats@example.com',
      'Subject: resume',
      'MIME-Version: 1.0',
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      '--' + boundary,
      'Content-Type: text/plain',
      '',
      'body',
      ...parts,
      `--${boundary}--`,
      '',
    ].join('\r\n'),
    'utf8',
  );
}

describe('邮箱附件分流（FR-ENT-1 / 功能需求 §3.1）', () => {
  it('PDF/Word/图片走 AI 解析，Excel 走独立表格导入', async () => {
    const result = await classifyMailAttachments([
      { fileName: 'resume.pdf', mimeType: 'application/pdf', buffer: Buffer.from(PDF_BASE64, 'base64') },
      { fileName: 'resume.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from('PK') },
      { fileName: 'photo.png', mimeType: 'image/png', buffer: Buffer.from('x') },
      { fileName: 'batch.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('x') },
      { fileName: 'batch.csv', mimeType: 'text/csv', buffer: Buffer.from('x') },
    ]);

    expect(result.resume.map((item) => item.fileName)).toEqual(['resume.pdf', 'resume.docx', 'photo.png']);
    expect(result.excel.map((item) => item.fileName)).toEqual(['batch.xlsx', 'batch.csv']);
    expect(result.unsupported).toHaveLength(0);
  });

  it('.eml 容器先解包再分流，不被误判为格式不支持', async () => {
    const eml = buildEml([
      { name: 'inner.pdf', type: 'application/pdf', base64: PDF_BASE64 },
      { name: 'inner.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', base64: PDF_BASE64 },
    ]);

    const result = await classifyMailAttachments([
      { fileName: 'BOSS直聘-候选人.eml', mimeType: 'message/rfc822', buffer: eml },
    ]);

    expect(result.resume.map((item) => item.fileName)).toEqual(['inner.pdf']);
    expect(result.excel.map((item) => item.fileName)).toEqual(['inner.xlsx']);
    expect(result.unsupported).toHaveLength(0);
  });

  it('无法解包或超深嵌套的邮件容器记为不支持，不阻断其他附件', async () => {
    const broken = await classifyMailAttachments([
      { fileName: 'broken.eml', mimeType: 'message/rfc822', buffer: Buffer.from('not a mail') },
      { fileName: 'resume.pdf', mimeType: 'application/pdf', buffer: Buffer.from(PDF_BASE64, 'base64') },
    ]);

    expect(broken.unsupported.map((item) => item.fileName)).toEqual(['broken.eml']);
    expect(broken.resume).toHaveLength(1);
  });

  it('未知扩展名归入不支持，由监控页归因', async () => {
    const result = await classifyMailAttachments([
      { fileName: 'archive.zip', mimeType: 'application/zip', buffer: Buffer.from('x') },
    ]);
    expect(result.unsupported.map((item) => item.fileName)).toEqual(['archive.zip']);
  });
});

describe('邮箱凭据加密（技术设计 §5.1）', () => {
  beforeEach(() => {
    process.env.APP_ENV = 'local';
    process.env.JWT_ACCESS_SECRET = 'local-test-secret-at-least-32-bytes-long';
    delete process.env.MAIL_CREDENTIAL_KEY;
  });

  it('密文可还原明文，且同一明文两次加密结果不同', () => {
    const service = new MailCredentialService();
    const first = service.encrypt('授权码-123456');
    const second = service.encrypt('授权码-123456');

    expect(first).not.toBe(second);
    expect(first).not.toContain('授权码-123456');
    expect(service.decrypt(first)).toBe('授权码-123456');
    expect(service.decrypt(second)).toBe('授权码-123456');
  });

  it('篡改密文后解密失败，不会静默返回错误凭据', () => {
    const service = new MailCredentialService();
    const cipher = service.encrypt('secret');
    const tampered = cipher.replace(/.$/, (char) => (char === 'A' ? 'B' : 'A'));
    expect(() => service.decrypt(tampered)).toThrow();
  });
});

describe('邮箱配置校验（FR-ENT-1 / FR-ADM-6）', () => {
  function buildService() {
    const create = vi.fn().mockImplementation(({ data }) => ({
      id: 'cfg-1',
      provider: 'IMAP',
      active: true,
      folder: 'INBOX',
      pollIntervalSeconds: 300,
      lastPolledAt: null,
      lastPollStatus: null,
      lastError: null,
      lastErrorAt: null,
      consecutiveFailures: 0,
      lastFetchedCount: 0,
      lastCreatedCount: 0,
      lastDuplicateCount: 0,
      lastSkippedCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...data,
    }));
    const prisma = {
      mailInboxConfig: { findUnique: vi.fn().mockResolvedValue(null), create },
    } as unknown as PrismaService;
    return { service: new MailConfigService(prisma, new MailCredentialService()), create };
  }

  it('邮箱地址格式非法时拒绝创建', async () => {
    const { service } = buildService();
    await expect(service.create({ address: 'not-an-email' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('IMAP 配置缺少 host/username/授权码时拒绝创建', async () => {
    const { service } = buildService();
    await expect(
      service.create({ address: 'hr@example.com', host: 'imap.example.com' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('轮询间隔被夹到 30 秒下限，且凭据只以密文入库', async () => {
    const { service, create } = buildService();
    const view = await service.create({
      address: 'HR@Example.com',
      host: 'imap.example.com',
      username: 'hr@example.com',
      password: '授权码',
      pollIntervalSeconds: 1,
    });

    const data = create.mock.calls[0][0].data as Record<string, unknown>;
    expect(view.address).toBe('hr@example.com');
    expect(view.hasCredential).toBe(true);
    expect(data.secretCipher).not.toBe('授权码');
    expect(data.pollIntervalSeconds).toBe(30);
  });

  it('修改 IMAP 主机/端口/用户名/加密方式未重传授权码时拒绝，防止凭据外泄', async () => {
    const current = {
      id: 'cfg-1',
      address: 'hr@example.com',
      provider: 'IMAP',
      active: true,
      host: 'imap.example.com',
      port: 993,
      secure: true,
      username: 'hr@example.com',
      secretCipher: new MailCredentialService().encrypt('old-secret'),
      folder: 'INBOX',
      pollIntervalSeconds: 300,
    };
    const update = vi.fn();
    const prisma = {
      mailInboxConfig: {
        findUnique: vi.fn().mockResolvedValue(current),
        update,
      },
    } as unknown as PrismaService;
    const service = new MailConfigService(prisma, new MailCredentialService());

    await expect(
      service.update('cfg-1', { host: 'imap.attacker.example' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it('非本地环境拒绝私网 IMAP 主机与明文连接', async () => {
    const previousEnv = process.env.APP_ENV;
    process.env.APP_ENV = 'production';
    process.env.MAIL_CREDENTIAL_KEY = Buffer.alloc(32, 7).toString('base64');
    try {
      const { service } = buildService();
      await expect(
        service.create({
          address: 'hr@example.com',
          host: '169.254.169.254',
          username: 'hr@example.com',
          password: 'secret',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.create({
          address: 'hr@example.com',
          host: 'imap.example.com',
          port: 143,
          secure: false,
          username: 'hr@example.com',
          password: 'secret',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    } finally {
      process.env.APP_ENV = previousEnv;
      delete process.env.MAIL_CREDENTIAL_KEY;
    }
  });
});

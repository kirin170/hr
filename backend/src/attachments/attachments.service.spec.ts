import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataScope, SensitiveField } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../audit/audit.service.js';
import type { AuthorizationService } from '../auth/authorization.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { StorageService } from '../storage/storage.service.js';
import { AttachmentsService } from './attachments.service.js';

const actor: AuthenticatedUser = {
  id: 'user-1',
  displayName: '招聘 HR',
  departmentId: null,
  departmentIds: [],
  groupIds: [],
  roles: [],
};

const context = { requestId: 'req-1', ip: '127.0.0.1', userAgent: 'vitest' };

const file = {
  id: 'file-1',
  fileName: '张三-简历.pdf',
  mimeType: 'application/pdf',
  size: 2048,
  storageKey: 'resumes/abc.pdf',
  category: null as SensitiveField | null,
};

const makeService = () => {
  const prisma = {
    resumeFile: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    resumeIntake: { findMany: vi.fn().mockResolvedValue([]) },
    offerRecord: { findFirst: vi.fn().mockResolvedValue(null) },
  };
  const storage = {
    driverName: 'local',
    supportsSignedReadVerification: true,
    createReadUrl: vi
      .fn()
      .mockResolvedValue({ url: 'http://api.local/signed', expiresAt: new Date(1_800_000) }),
    verifySignedRead: vi.fn(),
    objectExists: vi.fn(),
    readObject: vi.fn(),
  };
  const authorization = {
    scopesFor: vi.fn().mockReturnValue([DataScope.ALL]),
    canAccessIntake: vi.fn(),
    assertSensitiveFieldAccess: vi.fn().mockResolvedValue(undefined),
  };
  const audit = { write: vi.fn().mockResolvedValue(undefined) };

  return {
    service: new AttachmentsService(
      prisma as unknown as PrismaService,
      storage as unknown as StorageService,
      authorization as unknown as AuthorizationService,
      audit as unknown as AuditService,
    ),
    mocks: { prisma, storage, authorization, audit },
  };
};

beforeEach(() => {
  delete process.env.SIGNED_URL_TTL_SECONDS;
});

describe('AttachmentsService 私有读与访问留痕（NFR-1/3/4）', () => {
  it('数据范围内签发短期签名链接并写入审计', async () => {
    const { service, mocks } = makeService();
    mocks.prisma.resumeFile.findUnique = vi.fn().mockResolvedValue(file);

    const result = await service.issueReadUrl('file-1', actor, context);

    expect(result).toMatchObject({
      fileId: 'file-1',
      fileName: '张三-简历.pdf',
      driver: 'local',
      url: 'http://api.local/signed',
    });
    expect(mocks.storage.createReadUrl).toHaveBeenCalledWith({
      key: 'resumes/abc.pdf',
      ttlSeconds: 300,
      actorId: actor.id,
    });
    expect(mocks.audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: actor.id,
        action: 'attachment.read_url_issued',
        resourceType: 'ResumeFile',
        resourceId: 'file-1',
        requestId: 'req-1',
      }),
    );
    expect(mocks.prisma.resumeFile.update).toHaveBeenCalled();
  });

  it('敏感材料缺少独立授权时拒绝签发', async () => {
    const { service, mocks } = makeService();
    mocks.prisma.resumeFile.findUnique = vi
      .fn()
      .mockResolvedValue({ ...file, category: SensitiveField.BANK_STATEMENTS });
    mocks.authorization.assertSensitiveFieldAccess = vi
      .fn()
      .mockRejectedValue(new ForbiddenException('缺少该敏感字段的独立授权'));

    await expect(service.issueReadUrl('file-1', actor, context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(mocks.storage.createReadUrl).not.toHaveBeenCalled();
    expect(mocks.audit.write).not.toHaveBeenCalled();
  });

  it('超出数据范围时按不存在处理，不泄露附件存在性', async () => {
    const { service, mocks } = makeService();
    mocks.prisma.resumeFile.findUnique = vi.fn().mockResolvedValue(file);
    mocks.authorization.scopesFor = vi.fn().mockReturnValue([DataScope.SELF]);
    mocks.prisma.resumeIntake.findMany = vi.fn().mockResolvedValue([
      {
        candidateId: 'candidate-1',
        duplicateOfCandidateId: null,
        jobId: null,
        createdById: 'user-2',
      },
    ]);
    mocks.authorization.canAccessIntake = vi.fn().mockResolvedValue(false);

    await expect(service.issueReadUrl('file-1', actor, context)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(mocks.storage.createReadUrl).not.toHaveBeenCalled();
  });

  it('签名链接校验失败或过期时拒绝回源', async () => {
    const { service, mocks } = makeService();
    mocks.storage.verifySignedRead = vi.fn().mockReturnValue(false);

    await expect(
      service.openSignedContent(
        { key: 'resumes/abc.pdf', expires: String(Date.now() - 1000), actor: 'user-1', signature: 'a'.repeat(64) },
        context,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(mocks.storage.readObject).not.toHaveBeenCalled();
    expect(mocks.audit.write).not.toHaveBeenCalled();
  });

  it('签名有效时回源读取并记录下载审计', async () => {
    const { service, mocks } = makeService();
    mocks.storage.verifySignedRead = vi.fn().mockReturnValue(true);
    mocks.storage.objectExists = vi.fn().mockResolvedValue(true);
    mocks.storage.readObject = vi.fn().mockResolvedValue(Buffer.from('%PDF-1.7'));
    mocks.prisma.resumeFile.findFirst = vi.fn().mockResolvedValue({
      id: 'file-1',
      fileName: '张三-简历.pdf',
      mimeType: 'application/pdf',
      size: 8,
      category: null,
    });

    const result = await service.openSignedContent(
      { key: 'resumes/abc.pdf', expires: String(Date.now() + 60_000), actor: 'user-1', signature: 'a'.repeat(64) },
      context,
    );

    expect(result.buffer).toEqual(Buffer.from('%PDF-1.7'));
    expect(mocks.audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user-1',
        action: 'attachment.downloaded',
        resourceId: 'file-1',
      }),
    );
  });
});

import { SensitiveField } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../audit/audit.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { StorageService } from '../storage/storage.service.js';
import type { TimelineService } from '../timeline/timeline.service.js';
import { RetentionService } from './retention.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const now = new Date('2026-11-16T00:00:00.000Z');
const daysAgo = (days: number) => new Date(now.getTime() - days * DAY_MS);

const makeService = () => {
  const prisma = {
    resumeFile: {
      findMany: vi.fn(),
      delete: vi.fn().mockResolvedValue({}),
    },
    resumeIntake: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    retentionRun: { create: vi.fn().mockResolvedValue({ id: 'run-1' }) },
  };
  const storage = {
    driverName: 'local',
    deleteObject: vi.fn().mockResolvedValue(undefined),
  };
  const audit = { write: vi.fn().mockResolvedValue(undefined) };
  const timeline = { record: vi.fn().mockResolvedValue(undefined) };

  return {
    service: new RetentionService(
      prisma as unknown as PrismaService,
      storage as unknown as StorageService,
      audit as unknown as AuditService,
      timeline as unknown as TimelineService,
    ),
    mocks: { prisma, storage, audit, timeline },
  };
};

const expiredResume = {
  id: 'file-old',
  fileName: 'old.pdf',
  size: 1024,
  storageKey: 'resumes/old.pdf',
  category: null as SensitiveField | null,
  expiresAt: null as Date | null,
  createdAt: daysAgo(400),
};
const expiredSensitive = {
  id: 'file-bg',
  fileName: 'bg-check.pdf',
  size: 2048,
  storageKey: 'resumes/bg.pdf',
  category: SensitiveField.BACKGROUND_MATERIALS as SensitiveField | null,
  expiresAt: null as Date | null,
  createdAt: daysAgo(200),
};
const activeResume = {
  id: 'file-active',
  fileName: 'active.pdf',
  size: 512,
  storageKey: 'resumes/active.pdf',
  category: null as SensitiveField | null,
  expiresAt: null as Date | null,
  createdAt: daysAgo(200),
};

beforeEach(() => {
  process.env.RETENTION_RESUME_DAYS = '365';
  process.env.RETENTION_SENSITIVE_DAYS = '180';
  delete process.env.RETENTION_BATCH_SIZE;
});

describe('RetentionService 到期清理（NFR-2 / 技术设计 §13.2）', () => {
  it('dryRun 只统计到期数量，不删除文件或结构化记录', async () => {
    const { service, mocks } = makeService();
    mocks.prisma.resumeFile.findMany = vi
      .fn()
      .mockResolvedValue([expiredResume, expiredSensitive, activeResume]);

    const summary = await service.purgeExpired({ now, dryRun: true });

    expect(summary).toMatchObject({
      scanned: 3,
      expired: 2,
      deletedFiles: 0,
      detachedIntakes: 0,
      dryRun: true,
      runId: null,
    });
    expect(mocks.storage.deleteObject).not.toHaveBeenCalled();
    expect(mocks.prisma.resumeFile.delete).not.toHaveBeenCalled();
    expect(mocks.prisma.retentionRun.create).not.toHaveBeenCalled();
    expect(mocks.audit.write).not.toHaveBeenCalled();
  });

  it('清理同时删除对象存储文件、结构化记录并保留时间线与审计', async () => {
    const { service, mocks } = makeService();
    mocks.prisma.resumeFile.findMany = vi
      .fn()
      .mockResolvedValue([expiredResume, expiredSensitive, activeResume]);

    const summary = await service.purgeExpired({ now, actorId: 'admin-1', requestId: 'req-1' });

    expect(summary).toMatchObject({
      scanned: 3,
      expired: 2,
      deletedFiles: 2,
      detachedIntakes: 2,
      failedDeletes: 0,
      dryRun: false,
      runId: 'run-1',
    });
    expect(mocks.storage.deleteObject.mock.calls).toEqual([
      ['resumes/old.pdf'],
      ['resumes/bg.pdf'],
    ]);
    expect(mocks.prisma.resumeIntake.updateMany).toHaveBeenCalledWith({
      where: { resumeFileId: 'file-old' },
      data: { resumeFileId: null },
    });
    expect(mocks.prisma.resumeFile.delete).toHaveBeenCalledTimes(2);
    expect(mocks.timeline.record).toHaveBeenCalledTimes(2);
    expect(mocks.timeline.record).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'ResumeFile',
        entityId: 'file-old',
        action: 'attachment.purged',
        actorId: 'admin-1',
      }),
    );
    expect(mocks.audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'retention.purge',
        resourceType: 'RetentionRun',
        resourceId: 'run-1',
        requestId: 'req-1',
      }),
    );
  });

  it('对象删除失败时保留结构化记录，等待下次重试', async () => {
    const { service, mocks } = makeService();
    mocks.prisma.resumeFile.findMany = vi.fn().mockResolvedValue([expiredResume]);
    mocks.storage.deleteObject = vi.fn().mockRejectedValue(new Error('oss timeout'));

    const summary = await service.purgeExpired({ now });

    expect(summary).toMatchObject({ expired: 1, deletedFiles: 0, failedDeletes: 1 });
    expect(mocks.prisma.resumeFile.delete).not.toHaveBeenCalled();
    expect(mocks.prisma.resumeIntake.updateMany).not.toHaveBeenCalled();
    expect(mocks.timeline.record).not.toHaveBeenCalled();
  });

  it('写入时记录的到期时间更早时立即生效，配置收紧不延长保留', async () => {
    const { service, mocks } = makeService();
    mocks.prisma.resumeFile.findMany = vi.fn().mockResolvedValue([
      { ...activeResume, id: 'file-due', expiresAt: new Date(now.getTime() - DAY_MS) },
    ]);

    const summary = await service.purgeExpired({ now });

    expect(summary).toMatchObject({ scanned: 1, expired: 1, deletedFiles: 1 });
    expect(mocks.storage.deleteObject).toHaveBeenCalledWith('resumes/active.pdf');
  });

  it('对外暴露可配置的保留期限', () => {
    const { service } = makeService();
    expect(service.policy()).toMatchObject({ resumeDays: 365, sensitiveDays: 180 });
  });
});

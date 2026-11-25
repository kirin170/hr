import { BadRequestException } from '@nestjs/common';
import { DataScope } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { AuthorizationService } from '../auth/authorization.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { ParseQueueService } from '../ai/parse.queue.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { TimelineService } from '../timeline/timeline.service.js';
import { IntakeService } from './intake.service.js';

const actor: AuthenticatedUser = {
  id: 'user-1',
  displayName: '招聘 HR',
  departmentId: null,
  departmentIds: [],
  groupIds: [],
  roles: [],
};

function buildService(
  prisma: unknown,
  authorization: unknown,
  queue: unknown = {},
  timeline: unknown = { record: vi.fn() },
): IntakeService {
  return new IntakeService(
    prisma as PrismaService,
    timeline as TimelineService,
    {} as StorageService,
    queue as ParseQueueService,
    authorization as AuthorizationService,
  );
}

describe('IntakeService 来源记录（ATS-009）', () => {
  it('手工录入写入推荐人与来源标识，并保留在入场记录上', async () => {
    const prisma = {
      candidate: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'cand-1' }),
      },
      resumeIntake: {
        create: vi.fn().mockResolvedValue({ id: 'intake-1', status: 'PARSED' }),
      },
      candidateSourceRecord: {
        create: vi.fn().mockResolvedValue({ id: 'source-1' }),
      },
    };
    const authorization = {
      loadUserContext: vi.fn().mockResolvedValue(actor),
      assertSensitiveFieldAccess: vi.fn().mockResolvedValue(undefined),
    };
    const service = buildService(prisma, authorization);

    const result = await service.ingestManual({
      name: '张三',
      phone: '13800000001',
      source: 'REFERRAL',
      referrerName: '王推荐',
      referrerContact: 'EMP-1001',
      referralCode: 'REF-9',
      sourceNote: '内部推荐活动',
      actorId: actor.id,
    });

    expect(prisma.resumeIntake.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          referrerName: '王推荐',
          referrerContact: 'EMP-1001',
          referralCode: 'REF-9',
          sourceNote: '内部推荐活动',
        }),
      }),
    );
    expect(prisma.candidateSourceRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          candidateId: 'cand-1',
          intakeId: 'intake-1',
          source: 'REFERRAL',
          referrerName: '王推荐',
          referralCode: 'REF-9',
        }),
      }),
    );
    expect(result).toMatchObject({ candidateId: 'cand-1', duplicate: false });
  });

  it('查重合并把重复记录的来源写入原候选人来源台账', async () => {
    const tx = {
      resumeIntake: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      candidateSourceRecord: {
        upsert: vi.fn().mockResolvedValue({ id: 'source-2' }),
      },
    };
    const prisma = {
      resumeIntake: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'intake-dup',
          status: 'DUPLICATE',
          candidateId: null,
          duplicateOfCandidateId: 'cand-1',
          jobId: 'job-1',
          createdById: 'user-1',
          source: 'REFERRAL',
          entryMode: 'MANUAL',
          resumeFileId: null,
          referrerName: '王推荐',
          referrerContact: null,
          referralCode: 'REF-9',
          sourceNote: '内部推荐',
          mergedAt: null,
        }),
      },
      $transaction: vi.fn().mockImplementation((fn: (client: unknown) => unknown) => fn(tx)),
    };
    const authorization = {
      loadUserContext: vi.fn().mockResolvedValue(actor),
      canAccessIntake: vi.fn().mockResolvedValue(true),
      canAccessCandidate: vi.fn().mockResolvedValue(true),
    };
    const service = buildService(prisma, authorization);

    const result = await service.mergeDuplicate('intake-dup', actor.id);

    expect(tx.resumeIntake.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'intake-dup', status: 'DUPLICATE', mergedAt: null },
      }),
    );
    expect(tx.candidateSourceRecord.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          candidateId: 'cand-1',
          intakeId: 'intake-dup',
          source: 'REFERRAL',
          referrerName: '王推荐',
          referralCode: 'REF-9',
          note: '内部推荐',
        }),
      }),
    );
    const createPayload = tx.candidateSourceRecord.upsert.mock.calls[0][0].create as Record<string, unknown>;
    expect(createPayload).not.toHaveProperty('sourceNote');
    expect(result).toMatchObject({ candidateId: 'cand-1', sourceRecordId: 'source-2' });
  });

  it('来源台账按来源与推荐人筛选，并隐藏无权限的联系方式', async () => {
    const prisma = {
      candidateSourceRecord: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'source-1',
            candidateId: 'cand-1',
            intakeId: 'intake-1',
            source: 'REFERRAL',
            entryMode: 'MANUAL',
            jobId: 'job-1',
            referrerName: '王推荐',
            referrerContact: 'EMP-1001',
            referralCode: 'REF-9',
            note: null,
            mergedFromCandidateId: null,
            createdById: 'user-1',
            createdAt: new Date('2026-11-18T02:00:00Z'),
          },
        ]),
        count: vi.fn().mockResolvedValue(1),
      },
      candidate: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'cand-1',
            name: '张三',
            phone: '13800000001',
            email: 'zs@example.com',
            stage: 'RECOMMENDED',
            jobId: 'job-1',
          },
        ]),
      },
      job: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'job-1', code: 'MJ000001', title: '后端工程师', isVirtual: false },
        ]),
      },
    };
    const authorization = {
      loadUserContext: vi.fn().mockResolvedValue(actor),
      scopesFor: vi.fn().mockReturnValue([DataScope.ALL]),
      canAccessSensitiveField: vi.fn().mockResolvedValue(false),
    };
    const service = buildService(prisma, authorization);

    const result = await service.listSources(
      { source: 'REFERRAL', referrer: '王推荐', page: 1, pageSize: 20 },
      actor,
    );

    expect(prisma.candidateSourceRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: expect.arrayContaining([
            { source: 'REFERRAL' },
            {
              OR: [
                { referrerName: { contains: '王推荐' } },
                { referrerContact: { contains: '王推荐' } },
                { referralCode: { contains: '王推荐' } },
              ],
            },
          ]),
        },
      }),
    );
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      referrerName: '王推荐',
      candidate: { name: '张三', phone: null, email: null },
      job: { code: 'MJ000001' },
    });
  });
});

describe('IntakeService 校园招聘投递（ATS-009）', () => {
  function campusPrisma(job: Record<string, unknown>, duplicate: unknown = null) {
    const tx = {
      candidate: { create: vi.fn().mockResolvedValue({ id: 'cand-1' }) },
      resumeIntake: {
        create: vi.fn().mockResolvedValue({ id: 'intake-1' }),
        update: vi.fn().mockResolvedValue({ id: 'intake-1' }),
      },
      candidateSourceRecord: { create: vi.fn().mockResolvedValue({ id: 'source-1' }) },
      campusApplication: {
        create: vi.fn().mockResolvedValue({ id: 'app-1', status: 'SUBMITTED' }),
      },
      aIRun: { create: vi.fn().mockResolvedValue({ id: 'run-1' }) },
    };
    return {
      tx,
      prisma: {
        job: { findUnique: vi.fn().mockResolvedValue(job) },
        candidate: { findFirst: vi.fn().mockResolvedValue(duplicate) },
        resumeIntake: { create: vi.fn().mockResolvedValue({ id: 'intake-dup' }) },
        campusApplication: {
          create: vi.fn().mockResolvedValue({ id: 'app-dup', status: 'SUBMITTED' }),
        },
        $transaction: vi.fn().mockImplementation((fn: (client: unknown) => unknown) => fn(tx)),
      },
    };
  }

  it('虚拟职位投递进入校招容器并保留个人意愿', async () => {
    const { prisma, tx } = campusPrisma({
      id: 'job-virtual',
      code: 'V001',
      title: '2027 校招',
      isVirtual: true,
      status: 'ACTIVE',
    });
    const service = buildService(prisma, {});

    const result = await service.campusApply({
      name: '李四',
      phone: '13800000002',
      jobId: 'job-virtual',
      school: '示例大学',
      major: '计算机',
      graduationYear: '2027',
      expectedCity: '杭州',
      desiredPositions: '后端工程师, 产品经理',
      remark: '可实习',
    });

    expect(tx.candidate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: '李四',
          source: 'CAMPUS',
          entryMode: 'APPLICATION',
          poolType: 'VIRTUAL',
          stage: 'VIRTUAL_POOL',
        }),
      }),
    );
    const applicationData = tx.campusApplication.create.mock.calls[0][0].data;
    expect(applicationData).toMatchObject({
      intakeId: 'intake-1',
      candidateId: 'cand-1',
      jobId: 'job-virtual',
      jobIsVirtual: true,
      status: 'SUBMITTED',
      assignedJobId: null,
      expectedCity: '杭州',
    });
    expect(JSON.parse(applicationData.preferences)).toMatchObject({
      desiredPositions: ['后端工程师', '产品经理'],
      school: '示例大学',
      expectedCity: '杭州',
      graduationYear: '2027',
    });
    expect(tx.candidateSourceRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          candidateId: 'cand-1',
          source: 'CAMPUS',
          entryMode: 'APPLICATION',
        }),
      }),
    );
    expect(result).toMatchObject({ jobIsVirtual: true, status: 'SUBMITTED' });
    expect(result).not.toHaveProperty('duplicate');
    expect(result).not.toHaveProperty('candidateId');
  });

  it('带正式职位投递直入 RECOMMENDED 并记录分配结果', async () => {
    const { prisma, tx } = campusPrisma({
      id: 'job-1',
      code: 'MJ000001',
      title: '后端工程师',
      isVirtual: false,
      status: 'ACTIVE',
    });
    tx.campusApplication.create.mockResolvedValue({ id: 'app-1', status: 'ASSIGNED' });
    const service = buildService(prisma, {});

    const result = await service.campusApply({
      name: '王五',
      email: 'ww@example.com',
      jobId: 'job-1',
    });

    expect(tx.candidate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ stage: 'RECOMMENDED', poolType: 'NONE' }),
      }),
    );
    expect(tx.campusApplication.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'ASSIGNED',
          assignedJobId: 'job-1',
          assignedAt: expect.any(Date),
        }),
      }),
    );
    expect(result).toMatchObject({ jobIsVirtual: false, status: 'SUBMITTED' });
    expect(result).not.toHaveProperty('duplicate');
    expect(result).not.toHaveProperty('candidateId');
  });

  it('重复手机号投递按查重处理，不覆盖已有候选人且公开响应不暴露查重结果', async () => {
    const { prisma, tx } = campusPrisma(
      { id: 'job-virtual', code: 'V001', title: '2027 校招', isVirtual: true, status: 'ACTIVE' },
      { id: 'cand-existing' },
    );
    const service = buildService(prisma, {});

    const result = await service.campusApply({
      name: '张三',
      phone: '13800000001',
      jobId: 'job-virtual',
      referrerName: '王推荐',
    });

    expect(tx.candidate.create).not.toHaveBeenCalled();
    expect(prisma.resumeIntake.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source: 'CAMPUS',
          entryMode: 'APPLICATION',
          status: 'DUPLICATE',
          duplicateOfCandidateId: 'cand-existing',
          referrerName: '王推荐',
        }),
      }),
    );
    expect(result).toMatchObject({
      applicationId: 'app-dup',
      status: 'SUBMITTED',
      jobIsVirtual: true,
    });
    expect(result).not.toHaveProperty('duplicate');
    expect(result).not.toHaveProperty('candidateId');
  });

  it('校招批量人工分配正式职位，只记录分配结果不覆盖原始意愿', async () => {
    const prisma = {
      job: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'job-1',
          code: 'MJ000001',
          title: '后端工程师',
          isVirtual: false,
          recruiterId: 'user-9',
        }),
      },
      campusApplication: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'app-1', intakeId: 'intake-1', candidateId: 'cand-1' },
        ]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      resumeIntake: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'intake-1',
          candidateId: 'cand-1',
          duplicateOfCandidateId: null,
          jobId: 'job-virtual',
          createdById: 'user-1',
        }),
        update: vi.fn().mockResolvedValue({ id: 'intake-1' }),
      },
      candidate: { update: vi.fn().mockResolvedValue({ id: 'cand-1' }) },
      $transaction: vi.fn().mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    const authorization = {
      loadUserContext: vi.fn().mockResolvedValue(actor),
      canAccessJob: vi.fn().mockResolvedValue(true),
      canAccessIntake: vi.fn().mockResolvedValue(true),
    };
    const service = buildService(prisma, authorization);

    const result = await service.assignCampusApplications(['app-1'], 'job-1', actor.id);

    expect(result).toMatchObject({ assigned: 1, failed: 0 });
    const updateArgs = prisma.campusApplication.updateMany.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(updateArgs.data).toMatchObject({
      candidateId: 'cand-1',
      assignedJobId: 'job-1',
      assignedById: 'user-1',
      status: 'ASSIGNED',
    });
    expect(updateArgs.data).not.toHaveProperty('preferences');
  });

  it('校招人工分配拒绝虚拟职位', async () => {
    const prisma = {
      job: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'job-virtual',
          code: 'V001',
          title: '2027 校招',
          isVirtual: true,
          recruiterId: null,
        }),
      },
    };
    const authorization = {
      loadUserContext: vi.fn().mockResolvedValue(actor),
      canAccessJob: vi.fn().mockResolvedValue(true),
    };
    const service = buildService(prisma, authorization);

    await expect(
      service.assignCampusApplications(['app-1'], 'job-virtual', actor.id),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

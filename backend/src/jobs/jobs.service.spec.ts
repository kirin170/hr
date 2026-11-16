import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DataScope } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { AuthorizationService } from '../auth/authorization.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { JobsService } from './jobs.service.js';

const actor: AuthenticatedUser = {
  id: 'user-1',
  displayName: '招聘 HR',
  departmentId: 'dept-1',
  departmentIds: ['dept-1'],
  groupIds: [],
  roles: [
    {
      code: 'RECRUITER',
      name: '招聘 HR',
      dataScope: DataScope.OWN_JOBS,
      permissions: ['job:read', 'job:create', 'job:update', 'job:close'],
    },
  ],
};

const makeJob = (overrides: Record<string, unknown> = {}) => ({
  id: 'job-1',
  code: 'MJ000001',
  title: '前端工程师',
  departmentId: 'dept-1',
  location: '上海',
  recruiterId: 'user-1',
  requirements: '熟悉 React',
  headcount: 2,
  hiredCount: 0,
  status: 'ACTIVE',
  interviewPlanId: null,
  sources: 'BOSS直聘',
  isVirtual: false,
  requisitionId: null,
  createdAt: new Date(Date.UTC(2026, 10, 1)),
  updatedAt: new Date(Date.UTC(2026, 10, 1)),
  ...overrides,
});

const makeService = (options: {
  job?: unknown;
  lastCode?: string | null;
  created?: unknown;
  findMany?: unknown[];
} = {}) => {
  const jobFindFirst = vi.fn(
    async (args?: { where?: { code?: { startsWith?: string } } }) => {
      if (args?.where?.code?.startsWith === 'MJ') {
        return options.lastCode ? { code: options.lastCode } : null;
      }
      return options.job ?? null;
    },
  );
  const prisma = {
    department: { findUnique: vi.fn().mockResolvedValue({ id: 'dept-1' }) },
    user: { findUnique: vi.fn().mockResolvedValue({ id: 'user-1' }) },
    jobRequisition: { findUnique: vi.fn().mockResolvedValue({ id: 'req-1' }) },
    job: {
      findFirst: jobFindFirst,
      findMany: vi.fn().mockResolvedValue(options.findMany ?? []),
      count: vi.fn().mockResolvedValue(options.findMany?.length ?? 0),
      create: vi.fn().mockResolvedValue(options.created ?? makeJob()),
      update: vi.fn().mockResolvedValue(makeJob({ status: 'CLOSED' })),
    },
    candidate: { count: vi.fn().mockResolvedValue(3) },
    timelineEvent: { create: vi.fn().mockResolvedValue({}), findMany: vi.fn().mockResolvedValue([]) },
  };
  const prismaService = {
    ...prisma,
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
  } as unknown as PrismaService;

  const authorization = {
    jobWhere: vi.fn().mockReturnValue({ recruiterId: actor.id }),
  } as unknown as AuthorizationService;
  return { service: new JobsService(prismaService, authorization), prisma };
};

describe('JobsService 职位编号与虚拟职位（FR-JOB-1/FR-JOB-6）', () => {
  it('首个职位编号为 MJ000001', async () => {
    const { service, prisma } = makeService({ lastCode: null });

    await service.create({ title: '前端工程师', departmentId: 'dept-1' }, actor);

    expect(prisma.job.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ code: 'MJ000001' }) }),
    );
  });

  it('后续职位编号按 MJ%06d 递增', async () => {
    const { service, prisma } = makeService({ lastCode: 'MJ000041' });

    await service.create({ title: '前端工程师', departmentId: 'dept-1' }, actor);

    expect(prisma.job.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ code: 'MJ000042' }) }),
    );
  });

  it('普通职位筛选默认排除虚拟职位', async () => {
    const { service, prisma } = makeService({ findMany: [] });

    await service.list(actor, {});

    expect(prisma.job.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: expect.arrayContaining([expect.objectContaining({ isVirtual: false })]),
        },
      }),
    );
  });

  it('虚拟职位可通过 isVirtual=true 单独筛选', async () => {
    const { service, prisma } = makeService({ findMany: [] });

    await service.list(actor, { isVirtual: 'true' });

    expect(prisma.job.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: expect.arrayContaining([expect.objectContaining({ isVirtual: true })]),
        },
      }),
    );
  });
});

describe('JobsService 招聘要求与 HC（FR-JOB-3/FR-JOB-4）', () => {
  it('非招聘负责人不能编辑招聘要求', async () => {
    const { service, prisma } = makeService({ job: makeJob({ recruiterId: 'user-2' }) });

    await expect(
      service.update('job-1', { requirements: '新的招聘要求' }, actor),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.job.update).not.toHaveBeenCalled();
  });

  it('招聘负责人可编辑招聘要求并留痕', async () => {
    const { service, prisma } = makeService({ job: makeJob() });

    await service.update('job-1', { requirements: '新的招聘要求' }, actor);

    expect(prisma.job.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { requirements: '新的招聘要求' },
    });
    expect(prisma.timelineEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'job.updated',
        payload: expect.objectContaining({
          changes: { requirements: { from: '熟悉 React', to: '新的招聘要求' } },
        }),
      }),
    });
  });

  it('招聘人数不能小于已入职人数', async () => {
    const { service } = makeService({ job: makeJob({ hiredCount: 2 }) });

    await expect(service.update('job-1', { headcount: 1 }, actor)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('HC 满员仅提示关闭，不自动关闭', async () => {
    const { service } = makeService({
      findMany: [makeJob({ headcount: 2, hiredCount: 2 })],
    });

    const result = await service.list(actor, {});

    expect(result.items[0].headcountFull).toBe(true);
    expect(result.items[0].headcountHint).toContain('建议关闭职位');
    expect(result.items[0].status).toBe('ACTIVE');
  });
});

describe('JobsService 关闭职位（FR-JOB-5）', () => {
  it('关闭职位只改职位状态，不改动流程中候选人', async () => {
    const { service, prisma } = makeService({ job: makeJob() });

    const result = await service.close('job-1', actor);

    expect(prisma.job.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { status: 'CLOSED' },
    });
    expect(prisma.candidate.count).toHaveBeenCalledWith({
      where: { jobId: 'job-1', stage: { notIn: ['ARCHIVED', 'ENDED', 'ONBOARDED'] } },
    });
    expect((prisma.candidate as Record<string, unknown>).update).toBeUndefined();
    expect((prisma.candidate as Record<string, unknown>).updateMany).toBeUndefined();
    expect(result.changed).toBe(true);
    expect(result.candidatesInProcess).toBe(3);
  });

  it('重复关闭返回现状且不重复写时间线', async () => {
    const { service, prisma } = makeService({ job: makeJob({ status: 'CLOSED' }) });

    const result = await service.close('job-1', actor);

    expect(result.changed).toBe(false);
    expect(prisma.job.update).not.toHaveBeenCalled();
    expect(prisma.timelineEvent.create).not.toHaveBeenCalled();
  });
});

describe('JobsService 职位筛选（FR-JOB-2）', () => {
  it('支持按编号、部门、渠道、负责人与简历更新时间筛选', async () => {
    const { service, prisma } = makeService({ findMany: [] });

    await service.list(actor, {
      code: 'MJ0000',
      departmentId: 'dept-1',
      channel: 'BOSS',
      recruiterId: 'user-1',
      resumeUpdatedFrom: '2026-11-01',
      resumeUpdatedTo: '2026-11-16',
    });

    const args = prisma.job.findMany.mock.calls[0][0] as {
      where: { AND: Record<string, unknown>[] };
    };
    const conditions = JSON.stringify(args.where.AND);
    expect(conditions).toContain('MJ0000');
    expect(conditions).toContain('dept-1');
    expect(conditions).toContain('BOSS');
    expect(conditions).toContain('candidates');
  });

  it('非法状态筛选被拒绝', async () => {
    const { service } = makeService({ findMany: [] });

    await expect(service.list(actor, { status: 'PAUSED' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

import { BadRequestException, ConflictException } from '@nestjs/common';
import { DataScope } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { AuthorizationService } from '../auth/authorization.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RequisitionsService } from './requisitions.service.js';

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
      permissions: ['requisition:read', 'requisition:manage', 'requisition:sync'],
    },
  ],
};

type RecordOverrides = Partial<Record<string, unknown>>;

const makeRecord = (overrides: RecordOverrides = {}) => ({
  id: 'req-1',
  oaApprovalId: 'OA-2026-0001',
  oaApprovalTitle: null,
  title: '后端工程师',
  departmentId: 'dept-1',
  recruiterId: 'user-1',
  jobLevel: 'P6',
  headcount: 2,
  source: 'DINGTALK_OA',
  status: 'ACTIVE',
  submittedAt: new Date(Date.UTC(2026, 10, 1)),
  recruitmentStartDate: new Date(Date.UTC(2026, 10, 3)),
  closedAt: null,
  cycleDays: null,
  cycleEligible: true,
  note: null,
  requirements: null,
  version: 1,
  createdAt: new Date(Date.UTC(2026, 10, 1)),
  updatedAt: new Date(Date.UTC(2026, 10, 1)),
  ...overrides,
});

const makeService = (options: {
  record?: unknown;
  findUnique?: ReturnType<typeof vi.fn>;
  create?: ReturnType<typeof vi.fn>;
} = {}) => {
  const prisma = {
    department: { findFirst: vi.fn().mockResolvedValue({ id: 'dept-1' }) },
    jobRequisition: {
      findUnique: options.findUnique ?? vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(options.record ?? null),
      create: options.create ?? vi.fn().mockResolvedValue(makeRecord()),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue(makeRecord()),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    job: { findMany: vi.fn().mockResolvedValue([]) },
    timelineEvent: { create: vi.fn().mockResolvedValue({}), findMany: vi.fn().mockResolvedValue([]) },
  } as unknown as PrismaService & {
    jobRequisition: {
      findUnique: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
      findUniqueOrThrow: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
    };
    timelineEvent: { create: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
    $transaction: unknown;
  };
  (prisma as unknown as { $transaction: unknown }).$transaction = vi.fn(
    async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma),
  );
  const authorization = {
    requisitionWhere: vi.fn().mockReturnValue({ OR: [{ recruiterId: actor.id }] }),
  } as unknown as AuthorizationService;
  return { service: new RequisitionsService(prisma, authorization), prisma };
};

const syncPayload = {
  oaApprovalId: 'OA-2026-0001',
  title: '后端工程师',
  departmentId: 'dept-1',
  headcount: 2,
  submittedAt: '2026-11-01',
  recruitmentStartDate: '2026-11-03',
};

describe('RequisitionsService OA 需求同步幂等（FR-REQ-1 / REQ-1）', () => {
  it('首次回调生成需求并写入时间线', async () => {
    const { service, prisma } = makeService();

    const result = await service.syncFromOa(syncPayload, actor);

    expect(result.created).toBe(true);
    expect(prisma.jobRequisition.create).toHaveBeenCalledTimes(1);
    expect(prisma.timelineEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'requisition.created_from_oa', actorId: actor.id }),
    });
  });

  it('重复回调按 oaApprovalId 返回已有需求且不重复落库', async () => {
    const existing = makeRecord();
    const { service, prisma } = makeService({
      findUnique: vi.fn().mockResolvedValue(existing),
    });

    const result = await service.syncFromOa(syncPayload, actor);

    expect(result.created).toBe(false);
    expect(result.requisition.oaApprovalId).toBe('OA-2026-0001');
    expect(prisma.jobRequisition.create).not.toHaveBeenCalled();
  });

  it('并发回调命中唯一约束后回读已有需求，不产生第二条记录', async () => {
    const existing = makeRecord();
    let lookups = 0;
    const findUnique = vi.fn().mockImplementation(async () => {
      lookups += 1;
      return lookups === 1 ? null : existing;
    });
    const { service, prisma } = makeService({
      findUnique,
      create: vi.fn().mockRejectedValue({ code: 'P2002' }),
    });

    const result = await service.syncFromOa(syncPayload, actor);

    expect(result.created).toBe(false);
    expect(findUnique).toHaveBeenCalledTimes(2);
    expect(prisma.jobRequisition.create).toHaveBeenCalledTimes(1);
  });

  it('缺少开始招聘时间时拒绝生成需求', async () => {
    const { service, prisma } = makeService();

    await expect(
      service.syncFromOa({ ...syncPayload, recruitmentStartDate: '' }, actor),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.jobRequisition.create).not.toHaveBeenCalled();
  });

  it('非法提报时间被拒绝', async () => {
    const { service } = makeService();

    await expect(
      service.syncFromOa({ ...syncPayload, submittedAt: '2026-02-30' }, actor),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('RequisitionsService 关闭与周期（FR-REQ-4/5 / REQ-2）', () => {
  it('同日关闭计 1 天', async () => {
    const record = makeRecord({ recruitmentStartDate: new Date(Date.UTC(2026, 10, 16)) });
    const { service, prisma } = makeService({ record });
    prisma.jobRequisition.findUniqueOrThrow.mockResolvedValue(
      makeRecord({
        status: 'CLOSED',
        recruitmentStartDate: new Date(Date.UTC(2026, 10, 16)),
        closedAt: new Date(Date.UTC(2026, 10, 16)),
        cycleDays: 1,
        version: 2,
      }),
    );

    const result = await service.close('req-1', { closedAt: '2026-11-16' }, actor);

    expect(prisma.jobRequisition.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'req-1', version: 1, status: 'ACTIVE' },
        data: expect.objectContaining({ status: 'CLOSED', cycleDays: 1 }),
      }),
    );
    expect(result.cycleDays).toBe(1);
  });

  it('多日关闭按自然日差计算周期', async () => {
    const record = makeRecord();
    const { service, prisma } = makeService({ record });
    prisma.jobRequisition.findUniqueOrThrow.mockResolvedValue(
      makeRecord({
        status: 'CLOSED',
        closedAt: new Date(Date.UTC(2026, 10, 18)),
        cycleDays: 15,
        version: 2,
      }),
    );

    const result = await service.close('req-1', { closedAt: '2026-11-18' }, actor);

    expect(result.cycleDays).toBe(15);
    expect(prisma.timelineEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'requisition.closed',
        payload: expect.objectContaining({ cycleDays: 15, operator: actor.id }),
      }),
    });
  });

  it('关闭时间早于开始招聘时间时拒绝保存', async () => {
    const { service, prisma } = makeService({ record: makeRecord() });

    await expect(
      service.close('req-1', { closedAt: '2026-11-02' }, actor),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.jobRequisition.updateMany).not.toHaveBeenCalled();
  });

  it('已关闭需求不能重复关闭', async () => {
    const { service } = makeService({ record: makeRecord({ status: 'CLOSED', cycleDays: 3 }) });

    await expect(service.close('req-1', {}, actor)).rejects.toBeInstanceOf(ConflictException);
  });

  it('缺少开始招聘时间的存量需求不能关闭', async () => {
    const { service } = makeService({ record: makeRecord({ recruitmentStartDate: null }) });

    await expect(service.close('req-1', {}, actor)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('RequisitionsService 回退与开始招聘时间（FR-REQ-6/REQ-4）', () => {
  it('回退清空当前关闭字段并在时间线保留历次周期', async () => {
    const record = makeRecord({
      status: 'CLOSED',
      closedAt: new Date(Date.UTC(2026, 10, 18)),
      cycleDays: 15,
      version: 3,
    });
    const { service, prisma } = makeService({ record });
    prisma.jobRequisition.findUniqueOrThrow.mockResolvedValue(makeRecord({ version: 4 }));

    const result = await service.revert('req-1', actor);

    expect(prisma.jobRequisition.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'req-1', version: 3, status: 'CLOSED' },
        data: expect.objectContaining({
          status: 'ACTIVE',
          closedAt: null,
          cycleDays: null,
        }),
      }),
    );
    expect(prisma.timelineEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'requisition.reverted',
        payload: expect.objectContaining({ previousClosedAt: '2026-11-18', previousCycleDays: 15 }),
      }),
    });
    expect(result.cycleDays).toBeNull();
  });

  it('本期不补录的存量已关闭需求不支持回退', async () => {
    const { service } = makeService({
      record: makeRecord({ status: 'CLOSED', cycleEligible: false, recruitmentStartDate: null }),
    });

    await expect(service.revert('req-1', actor)).rejects.toBeInstanceOf(ConflictException);
  });

  it('已关闭需求需先回退才能修改开始招聘时间', async () => {
    const { service } = makeService({ record: makeRecord({ status: 'CLOSED' }) });

    await expect(
      service.changeStartDate('req-1', { recruitmentStartDate: '2026-11-05' }, actor),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('招聘中修改开始招聘时间并记录前后值与重算天数', async () => {
    const record = makeRecord();
    const { service, prisma } = makeService({ record });
    prisma.jobRequisition.findUniqueOrThrow.mockResolvedValue(
      makeRecord({ recruitmentStartDate: new Date(Date.UTC(2026, 10, 5)), version: 2 }),
    );

    const result = await service.changeStartDate(
      'req-1',
      { recruitmentStartDate: '2026-11-05' },
      actor,
    );

    expect(prisma.jobRequisition.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'req-1', version: 1, status: 'ACTIVE' },
        data: expect.objectContaining({
          recruitmentStartDate: new Date(Date.UTC(2026, 10, 5)),
        }),
      }),
    );
    expect(prisma.timelineEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'requisition.start_date_changed',
        payload: expect.objectContaining({ from: '2026-11-03', to: '2026-11-05' }),
      }),
    });
    expect(result.recruitmentStartDate).toBe('2026-11-05');
  });

  it('开始招聘时间为空时拒绝保存', async () => {
    const { service } = makeService({ record: makeRecord() });

    await expect(
      service.changeStartDate('req-1', { recruitmentStartDate: '' }, actor),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('RequisitionsService 编辑与周期汇总（FR-REQ-8/FR-REQ-9）', () => {
  it('人事修改与 OA 同步信息保存在同一需求并记录前后值', async () => {
    const record = makeRecord();
    const { service, prisma } = makeService({ record });
    prisma.jobRequisition.findUniqueOrThrow.mockResolvedValue(
      makeRecord({ title: '高级后端工程师', headcount: 3, version: 2 }),
    );

    await service.update('req-1', { title: '高级后端工程师', headcount: 3 }, actor);

    expect(prisma.jobRequisition.updateMany).toHaveBeenCalledWith({
      where: { id: 'req-1', version: 1 },
      data: {
        title: '高级后端工程师',
        headcount: 3,
        version: { increment: 1 },
      },
    });
    expect(prisma.timelineEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'requisition.updated',
        payload: expect.objectContaining({
          changes: {
            title: { from: '后端工程师', to: '高级后端工程师' },
            headcount: { from: 2, to: 3 },
          },
        }),
      }),
    });
  });

  it('周期字段只读，不接受手工编辑', async () => {
    const { service } = makeService({ record: makeRecord() });

    await expect(service.update('req-1', { cycleDays: 1 }, actor)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('周期汇总排除存量已关闭需求', async () => {
    const { service, prisma } = makeService();
    prisma.jobRequisition.findMany.mockResolvedValue([
      { cycleDays: 3 },
      { cycleDays: 5 },
      { cycleDays: 10 },
    ]);
    prisma.jobRequisition.count.mockResolvedValue(2);

    const stats = await service.cycleStats(actor);

    expect(stats).toMatchObject({
      count: 3,
      average: 6,
      median: 5,
      min: 3,
      max: 10,
      excludedClosed: 2,
    });
    expect(prisma.jobRequisition.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({ status: 'CLOSED', cycleEligible: true }),
          ]),
        }),
      }),
    );
  });

  it('在招时长按 N 排序：N 降序等价于开始招聘时间升序', async () => {
    const { service, prisma } = makeService();

    await service.inProgress(actor, 'days_desc');

    expect(prisma.jobRequisition.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({ status: 'ACTIVE', recruitmentStartDate: { not: null } }),
          ]),
        }),
        orderBy: [{ recruitmentStartDate: 'asc' }, { id: 'asc' }],
      }),
    );
  });
});

import ExcelJS from 'exceljs';
import { BadRequestException } from '@nestjs/common';
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

async function excelBuffer(rows: (string | null)[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('简历导入');
  sheet.addRow(['姓名', '手机号', '邮箱', '职位编号', '简历来源', '备注']);
  for (const row of rows) sheet.addRow(row);
  return Buffer.from((await workbook.xlsx.writeBuffer()) as unknown as ArrayBuffer);
}

describe('IntakeService 入场列表与监控（ATS-008）', () => {
  it('列表分页返回 total 并在无敏感字段授权时隐藏邮箱发件人', async () => {
    const prisma = {
      resumeIntake: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'intake-1',
            source: 'EMAIL',
            entryMode: 'EMAIL_AUTO',
            status: 'PARSED',
            candidateId: 'cand-1',
            duplicateOfCandidateId: null,
            jobId: null,
            airRunId: null,
            resumeFileId: 'file-1',
            mailFrom: 'hr@example.com',
            createdAt: new Date('2026-11-17T02:00:00Z'),
            resumeFile: { id: 'file-1', fileName: 'a.pdf', mimeType: 'application/pdf', size: 10 },
          },
        ]),
        count: vi.fn().mockResolvedValue(7),
      },
      candidate: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'cand-1',
            name: '张三',
            stage: 'UNASSIGNED',
            poolType: 'UNASSIGNED',
            jobId: null,
            appliedAt: null,
          },
        ]),
      },
      job: { findMany: vi.fn().mockResolvedValue([]) },
      aIRun: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const authorization = {
      scopesFor: vi.fn().mockReturnValue(['ALL']),
      canAccessSensitiveField: vi.fn().mockResolvedValue(false),
    };
    const service = buildService(prisma, authorization);

    const result = await service.list({ page: 2, pageSize: 5 }, actor);

    expect(prisma.resumeIntake.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 5, take: 5 }),
    );
    expect(result.total).toBe(7);
    expect(result.page).toBe(2);
    expect(result.items[0]).toMatchObject({ mailFrom: null });
    expect(result.items[0].candidate).toMatchObject({ name: '张三' });
  });

  it('列表按状态/邮箱/时间筛选并校验非法状态', async () => {
    const prisma = {
      resumeIntake: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
      candidate: { findMany: vi.fn().mockResolvedValue([]) },
      job: { findMany: vi.fn().mockResolvedValue([]) },
      aIRun: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const authorization = {
      scopesFor: vi.fn().mockReturnValue(['ALL']),
      canAccessSensitiveField: vi.fn().mockResolvedValue(true),
    };
    const service = buildService(prisma, authorization);

    await service.list(
      {
        status: 'FAILED',
        mailbox: 'hr@example.com',
        receivedFrom: '2026-11-01',
        receivedTo: '2026-11-30',
      },
      actor,
    );

    const where = prisma.resumeIntake.findMany.mock.calls[0][0].where;
    expect(where.AND).toEqual(
      expect.arrayContaining([
        { status: 'FAILED' },
        { mailboxAddress: { contains: 'hr@example.com' } },
        {
          receivedAt: {
            gte: new Date('2026-11-01'),
            lte: expect.any(Date),
          },
        },
      ]),
    );
    const receivedTo = where.AND[2].receivedAt.lte as Date;
    expect(receivedTo.getHours()).toBe(23);

    await expect(service.list({ status: 'NOPE' }, actor)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('监控聚合进入/未进入、时延与失败归因', async () => {
    const counts = [10, 3, 7];
    const prisma = {
      resumeIntake: {
        count: vi.fn().mockImplementation(() => Promise.resolve(counts.shift())),
        groupBy: vi.fn().mockImplementation((args: { by: string[] }) => {
          const key = args.by[0];
          if (key === 'status') {
            return Promise.resolve([
              { status: 'PARSED', _count: { _all: 7 } },
              { status: 'FAILED', _count: { _all: 2 } },
            ]);
          }
          if (key === 'source') {
            return Promise.resolve([{ source: 'EMAIL', _count: { _all: 6 } }]);
          }
          if (key === 'entryMode') {
            return Promise.resolve([{ entryMode: 'EMAIL_AUTO', _count: { _all: 6 } }]);
          }
          if (key === 'mailboxAddress') {
            return Promise.resolve([
              {
                mailboxAddress: 'hr@example.com',
                _count: { _all: 5 },
                _max: { receivedAt: new Date('2026-11-17T01:00:00Z') },
              },
              { mailboxAddress: null, _count: { _all: 2 }, _max: { receivedAt: null } },
            ]);
          }
          return Promise.resolve([{ errorCode: 'PARSE_FAILED', _count: { _all: 2 } }]);
        }),
        findMany: vi.fn().mockImplementation((args: { select?: Record<string, unknown> }) => {
          const select = args.select ?? {};
          if ('receivedAt' in select) {
            return Promise.resolve([
              {
                receivedAt: new Date('2026-11-17T01:00:00Z'),
                createdAt: new Date('2026-11-17T01:01:00Z'),
              },
              {
                receivedAt: new Date('2026-11-17T01:00:00Z'),
                createdAt: new Date('2026-11-17T01:00:30Z'),
              },
            ]);
          }
          return Promise.resolve([
            { id: 'intake-9', status: 'FAILED', errorCode: 'PARSE_FAILED' },
          ]);
        }),
      },
    };
    const authorization = { scopesFor: vi.fn().mockReturnValue(['ALL']) };
    const service = buildService(prisma, authorization);

    const result = await service.monitor({ mailbox: 'hr@example.com' }, actor);

    expect(result.totals).toMatchObject({
      total: 10,
      entered: 7,
      notEntered: 3,
      assigned: 7,
      pool: 3,
      latencySamples: 2,
      averageLatencySeconds: 45,
      p90LatencySeconds: 60,
      maxLatencySeconds: 60,
    });
    expect(result.byMailbox).toEqual([
      {
        mailbox: 'hr@example.com',
        count: 5,
        lastReceivedAt: new Date('2026-11-17T01:00:00Z'),
      },
    ]);
    expect(result.failureReasons).toEqual([{ errorCode: 'PARSE_FAILED', count: 2 }]);
    expect(result.recentFailures).toHaveLength(1);
  });
});

describe('IntakeService 分配与查重合并（ATS-008）', () => {
  it('分配到虚拟职位时停留在校招容器并带出职位负责人', async () => {
    const prisma = {
      job: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'job-virtual',
          code: 'MJ000100',
          title: '2027 校招',
          isVirtual: true,
          recruiterId: 'user-9',
        }),
      },
      resumeIntake: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'intake-1',
          candidateId: 'cand-1',
          duplicateOfCandidateId: null,
          jobId: null,
          createdById: 'user-1',
        }),
        update: vi.fn().mockResolvedValue({ id: 'intake-1' }),
      },
      candidate: {
        update: vi.fn().mockResolvedValue({ id: 'cand-1' }),
      },
      campusApplication: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      $transaction: vi.fn().mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    const authorization = {
      loadUserContext: vi.fn().mockResolvedValue(actor),
      canAccessJob: vi.fn().mockResolvedValue(true),
      canAccessIntake: vi.fn().mockResolvedValue(true),
    };
    const service = buildService(prisma, authorization);

    const result = await service.assignJob('intake-1', 'job-virtual', actor.id);

    expect(prisma.candidate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          jobId: 'job-virtual',
          poolType: 'VIRTUAL',
          stage: 'VIRTUAL_POOL',
        }),
      }),
    );
    expect(result).toMatchObject({ isVirtual: true, recruiterId: 'user-9' });
  });

  it('批量分配逐条返回成功与失败，不影响其他记录', async () => {
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
      resumeIntake: {
        findUnique: vi.fn().mockImplementation((args: { where: { id: string } }) => {
          if (args.where.id === 'intake-missing') return Promise.resolve(null);
          return Promise.resolve({
            id: args.where.id,
            candidateId: `cand-${args.where.id}`,
            duplicateOfCandidateId: null,
            jobId: null,
            createdById: 'user-1',
          });
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      candidate: { update: vi.fn().mockResolvedValue({ id: 'cand-1' }) },
      campusApplication: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      $transaction: vi.fn().mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    const authorization = {
      loadUserContext: vi.fn().mockResolvedValue(actor),
      canAccessJob: vi.fn().mockResolvedValue(true),
      canAccessIntake: vi.fn().mockResolvedValue(true),
    };
    const service = buildService(prisma, authorization);

    const result = await service.assignJobs(['intake-1', 'intake-missing'], 'job-1', actor.id);

    expect(result.assigned).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.results).toEqual([
      expect.objectContaining({ intakeId: 'intake-1', ok: true }),
      expect.objectContaining({ intakeId: 'intake-missing', ok: false }),
    ]);
  });

  it('查重合并保留来源与附件并写时间线', async () => {
    const timeline = { record: vi.fn().mockResolvedValue(undefined) };
    const tx = {
      resumeIntake: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      candidateSourceRecord: {
        upsert: vi.fn().mockResolvedValue({ id: 'source-1' }),
      },
    };
    const prisma = {
      resumeIntake: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'intake-dup',
          status: 'DUPLICATE',
          candidateId: null,
          duplicateOfCandidateId: 'cand-1',
          jobId: null,
          createdById: 'user-1',
          source: 'EMAIL',
          entryMode: 'EMAIL_AUTO',
          resumeFileId: 'file-1',
          sourceNote: null,
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
    const service = buildService(prisma, authorization, {}, timeline);

    const result = await service.mergeDuplicate('intake-dup', actor.id);

    expect(tx.resumeIntake.updateMany).toHaveBeenCalledWith({
      where: { id: 'intake-dup', status: 'DUPLICATE', mergedAt: null },
      data: expect.objectContaining({
        candidateId: 'cand-1',
        mergedById: 'user-1',
        mergedAt: expect.any(Date),
      }),
    });
    expect(result).toMatchObject({
      candidateId: 'cand-1',
      source: 'EMAIL',
      resumeFileId: 'file-1',
    });
    expect(timeline.record).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'Candidate',
        entityId: 'cand-1',
        action: 'candidate.duplicate_merged',
      }),
    );
  });

  it('非查重记录不允许合并', async () => {
    const prisma = {
      resumeIntake: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'intake-1',
          status: 'PARSED',
          candidateId: 'cand-1',
          duplicateOfCandidateId: null,
          jobId: null,
          createdById: 'user-1',
          mergedAt: null,
        }),
      },
    };
    const authorization = {
      loadUserContext: vi.fn().mockResolvedValue(actor),
      canAccessIntake: vi.fn().mockResolvedValue(true),
    };
    const service = buildService(prisma, authorization);

    await expect(service.mergeDuplicate('intake-1', actor.id)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('IntakeService Excel 批量导入（ATS-008）', () => {
  function excelPrisma() {
    return {
      job: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'job-1', code: 'MJ000001', isVirtual: false, recruiterId: 'user-9' },
        ]),
      },
      candidate: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'cand-1' }),
      },
      resumeIntake: {
        create: vi.fn().mockResolvedValue({ id: 'intake-1' }),
      },
      candidateSourceRecord: {
        create: vi.fn().mockResolvedValue({ id: 'source-1' }),
      },
      excelImportBatch: {
        create: vi.fn().mockResolvedValue({ id: 'batch-1' }),
        update: vi.fn().mockResolvedValue({ id: 'batch-1' }),
      },
      excelImportRow: {
        createMany: vi.fn().mockResolvedValue({ count: 3 }),
      },
    };
  }

  it('逐行校验并直接建档，不创建 AI 解析任务', async () => {
    const prisma = excelPrisma();
    const queue = { enqueue: vi.fn() };
    const authorization = {
      loadUserContext: vi.fn().mockResolvedValue(actor),
      jobWhere: vi.fn().mockReturnValue({}),
      canAccessSensitiveField: vi.fn().mockResolvedValue(true),
      canAccessCandidate: vi.fn().mockResolvedValue(true),
    };
    const service = buildService(prisma, authorization, queue);
    const buffer = await excelBuffer([
      ['张三', '13800000001', 'zs@example.com', 'MJ000001', 'CAMPUS', '重点'],
      ['李四', 'bad-phone', '', '', '', ''],
      ['王五', '13800000003', '', 'MJ999999', '', ''],
    ]);

    const result = await service.importExcel(
      { originalname: 'resumes.xlsx', buffer, size: buffer.length },
      actor.id,
    );

    expect(result).toMatchObject({
      batchId: 'batch-1',
      totalRows: 3,
      successRows: 1,
      duplicateRows: 0,
      failedRows: 2,
    });
    expect(result.rows.map((row) => row.errorCode)).toEqual([
      null,
      'INVALID_PHONE',
      'JOB_NOT_FOUND',
    ]);
    expect(prisma.candidate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: '张三',
          jobId: 'job-1',
          entryMode: 'EXCEL_IMPORT',
          stage: 'RECOMMENDED',
        }),
      }),
    );
    expect(prisma.resumeIntake.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PARSED', candidateId: 'cand-1' }),
      }),
    );
    // Excel 不进入 AI 解析管道：不入队、无 AIRun
    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(prisma.excelImportBatch.update).toHaveBeenCalledWith({
      where: { id: 'batch-1' },
      data: { successRows: 1, duplicateRows: 0, failedRows: 2 },
    });
  });

  it('手机号命中已有候选人时按查重跳过并保留来源', async () => {
    const prisma = excelPrisma();
    prisma.candidate.findFirst = vi.fn().mockResolvedValue({ id: 'cand-existing' });
    const authorization = {
      loadUserContext: vi.fn().mockResolvedValue(actor),
      jobWhere: vi.fn().mockReturnValue({}),
      canAccessSensitiveField: vi.fn().mockResolvedValue(true),
      canAccessCandidate: vi.fn().mockResolvedValue(true),
    };
    const service = buildService(prisma, authorization);
    const buffer = await excelBuffer([
      ['张三', '13800000001', '', '', 'REFERRAL', ''],
    ]);

    const result = await service.importExcel(
      { originalname: 'resumes.xlsx', buffer, size: buffer.length },
      actor.id,
    );

    expect(result.duplicateRows).toBe(1);
    expect(prisma.candidate.create).not.toHaveBeenCalled();
    expect(prisma.resumeIntake.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'DUPLICATE',
          duplicateOfCandidateId: 'cand-existing',
          source: 'REFERRAL',
        }),
      }),
    );
  });

  it('拒绝非 xlsx 文件与空数据行', async () => {
    const authorization = { loadUserContext: vi.fn().mockResolvedValue(actor) };
    const service = buildService(excelPrisma(), authorization);

    await expect(
      service.importExcel(
        { originalname: 'resumes.csv', buffer: Buffer.from('a'), size: 1 },
        actor.id,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    const emptyBuffer = await excelBuffer([]);
    await expect(
      service.importExcel(
        { originalname: 'resumes.xlsx', buffer: emptyBuffer, size: emptyBuffer.length },
        actor.id,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

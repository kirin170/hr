import { ConflictException, NotFoundException } from '@nestjs/common';
import { CandidateStage, DataScope } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { AuthorizationService } from '../auth/authorization.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CandidatesService } from './candidates.service.js';

const actor: AuthenticatedUser = {
  id: 'user-1',
  displayName: '招聘 HR',
  departmentId: 'department-1',
  departmentIds: ['department-1'],
  groupIds: [],
  roles: [
    {
      code: 'RECRUITER',
      name: '招聘 HR',
      dataScope: DataScope.OWN_JOBS,
      permissions: ['candidate:read'],
    },
  ],
};

const makeService = (candidate: unknown) => {
  const candidateFindFirst = vi.fn().mockResolvedValue(candidate);
  const prisma = {
    candidate: { findFirst: candidateFindFirst },
  } as unknown as PrismaService;
  const authorization = {
    candidateWhere: vi.fn().mockReturnValue({ createdById: actor.id }),
    canAccessSensitiveField: vi.fn().mockResolvedValue(false),
  } as unknown as AuthorizationService;
  return {
    service: new CandidatesService(prisma, authorization),
    candidateFindFirst,
  };
};

describe('CandidatesService authorization', () => {
  it('returns a scoped candidate while hiding contacts without a field grant', async () => {
    const { service, candidateFindFirst } = makeService({
      id: 'candidate-1',
      name: '候选人',
      phone: '13800000000',
      email: 'person@example.test',
      jobId: null,
      stage: CandidateStage.RECOMMENDED,
      source: 'MANUAL',
      entryMode: 'MANUAL',
      tags: null,
      rating: null,
      experience: null,
      education: null,
      school: null,
      currentCompany: null,
      currentTitle: null,
      summary: null,
      resumeName: null,
      workHistory: null,
      note: null,
      appliedAt: new Date('2026-01-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      job: null,
    });

    const result = await service.get('candidate-1', actor);

    expect(candidateFindFirst.mock.calls[0]?.[0]).toMatchObject({
      where: {
        AND: [{ id: 'candidate-1' }, { createdById: actor.id }],
      },
    });
    expect(result.phone).toBe('已隐藏');
    expect(result.email).toBe('已隐藏');
  });

  it('does not return a candidate outside the actor data scope', async () => {
    const { service } = makeService(null);

    await expect(service.get('candidate-outside', actor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

const poolActor: AuthenticatedUser = {
  ...actor,
  roles: [{ ...actor.roles[0], permissions: ['candidate:read', 'candidate:stage:update'] }],
};

const makeCandidate = (overrides: Record<string, unknown> = {}) => ({
  id: 'candidate-1',
  name: '候选人',
  phone: null,
  email: null,
  jobId: 'job-old',
  poolType: 'NONE',
  stage: CandidateStage.HR_SCREENING,
  source: 'MANUAL',
  channel: 'BOSS',
  entryMode: 'MANUAL',
  tags: null,
  rating: null,
  experience: null,
  education: null,
  school: null,
  currentCompany: null,
  currentTitle: null,
  summary: null,
  resumeName: null,
  workHistory: null,
  note: null,
  archiveReasonId: null,
  archiveReasonText: null,
  archiveChannel: null,
  lockedState: 'NONE',
  appliedAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  job: null,
  ...overrides,
});

/** 事务内 Prisma 替身：候选人读写、人才库归档记录、时间线都不触达真实数据库 */
const makePoolHarness = (candidate: Record<string, unknown>) => {
  const entryCreate = vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: `entry-${data.candidateId}`, ...data }));
  const entryUpdate = vi.fn().mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data }));
  const entryFindFirst = vi.fn().mockResolvedValue({ id: 'entry-open' });
  const entryDeleteMany = vi.fn().mockResolvedValue({ count: 1 });
  const timelineCreate = vi.fn().mockResolvedValue({ id: 'timeline-1' });
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const tx = {
    candidate: {
      findFirst: vi.fn().mockResolvedValue(candidate),
      updateMany,
      findUniqueOrThrow: vi.fn().mockImplementation(({ where }) => Promise.resolve({ ...candidate, id: where.id })),
    },
    candidateTalentPoolEntry: {
      create: entryCreate,
      update: entryUpdate,
      findFirst: entryFindFirst,
      deleteMany: entryDeleteMany,
    },
    timelineEvent: { create: timelineCreate },
  };
  const prisma = {
    $transaction: vi.fn().mockImplementation((callback: (client: unknown) => unknown) => callback(tx)),
    candidate: { findFirst: vi.fn().mockResolvedValue(candidate) },
    job: { findFirst: vi.fn().mockResolvedValue({ id: 'job-new', title: '高级前端工程师' }) },
    candidateTalentPoolEntry: { findMany: vi.fn().mockResolvedValue([]) },
  } as unknown as PrismaService;
  const authorization = {
    candidateWhere: vi.fn().mockReturnValue({ createdById: actor.id }),
    jobWhere: vi.fn().mockReturnValue({ departmentId: 'department-1' }),
    canAccessSensitiveField: vi.fn().mockResolvedValue(false),
  } as unknown as AuthorizationService;
  return {
    service: new CandidatesService(prisma, authorization),
    tx,
    entryCreate,
    entryUpdate,
    entryDeleteMany,
    updateMany,
    timelineCreate,
  };
};

describe('CandidatesService talent pool (ATS-013)', () => {
  it('归档时自动写入人才库记录并把来源阶段与渠道快照留存', async () => {
    const { service, entryCreate, updateMany } = makePoolHarness(makeCandidate());

    await service.updateStage('candidate-1', { stage: 'ARCHIVED', reason: '薪资未谈拢' }, poolActor);

    expect(updateMany.mock.calls[0]?.[0]).toMatchObject({
      where: { id: 'candidate-1', stage: CandidateStage.HR_SCREENING },
      data: { stage: CandidateStage.ARCHIVED, archiveReasonText: '薪资未谈拢', archiveChannel: 'BOSS' },
    });
    expect(entryCreate.mock.calls[0]?.[0]).toMatchObject({
      data: { candidateId: 'candidate-1', sourceStage: CandidateStage.HR_SCREENING, reasonText: '薪资未谈拢', reasonMissing: false },
    });
  });

  it('归档原因为空时记为未填写档，不阻断归档入池', async () => {
    const { service, entryCreate } = makePoolHarness(makeCandidate());

    await service.updateStage('candidate-1', { stage: 'ARCHIVED' }, poolActor);

    expect(entryCreate.mock.calls[0]?.[0]).toMatchObject({ data: { reasonText: null, reasonMissing: true } });
  });

  it('已归档候选人重复归档不产生第二条入池记录', async () => {
    const { service, entryCreate, updateMany } = makePoolHarness(makeCandidate({ stage: CandidateStage.ARCHIVED }));

    await service.updateStage('candidate-1', { stage: 'ARCHIVED' }, poolActor);

    expect(entryCreate).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('选择职位激活时回流至 RECOMMENDED，并在原归档记录上回写激活信息而非删除历史', async () => {
    const { service, entryUpdate, entryDeleteMany, updateMany } = makePoolHarness(
      makeCandidate({ stage: CandidateStage.ARCHIVED, archiveReasonText: '暂不匹配' }),
    );

    await service.activateFromPool('candidate-1', { jobId: 'job-new' }, poolActor);

    expect(updateMany.mock.calls[0]?.[0]).toMatchObject({
      where: { id: 'candidate-1', stage: CandidateStage.ARCHIVED },
      data: { stage: CandidateStage.RECOMMENDED, jobId: 'job-new', poolType: 'NONE' },
    });
    expect(entryUpdate.mock.calls[0]?.[0]).toMatchObject({
      where: { id: 'entry-open' },
      data: { reactivatedJobId: 'job-new', reactivatedById: actor.id },
    });
    expect(entryDeleteMany).not.toHaveBeenCalled();
  });

  it('未归档候选人不能通过激活接口回流', async () => {
    const { service } = makePoolHarness(makeCandidate({ stage: CandidateStage.INTERVIEWING }));

    await expect(
      service.activateFromPool('candidate-1', { jobId: 'job-new' }, poolActor),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('激活未选择职位时拒绝请求', async () => {
    const { service } = makePoolHarness(makeCandidate({ stage: CandidateStage.ARCHIVED }));

    await expect(service.activateFromPool('candidate-1', {}, poolActor)).rejects.toThrow('请选择职位');
  });
});

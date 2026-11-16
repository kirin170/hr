import { NotFoundException } from '@nestjs/common';
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

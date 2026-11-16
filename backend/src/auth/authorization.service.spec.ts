import { ForbiddenException } from '@nestjs/common';
import { DataScope, SensitiveField } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { AuthorizationService } from './authorization.service.js';
import type { AuthenticatedUser } from './auth.types.js';
import type { PrismaService } from '../prisma/prisma.service.js';

const makeAuthorization = () => {
  const candidateFindFirst = vi.fn();
  const jobFindFirst = vi.fn();
  const fieldAccessGrantFindMany = vi.fn();
  const prisma = {
    candidate: { findFirst: candidateFindFirst },
    job: { findFirst: jobFindFirst },
    fieldAccessGrant: { findMany: fieldAccessGrantFindMany },
  } as unknown as PrismaService;
  return {
    authorization: new AuthorizationService(prisma),
    mocks: { candidateFindFirst, jobFindFirst, fieldAccessGrantFindMany },
  };
};

const actorWith = (
  dataScope: DataScope,
  permissions: string[],
): AuthenticatedUser => ({
  id: 'user-1',
  displayName: '测试用户',
  departmentId: 'department-1',
  departmentIds: ['department-1', 'department-child'],
  groupIds: ['group-1'],
  roles: [{ code: 'TEST', name: '测试角色', dataScope, permissions }],
});

describe('AuthorizationService', () => {
  it('allows a granted permission and builds an own-job candidate scope', () => {
    const { authorization } = makeAuthorization();
    const actor = actorWith(DataScope.OWN_JOBS, ['candidate:read']);

    expect(authorization.scopesFor(actor, 'candidate:read')).toEqual([
      DataScope.OWN_JOBS,
    ]);
    expect(authorization.candidateWhere(actor, 'candidate:read')).toEqual({
      OR: [
        {
          OR: [
            { createdById: actor.id },
            { job: { is: { recruiterId: actor.id } } },
          ],
        },
      ],
    });
  });

  it('rejects a feature permission that is not assigned to the actor', () => {
    const { authorization } = makeAuthorization();
    const actor = actorWith(DataScope.ALL, ['job:read']);

    expect(() => authorization.scopesFor(actor, 'candidate:read')).toThrow(
      ForbiddenException,
    );
  });

  it('returns allow or deny according to the candidate data-scope query', async () => {
    const { authorization, mocks } = makeAuthorization();
    const actor = actorWith(DataScope.DEPARTMENT, ['candidate:read']);

    mocks.candidateFindFirst.mockResolvedValueOnce({ id: 'candidate-1' });
    await expect(
      authorization.canAccessCandidate(actor, 'candidate:read', 'candidate-1'),
    ).resolves.toBe(true);
    expect(mocks.candidateFindFirst.mock.calls[0]?.[0]).toMatchObject({
      where: {
        AND: [
          { id: 'candidate-1' },
          { OR: [{ job: { is: { departmentId: { in: actor.departmentIds } } } }] },
        ],
      },
    });

    mocks.candidateFindFirst.mockResolvedValueOnce(null);
    await expect(
      authorization.canAccessCandidate(actor, 'candidate:read', 'candidate-outside'),
    ).resolves.toBe(false);
  });

  it('honors user-group field grants and denies an ungranted sensitive write', async () => {
    const { authorization, mocks } = makeAuthorization();
    const actor = actorWith(DataScope.ALL, ['candidate:read']);
    mocks.fieldAccessGrantFindMany.mockResolvedValue([{ canRead: true, canWrite: false }]);

    await expect(
      authorization.canAccessSensitiveField(
        actor,
        SensitiveField.CANDIDATE_CONTACT,
        'READ',
      ),
    ).resolves.toBe(true);
    expect(mocks.fieldAccessGrantFindMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        field: SensitiveField.CANDIDATE_CONTACT,
        OR: [
          { userId: actor.id },
          { userGroupId: { in: actor.groupIds } },
        ],
      },
    });

    await expect(
      authorization.assertSensitiveFieldAccess(
        actor,
        SensitiveField.CANDIDATE_CONTACT,
        'WRITE',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('judges intake records by data scope for intake and attachment access', async () => {
    const { authorization, mocks } = makeAuthorization();
    const record = {
      candidateId: 'candidate-1',
      duplicateOfCandidateId: null,
      jobId: 'job-1',
      createdById: 'user-2',
    };

    await expect(
      authorization.canAccessIntake(
        actorWith(DataScope.ALL, ['intake:read']),
        'intake:read',
        record,
      ),
    ).resolves.toBe(true);

    await expect(
      authorization.canAccessIntake(
        actorWith(DataScope.SELF, ['intake:read']),
        'intake:read',
        { ...record, createdById: 'user-1' },
      ),
    ).resolves.toBe(true);

    mocks.candidateFindFirst.mockResolvedValueOnce(null);
    mocks.jobFindFirst.mockResolvedValueOnce({ id: 'job-1' });
    await expect(
      authorization.canAccessIntake(
        actorWith(DataScope.DEPARTMENT, ['intake:read']),
        'intake:read',
        record,
      ),
    ).resolves.toBe(true);

    mocks.candidateFindFirst.mockResolvedValueOnce(null);
    mocks.jobFindFirst.mockResolvedValueOnce(null);
    await expect(
      authorization.canAccessIntake(
        actorWith(DataScope.DEPARTMENT, ['intake:read']),
        'intake:read',
        record,
      ),
    ).resolves.toBe(false);
  });
});

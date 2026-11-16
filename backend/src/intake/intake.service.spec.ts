import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AuthorizationService } from '../auth/authorization.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { ParseQueueService } from '../ai/parse.queue.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { TimelineService } from '../timeline/timeline.service.js';
import { IntakeService } from './intake.service.js';

describe('IntakeService sensitive-field authorization', () => {
  it('rejects manual contact intake without a sensitive-field write grant', async () => {
    const actor: AuthenticatedUser = {
      id: 'user-1',
      displayName: '招聘 HR',
      departmentId: null,
      departmentIds: [],
      groupIds: [],
      roles: [],
    };
    const candidateCreate = vi.fn();
    const prisma = {
      candidate: { create: candidateCreate },
    } as unknown as PrismaService;
    const authorization = {
      loadUserContext: vi.fn().mockResolvedValue(actor),
      assertSensitiveFieldAccess: vi
        .fn()
        .mockRejectedValue(new ForbiddenException('缺少该敏感字段的独立授权')),
    } as unknown as AuthorizationService;
    const service = new IntakeService(
      prisma,
      {} as TimelineService,
      {} as StorageService,
      {} as ParseQueueService,
      authorization,
    );

    await expect(
      service.ingestManual({
        name: '候选人',
        phone: '13800000000',
        actorId: actor.id,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(candidateCreate).not.toHaveBeenCalled();
  });
});

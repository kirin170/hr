import { Injectable } from '@nestjs/common';
import { AuditOutcome, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';

export type AuditWrite = {
  actorId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  requestId: string;
  beforeSummary?: Prisma.InputJsonValue;
  afterSummary?: Prisma.InputJsonValue;
  ip?: string | null;
  userAgent?: string | null;
  outcome?: AuditOutcome;
};

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async write(input: AuditWrite): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorId: input.actorId ?? null,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId ?? null,
        requestId: input.requestId,
        beforeSummary: input.beforeSummary,
        afterSummary: input.afterSummary,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        outcome: input.outcome ?? AuditOutcome.SUCCESS,
      },
    });
  }

  requestId(request: AuthenticatedRequest): string {
    const fromHeader = request.headers['x-request-id'];
    if (typeof fromHeader === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(fromHeader)) {
      return fromHeader;
    }
    return request.requestId ?? randomUUID();
  }

  async list(options: {
    actorId?: string;
    from?: Date;
    to?: Date;
    limit: number;
  }) {
    return this.prisma.auditLog.findMany({
      where: {
        actorId: options.actorId,
        createdAt: {
          gte: options.from,
          lte: options.to,
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: options.limit,
      select: {
        id: true,
        actorId: true,
        action: true,
        resourceType: true,
        resourceId: true,
        requestId: true,
        beforeSummary: true,
        afterSummary: true,
        ip: true,
        userAgent: true,
        outcome: true,
        createdAt: true,
      },
    });
  }
}

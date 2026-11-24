import { Injectable } from '@nestjs/common';
import { AuditOutcome, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { maskAuditValue } from './audit.mask.js';

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

  /** 供领域服务自行写审计时复用请求上下文（requestId / IP / UA）。 */
  contextOf(request: AuthenticatedRequest): Pick<AuditWrite, 'requestId' | 'ip' | 'userAgent'> {
    return {
      requestId: this.requestId(request),
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    };
  }

  /**
   * 审计查询（ATS-024 扩展）：支持按对象与动作检索，返回前统一脱敏。
   * `actionPrefix` 用于按模块检索，例如 `setting.`、`authz.`。
   */
  async list(options: {
    actorId?: string;
    from?: Date;
    to?: Date;
    limit: number;
    resourceType?: string;
    resourceId?: string;
    action?: string;
    actionPrefix?: string;
  }) {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        actorId: options.actorId,
        resourceType: options.resourceType,
        resourceId: options.resourceId,
        action: options.action ?? (options.actionPrefix ? { startsWith: options.actionPrefix } : undefined),
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
        actor: { select: { displayName: true } },
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
    return rows.map((row) => ({
      ...row,
      actorName: row.actor?.displayName ?? null,
      beforeSummary: maskAuditValue(row.beforeSummary),
      afterSummary: maskAuditValue(row.afterSummary),
    }));
  }
}

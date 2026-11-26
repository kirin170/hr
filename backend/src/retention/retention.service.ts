import { Injectable, Logger } from '@nestjs/common';
import { SensitiveField } from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { TimelineService } from '../timeline/timeline.service.js';
import {
  isExpired,
  loadRetentionPolicy,
  retentionDaysFor,
  type RetentionPolicy,
} from './retention.config.js';

export interface PurgeOptions {
  actorId?: string | null;
  now?: Date;
  dryRun?: boolean;
  requestId?: string;
}

export interface PurgeSummary {
  scope: string;
  dryRun: boolean;
  scanned: number;
  expired: number;
  deletedFiles: number;
  detachedIntakes: number;
  failedDeletes: number;
  runId: string | null;
}

/**
 * 到期清理（NFR-2 / 技术设计 §13.2）：同时处理对象存储文件与结构化记录，
 * 结构化记录保留清理批次、时间线与审计留痕。
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly timeline: TimelineService,
  ) {}

  policy(): RetentionPolicy {
    return loadRetentionPolicy();
  }

  async purgeExpired(options: PurgeOptions = {}): Promise<PurgeSummary> {
    const policy = loadRetentionPolicy();
    const now = options.now ?? new Date();
    const dryRun = options.dryRun === true;
    const actorId = options.actorId ?? null;
    const requestId = options.requestId ?? `retention-${now.getTime()}`;
    const resumeCutoff = new Date(now.getTime() - policy.resumeDays * DAY_MS);
    const sensitiveCutoff = new Date(now.getTime() - policy.sensitiveDays * DAY_MS);

    // 将到期条件直接下推到 SQL，防止大量未到期普通简历占满批次饿死已到期敏感附件，同时命中 expiresAt 索引
    const candidates = await this.prisma.resumeFile.findMany({
      where: {
        OR: [
          { expiresAt: { lte: now } },
          {
            category: {
              in: [SensitiveField.BACKGROUND_MATERIALS, SensitiveField.BANK_STATEMENTS],
            },
            createdAt: { lte: sensitiveCutoff },
          },
          {
            OR: [{ category: null }, { category: SensitiveField.CANDIDATE_CONTACT }],
            createdAt: { lte: resumeCutoff },
          },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: policy.batchSize,
      select: {
        id: true,
        fileName: true,
        size: true,
        storageKey: true,
        category: true,
        expiresAt: true,
        createdAt: true,
      },
    });
    const expired = candidates.filter((file) => isExpired(file, now, policy));

    const summary: PurgeSummary = {
      scope: 'resume_files',
      dryRun,
      scanned: candidates.length,
      expired: expired.length,
      deletedFiles: 0,
      detachedIntakes: 0,
      failedDeletes: 0,
      runId: null,
    };

    if (!dryRun) {
      for (const file of expired) {
        try {
          await this.storage.deleteObject(file.storageKey);
        } catch (error) {
          summary.failedDeletes += 1;
          this.logger.warn(
            `附件对象删除失败，保留结构化记录待下次重试: ${file.storageKey} (${(error as Error).message})`,
          );
          continue;
        }

        const detached = await this.prisma.resumeIntake.updateMany({
          where: { resumeFileId: file.id },
          data: { resumeFileId: null },
        });
        await this.prisma.resumeFile.delete({ where: { id: file.id } });
        summary.deletedFiles += 1;
        summary.detachedIntakes += detached.count;

        await this.timeline.record({
          entityType: 'ResumeFile',
          entityId: file.id,
          action: 'attachment.purged',
          actorId,
          payload: {
            fileName: file.fileName,
            size: file.size,
            storageKey: file.storageKey,
            category: file.category,
            expiresAt: file.expiresAt?.toISOString() ?? null,
            retentionDays: retentionDaysFor(file.category as SensitiveField | null, policy),
            detachedIntakes: detached.count,
          },
        });
      }
    }

    const run = dryRun
      ? null
      : await this.prisma.retentionRun.create({
          data: {
            scope: summary.scope,
            cutoff: new Date(now.getTime() - policy.resumeDays * DAY_MS),
            scanned: summary.scanned,
            expired: summary.expired,
            deletedFiles: summary.deletedFiles,
            detachedIntakes: summary.detachedIntakes,
            failedDeletes: summary.failedDeletes,
            dryRun: false,
            actorId,
          },
          select: { id: true },
        });
    summary.runId = run?.id ?? null;

    if (!dryRun) {
      await this.audit.write({
        actorId,
        action: 'retention.purge',
        resourceType: 'RetentionRun',
        resourceId: run?.id ?? null,
        requestId,
        afterSummary: {
          scope: summary.scope,
          scanned: summary.scanned,
          expired: summary.expired,
          deletedFiles: summary.deletedFiles,
          detachedIntakes: summary.detachedIntakes,
          failedDeletes: summary.failedDeletes,
          resumeDays: policy.resumeDays,
          sensitiveDays: policy.sensitiveDays,
          driver: this.storage.driverName,
        },
      });
    }

    return summary;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

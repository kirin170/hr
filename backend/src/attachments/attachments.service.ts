import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataScope } from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';
import { AuthorizationService } from '../auth/authorization.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { expiryFor, isExpired } from '../retention/retention.config.js';
import { StorageService, resolveSignedUrlTtlSeconds } from '../storage/storage.service.js';

export interface AttachmentAuditContext {
  requestId: string;
  ip?: string | null;
  userAgent?: string | null;
}

export interface SignedContentQuery {
  key?: string;
  expires?: string;
  actor?: string;
  signature?: string;
}

export interface SignedContentResult {
  file: {
    id: string;
    fileName: string;
    mimeType: string;
    size: number;
  };
  buffer: Buffer;
}

/**
 * 附件访问（NFR-1/3/4）：先校验数据范围与敏感材料独立授权，
 * 再签发短期私有读链接，签发与下载都写入审计。
 */
@Injectable()
export class AttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  async issueReadUrl(
    fileId: string,
    actor: AuthenticatedUser,
    context: AttachmentAuditContext,
  ) {
    const file = await this.prisma.resumeFile.findUnique({
      where: { id: fileId },
      select: {
        id: true,
        fileName: true,
        mimeType: true,
        size: true,
        storageKey: true,
        category: true,
        createdAt: true,
        expiresAt: true,
      },
    });
    if (!file) {
      throw new NotFoundException('附件不存在');
    }

    if (file.storageKey.startsWith('offer-materials/') && isExpired(file, new Date())) throw new NotFoundException('材料已到期');
    await this.assertFileAccessible(file.id, actor, file.storageKey);
    if (file.category) {
      await this.authorization.assertSensitiveFieldAccess(actor, file.category, 'READ');
    }

    let ttlSeconds = resolveSignedUrlTtlSeconds();
    if (file.storageKey.startsWith('offer-materials/')) {
      const configured = expiryFor(file.createdAt, file.category);
      const due = file.expiresAt && file.expiresAt < configured ? file.expiresAt : configured;
      ttlSeconds = Math.min(ttlSeconds, Math.floor((due.getTime() - Date.now()) / 1000));
      if (ttlSeconds < 1) throw new NotFoundException('材料已到期');
    }
    const signed = await this.storage.createReadUrl({
      key: file.storageKey,
      ttlSeconds,
      actorId: actor.id,
    });

    await this.prisma.resumeFile.update({
      where: { id: file.id },
      data: { lastAccessedAt: new Date() },
    });
    await this.audit.write({
      actorId: actor.id,
      action: 'attachment.read_url_issued',
      resourceType: 'ResumeFile',
      resourceId: file.id,
      requestId: context.requestId,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
      afterSummary: {
        driver: this.storage.driverName,
        category: file.category ?? 'NONE',
        ttlSeconds,
        expiresAt: signed.expiresAt.toISOString(),
      },
    });

    return {
      fileId: file.id,
      fileName: file.fileName,
      mimeType: file.mimeType,
      size: file.size,
      driver: this.storage.driverName,
      url: signed.url,
      expiresAt: signed.expiresAt.toISOString(),
    };
  }

  async openSignedContent(
    query: SignedContentQuery,
    context: AttachmentAuditContext,
  ): Promise<SignedContentResult> {
    if (!this.storage.supportsSignedReadVerification) {
      throw new BadRequestException('当前存储驱动由对象存储直接提供签名链接，不使用回源下载');
    }

    const key = query.key?.trim() ?? '';
    const signature = query.signature?.trim() ?? '';
    const expires = Number(query.expires);
    const actorId = query.actor?.trim() || null;
    if (!key || !signature || !Number.isFinite(expires)) {
      throw new ForbiddenException('签名链接无效');
    }
    if (!this.storage.verifySignedRead({ key, expires, actorId, signature })) {
      throw new ForbiddenException('签名链接无效或已过期');
    }

    const file = await this.prisma.resumeFile.findFirst({
      where: { storageKey: key },
      select: { id: true, fileName: true, mimeType: true, size: true, category: true, createdAt: true, expiresAt: true },
    });
    if (!file || (key.startsWith('offer-materials/') && isExpired(file, new Date())) || !(await this.storage.objectExists(key))) {
      throw new NotFoundException('附件不存在');
    }

    const buffer = await this.storage.readObject(key);
    await this.audit.write({
      actorId,
      action: 'attachment.downloaded',
      resourceType: 'ResumeFile',
      resourceId: file.id,
      requestId: context.requestId,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
      afterSummary: {
        category: file.category ?? 'NONE',
        size: file.size,
        driver: this.storage.driverName,
      },
    });

    return {
      file: {
        id: file.id,
        fileName: file.fileName,
        mimeType: file.mimeType,
        size: file.size,
      },
      buffer,
    };
  }

  private async assertFileAccessible(
    fileId: string,
    actor: AuthenticatedUser,
    storageKey: string,
  ): Promise<void> {
    // Offer 材料不依赖简历入场权限：必须同时满足该候选人的数据范围与独立敏感授权。
    const offer = await this.prisma.offerRecord.findFirst({
      where: { materials: { contains: `|${fileId}|` } },
      select: { candidateId: true, jobId: true },
    });
    if (offer) {
      const candidate = await this.prisma.candidate.findFirst({
        where: { AND: [{ id: offer.candidateId, jobId: offer.jobId }, this.authorization.candidateWhere(actor, 'candidate:read')] }, select: { id: true },
      });
      if (!candidate) throw new NotFoundException('附件不存在');
      return;
    }
    if (storageKey.startsWith('offer-materials/')) throw new NotFoundException('附件不存在');
    if (this.authorization.scopesFor(actor, 'intake:read').includes(DataScope.ALL)) {
      return;
    }
    const intakes = await this.prisma.resumeIntake.findMany({
      where: { resumeFileId: fileId },
      select: {
        candidateId: true,
        duplicateOfCandidateId: true,
        jobId: true,
        createdById: true,
      },
      take: 50,
    });
    for (const intake of intakes) {
      if (await this.authorization.canAccessIntake(actor, 'intake:read', intake)) {
        return;
      }
    }
    throw new NotFoundException('附件不存在');
  }
}

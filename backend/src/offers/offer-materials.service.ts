import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { SensitiveField } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { AttachmentsService, type AttachmentAuditContext } from '../attachments/attachments.service.js';
import { AuthorizationService } from '../auth/authorization.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { expiryFor, isExpired, loadRetentionPolicy } from '../retention/retention.config.js';
import { StorageService } from '../storage/storage.service.js';
import { resumeMaxBytes, validateUpload } from '../storage/upload-validation.js';

export type UploadedOfferMaterial = { originalname: string; mimetype: string; buffer: Buffer };

@Injectable()
export class OfferMaterialsService {
  constructor(private readonly db: PrismaService, private readonly auth: AuthorizationService, private readonly storage: StorageService, private readonly attachments: AttachmentsService) {}
  private async target(id: string, actor: AuthenticatedUser, write = false) {
    const candidate = await this.db.candidate.findFirst({ where: { AND: [{ id }, this.auth.candidateWhere(actor, write ? 'candidate:stage:update' : 'candidate:read')] } });
    if (!candidate) throw new NotFoundException('候选人不存在');
    if (write && (candidate.stage !== 'OFFERING' || candidate.lockedState === 'INOPERABLE')) throw new ConflictException('候选人不可操作');
    const offer = await this.db.offerRecord.findUnique({ where: { candidateId: id } });
    if (!offer || candidate.jobId !== offer.jobId) throw new NotFoundException('Offer 不存在');
    return offer;
  }
  async list(id: string, actor: AuthenticatedUser) {
    const offer = await this.target(id, actor);
    const ids = (offer.materials ?? '').split('|').filter(Boolean);
    const files = await this.db.resumeFile.findMany({ where: { id: { in: ids }, category: { in: [SensitiveField.BACKGROUND_MATERIALS, SensitiveField.BANK_STATEMENTS] } }, select: { id: true, fileName: true, mimeType: true, size: true, category: true, createdAt: true, expiresAt: true } });
    const canReadBg = await this.auth.canAccessSensitiveField(actor, SensitiveField.BACKGROUND_MATERIALS, 'READ');
    const canReadBank = await this.auth.canAccessSensitiveField(actor, SensitiveField.BANK_STATEMENTS, 'READ');
    return files.filter(f => !isExpired(f, new Date()) && (f.category === SensitiveField.BACKGROUND_MATERIALS ? canReadBg : canReadBank));
  }
  async upload(id: string, category: unknown, file: UploadedOfferMaterial | undefined, actor: AuthenticatedUser) {
    const offer = await this.target(id, actor, true);
    if (!['BACKGROUND_MATERIALS', 'BACKGROUND_APPROVAL'].includes(offer.workflowStage ?? '') || offer.stageStatus === 'NOT_PASSED') throw new ConflictException('仅背调阶段可上传材料');
    if (category !== SensitiveField.BACKGROUND_MATERIALS && category !== SensitiveField.BANK_STATEMENTS) throw new BadRequestException('材料类别无效');
    await this.auth.assertSensitiveFieldAccess(actor, category, 'WRITE');
    if (!file?.buffer) throw new BadRequestException('材料必填');
    const validated = validateUpload({ fileName: file.originalname, mimeType: file.mimetype, buffer: file.buffer }, { maxBytes: resumeMaxBytes(), allowedExtensions: new Set(['.pdf','.doc','.docx','.png','.jpg','.jpeg','.webp']) });
    // MP4 的 ISO BMFF 文件头；限制扩展名和 MIME，禁止作为网页执行。
    const video = file.originalname.toLowerCase().endsWith('.mp4') && file.mimetype === 'video/mp4' && file.buffer.length >= 12 && file.buffer.subarray(4,8).toString('ascii') === 'ftyp' && file.buffer.length <= resumeMaxBytes();
    if (!validated.ok && !video) throw new BadRequestException(validated.message);
    const ext = video ? '.mp4' : validated.ok ? validated.extension : '';
    const mime = video ? 'video/mp4' : validated.ok ? validated.mimeType : '';
    const nonce = randomBytes(32); const sha256 = createHash('sha256').update(nonce).update(file.buffer).digest('hex');
    const key = `offer-materials/${sha256}${ext}`; const now = new Date();
    await this.storage.putObject({ key, body: file.buffer, contentType: mime });
    try {
      return await this.db.$transaction(async tx => {
        const guard = await tx.candidate.updateMany({ where: { id, jobId: offer.jobId, stage: 'OFFERING', lockedState: { not: 'INOPERABLE' } }, data: { stage: 'OFFERING' } });
        if (!guard.count) throw new ConflictException('候选人状态已变化');
        const created = await tx.resumeFile.create({ data: { sha256, fileName: file.originalname.slice(0, 255), mimeType: mime, size: file.buffer.length, storageKey: key, storageDriver: this.storage.driverName, category, expiresAt: expiryFor(now, category, loadRetentionPolicy()) } });
        const changed = await tx.offerRecord.updateMany({ where: { id: offer.id, workflowVersion: offer.workflowVersion, workflowStage: offer.workflowStage, stageStatus: offer.stageStatus }, data: { materials: `${offer.materials ?? '|'}${created.id}|`, workflowVersion: { increment: 1 } } });
        if (!changed.count) throw new ConflictException('Offer 已变化，请重试');
        await tx.timelineEvent.create({ data: { entityType: 'Candidate', entityId: id, actorId: actor.id, action: 'offer.material_uploaded', payload: { fileId: created.id, category } } });
        return { id: created.id, fileName: created.fileName, category, expiresAt: created.expiresAt };
      });
    } catch (e) { await this.storage.deleteObject(key); throw e; }
  }
  async readUrl(id: string, fileId: string, actor: AuthenticatedUser, context: AttachmentAuditContext) {
    const offer = await this.target(id, actor);
    if (!(offer.materials ?? '').split('|').includes(fileId)) throw new NotFoundException('材料不存在');
    const file = await this.db.resumeFile.findUnique({ where: { id: fileId } });
    if (!file || !file.category || isExpired(file, new Date())) throw new NotFoundException('材料不存在或已到期');
    return this.attachments.issueReadUrl(fileId, actor, context);
  }
}

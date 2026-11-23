import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SensitiveField, type OfferRecord } from '@prisma/client';
import { AuthorizationService } from '../auth/authorization.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { canEnterPendingOnboard, nextOfferStage, OFFER_STAGES, validateFailureReason, type FailureInitiator, type OfferStage, type OfferStatus } from './offer-contract.js';

type Input = Record<string, unknown>;
function input(value: unknown): Input {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('请求格式无效');
  return value as Input;
}
function text(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new BadRequestException(`${name}必填`);
  return value.trim();
}
function only(body: Input, allowed: string[]) {
  if (Object.keys(body).some(k => !allowed.includes(k))) throw new BadRequestException('包含不支持的字段');
}
function publicOffer(offer: OfferRecord) {
  const { materials: _materials, stage: _legacyStage, ...visible } = offer;
  return { ...visible, stage: offer.workflowStage };
}
@Injectable()
export class OffersService {
  constructor(private readonly db: PrismaService, private readonly auth: AuthorizationService) {}
  private async candidate(id: string, actor: AuthenticatedUser, write = false) {
    const candidate = await this.db.candidate.findFirst({ where: { AND: [{ id }, this.auth.candidateWhere(actor, write ? 'candidate:stage:update' : 'candidate:read')] } });
    if (!candidate) throw new NotFoundException('候选人不存在');
    if (write && (candidate.stage !== 'OFFERING' || candidate.lockedState === 'INOPERABLE' || !candidate.jobId)) throw new ConflictException('候选人不处于可操作的 Offer 阶段');
    return candidate;
  }
  async read(id: string, actor: AuthenticatedUser) {
    const candidate = await this.db.candidate.findFirst({ where: { AND: [{ id }, this.auth.candidateWhere(actor, 'candidate:stage:update')] } });
    if (!candidate) throw new NotFoundException('候选人不存在');
    const offer = await this.db.offerRecord.findUnique({ where: { candidateId: id } });
    if (offer && offer.jobId !== candidate.jobId) throw new ConflictException('历史 Offer 对应其他职位，需人工核对');
    if (!offer) return null;
    return publicOffer(offer);
  }
  async reasons(actor: AuthenticatedUser) {
    this.auth.scopesFor(actor, 'candidate:stage:update');
    return this.db.reasonOption.findMany({ where: { active: true, type: { in: ['ARCHIVE', 'OFFER_REJECT'] } }, orderBy: { label: 'asc' } });
  }
  async create(id: string, actor: AuthenticatedUser) {
    const candidate = await this.candidate(id, actor, true);
    if (await this.db.offerRecord.findUnique({ where: { candidateId: id } })) throw new ConflictException('Offer 已存在，历史记录须先核对');
    const created = await this.db.$transaction(async tx => {
      const guard = await tx.candidate.updateMany({ where: { id, jobId: candidate.jobId, stage: 'OFFERING', lockedState: { not: 'INOPERABLE' } }, data: { stage: 'OFFERING' } });
      if (!guard.count) throw new ConflictException('候选人状态已变化');
      const offer = await tx.offerRecord.create({ data: { candidateId: id, jobId: candidate.jobId!, workflowStage: 'APPROVAL_MATERIALS', stageStatus: 'PENDING' } });
      await tx.timelineEvent.create({ data: { entityType: 'Candidate', entityId: id, actorId: actor.id, action: 'offer.created', payload: { stage: offer.workflowStage, status: offer.stageStatus } } });
      return offer;
    });
    return publicOffer(created);
  }
  async preview(id: string, actor: AuthenticatedUser) {
    const candidate = await this.candidate(id, actor, true);
    const offer = await this.db.offerRecord.findUnique({ where: { candidateId: id } });
    if (!offer || offer.jobId !== candidate.jobId) throw new NotFoundException('Offer 不存在');
    const form = await this.db.interviewRegistrationForm.findFirst({ where: { candidateId: id, jobId: offer.jobId }, orderBy: { createdAt: 'desc' } });
    const contact = await this.auth.canAccessSensitiveField(actor, SensitiveField.CANDIDATE_CONTACT, 'READ');
    const fields = Array.isArray(form?.fields) ? form.fields.filter(f => {
      if (!f || typeof f !== 'object' || Array.isArray(f)) return false;
      const x = f as Record<string, unknown>;
      return !/薪|salary|pay|compensation|评级|评估|评价|结论|建议|\bai\b/i.test(`${String(x.key)} ${String(x.label)}`) && (contact || !/电话|手机|邮箱|联系|phone|email|contact/i.test(`${String(x.key)} ${String(x.label)}`));
    }) : [];
    const values = form?.values && typeof form.values === 'object' && !Array.isArray(form.values) ? form.values as Record<string, Prisma.JsonValue> : {};
    const registration = form ? { fields, values: Object.fromEntries(fields.map(f => { const k = String((f as Record<string, unknown>).key); return [k, values[k] ?? null]; })) } : null;
    const workHistory = Array.isArray(candidate.workHistory) ? candidate.workHistory.map(item => { const row = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, Prisma.JsonValue> : {}; return { company: row.company ?? null, title: row.title ?? null, period: row.period ?? null }; }) : [];
    return { resume: { name: candidate.name, experience: candidate.experience, education: candidate.education, school: candidate.school, currentCompany: candidate.currentCompany, currentTitle: candidate.currentTitle, workHistory, ...(contact ? { phone: candidate.phone, email: candidate.email } : {}) }, registration, hireLevel: offer.hireLevel };
  }
  async update(id: string, raw: unknown, actor: AuthenticatedUser) {
    const body = input(raw); const action = text(body.action, '操作');
    const allowed: Record<string, string[]> = { RECONCILE: ['action','version','confirmLegacy'], DETAILS: ['action','version','oaApprovalId','hireLevel','salaryReturned','onboardDate','markSent'], ACCEPT: ['action','version'], ADVANCE: ['action','version'], FAIL: ['action','version','initiator','reasonId','reasonText'], ONBOARD: ['action','version'] };
    if (!allowed[action]) throw new BadRequestException('操作无效');
    only(body, allowed[action]);
    if (!Number.isInteger(body.version) || Number(body.version) < 0) throw new BadRequestException('版本无效');
    const candidate = await this.candidate(id, actor, true);
    const offer = await this.db.offerRecord.findUnique({ where: { candidateId: id } });
    if (!offer || offer.jobId !== candidate.jobId) throw new NotFoundException('Offer 不存在');
    if (action === 'RECONCILE') {
      if (body.confirmLegacy !== true || offer.workflowStage !== null || offer.workflowVersion !== body.version) throw new ConflictException('仅可显式核对尚未迁移的历史 Offer');
      const reconciled = await this.db.$transaction(async tx => {
        const guard = await tx.candidate.updateMany({ where: { id, jobId: offer.jobId, stage: 'OFFERING', lockedState: { not: 'INOPERABLE' } }, data: { stage: 'OFFERING' } });
        if (!guard.count) throw new ConflictException('候选人状态已变化');
        const changed = await tx.offerRecord.updateMany({ where: { id: offer.id, workflowVersion: Number(body.version), workflowStage: null }, data: { workflowStage: 'APPROVAL_MATERIALS', stageStatus: 'PENDING', workflowVersion: { increment: 1 }, oralResult: null, writtenResult: null, rejectReasonId: null, onboardDate: null, offerSentAt: null } });
        if (!changed.count) throw new ConflictException('记录已变化，请刷新');
        await tx.timelineEvent.create({ data: { entityType: 'Candidate', entityId: id, actorId: actor.id, action: 'offer.legacy_reconciled', payload: { previousStage: offer.stage, previousOralResult: offer.oralResult, previousRejectReasonId: offer.rejectReasonId, previousBackgroundStatus: offer.backgroundCheckStatus, previousSentAt: offer.offerSentAt?.toISOString() ?? null, previousOnboardDate: offer.onboardDate?.toISOString() ?? null, nextStage: 'APPROVAL_MATERIALS' } } });
        return tx.offerRecord.findUniqueOrThrow({ where: { id: offer.id } });
      });
      return publicOffer(reconciled);
    }
    if (!offer.workflowStage || !OFFER_STAGES.includes(offer.workflowStage as OfferStage) || !['PENDING','ACCEPTED','NOT_PASSED'].includes(offer.stageStatus ?? '')) throw new ConflictException('历史 Offer 需要先人工核对');
    if (offer.workflowVersion !== body.version) throw new ConflictException('记录已变化，请刷新');
    const stage = offer.workflowStage as OfferStage; const status = offer.stageStatus as OfferStatus;
    const data: Prisma.OfferRecordUpdateManyMutationInput = { workflowVersion: { increment: 1 } };
    let detail: Prisma.InputJsonObject = { action, stage, status };
    let failure: ReturnType<typeof validateFailureReason> | null = null;
    if (action === 'DETAILS') {
      if (status === 'NOT_PASSED') throw new ConflictException('已终止的 Offer 不可修改');
      if ('oaApprovalId' in body) data.oaApprovalId = text(body.oaApprovalId, 'OA 单号');
      if ('hireLevel' in body) data.hireLevel = text(body.hireLevel, '录用职级');
      if ('salaryReturned' in body) { if (typeof body.salaryReturned !== 'boolean') throw new BadRequestException('薪资返回标志无效'); data.salaryReturned = body.salaryReturned; }
      if ('onboardDate' in body) { if (stage !== 'WRITTEN_OFFER') throw new ConflictException('背调通过后才能确定入职时间'); const d = new Date(text(body.onboardDate, '入职时间')); if (!Number.isFinite(d.getTime())) throw new BadRequestException('入职时间无效'); data.onboardDate = d; }
      if ('markSent' in body) { if (body.markSent !== true || stage !== 'WRITTEN_OFFER' || offer.offerSentAt) throw new ConflictException('只能在书面 Offer 阶段标记一次已发送'); data.offerSentAt = new Date(); }
      detail = { ...detail, changes: Object.fromEntries(Object.keys(body).filter(k => !['action','version'].includes(k)).map(k => [k, { before: k === 'markSent' ? offer.offerSentAt?.toISOString() ?? null : k === 'onboardDate' ? offer.onboardDate?.toISOString() ?? null : offer[k as 'hireLevel' | 'oaApprovalId' | 'salaryReturned'], after: k === 'markSent' ? (data.offerSentAt as Date).toISOString() : k === 'onboardDate' ? (data.onboardDate as Date).toISOString() : body[k] }])) as Prisma.InputJsonObject };
    } else if (action === 'ACCEPT') {
      if (status !== 'PENDING') throw new ConflictException('当前阶段结果已记录');
      if (stage === 'WRITTEN_OFFER' && !offer.offerSentAt) throw new ConflictException('请先标记书面 Offer 已发送');
      data.stageStatus = 'ACCEPTED';
      if (stage === 'ORAL_OFFER') data.oralResult = 'ACCEPTED';
      if (stage === 'WRITTEN_OFFER') data.writtenResult = 'ACCEPTED';
    } else if (action === 'ADVANCE') {
      const next = nextOfferStage({ stage, status }); data.workflowStage = next.stage; data.stageStatus = next.status; detail = { ...detail, nextStage: next.stage };
    } else if (action === 'FAIL') {
      if (status !== 'PENDING') throw new ConflictException('当前阶段结果已记录');
      const initiator = text(body.initiator, '发起方') as FailureInitiator;
      if (stage === 'WRITTEN_OFFER' && initiator === 'CANDIDATE' && !offer.offerSentAt) throw new ConflictException('书面 Offer 发送后才能记录候选人拒绝');
      const option = await this.db.reasonOption.findUnique({ where: { id: text(body.reasonId, '原因') } });
      failure = validateFailureReason(stage, initiator, option, body.reasonText);
      data.stageStatus = 'NOT_PASSED'; data.failureInitiator = initiator; data.failureReasonType = failure.reasonType; data.rejectReasonId = failure.reasonId; data.failureReasonLabel = option!.label; data.failureReasonText = failure.reasonText;
      if (initiator === 'CANDIDATE' && stage === 'ORAL_OFFER') data.oralResult = 'REJECTED';
      if (initiator === 'CANDIDATE' && stage === 'WRITTEN_OFFER') data.writtenResult = 'REJECTED';
      detail = { ...detail, initiator, ...failure, reasonLabel: option!.label };
    } else if (!canEnterPendingOnboard({ stage, status }, offer.offerSentAt, offer.onboardDate)) throw new ConflictException('须书面 Offer 已发送、候选人已接受且确定入职时间');
    const updated = await this.db.$transaction(async tx => {
      const candidateGuard = await tx.candidate.updateMany({ where: { id, jobId: offer.jobId, stage: 'OFFERING', lockedState: { not: 'INOPERABLE' } }, data: action === 'FAIL' ? { stage: 'ARCHIVED', archiveReasonId: failure!.reasonId, archiveReasonText: failure!.reasonText, archiveChannel: candidate.channel } : action === 'ONBOARD' ? { stage: 'PENDING_ONBOARD' } : { stage: 'OFFERING' } });
      if (candidateGuard.count !== 1) throw new ConflictException('候选人状态已变化');
      const changed = await tx.offerRecord.updateMany({ where: { id: offer.id, workflowVersion: Number(body.version), workflowStage: stage, stageStatus: status }, data });
      if (changed.count !== 1) throw new ConflictException('Offer 已变化，请刷新');
      if (failure) await tx.candidateTalentPoolEntry.create({ data: { candidateId: id, archivedAt: new Date(), sourceStage: 'OFFERING', reasonId: failure.reasonId, reasonText: failure.reasonText, reasonMissing: false } });
      await tx.timelineEvent.create({ data: { entityType: 'Candidate', entityId: id, actorId: actor.id, action: `offer.${action.toLowerCase()}`, payload: detail } });
      return tx.offerRecord.findUniqueOrThrow({ where: { id: offer.id } });
    });
    return publicOffer(updated);
  }
}

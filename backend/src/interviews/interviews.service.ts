import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DataScope, InterviewMode, InterviewStatus, Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { AuthorizationService } from '../auth/authorization.service.js';
import { parseMinutesLink } from '../dingtalk/dingtalk-minutes.client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { INTERVIEW_CALENDAR, INTERVIEW_NOTIFICATIONS, type InterviewCalendar, type InterviewNotifications } from './interview-adapters.js';

type Input = Record<string, unknown>;
const record = (value: unknown): Input => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('请求格式无效');
  return value as Input;
};
const required = (v: unknown, name: string): string => {
  if (typeof v !== 'string' || !v.trim()) throw new BadRequestException(`${name}必填`);
  return v.trim();
};
const date = (v: unknown, name: string): Date => {
  const d = new Date(required(v, name));
  if (!Number.isFinite(d.getTime())) throw new BadRequestException(`${name}无效`);
  return d;
};
const ids = (raw: string | null) => (raw ?? '').split('|').filter(Boolean);

@Injectable()
export class InterviewsService {
  private readonly logger = new Logger(InterviewsService.name);
  constructor(private readonly db: PrismaService, private readonly auth: AuthorizationService,
    @Inject(INTERVIEW_NOTIFICATIONS) private readonly notifications: InterviewNotifications, @Inject(INTERVIEW_CALENDAR) private readonly calendar: InterviewCalendar) {}

  private async canRead(candidateId: string, jobId: string, actor: AuthenticatedUser): Promise<boolean> {
    const scopes = this.auth.scopesFor(actor, 'candidate:read');
    if (scopes.includes(DataScope.ALL)) return true;
    const [candidate, job, participation] = await Promise.all([
      this.db.candidate.findUnique({ where: { id: candidateId }, select: { createdById: true } }),
      this.db.job.findUnique({ where: { id: jobId }, select: { recruiterId: true, departmentId: true } }),
      this.db.interview.findFirst({ where: { candidateId, jobId, interviewerIds: { contains: `|${actor.id}|` } }, select: { id: true } }),
    ]);
    return scopes.some(scope => {
      if (scope === DataScope.SELF) return candidate?.createdById === actor.id;
      if (scope === DataScope.OWN_JOBS) return candidate?.createdById === actor.id || job?.recruiterId === actor.id;
      if (scope === DataScope.DEPARTMENT) return !!job && actor.departmentIds.includes(job.departmentId);
      if (scope === DataScope.PARTICIPATING) return !!participation;
      if (scope === DataScope.DEPARTMENT_AND_PARTICIPATING) return !!participation || (!!job && actor.departmentIds.includes(job.departmentId));
      return false;
    });
  }
  private async target(id: string, actor: AuthenticatedUser) {
    const interview = await this.db.interview.findUnique({ where: { id }, include: { candidate: { select: { id: true, name: true } } } });
    if (!interview || !await this.canRead(interview.candidateId, interview.jobId, actor)) throw new NotFoundException('面试不存在');
    return interview;
  }
  private async manageable(candidateId: string, jobId: string, actor: AuthenticatedUser) {
    const candidate = await this.db.candidate.findFirst({ where: { AND: [{ id: candidateId, jobId, lockedState: { not: 'INOPERABLE' } }, this.auth.candidateWhere(actor, 'candidate:stage:update')] } });
    if (!candidate) throw new NotFoundException('候选人不存在或不属于职位');
    return candidate;
  }
  private async times(input: Input) {
    const start = date(input.startAt, '开始时间'); const end = date(input.endAt, '结束时间');
    if (end <= start) throw new BadRequestException('结束时间必须晚于开始时间');
    return { start, end };
  }
  private async notify(action: string, interviewerIds: string[], id: string) {
    try { await this.notifications.notify(action, interviewerIds, id); } catch { /* 通知失败不影响主流程 */ }
  }
  private async checkConflicts(interviewerIds: string[], start: Date, end: Date, exceptId?: string) {
    try {
      return { conflicts: await this.calendar.conflicts(interviewerIds, start, end, exceptId), availabilityStatus: 'AVAILABLE' as const };
    } catch {
      this.logger.warn('面试忙闲查询失败，排期仍可继续');
      return { conflicts: [] as string[], availabilityStatus: 'UNAVAILABLE' as const };
    }
  }
  private dto<T extends { interviewerIds: string | null }>(row: T) { return { ...row, interviewerIds: ids(row.interviewerIds) }; }

  async list(actor: AuthenticatedUser, filter: { candidateId?: string; jobId?: string; status?: string; keyword?: string }) {
    const where: Prisma.InterviewWhereInput = {};
    if (filter.candidateId) where.candidateId = filter.candidateId;
    if (filter.jobId) where.jobId = filter.jobId;
    if (filter.status) {
      if (!Object.values(InterviewStatus).includes(filter.status as InterviewStatus)) throw new BadRequestException('状态无效');
    }
    if (filter.keyword) where.candidate = { name: { contains: filter.keyword } };
    const rows = await this.db.interview.findMany({ where, include: { candidate: { select: { id: true, name: true } } }, orderBy: { time: 'asc' } });
    const allowed = await Promise.all(rows.map(row => this.canRead(row.candidateId, row.jobId, actor)));
    const visible = rows.filter((_, i) => allowed[i]);
    const feedback = await this.db.interviewFeedback.findMany({ where: { interviewId: { in: visible.map(row => row.id) } }, select: { interviewId: true, interviewerId: true } });
    return visible.map(row => {
      const people = ids(row.interviewerIds);
      const finished = row.endTime && row.endTime <= new Date();
      const complete = people.length > 0 && people.every(id => feedback.some(f => f.interviewId === row.id && f.interviewerId === id));
      const status = row.status === InterviewStatus.CANCELLED ? row.status : finished ? (complete ? InterviewStatus.COMPLETED : InterviewStatus.FEEDBACK_PENDING) : row.status;
      return { ...this.dto(row), status };
    }).filter(row => !filter.status || row.status === filter.status);
  }
  async history(id: string, actor: AuthenticatedUser) {
    await this.target(id, actor);
    return this.db.interviewChange.findMany({ where: { interviewId: id }, orderBy: { createdAt: 'asc' } });
  }
  async mockNotifications(id: string, actor: AuthenticatedUser) {
    const row = await this.target(id, actor);
    await this.manageable(row.candidateId, row.jobId, actor);
    return this.db.interviewMockNotification.findMany({ where: { interviewId: id }, orderBy: { createdAt: 'asc' } });
  }
  async interviewers(actor: AuthenticatedUser) {
    this.auth.scopesFor(actor, 'candidate:stage:update');
    return this.db.user.findMany({ where: { status: 'ACTIVE' }, select: { id: true, displayName: true }, orderBy: { displayName: 'asc' } });
  }
  async availability(candidateId: string, actor: AuthenticatedUser) {
    const candidate = await this.db.candidate.findFirst({ where: { AND: [{ id: candidateId }, this.auth.candidateWhere(actor, 'candidate:read')] }, select: { id: true } });
    if (!candidate) throw new NotFoundException('候选人不存在');
    return this.db.candidateDepartmentScreening.findMany({ where: { candidateId, result: 'PASS', revokedAt: null }, select: { id: true, availabilitySlots: true, createdAt: true }, orderBy: { createdAt: 'desc' } });
  }
  async create(value: unknown, actor: AuthenticatedUser) {
    const input = record(value); const candidateId = required(input.candidateId, '候选人'); const jobId = required(input.jobId, '职位');
    await this.manageable(candidateId, jobId, actor);
    const round = Number(input.round); if (!Number.isInteger(round) || round < 1) throw new BadRequestException('轮次无效');
    const mode = required(input.mode, '面试方式') as InterviewMode; if (!Object.values(InterviewMode).includes(mode)) throw new BadRequestException('面试方式无效');
    if (!Array.isArray(input.interviewerIds)) throw new BadRequestException('面试官必填');
    const interviewerIds = [...new Set(input.interviewerIds.map(v => required(v, '面试官')))];
    if (!interviewerIds.length || interviewerIds.some(id => id.includes('|'))) throw new BadRequestException('面试官无效');
    const count = await this.db.user.count({ where: { id: { in: interviewerIds }, status: 'ACTIVE' } });
    if (count !== interviewerIds.length) throw new BadRequestException('面试官不存在或已停用');
    const { start, end } = await this.times(input); const availability = await this.checkConflicts(interviewerIds, start, end);
    const responses = Object.fromEntries(interviewerIds.map(id => [id, 'PENDING']));
    const row = await this.db.interview.create({ data: { candidateId, jobId, round, mode, time: start, endTime: end, location: typeof input.location === 'string' ? input.location.trim() : null, interviewerIds: `|${interviewerIds.join('|')}|`, responses, status: 'TO_SCHEDULE' } });
    await this.notify('CREATE', [...interviewerIds, `candidate:${candidateId}`], row.id); return { interview: this.dto(row), ...availability, calendar: 'MOCK' };
  }
  async change(id: string, value: unknown, actor: AuthenticatedUser) {
    const input = record(value); const row = await this.target(id, actor); await this.manageable(row.candidateId, row.jobId, actor);
    if (row.status === 'CANCELLED') throw new BadRequestException('面试已取消');
    const action = required(input.action, '操作'); const reason = required(input.reason, '原因');
    if (!['RESCHEDULE', 'CANCEL'].includes(action)) throw new BadRequestException('操作无效');
    let update: Prisma.InterviewUpdateInput; let availability: { conflicts: string[]; availabilityStatus: 'AVAILABLE' | 'UNAVAILABLE' | 'NOT_CHECKED' } = { conflicts: [], availabilityStatus: 'NOT_CHECKED' };
    if (action === 'RESCHEDULE') {
      const { start, end } = await this.times(input); availability = await this.checkConflicts(ids(row.interviewerIds), start, end, id);
      update = { time: start, endTime: end, responses: Object.fromEntries(ids(row.interviewerIds).map(x => [x, 'PENDING'])) };
    } else update = { status: 'CANCELLED', cancelReason: reason };
    const result = await this.db.$transaction(async tx => {
      const changed = await tx.interview.update({ where: { id }, data: update });
      await tx.interviewChange.create({ data: { interviewId: id, action, actorId: actor.id, reason, before: { startAt: row.time.toISOString(), endAt: row.endTime?.toISOString() ?? null, status: row.status }, after: { startAt: changed.time.toISOString(), endAt: changed.endTime?.toISOString() ?? null, status: changed.status } } });
      return changed;
    });
    await this.notify(action, [...ids(row.interviewerIds), `candidate:${row.candidateId}`], id); return { interview: this.dto(result), ...availability, calendar: 'MOCK' };
  }
  async respond(id: string, value: unknown, actor: AuthenticatedUser) {
    const row = await this.target(id, actor); if (!ids(row.interviewerIds).includes(actor.id)) throw new ForbiddenException('仅受邀面试官可响应');
    if (row.status === 'CANCELLED') throw new BadRequestException('面试已取消');
    const response = required(record(value).response, '响应'); if (!['ACCEPTED', 'DECLINED'].includes(response)) throw new BadRequestException('响应无效');
    const path = `$.${JSON.stringify(actor.id)}`;
    const updated = await this.db.$executeRaw`UPDATE interviews SET responses = JSON_SET(COALESCE(responses, JSON_OBJECT()), ${path}, ${response}) WHERE id = ${id} AND status <> 'CANCELLED'`;
    if (!updated) throw new BadRequestException('面试已取消或不存在');
    return this.dto(await this.db.interview.findUniqueOrThrow({ where: { id } }));
  }
  async feedback(id: string, actor: AuthenticatedUser) {
    const row = await this.target(id, actor);
    const interviews = await this.db.interview.findMany({ where: { candidateId: row.candidateId, jobId: row.jobId }, select: { id: true } });
    return this.db.interviewFeedback.findMany({ where: { interviewId: { in: interviews.map(i => i.id) }, visibleToInterviewers: true }, orderBy: { createdAt: 'asc' } });
  }
  async addFeedback(id: string, value: unknown, actor: AuthenticatedUser) {
    const row = await this.target(id, actor); const input = record(value); const interviewerId = required(input.interviewerId, '面试官');
    if (!ids(row.interviewerIds).includes(interviewerId)) throw new BadRequestException('评价人不是本轮面试官');
    const proxy = interviewerId !== actor.id;
    if (proxy) await this.manageable(row.candidateId, row.jobId, actor);
    else if (!ids(row.interviewerIds).includes(actor.id)) throw new ForbiddenException('无评价权限');
    const content = required(input.content, '评价内容');
    const conclusion = required(input.conclusion, '评价结论');
    if (!['PASS', 'HOLD', 'REJECT'].includes(conclusion)) throw new BadRequestException('评价结论无效');
    return this.db.interviewFeedback.create({ data: { interviewId: id, interviewerId, filledById: actor.id, filledByMode: proxy ? 'PROXY' : 'SELF', proxyName: proxy ? actor.displayName : null, proxyAt: proxy ? new Date() : null, content, conclusion } });
  }
  async transcripts(id: string, actor: AuthenticatedUser) {
    const row = await this.target(id, actor);
    return this.db.interviewTranscriptLink.findMany({
      where: { candidateId: row.candidateId, jobId: row.jobId },
      orderBy: { createdAt: 'asc' },
      include: {
        materials: {
          select: { id: true, source: true, title: true, contentHash: true, fetchedAt: true },
          orderBy: { fetchedAt: 'desc' },
        },
      },
    });
  }
  async addTranscript(id: string, value: unknown, actor: AuthenticatedUser) {
    const row = await this.target(id, actor); await this.manageable(row.candidateId, row.jobId, actor);
    const url = required(record(value).url, '听记链接');
    try { const parsed = new URL(url); if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(); } catch { throw new BadRequestException('链接必须为 HTTP(S) 地址'); }
    // 追加写入，不覆盖既有链接；能解析出听记 ID 时记录来源，便于按权限读取素材（ATS-020）
    const minutesId = parseMinutesLink(url)?.minutesId ?? null;
    return this.db.interviewTranscriptLink.create({ data: { interviewId: id, candidateId: row.candidateId, jobId: row.jobId, round: row.round, url, createdBy: actor.id, source: minutesId ? 'DINGTALK' : 'MANUAL', minutesId } });
  }
  async registrationTemplate(actor: AuthenticatedUser) {
    this.auth.scopesFor(actor, 'candidate:read');
    return this.db.interviewRegistrationTemplate.findFirst({ orderBy: { createdAt: 'desc' } });
  }
  async saveRegistrationTemplate(value: unknown, actor: AuthenticatedUser) {
    this.auth.scopesFor(actor, 'candidate:stage:update');
    const fields = record(value).fields;
    if (!Array.isArray(fields) || !fields.length || fields.length > 50) throw new BadRequestException('字段须为 1 至 50 项');
    const seen = new Set<string>();
    const normalized = fields.map(raw => {
      const f = record(raw); const key = required(f.key, '字段标识'); const label = required(f.label, '字段名称');
      if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key) || seen.has(key)) throw new BadRequestException('字段标识无效或重复');
      seen.add(key); const type = required(f.type, '字段类型');
      if (!['text', 'textarea', 'select'].includes(type)) throw new BadRequestException('字段类型无效');
      const options = type === 'select' && Array.isArray(f.options) ? f.options.map(option => required(option, '选项')) : [];
      if (type === 'select' && !options.length) throw new BadRequestException('选择字段需要选项');
      return { key, label, type, required: f.required === true, options };
    });
    return this.db.interviewRegistrationTemplate.create({ data: { fields: normalized, createdBy: actor.id } });
  }
  async registration(id: string, actor: AuthenticatedUser) {
    const row = await this.target(id, actor);
    await this.manageable(row.candidateId, row.jobId, actor);
    return this.db.interviewRegistrationForm.findMany({ where: { candidateId: row.candidateId, jobId: row.jobId }, orderBy: { createdAt: 'desc' } });
  }
  async submitRegistration(id: string, value: unknown, actor: AuthenticatedUser) {
    const row = await this.target(id, actor); await this.manageable(row.candidateId, row.jobId, actor);
    const input = record(value); const templateId = required(input.templateId, '模板'); const values = record(input.values);
    const template = await this.db.interviewRegistrationTemplate.findUnique({ where: { id: templateId } });
    if (!template || !Array.isArray(template.fields)) throw new BadRequestException('模板不存在');
    const result = this.registrationValues(template.fields, values);
    return this.db.interviewRegistrationForm.create({ data: { candidateId: row.candidateId, jobId: row.jobId, templateId, fields: template.fields as Prisma.InputJsonValue, values: result, submittedBy: actor.id } });
  }

  private registrationValues(fields: Prisma.JsonValue, values: Input) {
    if (!Array.isArray(fields)) throw new BadRequestException('模板无效');
    const result: Record<string, string> = {};
    for (const raw of fields) {
      const f = record(raw); const key = required(f.key, '字段'); const v = values[key];
      if (v !== undefined && typeof v !== 'string') throw new BadRequestException('字段值必须为文本');
      const text = typeof v === 'string' ? v.trim() : '';
      if (f.required && !text) throw new BadRequestException(`${String(f.label)}必填`);
      if (f.type === 'select' && text && (!Array.isArray(f.options) || !f.options.includes(text))) throw new BadRequestException(`${String(f.label)}选项无效`);
      result[key] = text;
    }
    return result;
  }
  async inviteRegistration(id: string, actor: AuthenticatedUser) {
    const row = await this.target(id, actor); await this.manageable(row.candidateId, row.jobId, actor);
    const template = await this.db.interviewRegistrationTemplate.findFirst({ orderBy: { createdAt: 'desc' } });
    if (!template) throw new BadRequestException('请先配置登记表');
    if (row.status === 'CANCELLED' || row.time.getTime() <= Date.now()) throw new BadRequestException('仅能为未来的面试生成登记链接');
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Math.min(row.time.getTime(), Date.now() + 7 * 86400000));
    await this.db.interviewRegistrationInvite.create({ data: { interviewId: id, templateId: template.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt, createdBy: actor.id } });
    return { token, expiresAt };
  }
  private async invite(token: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new NotFoundException('链接无效或已过期');
    const invite = await this.db.interviewRegistrationInvite.findUnique({ where: { tokenHash: createHash('sha256').update(token).digest('hex') } });
    if (!invite || invite.usedAt || invite.expiresAt <= new Date()) throw new NotFoundException('链接无效或已过期');
    const [interview, template] = await Promise.all([this.db.interview.findUnique({ where: { id: invite.interviewId } }), this.db.interviewRegistrationTemplate.findUnique({ where: { id: invite.templateId } })]);
    if (!interview || interview.status === 'CANCELLED' || interview.time <= new Date() || !template) throw new NotFoundException('链接无效或已过期');
    return { invite, interview, template };
  }
  async publicRegistration(token: string) {
    const { template, invite } = await this.invite(token);
    return { fields: template.fields, expiresAt: invite.expiresAt };
  }
  async publicSubmitRegistration(token: string, value: unknown) {
    const { invite, interview, template } = await this.invite(token);
    const values = this.registrationValues(template.fields, record(record(value).values));
    return this.db.$transaction(async tx => {
      const consumed = await tx.interviewRegistrationInvite.updateMany({ where: { id: invite.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
      if (!consumed.count) throw new NotFoundException('链接无效或已使用');
      await tx.interviewRegistrationForm.create({ data: { candidateId: interview.candidateId, jobId: interview.jobId, templateId: template.id, fields: template.fields as Prisma.InputJsonValue, values, submittedBy: 'CANDIDATE_LINK' } });
      return { submitted: true };
    });
  }

}

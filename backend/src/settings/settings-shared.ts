import { BadRequestException } from '@nestjs/common';
import { AuditOutcome, Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { sanitizeForAudit } from '../audit/audit.mask.js';

/** 请求上下文：审计记录需要 requestId、IP 与 UA。 */
export type AuditContext = { requestId: string; ip?: string | null; userAgent?: string | null };

const OTHER_PREFIX = '其他';
export const isOtherLabel = (label: string) => label.trim().startsWith(OTHER_PREFIX);

export function cleanLabel(value: unknown, name = '名称'): string {
  if (typeof value !== 'string') throw new BadRequestException(`${name}必须为字符串`);
  const label = value.trim();
  if (!label) throw new BadRequestException(`${name}不能为空`);
  if (label.length > 50) throw new BadRequestException(`${name}不能超过 50 个字符`);
  return label;
}

export function requiredVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new BadRequestException('version 为必填项，请传入读取到的版本号');
  }
  return value;
}

export function sortOrderValue(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 9999) {
    throw new BadRequestException('sortOrder 必须为 0 至 9999 的整数');
  }
  return value;
}

export function booleanFlag(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new BadRequestException(`${name}必须为布尔值`);
  return value;
}

/** ids 必须是 expected 的一个排列（不重复、不缺失、不多余）。 */
export function assertPermutation(ids: string[], expected: string[], message: string): void {
  const unique = new Set(ids);
  if (unique.size !== ids.length || ids.length !== expected.length || expected.some((id) => !unique.has(id))) {
    throw new BadRequestException(message);
  }
}

export function idList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 200) {
    throw new BadRequestException('ids 必须为 1 至 200 项的数组');
  }
  if (value.some((item) => typeof item !== 'string' || !item)) throw new BadRequestException('ids 含无效项');
  return value as string[];
}

function clip191(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  return value.length > 191 ? value.slice(0, 191) : value;
}

function auditData(
  actor: AuthenticatedUser,
  ctx: AuditContext,
  action: string,
  resourceType: string,
  resourceId: string | null,
  before: unknown,
  after: unknown,
): Prisma.AuditLogUncheckedCreateInput {
  return {
    actorId: clip191(actor.id),
    action: clip191(action) ?? 'unknown',
    resourceType: clip191(resourceType) ?? 'Setting',
    resourceId: clip191(resourceId),
    requestId: clip191(ctx.requestId) ?? 'unknown',
    beforeSummary: sanitizeForAudit(before),
    afterSummary: sanitizeForAudit(after),
    ip: clip191(ctx.ip),
    userAgent: clip191(ctx.userAgent),
    outcome: AuditOutcome.SUCCESS,
  };
}

/**
 * 带版本校验的更新：版本不一致时返回 false（由调用方转成 409），
 * 成功时在同一事务内写入脱敏审计，保证“改了配置必有审计、有审计必有变更”。
 * 各表的 updateMany 由调用方提供，避免跨表联合类型。
 */
export async function commitVersioned(
  tx: Prisma.TransactionClient,
  update: () => Promise<Prisma.BatchPayload>,
  audit: {
    actor: AuthenticatedUser;
    ctx: AuditContext;
    action: string;
    resourceType: string;
    resourceId: string;
    before: unknown;
    after: unknown;
  },
): Promise<boolean> {
  const result = await update();
  if (result.count !== 1) return false;
  await tx.auditLog.create({
    data: auditData(
      audit.actor,
      audit.ctx,
      audit.action,
      audit.resourceType,
      audit.resourceId,
      audit.before,
      audit.after,
    ),
  });
  return true;
}

/** 在事务内写一条“创建/排序”类审计（没有版本冲突语义）。 */
export async function writeAudit(
  tx: Prisma.TransactionClient,
  actor: AuthenticatedUser,
  ctx: AuditContext,
  action: string,
  resourceType: string,
  resourceId: string | null,
  before: unknown,
  after: unknown,
): Promise<void> {
  await tx.auditLog.create({
    data: auditData(actor, ctx, action, resourceType, resourceId, before, after),
  });
}

/** 固定业务规则（PRD §9.2）：只读展示，后台不提供任何可绕过这些规则的配置入口。 */
export const FIXED_RULES = [
  {
    key: 'candidate.stages',
    title: '候选人九阶段主链',
    value: ['人才推荐', '初筛', '部门筛选', '面试', 'Offer', '待入职', '已入职', '试用期', '结束'],
    note: '待分配候选人须先分配职位进入人才推荐；已归档候选人只能经人才库激活恢复；部门筛选通过才能进入面试。',
    code: 'backend/src/candidates/candidates.service.ts assertTransition',
  },
  {
    key: 'offer.stages',
    title: 'Offer 六阶段',
    value: ['录用审批资料', 'OA审批中', '口头offer', '背调信息整理中', '背调审批', '书面offer'],
    note: '不通过/拒绝须填原因：企业不通过用集 A，候选人拒绝用集 B；OA 结论仅展示，阶段结果由人事回填。',
    code: 'backend/src/offers/offer-contract.ts OFFER_STAGES',
  },
  {
    key: 'required',
    title: '必填条件',
    value: [
      '候选人姓名',
      '职位名称/部门/招聘人数',
      '需求名称/部门/人数/开始招聘时间',
      'Offer 不通过/拒绝原因',
      '放弃入职原因',
    ],
    note: '固定必填项在字段配置中不可取消；一般归档原因选填，未填写仅作为统计分组。',
    code: 'backend/src/settings/field-registry.ts FIELD_DEFINITIONS',
  },
  {
    key: 'requisition.cycle',
    title: '需求周期口径',
    value: ['需求级自然日差', '同日关闭计 1 天'],
    note: '提报时间仅记录、不参与计算；未关闭需求与本期不补录的已关闭存量不纳入汇总；统计口径不可配置。',
    code: 'backend/src/requisitions/requisition-cycle.ts',
  },
  {
    key: 'ai.confirm',
    title: 'AI 人工确认',
    value: ['草稿 → 人工显式确认'],
    note: '所有 AI 场景产出均为草稿；置信度仅辅助核对，不得触发自动转正式、自动流转或审批结论。',
    code: 'backend/src/ai/ai-run.service.ts confirm',
  },
  {
    key: 'organization.source',
    title: '正式组织来源',
    value: ['钉钉组织同步'],
    note: '正式部门和成员以钉钉同步为来源；后台只维护身份映射、授权与同步处理入口。',
    code: 'backend/src/dingtalk/dingtalk-sync.service.ts',
  },
  {
    key: 'intake.mail',
    title: '邮箱入场规则',
    value: ['先进待分配池', 'HR 手工选职位'],
    note: '仅抓取已关联邮箱中带简历附件的邮件；不启用虚拟职位自动分配；招聘网站账号级后台抓取留二期。',
    code: 'backend/src/mail/mail-poll.service.ts',
  },
  {
    key: 'interview.conclusion',
    title: '面试评价结论',
    value: ['PASS', 'HOLD', 'REJECT'],
    note: '评价不自动推进候选人阶段；代填评价记录 PROXY、操作人与时间。',
    code: 'backend/src/interviews/interviews.service.ts addFeedback',
  },
] as const;

/** 内置通知事件清单，接收角色由业务规则确定。 */
export const NOTIFICATION_EVENTS = [
  {
    key: 'interview.CREATE',
    label: '面试邀请',
    lowPriority: false,
    recipients: '受邀面试官、候选人负责人',
    channel: 'MOCK',
  },
  {
    key: 'interview.RESCHEDULE',
    label: '面试改期',
    lowPriority: false,
    recipients: '受邀面试官、候选人负责人',
    channel: 'MOCK',
  },
  {
    key: 'interview.CANCEL',
    label: '面试取消',
    lowPriority: false,
    recipients: '受邀面试官、候选人负责人',
    channel: 'MOCK',
  },
  { key: 'interview.START', label: '面试开始提醒', lowPriority: false, recipients: '受邀面试官', channel: 'PENDING' },
  { key: 'interview.FEEDBACK_REMINDER', label: '面试评价提醒', lowPriority: false, recipients: '尚未评价的面试官', channel: 'PENDING' },
  { key: 'interview.FEEDBACK_NUDGE', label: '面试评价催促', lowPriority: false, recipients: '尚未评价的面试官', channel: 'PENDING' },
  { key: 'candidate.TIMEOUT', label: '简历超时提醒', lowPriority: true, recipients: '候选人负责人或招聘负责人', channel: 'PENDING' },
  { key: 'onboarding.REMINDER', label: '待入职保温提醒', lowPriority: true, recipients: '招聘负责人', channel: 'PENDING' },
] as const;

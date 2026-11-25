import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ReasonType } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  assertPermutation,
  booleanFlag,
  cleanLabel,
  commitVersioned,
  idList,
  isOtherLabel,
  requiredVersion,
  writeAudit,
  type AuditContext,
} from './settings-shared.js';

export const REASON_SET_LABELS: Record<ReasonType, string> = {
  ARCHIVE: '集 A · 淘汰/归档',
  OFFER_REJECT: '集 B · Offer 拒绝',
  ONBOARD_ABANDON: '集 C · 放弃入职',
};

const reasonTypes = Object.values(ReasonType) as ReasonType[];
const reasonOrder: Prisma.ReasonOptionOrderByWithRelationInput[] = [
  { sortOrder: 'asc' },
  { createdAt: 'asc' },
  { id: 'asc' },
];

export type ReasonView = {
  id: string;
  type: ReasonType;
  setTypeLabel: string;
  label: string;
  active: boolean;
  sortOrder: number;
  version: number;
  isOther: boolean;
  usageCount: number;
  updatedAt: string;
};

type ReasonRow = Prisma.ReasonOptionGetPayload<Record<string, never>>;

/**
 * 原因选项（FR-ADM-5）：集 A/B/C 三套独立选项。
 * 只提供新增、排序、启停与改名，不提供删除，保证历史记录的 reasonId 始终可解析；
 * 每个集合保留唯一的「其他」选项，业务侧选择后必须填写说明。
 */
@Injectable()
export class ReasonSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(type?: ReasonType) {
    const options = await this.prisma.reasonOption.findMany({
      where: { type },
      orderBy: [{ type: 'asc' }, ...reasonOrder],
    });
    const [usage, unfilled] = await Promise.all([this.usage(), this.unfilledArchiveCount()]);
    const stats = Object.fromEntries(
      reasonTypes.map((reasonType) => [
        reasonType,
        {
          used: options
            .filter((option) => option.type === reasonType)
            .reduce((sum, option) => sum + (usage.get(option.id) ?? 0), 0),
          unfilled: reasonType === ReasonType.ARCHIVE ? unfilled : 0,
        },
      ]),
    ) as Record<ReasonType, { used: number; unfilled: number }>;
    return {
      items: options.map((option) => this.toView(option, usage.get(option.id) ?? 0)),
      stats,
      unfilledNote: '「未填写」只是一般归档空值的统计分组，不是原因选项。',
    };
  }

  async create(input: Record<string, unknown>, actor: AuthenticatedUser, ctx: AuditContext): Promise<ReasonView> {
    const type = this.reasonType(input.type);
    const label = cleanLabel(input.label, '原因名称');
    const created = await this.prisma.$transaction(async (tx) => {
      await this.assertLabelFree(tx, type, label, null);
      if (isOtherLabel(label)) {
        throw new ConflictException(`${REASON_SET_LABELS[type]}已包含「其他」选项，每个集合只能有一个`);
      }
      const last = await tx.reasonOption.aggregate({ where: { type }, _max: { sortOrder: true } });
      const row = await tx.reasonOption.create({
        data: { type, label, sortOrder: (last._max.sortOrder ?? -1) + 1, updatedById: actor.id },
      });
      await writeAudit(tx, actor, ctx, 'setting.reason.create', 'ReasonOption', row.id, undefined, { type, label });
      return row;
    });
    return this.toView(created, 0);
  }

  async update(id: string, patch: Record<string, unknown>, actor: AuthenticatedUser, ctx: AuditContext): Promise<ReasonView> {
    const version = requiredVersion(patch.version);
    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await tx.reasonOption.findUnique({ where: { id } });
      if (!current) throw new NotFoundException('原因选项不存在');

      const data: Prisma.ReasonOptionUncheckedUpdateManyInput = {};
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      if (patch.label !== undefined) {
        const label = cleanLabel(patch.label, '原因名称');
        if (label !== current.label) {
          if (isOtherLabel(current.label)) {
            throw new ConflictException('「其他」是集合内的固定选项，不能改名为普通选项');
          }
          await this.assertLabelFree(tx, current.type, label, id);
          data.label = label;
          before.label = current.label;
          after.label = label;
        }
      }
      if (patch.active !== undefined) {
        const active = booleanFlag(patch.active, 'active');
        if (active !== current.active) {
          if (!active && isOtherLabel(current.label)) {
            throw new ConflictException('「其他」是集合内的固定选项，不能停用');
          }
          data.active = active;
          before.active = current.active;
          after.active = active;
        }
      }
      if (Object.keys(data).length === 0) return current;
      const committed = await commitVersioned(
        tx,
        () =>
          tx.reasonOption.updateMany({
            where: { id, version },
            data: { ...data, updatedById: actor.id, version: { increment: 1 } },
          }),
        {
          actor,
          ctx,
          action: 'setting.reason.update',
          resourceType: 'ReasonOption',
          resourceId: id,
          before,
          after,
        },
      );
      if (!committed) throw new ConflictException('该原因选项已被他人修改，请刷新后重试');
      return tx.reasonOption.findUniqueOrThrow({ where: { id } });
    });
    return this.toView(updated, 0);
  }

  async reorder(input: Record<string, unknown>, actor: AuthenticatedUser, ctx: AuditContext) {
    const type = this.reasonType(input.type);
    const ids = idList(input.ids);
    await this.prisma.$transaction(async (tx) => {
      const options = await tx.reasonOption.findMany({ where: { type }, orderBy: reasonOrder });
      assertPermutation(ids, options.map((option) => option.id), '排序列表必须包含该集合的全部原因选项');
      for (const [index, optionId] of ids.entries()) {
        const current = options.find((option) => option.id === optionId)!;
        if (current.sortOrder === index) continue;
        await tx.reasonOption.update({
          where: { id: optionId },
          data: { sortOrder: index, updatedById: actor.id, version: { increment: 1 } },
        });
      }
      await writeAudit(
        tx,
        actor,
        ctx,
        'setting.reason.reorder',
        'ReasonOption',
        type,
        { order: options.map((option) => option.label) },
        { order: ids.map((optionId) => options.find((option) => option.id === optionId)!.label) },
      );
    });
    return this.list(type);
  }

  /** 业务侧读取启用中的选项（归档表单等）。 */
  async active(type: ReasonType) {
    const options = await this.prisma.reasonOption.findMany({
      where: { type, active: true },
      orderBy: reasonOrder,
      select: { id: true, label: true },
    });
    return options.map((option) => ({ ...option, isOther: isOtherLabel(option.label) }));
  }

  private reasonType(value: unknown): ReasonType {
    if (typeof value !== 'string' || !reasonTypes.includes(value as ReasonType)) {
      throw new BadRequestException('原因集合无效');
    }
    return value as ReasonType;
  }

  private async assertLabelFree(tx: Prisma.TransactionClient, type: ReasonType, label: string, selfId: string | null) {
    const duplicated = await tx.reasonOption.findFirst({
      where: { type, label, ...(selfId ? { id: { not: selfId } } : {}) },
      select: { id: true },
    });
    if (duplicated) throw new ConflictException(`${REASON_SET_LABELS[type]}中已存在同名原因`);
  }

  /** 使用次数按 reasonId 统计：Offer 失败、人才库归档、放弃入职三处。 */
  private async usage(): Promise<Map<string, number>> {
    const usage = new Map<string, number>();
    const add = (key: string | null, count: number) => {
      if (key) usage.set(key, (usage.get(key) ?? 0) + count);
    };
    const [offerGroups, poolGroups, abandonEvents] = await Promise.all([
      this.prisma.offerRecord.groupBy({
        by: ['rejectReasonId'],
        where: { rejectReasonId: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.candidateTalentPoolEntry.groupBy({
        by: ['reasonId'],
        where: { reasonId: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.timelineEvent.findMany({
        where: { action: 'onboarding.abandoned' },
        select: { payload: true },
        take: 5000,
      }),
    ]);
    offerGroups.forEach((group) => add(group.rejectReasonId, group._count._all));
    poolGroups.forEach((group) => add(group.reasonId, group._count._all));
    for (const event of abandonEvents) {
      const payload = event.payload;
      const reasonId = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload.reasonId : null;
      if (typeof reasonId === 'string') add(reasonId, 1);
    }
    return usage;
  }

  private unfilledArchiveCount(): Promise<number> {
    return this.prisma.candidateTalentPoolEntry.count({ where: { reasonMissing: true } });
  }

  private toView(row: ReasonRow, usageCount: number): ReasonView {
    return {
      id: row.id,
      type: row.type,
      setTypeLabel: REASON_SET_LABELS[row.type],
      label: row.label,
      active: row.active,
      sortOrder: row.sortOrder,
      version: row.version,
      isOther: isOtherLabel(row.label),
      usageCount,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

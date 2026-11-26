import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DICT_TYPES, DICT_TYPE_LABELS, isDictType, type DictType } from './field-registry.js';
import {
  assertPermutation,
  booleanFlag,
  cleanLabel,
  commitVersioned,
  idList,
  requiredVersion,
  writeAudit,
  type AuditContext,
} from './settings-shared.js';

type DictRow = Prisma.DictItemGetPayload<Record<string, never>>;
type Client = Prisma.TransactionClient | PrismaService;

const dictOrder: Prisma.DictItemOrderByWithRelationInput[] = [
  { sortOrder: 'asc' },
  { createdAt: 'asc' },
  { id: 'asc' },
];

export type DictView = {
  id: string;
  type: DictType;
  label: string;
  active: boolean;
  sortOrder: number;
  version: number;
  usageCount: number;
  updatedAt: string;
};

/**
 * 通用字典（FR-ADM-3）：渠道、标签、职级、职能类型、需求类型。
 * 业务记录按取值保存字典文本，因此已被引用的选项不允许改名（否则历史统计被拆成两个取值），
 * 只能停用；停用后历史记录仍按原取值显示与统计。
 */
@Injectable()
export class DictSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(type?: DictType) {
    const rows = await this.prisma.dictItem.findMany({
      where: { type },
      orderBy: [{ type: 'asc' }, ...dictOrder],
    });
    const counts = await this.usageCounts(rows, this.prisma);
    return {
      items: rows.map((row) => this.toView(row, counts.get(this.key(row.type, row.label)) ?? 0)),
      types: DICT_TYPES.map((dictType) => ({ type: dictType, ...DICT_TYPE_LABELS[dictType] })),
    };
  }

  async create(input: Record<string, unknown>, actor: AuthenticatedUser, ctx: AuditContext): Promise<DictView> {
    const type = this.dictType(input.type);
    const label = cleanLabel(input.label, '选项名称');
    const created = await this.prisma.$transaction(async (tx) => {
      await this.assertLabelFree(tx, type, label, null);
      const last = await tx.dictItem.aggregate({ where: { type }, _max: { sortOrder: true } });
      const row = await tx.dictItem.create({
        data: { type, label, sortOrder: (last._max.sortOrder ?? -1) + 1, updatedById: actor.id },
      });
      await writeAudit(tx, actor, ctx, 'setting.dict.create', 'DictItem', row.id, undefined, { type, label });
      return row;
    });
    return this.toView(created, 0);
  }

  async update(id: string, patch: Record<string, unknown>, actor: AuthenticatedUser, ctx: AuditContext): Promise<DictView> {
    const version = requiredVersion(patch.version);
    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await tx.dictItem.findUnique({ where: { id } });
      if (!current) throw new NotFoundException('字典项不存在');
      const type = current.type as DictType;

      const data: Prisma.DictItemUncheckedUpdateManyInput = {};
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      if (patch.label !== undefined) {
        const label = cleanLabel(patch.label, '选项名称');
        if (label !== current.label) {
          const used = (await this.usageCounts([current], tx)).get(this.key(current.type, current.label)) ?? 0;
          if (used > 0) {
            throw new ConflictException(`该选项已被 ${used} 条业务记录引用，不能改名；请停用后新建选项`);
          }
          await this.assertLabelFree(tx, type, label, id);
          data.label = label;
          before.label = current.label;
          after.label = label;
        }
      }
      if (patch.active !== undefined) {
        const active = booleanFlag(patch.active, 'active');
        if (active !== current.active) {
          data.active = active;
          before.active = current.active;
          after.active = active;
        }
      }
      if (Object.keys(data).length === 0) return current;
      const committed = await commitVersioned(
        tx,
        () =>
          tx.dictItem.updateMany({
            where: { id, version },
            data: { ...data, updatedById: actor.id, version: { increment: 1 } },
          }),
        {
          actor,
          ctx,
          action: 'setting.dict.update',
          resourceType: 'DictItem',
          resourceId: id,
          before,
          after,
        },
      );
      if (!committed) throw new ConflictException('该字典项已被他人修改，请刷新后重试');
      return tx.dictItem.findUniqueOrThrow({ where: { id } });
    });
    const used = (await this.usageCounts([updated], this.prisma)).get(this.key(updated.type, updated.label)) ?? 0;
    return this.toView(updated, used);
  }

  async reorder(input: Record<string, unknown>, actor: AuthenticatedUser, ctx: AuditContext) {
    const type = this.dictType(input.type);
    const ids = idList(input.ids);
    await this.prisma.$transaction(async (tx) => {
      const items = await tx.dictItem.findMany({ where: { type }, orderBy: dictOrder });
      assertPermutation(ids, items.map((item) => item.id), '排序列表必须包含该字典的全部选项');
      for (const [index, itemId] of ids.entries()) {
        const current = items.find((item) => item.id === itemId)!;
        if (current.sortOrder === index) continue;
        await tx.dictItem.update({
          where: { id: itemId },
          data: { sortOrder: index, updatedById: actor.id, version: { increment: 1 } },
        });
      }
      await writeAudit(
        tx,
        actor,
        ctx,
        'setting.dict.reorder',
        'DictItem',
        type,
        { order: items.map((item) => item.label) },
        { order: ids.map((itemId) => items.find((item) => item.id === itemId)!.label) },
      );
    });
    return this.list(type);
  }

  /** 业务保存时校验取值：必须是该字典启用中的选项。 */
  async assertValue(type: DictType, value: string, fieldLabel: string): Promise<void> {
    const hit = await this.prisma.dictItem.findFirst({
      where: { type, label: value, active: true },
      select: { id: true },
    });
    if (!hit) {
      throw new BadRequestException(`${fieldLabel}“${value}”不在可选项中，请查看管理后台“招聘基础配置”的启用项`);
    }
  }

  /** 启用中的取值，供业务表单提供建议。 */
  async activeLabels(type: DictType): Promise<string[]> {
    const rows = await this.prisma.dictItem.findMany({
      where: { type, active: true },
      orderBy: dictOrder,
      select: { label: true },
    });
    return rows.map((row) => row.label);
  }

  private dictType(value: unknown): DictType {
    if (!isDictType(value)) throw new BadRequestException('字典类型无效');
    return value;
  }

  private key(type: string, label: string): string {
    return `${type}/${label}`;
  }

  private async assertLabelFree(tx: Prisma.TransactionClient, type: DictType, label: string, selfId: string | null) {
    const duplicated = await tx.dictItem.findFirst({
      where: { type, label, ...(selfId ? { id: { not: selfId } } : {}) },
      select: { id: true },
    });
    if (duplicated) throw new ConflictException(`${DICT_TYPE_LABELS[type].label}中已存在同名选项`);
  }

  /** 按取值统计业务引用：渠道、标签、职级有实际落点，其余类型暂无业务字段。 */
  private async usageCounts(rows: Array<{ type: string; label: string }>, client: Client): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    const add = (type: string, label: string | null, count: number) => {
      if (label) counts.set(this.key(type, label), (counts.get(this.key(type, label)) ?? 0) + count);
    };
    const labelsOf = (type: string) => [...new Set(rows.filter((row) => row.type === type).map((row) => row.label))];

    const channels = labelsOf('CHANNEL');
    if (channels.length) {
      const [byCandidate, bySource] = await Promise.all([
        client.candidate.groupBy({
          by: ['channel'],
          where: { channel: { in: channels } },
          _count: { _all: true },
        }),
        client.candidateSourceRecord.groupBy({
          by: ['source'],
          where: { source: { in: channels } },
          _count: { _all: true },
        }),
      ]);
      byCandidate.forEach((group) => add('CHANNEL', group.channel, group._count._all));
      bySource.forEach((group) => add('CHANNEL', group.source, group._count._all));
    }

    const levels = labelsOf('JOB_LEVEL');
    if (levels.length) {
      const groups = await client.jobRequisition.groupBy({
        by: ['jobLevel'],
        where: { jobLevel: { in: levels } },
        _count: { _all: true },
      });
      groups.forEach((group) => add('JOB_LEVEL', group.jobLevel, group._count._all));
    }

    const reqTypes = labelsOf('REQUISITION_TYPE');
    if (reqTypes.length) {
      const groups = await client.jobRequisition.groupBy({
        by: ['requisitionType'],
        where: { requisitionType: { in: reqTypes } },
        _count: { _all: true },
      });
      groups.forEach((group) => add('REQUISITION_TYPE', group.requisitionType, group._count._all));
    }

    for (const label of labelsOf('TAG')) {
      // tags 以 JSON 文本保存，按带引号的完整取值匹配，避免“前端”命中“前端负责人”
      add('TAG', label, await client.candidate.count({ where: { tags: { contains: JSON.stringify(label) } } }));
    }
    return counts;
  }

  private toView(row: DictRow, usageCount: number): DictView {
    return {
      id: row.id,
      type: row.type as DictType,
      label: row.label,
      active: row.active,
      sortOrder: row.sortOrder,
      version: row.version,
      usageCount,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

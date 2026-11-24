import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DictSettingsService } from './dict-settings.service.js';
import {
  CONFIG_ENTITIES,
  CONFIG_ENTITY_LABELS,
  DICT_TYPES,
  FIELD_DEFINITIONS,
  type ConfigEntity,
} from './field-registry.js';
import { assertActiveInterviewPlan, assertDictValue, assertRequiredFields } from './config-rules.js';
import {
  booleanFlag,
  cleanLabel,
  commitVersioned,
  isOtherLabel,
  requiredVersion,
  writeAudit,
  type AuditContext,
} from './settings-shared.js';

export type FieldView = {
  id: string;
  entity: ConfigEntity;
  key: string;
  label: string;
  required: boolean;
  visible: boolean;
  requiredConfigurable: boolean;
  visibleConfigurable: boolean;
  effect: 'server' | 'form';
  description: string;
  version: number;
};

export type PlanView = {
  id: string;
  name: string;
  rounds: number;
  description: string | null;
  active: boolean;
  sortOrder: number;
  version: number;
  usageCount: number;
  updatedAt: string;
};

type PlanRow = Prisma.InterviewPlanGetPayload<Record<string, never>>;

const planOrder: Prisma.InterviewPlanOrderByWithRelationInput[] = [
  { sortOrder: 'asc' },
  { createdAt: 'asc' },
  { id: 'asc' },
];

/**
 * 字段配置与面试方案（FR-ADM-3/4）。
 * 可配置的字段范围由注册表固定；固定必填、固定显示不可取消，
 * 因此九阶段、Offer、必填条件等规则无法通过字段配置绕过。
 */
@Injectable()
export class FieldConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dicts: DictSettingsService,
  ) {}

  // ---------- 字段配置 ----------

  async listFields(): Promise<{ entity: ConfigEntity; label: string; items: FieldView[] }[]> {
    const rows = await this.prisma.fieldConfig.findMany();
    return CONFIG_ENTITIES.map((entity) => ({
      entity,
      label: CONFIG_ENTITY_LABELS[entity],
      items: FIELD_DEFINITIONS.filter((definition) => definition.entity === entity).map((definition, index) => {
        const row = rows.find((item) => item.entity === entity && item.fieldKey === definition.key);
        return {
          id: row?.id ?? `${entity}.${definition.key}`,
          entity,
          key: definition.key,
          label: definition.label,
          required: definition.fixedRequired || row?.required === true,
          visible: definition.fixedVisible || (row ? row.visible : true),
          requiredConfigurable: !definition.fixedRequired,
          visibleConfigurable: !definition.fixedVisible,
          effect: definition.effect,
          description: definition.description,
          version: row?.version ?? 0,
          sortOrder: row?.sortOrder ?? index,
        };
      }),
    }));
  }

  async updateField(id: string, patch: Record<string, unknown>, actor: AuthenticatedUser, ctx: AuditContext): Promise<FieldView> {
    const version = requiredVersion(patch.version);
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.fieldConfig.findUnique({ where: { id } });
      if (!current) throw new NotFoundException('字段配置不存在');
      const definition = FIELD_DEFINITIONS.find(
        (item) => item.entity === current.entity && item.key === current.fieldKey,
      );
      if (!definition) throw new NotFoundException('该字段不在允许配置的范围内');

      const data: Prisma.FieldConfigUncheckedUpdateManyInput = {};
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      if (patch.required !== undefined) {
        const required = booleanFlag(patch.required, 'required');
        if (required !== current.required) {
          if (definition.fixedRequired && !required) {
            throw new BadRequestException(`${definition.label}为固定必填条件，不能取消必填`);
          }
          data.required = required;
          before.required = current.required;
          after.required = required;
        }
      }
      if (patch.visible !== undefined) {
        const visible = booleanFlag(patch.visible, 'visible');
        if (visible !== current.visible) {
          if (definition.fixedVisible && !visible) {
            throw new BadRequestException(`${definition.label}为固定显示字段，不能隐藏`);
          }
          data.visible = visible;
          before.visible = current.visible;
          after.visible = visible;
        }
      }
      if (Object.keys(data).length === 0) return;
      const committed = await commitVersioned(
        tx,
        () =>
          tx.fieldConfig.updateMany({
            where: { id, version },
            data: { ...data, updatedById: actor.id, version: { increment: 1 } },
          }),
        {
          actor,
          ctx,
          action: 'setting.field.update',
          resourceType: 'FieldConfig',
          resourceId: id,
          before: { entity: current.entity, key: current.fieldKey, ...before },
          after: { entity: current.entity, key: current.fieldKey, ...after },
        },
      );
      if (!committed) throw new ConflictException('该字段配置已被他人修改，请刷新后重试');
    });
    const group = (await this.listFields()).find((item) => item.items.some((field) => field.id === id));
    const field = group?.items.find((item) => item.id === id);
    if (!field) throw new NotFoundException('字段配置不存在');
    return field;
  }

  /** 业务保存时按配置校验必填：固定必填 + 后台配置为必填的字段都必须有值。 */
  assertRequired(entity: ConfigEntity, input: Record<string, unknown>): Promise<void> {
    return assertRequiredFields(this.prisma, entity, input);
  }

  /** 候选人渠道取值必须是启用中的字典项（未填写时不校验，由必填规则负责）。 */
  async assertCandidateChannel(value: unknown): Promise<void> {
    if (typeof value !== 'string' || !value.trim()) return;
    await assertDictValue(this.prisma, 'CHANNEL', value.trim(), '渠道');
  }

  // ---------- 面试方案 ----------

  async listPlans(): Promise<PlanView[]> {
    const [rows, usage] = await Promise.all([
      this.prisma.interviewPlan.findMany({ orderBy: planOrder }),
      this.prisma.job.groupBy({ by: ['interviewPlanId'], where: { interviewPlanId: { not: null } }, _count: { _all: true } }),
    ]);
    const counts = new Map(usage.map((group) => [group.interviewPlanId, group._count._all]));
    return rows.map((row) => this.toPlanView(row, counts.get(row.id) ?? 0));
  }

  async createPlan(input: Record<string, unknown>, actor: AuthenticatedUser, ctx: AuditContext): Promise<PlanView> {
    const name = cleanLabel(input.name, '方案名称');
    const rounds = this.rounds(input.rounds);
    const description = this.description(input.description);
    const created = await this.prisma.$transaction(async (tx) => {
      await this.assertPlanNameFree(tx, name, null);
      const last = await tx.interviewPlan.aggregate({ where: {}, _max: { sortOrder: true } });
      const row = await tx.interviewPlan.create({
        data: { name, rounds, description, sortOrder: (last._max.sortOrder ?? -1) + 1, updatedById: actor.id },
      });
      await writeAudit(tx, actor, ctx, 'setting.plan.create', 'InterviewPlan', row.id, undefined, { name, rounds });
      return row;
    });
    return this.toPlanView(created, 0);
  }

  async updatePlan(id: string, patch: Record<string, unknown>, actor: AuthenticatedUser, ctx: AuditContext): Promise<PlanView> {
    const version = requiredVersion(patch.version);
    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await tx.interviewPlan.findUnique({ where: { id } });
      if (!current) throw new NotFoundException('面试方案不存在');

      const data: Prisma.InterviewPlanUncheckedUpdateManyInput = {};
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      if (patch.name !== undefined) {
        const name = cleanLabel(patch.name, '方案名称');
        if (name !== current.name) {
          await this.assertPlanNameFree(tx, name, id);
          data.name = name;
          before.name = current.name;
          after.name = name;
        }
      }
      if (patch.rounds !== undefined) {
        const rounds = this.rounds(patch.rounds);
        if (rounds !== current.rounds) {
          data.rounds = rounds;
          before.rounds = current.rounds;
          after.rounds = rounds;
        }
      }
      if (patch.description !== undefined) {
        const description = this.description(patch.description);
        if (description !== current.description) {
          data.description = description;
          before.description = current.description;
          after.description = description;
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
          tx.interviewPlan.updateMany({
            where: { id, version },
            data: { ...data, updatedById: actor.id, version: { increment: 1 } },
          }),
        {
          actor,
          ctx,
          action: 'setting.plan.update',
          resourceType: 'InterviewPlan',
          resourceId: id,
          before,
          after,
        },
      );
      if (!committed) throw new ConflictException('该面试方案已被他人修改，请刷新后重试');
      return tx.interviewPlan.findUniqueOrThrow({ where: { id } });
    });
    const usage = await this.prisma.job.count({ where: { interviewPlanId: id } });
    return this.toPlanView(updated, usage);
  }

  /** 职位引用的方案必须存在且启用；停用后已有职位保留原引用，但不能再被新职位选用。 */
  assertActivePlan(planId: string): Promise<void> {
    return assertActiveInterviewPlan(this.prisma, planId);
  }

  // ---------- 业务界面读取的有效配置 ----------

  /** 任何已登录用户可读：只包含表单所需的必填/显示标记与启用中的选项，不含管理明细。 */
  async effective() {
    const [rows, dictRows, archiveReasons, plans] = await Promise.all([
      this.prisma.fieldConfig.findMany(),
      this.prisma.dictItem.findMany({
        where: { active: true },
        orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        select: { type: true, label: true },
      }),
      this.prisma.reasonOption.findMany({
        where: { type: 'ARCHIVE', active: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, label: true },
      }),
      this.prisma.interviewPlan.findMany({
        where: { active: true },
        orderBy: planOrder,
        select: { id: true, name: true, rounds: true },
      }),
    ]);
    const byKey = new Map(rows.map((row) => [`${row.entity}.${row.fieldKey}`, row]));
    const fields = Object.fromEntries(
      CONFIG_ENTITIES.map((entity) => [
        entity,
        FIELD_DEFINITIONS.filter((definition) => definition.entity === entity).map((definition) => {
          const row = byKey.get(`${entity}.${definition.key}`);
          return {
            key: definition.key,
            label: definition.label,
            required: definition.fixedRequired || row?.required === true,
            visible: definition.fixedVisible || (row ? row.visible : true),
          };
        }),
      ]),
    ) as Record<ConfigEntity, Array<{ key: string; label: string; required: boolean; visible: boolean }>>;
    const dicts = Object.fromEntries(
      DICT_TYPES.map((type) => [type, dictRows.filter((row) => row.type === type).map((row) => row.label)]),
    ) as Record<(typeof DICT_TYPES)[number], string[]>;
    return {
      fields,
      dicts,
      archiveReasons: archiveReasons.map((option) => ({ id: option.id, label: option.label, isOther: isOtherLabel(option.label) })),
      interviewPlans: plans,
    };
  }

  private rounds(value: unknown): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 10) {
      throw new BadRequestException('面试轮次必须为 1 至 10 的整数');
    }
    return value;
  }

  private description(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') throw new BadRequestException('方案说明必须为字符串');
    const text = value.trim();
    if (text.length > 500) throw new BadRequestException('方案说明不能超过 500 个字符');
    return text || null;
  }

  private async assertPlanNameFree(tx: Prisma.TransactionClient, name: string, selfId: string | null) {
    const duplicated = await tx.interviewPlan.findFirst({
      where: { name, ...(selfId ? { id: { not: selfId } } : {}) },
      select: { id: true },
    });
    if (duplicated) throw new ConflictException('已存在同名面试方案');
  }

  private toPlanView(row: PlanRow, usageCount: number): PlanView {
    return {
      id: row.id,
      name: row.name,
      rounds: row.rounds,
      description: row.description,
      active: row.active,
      sortOrder: row.sortOrder,
      version: row.version,
      usageCount,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

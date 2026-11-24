import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { FIELD_DEFINITIONS, isEmptyFieldValue, type ConfigEntity } from './field-registry.js';

type Client = Prisma.TransactionClient | PrismaService;

/** 与各业务服务的 `optionalText` 口径一致：占位文案“待补充”视为未填写。 */
function isBlank(value: unknown): boolean {
  return isEmptyFieldValue(value) || (typeof value === 'string' && value.trim() === '待补充');
}

/**
 * 业务保存时按字段配置校验必填（ATS-024 / FR-ADM-3）。
 *
 * 独立于 Nest 注入的纯函数：候选人、职位等业务服务直接用自身的 Prisma 客户端调用，
 * 保证业务保存路径与后台配置读取的是同一份持久化数据。
 * 固定必填字段始终校验；其余字段是否必填取自 field_configs。
 */
export async function assertRequiredFields(
  client: Client,
  entity: ConfigEntity,
  input: Record<string, unknown>,
): Promise<void> {
  const rows = await client.fieldConfig.findMany({
    where: { entity },
    select: { fieldKey: true, required: true },
  });
  const configured = new Map(rows.map((row) => [row.fieldKey, row.required]));
  for (const definition of FIELD_DEFINITIONS) {
    if (definition.entity !== entity || definition.effect !== 'server') continue;
    const required = definition.fixedRequired || configured.get(definition.key) === true;
    if (required && isBlank(input[definition.key])) {
      throw new BadRequestException(`${definition.label}不能为空`);
    }
  }
}

/** 字典取值校验：已填写时必须是该字典启用中的选项。 */
export async function assertDictValue(
  client: Client,
  type: string,
  value: string,
  fieldLabel: string,
): Promise<void> {
  const hit = await client.dictItem.findFirst({
    where: { type, label: value, active: true },
    select: { id: true },
  });
  if (!hit) {
    throw new BadRequestException(`${fieldLabel}“${value}”不在可选项中，请查看管理后台“招聘基础配置”的启用项`);
  }
}

/** 职位引用的面试方案必须存在且启用；停用后已有职位保留原引用，但不能再被新职位选用。 */
export async function assertActiveInterviewPlan(client: Client, planId: string): Promise<void> {
  const plan = await client.interviewPlan.findFirst({
    where: { id: planId, active: true },
    select: { id: true },
  });
  if (!plan) throw new BadRequestException('面试方案不存在或已停用');
}

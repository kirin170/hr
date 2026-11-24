import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

type Client = Prisma.TransactionClient | PrismaService;

/**
 * 部门与操作人显示名（ATS-024 遗留缺陷修复）。
 *
 * `Job.departmentId` 只保存部门 ID、没有外键关联，时间线也只保存 actorId；
 * 这里按 ID 批量补全名称，供候选人/职位接口返回 departmentName 与操作人姓名。
 *
 * 名称只用于展示增强：查询失败时返回空映射，调用方回退为空串或“未知”，
 * 不影响候选人、职位等主数据的返回。
 */
export async function resolveDepartmentNames(
  client: Client,
  ids: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))];
  if (!unique.length) return new Map();
  try {
    const rows = await client.department.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((row) => [row.id, row.name]));
  } catch {
    return new Map();
  }
}

export async function resolveUserNames(
  client: Client,
  ids: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))];
  if (!unique.length) return new Map();
  try {
    const rows = await client.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, displayName: true },
    });
    return new Map(rows.map((row) => [row.id, row.displayName]));
  } catch {
    return new Map();
  }
}

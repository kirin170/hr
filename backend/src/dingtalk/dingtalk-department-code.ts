import { createHash } from 'node:crypto';

/**
 * 钉钉部门在本地 Department.code 中的唯一编码：`DINGTALK_<corpId 摘要>_<deptId>`。
 * 组织同步与 OA 部门映射共用同一规则，避免两处各算一套。
 */
export function dingtalkDepartmentCode(corpId: string, departmentId: number): string {
  const digest = createHash('sha256').update(corpId).digest('hex').slice(0, 12);
  return `DINGTALK_${digest}_${departmentId}`;
}

/** 反解本地部门编码中的钉钉 deptId；不是钉钉同步的部门返回 null。 */
export function parseDingtalkDepartmentCode(code: string | null | undefined): number | null {
  if (!code) return null;
  const match = /^DINGTALK_[0-9a-f]{12}_([1-9]\d*)$/.exec(code);
  return match ? Number(match[1]) : null;
}

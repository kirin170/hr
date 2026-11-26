import type { ApiDepartment } from '../../types'

export type RunFn = (key: string, action: () => Promise<unknown>, success: string) => Promise<boolean>

export type DepartmentTreeNode = {
  department: ApiDepartment
  depth: number
  childIds: string[]
  childCount: number
  descendantCount: number
  parentName: string | null
  effectiveParentId: string | null
}

/** 将平铺部门列表整理为按层级排序的树节点，并计算直属与全部下级部门数 */
export function buildDepartmentTree(items: ApiDepartment[]): DepartmentTreeNode[] {
  const byId = new Map(items.map((item) => [item.id, item]))
  const childrenMap = new Map<string | null, ApiDepartment[]>()
  for (const item of items) {
    const parentKey = item.parentId && byId.has(item.parentId) ? item.parentId : null
    childrenMap.set(parentKey, [...(childrenMap.get(parentKey) ?? []), item])
  }
  const sortList = (list: ApiDepartment[]) =>
    [...list].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN') || a.code.localeCompare(b.code))

  const descendantMemo = new Map<string, number>()
  const countDesc = (id: string, stack = new Set<string>()): number => {
    const cached = descendantMemo.get(id)
    if (cached !== undefined) return cached
    if (stack.has(id)) return 0
    stack.add(id)
    let total = 0
    for (const child of childrenMap.get(id) ?? []) {
      total += 1 + countDesc(child.id, stack)
    }
    descendantMemo.set(id, total)
    return total
  }

  const result: DepartmentTreeNode[] = []
  const visited = new Set<string>()
  const walk = (parentKey: string | null, depth: number) => {
    for (const dept of sortList(childrenMap.get(parentKey) ?? [])) {
      if (visited.has(dept.id)) continue
      visited.add(dept.id)
      const kids = sortList(childrenMap.get(dept.id) ?? [])
      result.push({
        department: dept,
        depth,
        childIds: kids.map((k) => k.id),
        childCount: kids.length,
        descendantCount: countDesc(dept.id),
        parentName: dept.parentId ? byId.get(dept.parentId)?.name ?? null : null,
        effectiveParentId: dept.parentId && byId.has(dept.parentId) ? dept.parentId : null,
      })
      walk(dept.id, depth + 1)
    }
  }
  walk(null, 0)
  return result
}

export function msg(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败'
}

export function statusLabel(status: string): string {
  const map: Record<string, string> = {
    READY: '已配置',
    PARTIAL: '部分配置',
    NOT_CONFIGURED: '未配置',
    UP: '正常',
    DOWN: '不可用',
    DEGRADED: '降级',
    MOCK: '模拟',
  }
  return map[status] || status
}

export function scopeLabel(scope: string): string {
  const map: Record<string, string> = {
    SELF: '本人',
    DEPARTMENT: '本部门',
    DEPARTMENT_TREE: '本部门及下级',
    OWN_JOBS: '负责职位',
    PARTICIPATING: '参与面试或筛选',
    DEPARTMENT_AND_PARTICIPATING: '本部门及参与',
    ALL: '全部',
  }
  return map[scope] || scope
}

export function dingtalkEventTypeLabel(eventType: string): string {
  const map: Record<string, string> = {
    MANUAL_FULL_SYNC: '全量同步（组织与人员）',
    user_add_org: '成员入职同步',
    user_modify_org: '成员变更同步',
    user_leave_org: '成员离职停用',
    org_dept_create: '部门新增同步',
    org_dept_modify: '部门变更同步',
    org_dept_remove: '部门删除同步',
  }
  return map[eventType] || eventType
}

export function dingtalkEventStatusLabel(status: string): string {
  const map: Record<string, string> = {
    RECEIVED: '待入队',
    QUEUED: '排队中',
    PROCESSING: '同步中',
    PROCESSED: '已完成',
    FAILED: '失败',
  }
  return map[status] || status
}

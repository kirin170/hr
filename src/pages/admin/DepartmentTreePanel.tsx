import { useEffect, useMemo, useState } from 'react'
import { Building2, ChevronDown, ChevronRight, FolderTree, Search, X } from 'lucide-react'
import type { ApiDepartment } from '../../types'
import { cn } from '../../utils'
import { buildDepartmentTree, type DepartmentTreeNode } from './shared'

type DepartmentTreePanelProps = {
  departments: ApiDepartment[]
  selectedId: string
  onSelect: (departmentId: string) => void
  topOption?: { id?: string; label: string; count?: number }
  title?: string
  treeNodes?: DepartmentTreeNode[]
}

/** 左侧定高可折叠部门树面板：默认仅展开根节点，支持关键字展开定位子孙路径 */
export function DepartmentTreePanel({
  departments,
  selectedId,
  onSelect,
  topOption,
  title = '部门架构树',
  treeNodes,
}: DepartmentTreePanelProps) {
  const nodes = useMemo(() => treeNodes ?? buildDepartmentTree(departments), [treeNodes, departments])
  const [keyword, setKeyword] = useState('')
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())
  const [initialized, setInitialized] = useState(false)

  useEffect(() => {
    if (initialized || nodes.length === 0) return
    setExpandedIds(new Set(nodes.filter((n) => n.depth === 0).map((n) => n.department.id)))
    setInitialized(true)
  }, [nodes, initialized])

  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.department.id, n])), [nodes])
  const childrenByParent = useMemo(() => {
    const map = new Map<string | null, DepartmentTreeNode[]>()
    for (const node of nodes) {
      const key = node.effectiveParentId
      map.set(key, [...(map.get(key) ?? []), node])
    }
    return map
  }, [nodes])

  const visibleNodes = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    if (q) {
      const included = new Set<string>()
      for (const node of nodes) {
        const hit =
          node.department.name.toLowerCase().includes(q) ||
          node.department.code.toLowerCase().includes(q)
        if (!hit) continue
        let curr: DepartmentTreeNode | undefined = node
        while (curr) {
          included.add(curr.department.id)
          curr = curr.effectiveParentId ? nodeMap.get(curr.effectiveParentId) : undefined
        }
      }
      return nodes.filter((node) => included.has(node.department.id))
    }

    const result: DepartmentTreeNode[] = []
    const walk = (parentId: string | null) => {
      for (const node of childrenByParent.get(parentId) ?? []) {
        result.push(node)
        if (expandedIds.has(node.department.id)) {
          walk(node.department.id)
        }
      }
    }
    walk(null)
    return result
  }, [keyword, nodes, nodeMap, childrenByParent, expandedIds])

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allExpandableIds = useMemo(
    () => nodes.filter((n) => n.childCount > 0).map((n) => n.department.id),
    [nodes],
  )
  const isAllExpanded = allExpandableIds.length > 0 && expandedIds.size >= allExpandableIds.length

  return (
    <aside className="panel org-tree-pane">
      <div className="org-tree-head">
        <div className="org-tree-title">
          <FolderTree size={14} />
          <strong>{title}</strong>
          <span>{departments.length}</span>
        </div>
        {allExpandableIds.length > 0 && !keyword.trim() && (
          <button
            type="button"
            className="text-button"
            onClick={() =>
              setExpandedIds(
                isAllExpanded
                  ? new Set(nodes.filter((n) => n.depth === 0).map((n) => n.department.id))
                  : new Set(allExpandableIds),
              )
            }
          >
            {isAllExpanded ? '收起层级' : '展开全部'}
          </button>
        )}
      </div>

      <label className="table-search org-tree-search">
        <Search size={14} />
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜索部门名称或编码"
        />
        {keyword && (
          <button type="button" onClick={() => setKeyword('')} aria-label="清空搜索">
            <X size={13} />
          </button>
        )}
      </label>

      <div className="org-tree-scroll" role="tree" aria-label={title}>
        {topOption && !keyword.trim() && (
          <button
            type="button"
            className={cn('org-tree-item org-tree-all', selectedId === (topOption.id ?? '') && 'active')}
            onClick={() => onSelect(topOption.id ?? '')}
          >
            <Building2 size={14} />
            <span className="org-tree-label">{topOption.label}</span>
            {topOption.count !== undefined && <span className="org-tree-badge">{topOption.count}</span>}
          </button>
        )}

        {visibleNodes.map((node) => {
          const { department, depth, childCount } = node
          const expanded = Boolean(keyword.trim()) || expandedIds.has(department.id)
          const selected = selectedId === department.id
          return (
            <div
              key={department.id}
              role="treeitem"
              aria-selected={selected}
              aria-expanded={childCount > 0 ? expanded : undefined}
              className={cn('org-tree-item', selected && 'active')}
              style={{ paddingLeft: `${8 + depth * 14}px` }}
            >
              {childCount > 0 ? (
                <button
                  type="button"
                  className="org-tree-chevron"
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleExpand(department.id)
                  }}
                  aria-label={expanded ? '收起下级' : '展开下级'}
                >
                  {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                </button>
              ) : (
                <span className="org-tree-spacer" aria-hidden="true" />
              )}
              <button
                type="button"
                className="org-tree-select"
                onClick={() => {
                  onSelect(department.id)
                  if (childCount > 0 && !expandedIds.has(department.id)) {
                    toggleExpand(department.id)
                  }
                }}
              >
                <span className="org-tree-label" title={`${department.name} (${department.code})`}>
                  {department.name}
                </span>
                {childCount > 0 && <span className="org-tree-badge">{childCount}</span>}
              </button>
            </div>
          )
        })}

        {visibleNodes.length === 0 && (
          <div className="empty-inline">没有匹配的部门</div>
        )}
      </div>
    </aside>
  )
}

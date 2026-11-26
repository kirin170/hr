import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, Building2, FolderPlus, RefreshCw } from 'lucide-react'
import * as api from '../../api'
import type { DingTalkSyncEventRow } from '../../api'
import { useApp } from '../../context'
import type { ApiDepartment } from '../../types'
import { cn } from '../../utils'
import { DepartmentTreePanel } from './DepartmentTreePanel'
import { buildDepartmentTree, dingtalkEventStatusLabel, dingtalkEventTypeLabel, msg, type DepartmentTreeNode } from './shared'

type OrgTab = 'tree' | 'sync'

export function AdminOrgPage() {
  const { toast } = useApp()
  const [tab, setTab] = useState<OrgTab>('tree')
  const [departments, setDepartments] = useState<ApiDepartment[]>([])
  const [events, setEvents] = useState<DingTalkSyncEventRow[] | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [draft, setDraft] = useState({ code: '', name: '', parentId: '' })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [deptRows, syncEvents] = await Promise.all([
        api.listDepartments(),
        api.listDingTalkSyncEvents(30).catch(() => null),
      ])
      setDepartments(deptRows)
      setEvents(syncEvents)
      setError('')
    } catch (err) {
      setError(msg(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const tree = useMemo(() => buildDepartmentTree(departments), [departments])
  const nodeMap = useMemo(() => new Map(tree.map((node) => [node.department.id, node])), [tree])

  useEffect(() => {
    if (tree.length === 0) return
    if (!selectedId || !nodeMap.has(selectedId)) {
      setSelectedId(tree[0].department.id)
    }
  }, [tree, nodeMap, selectedId])

  const selectedNode = selectedId ? nodeMap.get(selectedId) ?? tree[0] : tree[0]
  const directChildren = useMemo(() => {
    if (!selectedNode) return []
    return selectedNode.childIds.flatMap((id) => {
      const node = nodeMap.get(id)
      return node ? [node] : []
    })
  }, [selectedNode, nodeMap])

  const breadcrumbs = useMemo(() => {
    const chain: DepartmentTreeNode[] = []
    let curr: DepartmentTreeNode | undefined = selectedNode
    while (curr) {
      chain.unshift(curr)
      curr = curr.effectiveParentId ? nodeMap.get(curr.effectiveParentId) : undefined
    }
    return chain
  }, [selectedNode, nodeMap])

  const run = async (key: string, action: () => Promise<unknown>, success: string): Promise<boolean> => {
    setBusy(key)
    setError('')
    try {
      await action()
      await load()
      toast(success)
      return true
    } catch (err) {
      const message = msg(err)
      setError(message)
      toast(message, 'info')
      return false
    } finally {
      setBusy('')
    }
  }

  const openCreateUnder = (parentId: string) => {
    setDraft({ code: '', name: '', parentId })
    setTab('tree')
    setShowCreate(true)
  }

  return (
    <div className="page-stack">
      <div className="page-title-row">
        <div>
          <div className="eyebrow">系统管理 <span className="eyebrow-separator">·</span> 组织结构与钉钉同步</div>
          <h2>组织架构</h2>
          <p>支持按树形层级浏览部门与子部门，在顶部切换查看同步记录或直接新增部门，无需翻越长表格。</p>
        </div>
        <div className="page-title-actions">
          <button className="button button-secondary" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={15} />刷新
          </button>
          <button
            className="button button-secondary"
            disabled={busy === 'dingtalk-sync'}
            onClick={() => void run('dingtalk-sync', () => api.triggerDingTalkSync(), '钉钉组织与人员全量同步已入队')}
          >
            <RefreshCw size={15} />{busy === 'dingtalk-sync' ? '同步中…' : '同步钉钉组织与人员'}
          </button>
          <button
            className="button button-primary"
            onClick={() => {
              if (showCreate) {
                setShowCreate(false)
              } else {
                openCreateUnder(selectedNode?.department.id ?? '')
              }
            }}
          >
            <FolderPlus size={15} />{showCreate ? '收起新建' : '新建部门'}
          </button>
        </div>
      </div>

      <div className="stage-tabs">
        <button className={cn('stage-tab', tab === 'tree' && 'active')} onClick={() => setTab('tree')}>
          <Building2 size={14} />部门架构 <span>{departments.length}</span>
        </button>
        {events !== null && (
          <button className={cn('stage-tab', tab === 'sync' && 'active')} onClick={() => setTab('sync')}>
            <RefreshCw size={14} />钉钉同步记录 <span>{events.length}</span>
          </button>
        )}
      </div>

      {error && <div className="admin-error" role="alert">{error}</div>}

      {tab === 'tree' && (
        <>
          {showCreate && (
            <section className="panel admin-section">
              <div className="panel-header">
                <div>
                  <h3>新建部门</h3>
                  <p className="hint">可作为顶级部门或挂在当前选中部门下；停用与更名由通讯录同步或组织接口维护。</p>
                </div>
              </div>
              <div className="admin-inline-form" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}>
                <input
                  className="admin-input admin-input-sm"
                  placeholder="部门编码"
                  value={draft.code}
                  onChange={(e) => setDraft({ ...draft, code: e.target.value })}
                />
                <input
                  className="admin-input"
                  placeholder="部门名称"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
                <select
                  className="admin-select"
                  value={draft.parentId}
                  onChange={(e) => setDraft({ ...draft, parentId: e.target.value })}
                >
                  <option value="">作为顶级部门</option>
                  {tree.map(({ department, depth }) => (
                    <option key={department.id} value={department.id}>
                      {'　'.repeat(depth)}{department.name} ({department.code})
                    </option>
                  ))}
                </select>
                <button
                  className="button button-primary button-sm"
                  disabled={!draft.code.trim() || !draft.name.trim() || busy === 'department-create'}
                  onClick={() => {
                    const payload = {
                      code: draft.code.trim(),
                      name: draft.name.trim(),
                      parentId: draft.parentId || undefined,
                    }
                    void run('department-create', () => api.createAuthzDepartment(payload), '部门已创建')
                      .then((ok) => {
                        if (ok) {
                          setDraft({ code: '', name: '', parentId: '' })
                          setShowCreate(false)
                        }
                      })
                  }}
                >
                  {busy === 'department-create' ? '创建中…' : '确认创建'}
                </button>
              </div>
            </section>
          )}

          <div className="admin-split-layout org-split-layout">
            <DepartmentTreePanel
              departments={departments}
              treeNodes={tree}
              selectedId={selectedNode?.department.id ?? ''}
              onSelect={setSelectedId}
              title="组织树"
            />

            <section className="panel org-detail-pane">
              {selectedNode ? (
                <>
                  <div className="org-detail-head">
                    <div>
                      <div className="org-breadcrumb">
                        {breadcrumbs.map((node, index) => (
                          <span key={node.department.id}>
                            {index > 0 && <span className="org-breadcrumb-sep">/</span>}
                            <button
                              type="button"
                              className={cn('org-breadcrumb-btn', index === breadcrumbs.length - 1 && 'current')}
                              onClick={() => setSelectedId(node.department.id)}
                            >
                              {node.department.name}
                            </button>
                          </span>
                        ))}
                      </div>
                      <div className="org-detail-title">
                        <h3>{selectedNode.department.name}</h3>
                        <span className="mono-cell">{selectedNode.department.code}</span>
                      </div>
                      <p className="hint">
                        上级：{selectedNode.parentName || '顶级部门'} · 直属下级 {selectedNode.childCount} 个 · 含全部子孙部门共 {selectedNode.descendantCount} 个
                      </p>
                    </div>
                    <div className="org-detail-actions">
                      {selectedNode.effectiveParentId && (
                        <button
                          type="button"
                          className="button button-secondary button-sm"
                          onClick={() => setSelectedId(selectedNode.effectiveParentId!)}
                        >
                          返回上级
                        </button>
                      )}
                      <button
                        type="button"
                        className="button button-secondary button-sm"
                        onClick={() => openCreateUnder(selectedNode.department.id)}
                      >
                        <FolderPlus size={14} />在此新建子部门
                      </button>
                    </div>
                  </div>

                  <div className="admin-table-scroll">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>直属下级部门名称</th>
                          <th>编码</th>
                          <th>直属子级</th>
                          <th>全部下级</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {directChildren.map((child) => (
                          <tr
                            key={child.department.id}
                            className="org-child-row"
                            onClick={() => setSelectedId(child.department.id)}
                          >
                            <td><strong>{child.department.name}</strong></td>
                            <td><span className="mono-cell">{child.department.code}</span></td>
                            <td>{child.childCount}</td>
                            <td>{child.descendantCount}</td>
                            <td>
                              <button
                                type="button"
                                className="text-button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setSelectedId(child.department.id)
                                }}
                              >
                                进入 <ArrowUpRight size={13} />
                              </button>
                            </td>
                          </tr>
                        ))}
                        {directChildren.length === 0 && (
                          <tr>
                            <td colSpan={5} className="empty-inline">
                              当前部门下暂无下级子部门，可点击右上角「在此新建子部门」或从左侧切换其他节点。
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div className="empty-inline">{loading ? '正在加载组织架构…' : '暂无部门数据'}</div>
              )}
            </section>
          </div>
        </>
      )}

      {tab === 'sync' && events !== null && (
        <section className="panel admin-section">
          <div className="panel-header">
            <div>
              <h3>钉钉通讯录同步记录</h3>
              <p className="hint">事件重试与全量同步沿用组织同步接口；同步失败时可点击重试。</p>
            </div>
          </div>
          <div className="admin-table-scroll" style={{ maxHeight: 'calc(100vh - 330px)' }}>
            <table className="admin-table">
              <thead><tr><th>事件 ID</th><th>类型</th><th>状态</th><th>说明</th><th>接收时间</th><th>操作</th></tr></thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <td><small className="mono-cell">{event.id.slice(-10)}</small></td>
                    <td>{dingtalkEventTypeLabel(event.eventType)}</td>
                    <td>
                      <span className={cn('status-chip', event.status === 'FAILED' ? 'status-err' : event.status === 'PROCESSED' ? 'status-on' : 'status-warn')}>
                        {dingtalkEventStatusLabel(event.status)}
                      </span>
                    </td>
                    <td className="admin-note">{event.lastError || (event.subjectId ? `对象 ${event.subjectId}` : '—')}</td>
                    <td>{event.receivedAt ? event.receivedAt.slice(0, 16).replace('T', ' ') : '—'}</td>
                    <td>
                      {event.status === 'FAILED' ? (
                        <button
                          className="text-button"
                          disabled={busy === event.id}
                          onClick={() => void run(event.id, () => api.retryDingTalkEvent(event.id), '事件已重试')}
                        >
                          重试
                        </button>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
                {events.length === 0 && (
                  <tr><td colSpan={6} className="empty-inline">暂无同步事件</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}

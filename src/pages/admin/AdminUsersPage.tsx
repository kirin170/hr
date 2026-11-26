import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, RefreshCw, Search, UserPlus, Users, X } from 'lucide-react'
import * as api from '../../api'
import type { DingTalkSyncEventRow } from '../../api'
import { useApp } from '../../context'
import type { ApiDepartment, AuthzRole, AuthzUserPage } from '../../types'
import { cn } from '../../utils'
import { DepartmentTreePanel } from './DepartmentTreePanel'
import { buildDepartmentTree, dingtalkEventStatusLabel, dingtalkEventTypeLabel, msg } from './shared'

type UsersTab = 'members' | 'sync'

const emptyUserDraft = {
  displayName: '',
  employeeNo: '',
  email: '',
  departmentId: '',
  identityProvider: 'LOCAL' as 'LOCAL' | 'DINGTALK',
  identitySubject: '',
}

export function AdminUsersPage() {
  const { toast } = useApp()
  const [tab, setTab] = useState<UsersTab>('members')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [usersPage, setUsersPage] = useState<AuthzUserPage>({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 })
  const [roles, setRoles] = useState<AuthzRole[]>([])
  const [departments, setDepartments] = useState<ApiDepartment[]>([])
  const [syncEvents, setSyncEvents] = useState<DingTalkSyncEventRow[]>([])
  const [syncPermitted, setSyncPermitted] = useState(true)
  const [syncDeptId, setSyncDeptId] = useState('')
  const [keyword, setKeyword] = useState('')
  const [debouncedKeyword, setDebouncedKeyword] = useState('')
  const [departmentFilter, setDepartmentFilter] = useState('')
  const [includeChildren, setIncludeChildren] = useState(true)
  const [roleFilter, setRoleFilter] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [draft, setDraft] = useState(emptyUserDraft)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedKeyword((prev) => {
        const next = keyword.trim()
        if (prev !== next) setPage(1)
        return next
      })
    }, 250)
    return () => clearTimeout(timer)
  }, [keyword])

  const loadMeta = useCallback(async () => {
    const [roleRows, deptRows] = await Promise.all([
      api.listAuthzRoles().catch(() => [] as AuthzRole[]),
      api.listDepartments().catch(() => [] as ApiDepartment[]),
    ])
    setRoles(roleRows)
    setDepartments(deptRows)
    try {
      setSyncEvents(await api.listDingTalkSyncEvents(30))
      setSyncPermitted(true)
    } catch {
      setSyncEvents([])
      setSyncPermitted(false)
    }
  }, [])

  const loadUsers = useCallback(async () => {
    setLoading(true)
    try {
      const result = await api.listAuthzUsersPage({
        page,
        pageSize,
        q: debouncedKeyword || undefined,
        departmentId: departmentFilter || undefined,
        includeChildren: departmentFilter ? includeChildren : undefined,
        roleCode: roleFilter || undefined,
      })
      setUsersPage(result)
      setError('')
    } catch (err) {
      setError(msg(err))
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, debouncedKeyword, departmentFilter, includeChildren, roleFilter])

  const refreshAll = useCallback(async () => {
    await Promise.all([loadMeta(), loadUsers()])
  }, [loadMeta, loadUsers])

  useEffect(() => {
    void loadMeta()
  }, [loadMeta])

  useEffect(() => {
    void loadUsers()
  }, [loadUsers])

  const run = async (key: string, action: () => Promise<unknown>, success: string): Promise<boolean> => {
    setBusy(key)
    setError('')
    try {
      await action()
      await refreshAll()
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

  const deptTree = useMemo(() => buildDepartmentTree(departments), [departments])
  const departmentName = useMemo(() => {
    const map = new Map(departments.map((item) => [item.id, item.name]))
    return (id: string | null) => (id ? map.get(id) ?? '未知部门' : '未分配部门')
  }, [departments])

  const submitCreate = () => {
    const payload = {
      displayName: draft.displayName.trim(),
      employeeNo: draft.employeeNo.trim() || undefined,
      email: draft.email.trim() || undefined,
      departmentId: draft.departmentId || undefined,
      identityProvider: draft.identityProvider,
      identitySubject: draft.identitySubject.trim(),
    }
    void run('user-create', () => api.createAuthzUser(payload), '成员已创建').then((ok) => {
      if (ok) {
        setDraft(emptyUserDraft)
        setShowCreate(false)
      }
    })
  }

  const triggerDingTalkSync = () => {
    const trimmed = syncDeptId.trim()
    const deptNum = trimmed ? Number(trimmed) : undefined
    if (trimmed && (!Number.isInteger(deptNum) || (deptNum ?? 0) < 1)) {
      toast('钉钉部门 ID 必须为正整数', 'info')
      return
    }
    void run(
      'dingtalk-sync',
      () => api.triggerDingTalkSync(deptNum),
      deptNum ? `已触发钉钉部门 ${deptNum} 人员与组织同步` : '钉钉全量人员与组织同步已入队',
    )
  }

  return (
    <div className="page-stack">
      <div className="page-title-row">
        <div>
          <div className="eyebrow">系统管理 <span className="eyebrow-separator">·</span> 人员台账、钉钉同步与角色授予</div>
          <h2>成员管理</h2>
          <p>支持按左侧组织树定位部门成员，表内滚动浏览，翻页器与操作区始终固定在可视区内。</p>
        </div>
        <div className="page-title-actions">
          <button className="button button-secondary" onClick={() => void refreshAll()} disabled={loading}>
            <RefreshCw size={15} />刷新
          </button>
          {syncPermitted && (
            <button
              className="button button-secondary"
              disabled={busy === 'dingtalk-sync'}
              onClick={triggerDingTalkSync}
            >
              <RefreshCw size={15} />{busy === 'dingtalk-sync' ? '同步中…' : '同步钉钉人员'}
            </button>
          )}
          <button className="button button-primary" onClick={() => { setTab('members'); setShowCreate((v) => !v) }}>
            <UserPlus size={15} />{showCreate ? '收起新建' : '新建成员'}
          </button>
        </div>
      </div>

      <div className="stage-tabs">
        <button className={cn('stage-tab', tab === 'members' && 'active')} onClick={() => setTab('members')}>
          <Users size={14} />成员清单 <span>{usersPage.total}</span>
        </button>
        {syncPermitted && (
          <button className={cn('stage-tab', tab === 'sync' && 'active')} onClick={() => setTab('sync')}>
            <RefreshCw size={14} />钉钉人员同步记录 <span>{syncEvents.length}</span>
          </button>
        )}
      </div>

      {error && <div className="admin-error" role="alert">{error}</div>}

      {tab === 'members' && (
        <>
          {showCreate && (
            <section className="panel admin-section">
              <div className="panel-header">
                <div>
                  <h3>新建成员</h3>
                  <p className="hint">本地预览环境可选 LOCAL 并填写登录标识；企业钉钉账号请选择 DINGTALK 并填写钉钉 unionId。</p>
                </div>
              </div>
              <div className="intake-form-grid" style={{ paddingLeft: 0, paddingRight: 0, paddingBottom: 0 }}>
                <label className="form-field">
                  <span>姓名<em>*</em></span>
                  <input value={draft.displayName} onChange={(e) => setDraft({ ...draft, displayName: e.target.value })} placeholder="成员姓名" />
                </label>
                <label className="form-field">
                  <span>身份来源<em>*</em></span>
                  <select value={draft.identityProvider} onChange={(e) => setDraft({ ...draft, identityProvider: e.target.value as 'LOCAL' | 'DINGTALK' })}>
                    <option value="LOCAL">LOCAL（本地账号）</option>
                    <option value="DINGTALK">DINGTALK（钉钉账号）</option>
                  </select>
                </label>
                <label className="form-field">
                  <span>身份标识<em>*</em></span>
                  <input value={draft.identitySubject} onChange={(e) => setDraft({ ...draft, identitySubject: e.target.value })} placeholder="账号或钉钉 unionId" />
                </label>
                <label className="form-field">
                  <span>所属部门</span>
                  <select value={draft.departmentId} onChange={(e) => setDraft({ ...draft, departmentId: e.target.value })}>
                    <option value="">未分配部门</option>
                    {deptTree.map(({ department, depth }) => (
                      <option key={department.id} value={department.id}>
                        {'　'.repeat(depth)}{department.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  <span>工号</span>
                  <input value={draft.employeeNo} onChange={(e) => setDraft({ ...draft, employeeNo: e.target.value })} placeholder="选填" />
                </label>
                <label className="form-field">
                  <span>邮箱</span>
                  <input value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} placeholder="name@example.com" />
                </label>
                <div className="intake-form-actions">
                  <button
                    className="button button-primary"
                    disabled={!draft.displayName.trim() || !draft.identitySubject.trim() || busy === 'user-create'}
                    onClick={submitCreate}
                  >
                    {busy === 'user-create' ? '创建中…' : '确认创建'}
                  </button>
                </div>
              </div>
            </section>
          )}

          <div className="admin-split-layout users-split-layout">
            <DepartmentTreePanel
              departments={departments}
              treeNodes={deptTree}
              selectedId={departmentFilter}
              onSelect={(id) => {
                setDepartmentFilter(id)
                setPage(1)
              }}
              topOption={{ id: '', label: '全部部门成员' }}
              title="按部门筛选"
            />

            <section className="panel users-table-pane">
              <div className="candidate-toolbar">
                <label className="table-search">
                  <Search size={15} />
                  <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="搜索姓名、工号或邮箱" />
                  {keyword && (
                    <button
                      type="button"
                      onClick={() => { setKeyword(''); setDebouncedKeyword(''); setPage(1) }}
                      aria-label="清空"
                    >
                      <X size={13} />
                    </button>
                  )}
                </label>
                <label className="filter-select">
                  <span>角色</span>
                  <select value={roleFilter} onChange={(e) => { setRoleFilter(e.target.value); setPage(1) }}>
                    <option value="">全部角色</option>
                    {roles.map((role) => <option key={role.code} value={role.code}>{role.name}</option>)}
                  </select>
                  <ChevronDown size={13} />
                </label>
                {departmentFilter && (
                  <>
                    <span className="active-filter-chip">
                      部门：{departmentName(departmentFilter)}
                      <button
                        type="button"
                        onClick={() => { setDepartmentFilter(''); setPage(1) }}
                        aria-label="清除部门筛选"
                      >
                        <X size={12} />
                      </button>
                    </span>
                    <label className="admin-check">
                      <input
                        type="checkbox"
                        checked={includeChildren}
                        onChange={(e) => { setIncludeChildren(e.target.checked); setPage(1) }}
                      />
                      含下级部门
                    </label>
                  </>
                )}
              </div>

              <div className="admin-table-scroll">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>成员</th>
                      <th>工号</th>
                      <th>所属部门</th>
                      <th>状态</th>
                      <th>当前角色（点击 × 移除）</th>
                      <th>授予角色</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usersPage.items.map((user) => {
                      const current = user.roleAssignments.map((item) => item.role.code)
                      return (
                        <tr key={user.id}>
                          <td>
                            <strong>{user.displayName}</strong>
                            <small>{user.email || '—'}</small>
                          </td>
                          <td>{user.employeeNo || '—'}</td>
                          <td>{departmentName(user.departmentId)}</td>
                          <td>
                            <span className={cn('status-chip', user.status === 'ACTIVE' ? 'status-on' : 'status-off')}>
                              {user.status === 'ACTIVE' ? '在职' : user.status}
                            </span>
                          </td>
                          <td className="admin-note">
                            {user.roleAssignments.length > 0 ? (
                              user.roleAssignments.map((item) => (
                                <button
                                  key={item.role.code}
                                  type="button"
                                  className="text-button"
                                  style={{ marginRight: 8 }}
                                  disabled={busy === user.id}
                                  title={`移除角色 ${item.role.name}`}
                                  onClick={() => {
                                    const next = current
                                      .filter((code) => code !== item.role.code)
                                      .map((code) => ({ roleCode: code }))
                                    void run(user.id, () => api.assignUserRoles(user.id, next), `${user.displayName} 角色已更新`)
                                  }}
                                >
                                  {item.role.name} ×
                                </button>
                              ))
                            ) : (
                              <span className="hint">未分配</span>
                            )}
                          </td>
                          <td>
                            <select
                              className="admin-select"
                              value=""
                              disabled={busy === user.id || roles.length === 0}
                              onChange={(event) => {
                                const roleCode = event.target.value
                                if (!roleCode) return
                                const next = [...new Set([...current, roleCode])].map((code) => ({ roleCode: code }))
                                void run(user.id, () => api.assignUserRoles(user.id, next), `${user.displayName} 角色已更新`)
                              }}
                            >
                              <option value="">添加角色…</option>
                              {roles.filter((role) => !current.includes(role.code)).map((role) => (
                                <option key={role.code} value={role.code}>{role.name}</option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      )
                    })}
                    {!loading && usersPage.items.length === 0 && (
                      <tr><td colSpan={6} className="empty-inline">没有匹配的成员</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="table-footer">
                <span>共 {usersPage.total} 位成员</span>
                <div className="pagination-controls">
                  <label className="page-size-select">
                    <span>每页</span>
                    <select
                      value={pageSize}
                      onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1) }}
                    >
                      <option value={20}>20 条</option>
                      <option value={50}>50 条</option>
                      <option value={100}>100 条</option>
                    </select>
                  </label>
                  <div className="pagination">
                    <button
                      type="button"
                      disabled={page <= 1 || loading}
                      onClick={() => setPage(1)}
                      title="首页"
                    >
                      首页
                    </button>
                    <button
                      type="button"
                      disabled={page <= 1 || loading}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      aria-label="上一页"
                    >
                      <ChevronLeft size={15} />
                    </button>
                    <span className="cell-sub">第 {usersPage.page} / {usersPage.totalPages} 页</span>
                    <button
                      type="button"
                      disabled={page >= usersPage.totalPages || loading}
                      onClick={() => setPage((p) => Math.min(usersPage.totalPages, p + 1))}
                      aria-label="下一页"
                    >
                      <ChevronRight size={15} />
                    </button>
                    <button
                      type="button"
                      disabled={page >= usersPage.totalPages || loading}
                      onClick={() => setPage(usersPage.totalPages)}
                      title="末页"
                    >
                      末页
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </>
      )}

      {tab === 'sync' && syncPermitted && (
        <section className="panel admin-section">
          <div className="panel-header">
            <div>
              <h3>钉钉人员与组织同步</h3>
              <p className="hint">按服务端配置的根部门全量拉取钉钉部门与在职成员，并接收员工入职/异动/离职回调事件。</p>
            </div>
          </div>

          <div className="admin-inline-form" style={{ marginTop: 0, paddingTop: 0, borderTop: 0, paddingBottom: 14, borderBottom: '1px solid var(--line)' }}>
            <input
              className="admin-input"
              inputMode="numeric"
              placeholder="指定钉钉部门 ID（留空则按系统配置全量同步）"
              value={syncDeptId}
              onChange={(e) => setSyncDeptId(e.target.value.replace(/\D/g, ''))}
            />
            <button
              className="button button-primary button-sm"
              disabled={busy === 'dingtalk-sync'}
              onClick={triggerDingTalkSync}
            >
              <RefreshCw size={14} />{busy === 'dingtalk-sync' ? '正在入队…' : '立即触发同步'}
            </button>
          </div>

          <div className="admin-table-scroll" style={{ maxHeight: 'calc(100vh - 380px)', marginTop: 8 }}>
            <table className="admin-table">
              <thead>
                <tr><th>记录</th><th>同步类型</th><th>状态</th><th>尝试次数</th><th>说明</th><th>接收时间</th><th>操作</th></tr>
              </thead>
              <tbody>
                {syncEvents.map((event) => (
                  <tr key={event.id}>
                    <td><small className="mono-cell">{event.id.slice(-10)}</small></td>
                    <td>{dingtalkEventTypeLabel(event.eventType)}</td>
                    <td>
                      <span className={cn('status-chip', event.status === 'FAILED' ? 'status-err' : event.status === 'PROCESSED' ? 'status-on' : 'status-warn')}>
                        {dingtalkEventStatusLabel(event.status)}
                      </span>
                    </td>
                    <td>{event.attempts}</td>
                    <td className="admin-note">{event.lastError || (event.subjectId ? `对象 ${event.subjectId}` : '—')}</td>
                    <td>{event.receivedAt ? event.receivedAt.slice(0, 16).replace('T', ' ') : '—'}</td>
                    <td>
                      {event.status === 'FAILED' ? (
                        <button
                          className="text-button"
                          disabled={busy === event.id}
                          onClick={() => void run(event.id, () => api.retryDingTalkEvent(event.id), '同步事件已重新入队')}
                        >
                          重试
                        </button>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
                {syncEvents.length === 0 && (
                  <tr><td colSpan={7} className="empty-inline">暂无钉钉同步记录</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}

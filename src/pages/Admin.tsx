import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, Download, Lock, RefreshCw, Save, ShieldCheck, Trash2, UserCog } from 'lucide-react'
import * as api from '../api'
import type {
  AdminOverview,
  AuditLogRow,
  AuthzGroup,
  AuthzRole,
  AuthzUser,
  DictItemView,
  FieldGrantRow,
  InterviewPlanView,
  MyNotificationPreferences,
  NotificationEventInfo,
  OperationsSnapshot,
  ReasonOptionView,
} from '../types'
import { useApp } from '../context'
import { invalidateEffectiveSettings } from '../useEffectiveSettings'
import { cn } from '../utils'

type TabKey = 'basic' | 'reasons' | 'notifications' | 'access' | 'integrations' | 'operations' | 'audit' | 'rules'

const TABS: { key: TabKey; label: string; hint: string }[] = [
  { key: 'basic', label: '招聘基础配置', hint: '字段、字典与面试方案' },
  { key: 'reasons', label: '原因选项', hint: '归档 / Offer 拒绝 / 放弃入职' },
  { key: 'notifications', label: '通知与提醒', hint: '事件清单与送达方式' },
  { key: 'access', label: '组织与权限', hint: '角色、权限组、部门、字段授权' },
  { key: 'integrations', label: '接入配置', hint: '邮箱、钉钉、导入令牌、保留策略' },
  { key: 'operations', label: '运行监控', hint: '服务状态与失败任务' },
  { key: 'audit', label: '操作审计', hint: '按对象、动作与时间检索' },
  { key: 'rules', label: '固定规则', hint: '不可配置的业务约束' },
]

const REASON_TYPES = ['ARCHIVE', 'OFFER_REJECT', 'ONBOARD_ABANDON'] as const

function msg(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败'
}

/**
 * 管理后台（ATS-024 / PRD §9.2 FR-ADM-1～5、9、10）。
 *
 * 本页只做「配置维护 + 状态汇总 + 审计检索」：邮箱、钉钉、导入令牌、保留清理等动作
 * 全部复用各领域既有接口，权限也按领域权限校验，管理权限不隐含业务数据访问权。
 */
export function Admin() {
  const { toast } = useApp()
  const [tab, setTab] = useState<TabKey>('basic')
  const [overview, setOverview] = useState<AdminOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    try {
      setOverview(await api.getAdminOverview())
      setError('')
    } catch (err) {
      setError(msg(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const run = useCallback(async (key: string, action: () => Promise<unknown>, success: string): Promise<boolean> => {
    setBusy(key)
    setError('')
    try {
      await action()
      // 配置变化后让候选人/职位表单重新拉取有效配置
      invalidateEffectiveSettings()
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
  }, [load, toast])

  return (
    <div className="admin-page">
      <nav className="admin-tabs" aria-label="管理后台分区">
        {TABS.map((item) => (
          <button
            key={item.key}
            className={cn('admin-tab', tab === item.key && 'admin-tab-active')}
            onClick={() => setTab(item.key)}
          >
            <strong>{item.label}</strong>
            <small>{item.hint}</small>
          </button>
        ))}
      </nav>
      <div className="admin-body">
        {error && <div className="admin-error" role="alert"><AlertTriangle size={15} />{error}</div>}
        {loading && !overview && <div className="panel empty-state">正在加载配置…</div>}
        {overview && tab === 'basic' && <BasicTab overview={overview} busy={busy} run={run} />}
        {overview && tab === 'reasons' && <ReasonsTab overview={overview} busy={busy} run={run} />}
        {overview && tab === 'rules' && <RulesTab overview={overview} />}
        {tab === 'notifications' && <NotificationsTab />}
        {tab === 'access' && <AccessTab />}
        {tab === 'integrations' && <IntegrationsTab />}
        {tab === 'operations' && <OperationsTab />}
        {tab === 'audit' && <AuditTab />}
      </div>
    </div>
  )
}

type RunFn = (key: string, action: () => Promise<unknown>, success: string) => Promise<boolean>

// ---------- 招聘基础配置 ----------

function BasicTab({ overview, busy, run }: { overview: AdminOverview; busy: string; run: RunFn }) {
  return (
    <>
      <section className="panel admin-section">
        <div className="panel-header">
          <div>
            <h3>字段配置</h3>
            <p className="hint">固定必填与固定显示的字段不可取消；配置为必填的字段由服务端在保存时校验。</p>
          </div>
        </div>
        {overview.fields.map((group) => (
          <div className="admin-subsection" key={group.entity}>
            <h4>{group.label}</h4>
            <table className="admin-table">
              <thead>
                <tr><th>字段</th><th>作用</th><th>必填</th><th>显示</th><th>说明</th></tr>
              </thead>
              <tbody>
                {group.items.map((field) => (
                  <tr key={field.id}>
                    <td><strong>{field.label}</strong><small>{field.key}</small></td>
                    <td><span className={cn('status-chip', field.effect === 'server' ? 'status-warn' : 'status-off')}>{field.effect === 'server' ? '服务端强制' : '表单'}</span></td>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`${field.label}必填`}
                        checked={field.required}
                        disabled={!field.requiredConfigurable || busy === field.id}
                        onChange={(event) => { void run(field.id, () => api.updateFieldConfig(field.id, { version: field.version, required: event.target.checked }), `${field.label}必填规则已更新`) }}
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`${field.label}显示`}
                        checked={field.visible}
                        disabled={!field.visibleConfigurable || busy === field.id}
                        onChange={(event) => { void run(field.id, () => api.updateFieldConfig(field.id, { version: field.version, visible: event.target.checked }), `${field.label}显示规则已更新`) }}
                      />
                    </td>
                    <td className="admin-note">{field.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </section>
      <DictSection overview={overview} busy={busy} run={run} />
      <PlanSection overview={overview} busy={busy} run={run} />
    </>
  )
}

function DictSection({ overview, busy, run }: { overview: AdminOverview; busy: string; run: RunFn }) {
  const [type, setType] = useState(overview.dicts.types[0]?.type || 'CHANNEL')
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<{ id: string; label: string } | null>(null)
  const items = overview.dicts.items.filter((item) => item.type === type)
  const typeLabel = overview.dicts.types.find((item) => item.type === type)?.label || type

  const move = (item: DictItemView, offset: number) => {
    const ids = items.map((row) => row.id)
    const index = ids.indexOf(item.id)
    const target = index + offset
    if (target < 0 || target >= ids.length) return
    const next = [...ids]
    ;[next[index], next[target]] = [next[target], next[index]]
    void run(`dict-order-${type}`, () => api.reorderDictItems(type, next), '字典顺序已更新')
  }

  return (
    <section className="panel admin-section">
      <div className="panel-header">
        <div>
          <h3>字典</h3>
          <p className="hint">已被业务引用的选项不能改名（会拆分历史统计），只能停用；停用不影响历史记录展示。</p>
        </div>
        <select className="admin-select" value={type} onChange={(event) => setType(event.target.value)}>
          {overview.dicts.types.map((item) => <option key={item.type} value={item.type}>{item.label}</option>)}
        </select>
      </div>
      <table className="admin-table">
        <thead><tr><th>选项</th><th>引用</th><th>状态</th><th>顺序</th><th>操作</th></tr></thead>
        <tbody>
          {items.map((item, index) => (
            <tr key={item.id}>
              <td>
                {editing?.id === item.id
                  ? <input className="admin-input" value={editing.label} onChange={(event) => setEditing({ id: item.id, label: event.target.value })} />
                  : <strong>{item.label}</strong>}
              </td>
              <td>{item.usageCount}</td>
              <td><span className={cn('status-chip', item.active ? 'status-on' : 'status-off')}>{item.active ? '启用' : '停用'}</span></td>
              <td>
                <button className="icon-button icon-button-small" disabled={index === 0} title="上移" onClick={() => move(item, -1)}><ArrowUp size={13} /></button>
                <button className="icon-button icon-button-small" disabled={index === items.length - 1} title="下移" onClick={() => move(item, 1)}><ArrowDown size={13} /></button>
              </td>
              <td>
                {editing?.id === item.id ? (
                  <>
                    <button className="text-button" disabled={busy === item.id || !editing.label.trim()} onClick={() => {
                      const label = editing.label.trim()
                      void run(item.id, () => api.updateDictItem(item.id, { version: item.version, label }), '选项已改名')
                        .then((ok) => { if (ok) setEditing(null) })
                    }}><Save size={13} />保存</button>
                    <button className="text-button" onClick={() => setEditing(null)}>取消</button>
                  </>
                ) : (
                  <>
                    <button className="text-button" onClick={() => setEditing({ id: item.id, label: item.label })}>改名</button>
                    <button className="text-button" disabled={busy === item.id} onClick={() => { void run(item.id, () => api.updateDictItem(item.id, { version: item.version, active: !item.active }), item.active ? '选项已停用' : '选项已启用') }}>
                      {item.active ? '停用' : '启用'}
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
          {items.length === 0 && <tr><td colSpan={5} className="empty-inline">该字典暂无选项</td></tr>}
        </tbody>
      </table>
      <div className="admin-inline-form">
        <input className="admin-input" value={draft} placeholder={`新增${typeLabel}选项`} onChange={(event) => setDraft(event.target.value)} />
        <button className="button button-primary button-sm" disabled={!draft.trim() || busy === `dict-create-${type}`} onClick={() => {
          const label = draft.trim()
          void run(`dict-create-${type}`, () => api.createDictItem({ type, label }), '选项已新增')
            .then((ok) => { if (ok) setDraft('') })
        }}>新增</button>
      </div>
    </section>
  )
}

function PlanSection({ overview, busy, run }: { overview: AdminOverview; busy: string; run: RunFn }) {
  const [draft, setDraft] = useState({ name: '', rounds: '2', description: '' })
  const [rounds, setRounds] = useState<Record<string, string>>({})
  const plans = overview.interviewPlans

  return (
    <section className="panel admin-section">
      <div className="panel-header">
        <div>
          <h3>面试方案</h3>
          <p className="hint">职位引用的方案必须存在且启用；停用后已有职位保留原引用，但新职位不能再选用。</p>
        </div>
      </div>
      <table className="admin-table">
        <thead><tr><th>方案</th><th>轮次</th><th>引用职位</th><th>状态</th><th>说明</th></tr></thead>
        <tbody>
          {plans.map((plan: InterviewPlanView) => (
            <tr key={plan.id}>
              <td><strong>{plan.name}</strong></td>
              <td>
                <input
                  className="admin-input admin-input-sm"
                  value={rounds[plan.id] ?? String(plan.rounds)}
                  onChange={(event) => setRounds({ ...rounds, [plan.id]: event.target.value })}
                />
                <button className="text-button" disabled={busy === plan.id} onClick={() => {
                  const next = Number(rounds[plan.id] ?? plan.rounds)
                  void run(plan.id, () => api.updateInterviewPlan(plan.id, { version: plan.version, rounds: next }), '面试轮次已更新')
                }}>保存</button>
              </td>
              <td>{plan.usageCount}</td>
              <td>
                <button className="text-button" disabled={busy === plan.id} onClick={() => { void run(plan.id, () => api.updateInterviewPlan(plan.id, { version: plan.version, active: !plan.active }), plan.active ? '方案已停用' : '方案已启用') }}>
                  <span className={cn('status-chip', plan.active ? 'status-on' : 'status-off')}>{plan.active ? '启用' : '停用'}</span>
                </button>
              </td>
              <td className="admin-note">{plan.description || '—'}</td>
            </tr>
          ))}
          {plans.length === 0 && <tr><td colSpan={5} className="empty-inline">暂无面试方案</td></tr>}
        </tbody>
      </table>
      <div className="admin-inline-form">
        <input className="admin-input" placeholder="方案名称" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        <input className="admin-input admin-input-sm" placeholder="轮次" value={draft.rounds} onChange={(event) => setDraft({ ...draft, rounds: event.target.value })} />
        <input className="admin-input" placeholder="说明（可选）" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
        <button className="button button-primary button-sm" disabled={!draft.name.trim() || busy === 'plan-create'} onClick={() => {
          const payload = { name: draft.name.trim(), rounds: Number(draft.rounds), description: draft.description.trim() || undefined }
          void run('plan-create', () => api.createInterviewPlan(payload), '面试方案已新增')
            .then((ok) => { if (ok) setDraft({ name: '', rounds: '2', description: '' }) })
        }}>新增方案</button>
      </div>
    </section>
  )
}

// ---------- 原因选项 ----------

function ReasonsTab({ overview, busy, run }: { overview: AdminOverview; busy: string; run: RunFn }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  return (
    <>
      {REASON_TYPES.map((type) => {
        const items = overview.reasons.items.filter((item) => item.type === type)
        const stats = overview.reasons.stats[type]
        const move = (item: ReasonOptionView, offset: number) => {
          const ids = items.map((row) => row.id)
          const index = ids.indexOf(item.id)
          const target = index + offset
          if (target < 0 || target >= ids.length) return
          const next = [...ids]
          ;[next[index], next[target]] = [next[target], next[index]]
          void run(`reason-order-${type}`, () => api.reorderReasonOptions(type, next), '原因顺序已更新')
        }
        return (
          <section className="panel admin-section" key={type}>
            <div className="panel-header">
              <div>
                <h3>{items[0]?.setTypeLabel || type}</h3>
                <p className="hint">已引用 {stats?.used ?? 0} 次；每个集合保留唯一的「其他」，选中后必须填写说明。</p>
              </div>
            </div>
            <table className="admin-table">
              <thead><tr><th>原因</th><th>引用</th><th>状态</th><th>顺序</th><th>操作</th></tr></thead>
              <tbody>
                {items.map((item, index) => (
                  <tr key={item.id}>
                    <td><strong>{item.label}</strong>{item.isOther && <span className="pill-tag">固定</span>}</td>
                    <td>{item.usageCount}</td>
                    <td><span className={cn('status-chip', item.active ? 'status-on' : 'status-off')}>{item.active ? '启用' : '停用'}</span></td>
                    <td>
                      <button className="icon-button icon-button-small" disabled={index === 0} title="上移" onClick={() => move(item, -1)}><ArrowUp size={13} /></button>
                      <button className="icon-button icon-button-small" disabled={index === items.length - 1} title="下移" onClick={() => move(item, 1)}><ArrowDown size={13} /></button>
                    </td>
                    <td>
                      <button
                        className="text-button"
                        disabled={busy === item.id || item.isOther}
                        title={item.isOther ? '「其他」为固定选项' : undefined}
                        onClick={() => { void run(item.id, () => api.updateReasonOption(item.id, { version: item.version, active: !item.active }), item.active ? '原因已停用' : '原因已启用') }}
                      >{item.active ? '停用' : '启用'}</button>
                    </td>
                  </tr>
                ))}
                {items.length === 0 && <tr><td colSpan={5} className="empty-inline">该集合暂无原因</td></tr>}
              </tbody>
            </table>
            <div className="admin-inline-form">
              <input className="admin-input" placeholder="新增原因（如：薪资未谈拢）" value={drafts[type] || ''} onChange={(event) => setDrafts({ ...drafts, [type]: event.target.value })} />
              <button className="button button-primary button-sm" disabled={!(drafts[type] || '').trim() || busy === `reason-create-${type}`} onClick={() => {
                const label = (drafts[type] || '').trim()
                void run(`reason-create-${type}`, () => api.createReasonOption({ type, label }), '原因已新增')
                  .then((ok) => { if (ok) setDrafts((prev) => ({ ...prev, [type]: '' })) })
              }}>新增</button>
            </div>
          </section>
        )
      })}
      <p className="hint">{overview.reasons.unfilledNote}</p>
    </>
  )
}

// ---------- 固定规则 ----------

function RulesTab({ overview }: { overview: AdminOverview }) {
  return (
    <section className="panel admin-section">
      <div className="panel-header">
        <div>
          <h3>固定规则</h3>
          <p className="hint">以下约束由服务端强制，管理后台不提供关闭入口，避免配置绕过业务规则。</p>
        </div>
        <Lock size={16} />
      </div>
      <ul className="admin-rules">
        {overview.rules.map((rule) => (
          <li key={rule.key}>
            <strong>{rule.title}</strong>
            <span>{rule.value.join(' · ')}</span>
            <span>{rule.note}</span>
            <code>{rule.code}</code>
          </li>
        ))}
      </ul>
    </section>
  )
}

// ---------- 通知与提醒 ----------

function NotificationsTab() {
  const [data, setData] = useState<{ channel: string; integrated: boolean; note: string; events: NotificationEventInfo[] } | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    void api.getNotificationSettings()
      .then((value) => { if (active) setData(value) })
      .catch((err: unknown) => { if (active) setError(msg(err)) })
    return () => { active = false }
  }, [])
  if (error) return <div className="panel empty-state">{error}</div>
  if (!data) return <div className="panel empty-state">正在加载通知配置…</div>
  return (
    <section className="panel admin-section">
      <div className="panel-header">
        <div>
          <h3>通知事件</h3>
          <p className="hint">{data.note}</p>
        </div>
        <span className={cn('status-chip', data.integrated ? 'status-on' : 'status-warn')}>{data.integrated ? '已接入' : `通道 ${data.channel}`}</span>
      </div>
      <table className="admin-table">
        <thead><tr><th>事件</th><th>标识</th><th>优先级</th><th>说明</th></tr></thead>
        <tbody>
          {data.events.map((event) => (
            <tr key={event.key}>
              <td><strong>{event.label}</strong></td>
              <td><small>{event.key}</small></td>
              <td>{event.lowPriority ? <span className="status-chip status-off">可自行关闭</span> : <span className="status-chip status-on">必达</span>}</td>
              <td className="admin-note">{event.description || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">个人可在右上角用户菜单「通知偏好」里关闭可自行关闭的事件；接收角色由业务规则确定，不在此维护。</p>
    </section>
  )
}

// ---------- 组织与权限 ----------

function AccessTab() {
  const { toast } = useApp()
  const [roles, setRoles] = useState<AuthzRole[]>([])
  const [groups, setGroups] = useState<AuthzGroup[]>([])
  const [users, setUsers] = useState<AuthzUser[]>([])
  const [departments, setDepartments] = useState<{ id: string; name: string; code: string }[]>([])
  const [grants, setGrants] = useState<FieldGrantRow[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [groupDraft, setGroupDraft] = useState({ code: '', name: '' })
  const [departmentDraft, setDepartmentDraft] = useState({ code: '', name: '', parentId: '' })
  const [grantDraft, setGrantDraft] = useState({
    field: 'CANDIDATE_CONTACT',
    targetType: 'USER' as 'USER' | 'GROUP',
    targetId: '',
    canRead: true,
    canWrite: false,
    expiresAt: '',
  })

  const load = useCallback(async () => {
    const [roleRows, groupRows, userRows, departmentRows, grantRows] = await Promise.all([
      api.listAuthzRoles().catch(() => [] as AuthzRole[]),
      api.listAuthzGroups().catch(() => [] as AuthzGroup[]),
      api.listAuthzUsers().catch(() => [] as AuthzUser[]),
      api.listDepartments().catch(() => [] as { id: string; name: string; code: string }[]),
      api.listFieldGrants().catch(() => [] as FieldGrantRow[]),
    ])
    setRoles(roleRows)
    setGroups(groupRows)
    setUsers(userRows)
    setDepartments(departmentRows)
    setGrants(grantRows)
  }, [])

  useEffect(() => {
    let active = true
    void load().catch((err: unknown) => { if (active) setError(msg(err)) })
    return () => { active = false }
  }, [load])

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

  const departmentName = (id: string | null) => departments.find((item) => item.id === id)?.name || '未分配部门'

  return (
    <>
      <section className="panel admin-section">
        <div className="panel-header">
          <div>
            <h3>角色与数据范围</h3>
            <p className="hint">角色、数据范围与权限码由授权模块维护，这里只做展示与核对。</p>
          </div>
        </div>
        <table className="admin-table">
          <thead><tr><th>角色</th><th>编码</th><th>数据范围</th><th>权限</th></tr></thead>
          <tbody>
            {roles.map((role) => (
              <tr key={role.code}>
                <td><strong>{role.name}</strong></td>
                <td><small>{role.code}</small></td>
                <td>{scopeLabel(role.dataScope)}</td>
                <td className="admin-note">{role.permissions.slice(0, 6).map((item) => item.permission.code).join('、')}{role.permissions.length > 6 ? ` 等 ${role.permissions.length} 项` : ''}</td>
              </tr>
            ))}
            {roles.length === 0 && <tr><td colSpan={4} className="empty-inline">无权限查看角色清单</td></tr>}
          </tbody>
        </table>
      </section>

      <section className="panel admin-section">
        <div className="panel-header">
          <div>
            <h3>权限组</h3>
            <p className="hint">权限组用于批量授予字段授权，成员由授权模块维护。</p>
          </div>
        </div>
        <table className="admin-table">
          <thead><tr><th>名称</th><th>编码</th><th>成员</th></tr></thead>
          <tbody>
            {groups.map((group) => (
              <tr key={group.id}>
                <td><strong>{group.name}</strong></td>
                <td><small>{group.code}</small></td>
                <td>{group._count?.members ?? 0}</td>
              </tr>
            ))}
            {groups.length === 0 && <tr><td colSpan={3} className="empty-inline">暂无权限组</td></tr>}
          </tbody>
        </table>
        <div className="admin-inline-form">
          <input className="admin-input admin-input-sm" placeholder="编码" value={groupDraft.code} onChange={(event) => setGroupDraft({ ...groupDraft, code: event.target.value })} />
          <input className="admin-input" placeholder="名称" value={groupDraft.name} onChange={(event) => setGroupDraft({ ...groupDraft, name: event.target.value })} />
          <button className="button button-primary button-sm" disabled={!groupDraft.code.trim() || !groupDraft.name.trim() || busy === 'group-create'} onClick={() => {
            const payload = { code: groupDraft.code.trim(), name: groupDraft.name.trim() }
            void run('group-create', () => api.createAuthzGroup(payload), '权限组已创建')
              .then((ok) => { if (ok) setGroupDraft({ code: '', name: '' }) })
          }}>新建权限组</button>
        </div>
      </section>

      <section className="panel admin-section">
        <div className="panel-header">
          <div>
            <h3>部门</h3>
            <p className="hint">部门决定职位归属与数据范围；新建后可在授权模块继续维护层级。</p>
          </div>
        </div>
        <table className="admin-table">
          <thead><tr><th>部门</th><th>编码</th></tr></thead>
          <tbody>
            {departments.map((item) => (
              <tr key={item.id}><td><strong>{item.name}</strong></td><td><small>{item.code}</small></td></tr>
            ))}
            {departments.length === 0 && <tr><td colSpan={2} className="empty-inline">无权限查看部门清单</td></tr>}
          </tbody>
        </table>
        <div className="admin-inline-form">
          <input className="admin-input admin-input-sm" placeholder="编码" value={departmentDraft.code} onChange={(event) => setDepartmentDraft({ ...departmentDraft, code: event.target.value })} />
          <input className="admin-input" placeholder="名称" value={departmentDraft.name} onChange={(event) => setDepartmentDraft({ ...departmentDraft, name: event.target.value })} />
          <select className="admin-select" value={departmentDraft.parentId} onChange={(event) => setDepartmentDraft({ ...departmentDraft, parentId: event.target.value })}>
            <option value="">顶级部门</option>
            {departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <button className="button button-primary button-sm" disabled={!departmentDraft.code.trim() || !departmentDraft.name.trim() || busy === 'department-create'} onClick={() => {
            const payload = { code: departmentDraft.code.trim(), name: departmentDraft.name.trim(), parentId: departmentDraft.parentId || undefined }
            void run('department-create', () => api.createAuthzDepartment(payload), '部门已创建')
              .then((ok) => { if (ok) setDepartmentDraft({ code: '', name: '', parentId: '' }) })
          }}>新建部门</button>
        </div>
      </section>

      <section className="panel admin-section">
        <div className="panel-header">
          <div>
            <h3>用户与角色</h3>
            <p className="hint">调整角色会以最终集合覆盖该用户的角色授予，请按实际岗位维护。</p>
          </div>
          <UserCog size={16} />
        </div>
        <table className="admin-table">
          <thead><tr><th>用户</th><th>工号</th><th>部门</th><th>角色</th><th>调整</th></tr></thead>
          <tbody>
            {users.map((user) => {
              const current = user.roleAssignments.map((item) => item.role.code)
              return (
                <tr key={user.id}>
                  <td><strong>{user.displayName}</strong><small>{user.email || '—'}</small></td>
                  <td>{user.employeeNo || '—'}</td>
                  <td>{departmentName(user.departmentId)}</td>
                  <td className="admin-note">
                    {user.roleAssignments.length > 0
                      ? user.roleAssignments.map((item) => (
                          <button
                            key={item.role.code}
                            type="button"
                            className="text-button"
                            style={{ marginRight: 6 }}
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
                      : '未分配'}
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
                      {roles.filter((role) => !current.includes(role.code)).map((role) => <option key={role.code} value={role.code}>{role.name}</option>)}
                    </select>
                  </td>
                </tr>
              )
            })}
            {users.length === 0 && <tr><td colSpan={5} className="empty-inline">无权限查看用户清单</td></tr>}
          </tbody>
        </table>
      </section>

      <section className="panel admin-section">
        <div className="panel-header">
          <div>
            <h3>字段授权</h3>
            <p className="hint">联系方式、背调材料、银行流水默认不可见，需按用户或权限组单独授权并设置有效期。</p>
          </div>
          <ShieldCheck size={16} />
        </div>
        <table className="admin-table">
          <thead><tr><th>字段</th><th>对象</th><th>权限</th><th>到期</th><th>操作</th></tr></thead>
          <tbody>
            {grants.map((grant) => {
              const userName = grant.userId ? users.find((u) => u.id === grant.userId)?.displayName : null
              const groupName = grant.userGroupId ? groups.find((g) => g.id === grant.userGroupId)?.name : null
              return (
                <tr key={grant.id}>
                  <td><strong>{grant.field}</strong></td>
                  <td><small>{grant.userId ? `用户：${userName || grant.userId}` : `权限组：${groupName || grant.userGroupId}`}</small></td>
                  <td>{grant.canRead ? '读' : ''}{grant.canWrite ? '写' : ''}</td>
                  <td>{grant.expiresAt ? grant.expiresAt.slice(0, 10) : '长期'}</td>
                  <td>
                    <button className="text-button" disabled={busy === grant.id} onClick={() => { void run(grant.id, () => api.revokeFieldGrant(grant.id), '字段授权已撤销') }}><Trash2 size={13} />撤销</button>
                  </td>
                </tr>
              )
            })}
            {grants.length === 0 && <tr><td colSpan={5} className="empty-inline">暂无字段授权</td></tr>}
          </tbody>
        </table>
        <div className="admin-inline-form">
          <select className="admin-select" value={grantDraft.field} onChange={(event) => setGrantDraft({ ...grantDraft, field: event.target.value })}>
            <option value="CANDIDATE_CONTACT">联系方式</option>
            <option value="BACKGROUND_MATERIALS">背调材料</option>
            <option value="BANK_STATEMENTS">银行流水</option>
          </select>
          <select className="admin-select" value={grantDraft.targetType} onChange={(event) => setGrantDraft({ ...grantDraft, targetType: event.target.value as 'USER' | 'GROUP', targetId: '' })}>
            <option value="USER">按用户</option>
            <option value="GROUP">按权限组</option>
          </select>
          <select className="admin-select" value={grantDraft.targetId} onChange={(event) => setGrantDraft({ ...grantDraft, targetId: event.target.value })}>
            <option value="">{grantDraft.targetType === 'USER' ? '选择用户…' : '选择权限组…'}</option>
            {grantDraft.targetType === 'USER'
              ? users.map((u) => <option key={u.id} value={u.id}>{u.displayName}{u.employeeNo ? ` (${u.employeeNo})` : ''}</option>)
              : groups.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.code})</option>)}
          </select>
          <label className="admin-check"><input type="checkbox" checked={grantDraft.canRead} onChange={(event) => setGrantDraft({ ...grantDraft, canRead: event.target.checked })} />读</label>
          <label className="admin-check"><input type="checkbox" checked={grantDraft.canWrite} onChange={(event) => setGrantDraft({ ...grantDraft, canWrite: event.target.checked })} />写</label>
          <input className="admin-input admin-input-sm" type="date" value={grantDraft.expiresAt} onChange={(event) => setGrantDraft({ ...grantDraft, expiresAt: event.target.value })} />
          <button className="button button-primary button-sm" disabled={!grantDraft.targetId || busy === 'grant-create'} onClick={() => {
            const payload = {
              field: grantDraft.field,
              userId: grantDraft.targetType === 'USER' ? grantDraft.targetId : undefined,
              userGroupId: grantDraft.targetType === 'GROUP' ? grantDraft.targetId : undefined,
              canRead: grantDraft.canRead,
              canWrite: grantDraft.canWrite,
              expiresAt: grantDraft.expiresAt ? new Date(`${grantDraft.expiresAt}T23:59:59+08:00`).toISOString() : undefined,
            }
            void run('grant-create', () => api.createFieldGrant(payload), '字段授权已创建')
          }}>授权</button>
        </div>
        <p className="hint">可直接选择用户或权限组授予敏感字段权限；到期日期按北京时间当日 23:59:59 生效。</p>
      </section>
    </>
  )
}

// ---------- 接入配置 ----------

function IntegrationsTab() {
  const { toast } = useApp()
  const [snapshot, setSnapshot] = useState<OperationsSnapshot | null>(null)
  const [policy, setPolicy] = useState<{ resumeDays: number; sensitiveDays: number; batchSize: number; note: string } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [revokeId, setRevokeId] = useState('')
  const [draft, setDraft] = useState({ address: '', provider: 'IMAP', host: '', port: '993', username: '', password: '' })

  const load = useCallback(async () => {
    const [nextSnapshot, nextPolicy] = await Promise.all([
      api.getOperationsSnapshot(),
      api.getRetentionPolicy().catch(() => null),
    ])
    setSnapshot(nextSnapshot)
    setPolicy(nextPolicy)
  }, [])

  useEffect(() => {
    let active = true
    void load().catch((err: unknown) => { if (active) setError(msg(err)) })
    return () => { active = false }
  }, [load])

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

  if (error && !snapshot) return <div className="panel empty-state">{error}</div>
  if (!snapshot) return <div className="panel empty-state">正在加载接入状态…</div>

  return (
    <>
      <section className="panel admin-section">
        <div className="panel-header">
          <div>
            <h3>集成状态</h3>
            <p className="hint">凭据维护与重试动作沿用各领域接口并按领域权限校验；本页不展示任何密钥。</p>
          </div>
          <button className="button button-secondary button-sm" onClick={() => { void run('reload', load, '状态已刷新') }}><RefreshCw size={13} />刷新</button>
        </div>
        <div className="admin-cards">
          {snapshot.integrations.map((item) => (
            <div className="admin-card" key={item.key}>
              <div className="admin-card-head">
                <strong>{item.name}</strong>
                <span className={cn('status-chip', item.status === 'READY' ? 'status-on' : item.status === 'NOT_CONFIGURED' ? 'status-err' : 'status-warn')}>{statusLabel(item.status)}</span>
              </div>
              <p>{item.detail}</p>
              {item.permission && <small>需要权限：{item.permission}</small>}
            </div>
          ))}
        </div>
      </section>

      <section className="panel admin-section">
        <div className="panel-header">
          <div>
            <h3>招聘邮箱</h3>
            <p className="hint">监控视图中的邮箱地址已脱敏；新增后可用「测试连接」验证凭据。</p>
          </div>
        </div>
        <table className="admin-table">
          <thead><tr><th>邮箱</th><th>协议</th><th>状态</th><th>最近抓取</th><th>操作</th></tr></thead>
          <tbody>
            {snapshot.mail.mailboxes.map((mailbox) => (
              <tr key={mailbox.id}>
                <td><strong>{mailbox.address}</strong>{mailbox.lastError && <small className="admin-danger">{mailbox.lastError}</small>}</td>
                <td>{mailbox.provider}</td>
                <td><span className={cn('status-chip', mailbox.active ? 'status-on' : 'status-off')}>{mailbox.active ? '启用' : '停用'}</span></td>
                <td>{mailbox.lastPolledAt ? `${mailbox.lastPolledAt.slice(0, 16).replace('T', ' ')}（${mailbox.lastPollStatus || '未知'}）` : '尚未抓取'}</td>
                <td>
                  <button className="text-button" disabled={busy === `test-${mailbox.id}`} onClick={() => { void run(`test-${mailbox.id}`, () => api.testMailboxConfig(mailbox.id), '连接测试已执行') }}>测试连接</button>
                  <button className="text-button" disabled={busy === `poll-${mailbox.id}`} onClick={() => { void run(`poll-${mailbox.id}`, () => api.pollMailboxConfig(mailbox.id), '已触发抓取') }}>立即抓取</button>
                </td>
              </tr>
            ))}
            {snapshot.mail.mailboxes.length === 0 && <tr><td colSpan={5} className="empty-inline">尚未配置招聘邮箱</td></tr>}
          </tbody>
        </table>
        <div className="admin-inline-form">
          <input className="admin-input" placeholder="邮箱地址" value={draft.address} onChange={(event) => setDraft({ ...draft, address: event.target.value })} />
          <select className="admin-select" value={draft.provider} onChange={(event) => setDraft({ ...draft, provider: event.target.value })}>
            <option value="IMAP">IMAP</option>
            <option value="MOCK">MOCK</option>
          </select>
          <input className="admin-input admin-input-sm" placeholder="主机" value={draft.host} onChange={(event) => setDraft({ ...draft, host: event.target.value })} />
          <input className="admin-input admin-input-sm" placeholder="端口" value={draft.port} onChange={(event) => setDraft({ ...draft, port: event.target.value })} />
          <input className="admin-input admin-input-sm" placeholder="账号" value={draft.username} onChange={(event) => setDraft({ ...draft, username: event.target.value })} />
          <input className="admin-input admin-input-sm" placeholder="授权码" type="password" value={draft.password} onChange={(event) => setDraft({ ...draft, password: event.target.value })} />
          <button className="button button-primary button-sm" disabled={!draft.address.trim() || busy === 'mailbox-create'} onClick={() => {
            const payload = {
              address: draft.address.trim(),
              provider: draft.provider,
              host: draft.host.trim() || undefined,
              port: draft.port.trim() ? Number(draft.port) : undefined,
              username: draft.username.trim() || undefined,
              password: draft.password || undefined,
            }
            void run('mailbox-create', () => api.createMailboxConfig(payload), '邮箱已新增')
              .then((ok) => { if (ok) setDraft((prev) => ({ ...prev, address: '', host: '', username: '', password: '' })) })
          }}>新增邮箱</button>
        </div>
      </section>

      <section className="panel admin-section">
        <div className="panel-header">
          <div>
            <h3>钉钉组织同步</h3>
            <p className="hint">事件重试与全量同步沿用组织同步接口，需要组织同步权限。</p>
          </div>
          <button className="button button-secondary button-sm" disabled={busy === 'dingtalk-sync'} onClick={() => { void run('dingtalk-sync', api.triggerDingTalkSync, '全量同步已入队') }}><RefreshCw size={13} />立即同步</button>
        </div>
        <table className="admin-table">
          <thead><tr><th>事件</th><th>类型</th><th>状态</th><th>接收时间</th><th>操作</th></tr></thead>
          <tbody>
            {snapshot.dingtalk.events.map((event) => (
              <tr key={event.id}>
                <td><small>{event.id}</small></td>
                <td>{event.eventType}</td>
                <td><span className={cn('status-chip', event.status === 'FAILED' ? 'status-err' : 'status-off')}>{event.status}</span></td>
                <td>{event.receivedAt ? event.receivedAt.slice(0, 16).replace('T', ' ') : '—'}</td>
                <td>
                  <button className="text-button" disabled={!event.retryable || busy === event.id} onClick={() => { void run(event.id, () => api.retryDingTalkEvent(event.id), '事件已重试') }}>重试</button>
                </td>
              </tr>
            ))}
            {snapshot.dingtalk.events.length === 0 && <tr><td colSpan={5} className="empty-inline">暂无同步事件</td></tr>}
          </tbody>
        </table>
      </section>

      <section className="panel admin-section">
        <div className="panel-header">
          <div>
            <h3>浏览器插件导入令牌</h3>
            <p className="hint">当前有效令牌 {snapshot.tokens.active} 个；吊销后立即失效，仅本人或授权管理员可执行。</p>
          </div>
        </div>
        <div className="admin-inline-form">
          <input className="admin-input" placeholder="操作者用户 ID" value={revokeId} onChange={(event) => setRevokeId(event.target.value)} />
          <button className="button button-secondary button-sm" disabled={!revokeId.trim() || busy === 'revoke'} onClick={() => {
            const operatorId = revokeId.trim()
            void run('revoke', () => api.revokeBrowserImportTokens(operatorId), '该操作者的令牌已吊销')
              .then((ok) => { if (ok) setRevokeId('') })
          }}>吊销令牌</button>
        </div>
      </section>

      <section className="panel admin-section">
        <div className="panel-header">
          <div>
            <h3>数据保留与清理</h3>
            <p className="hint">{policy?.note || '保留期限由服务端环境变量配置'}</p>
          </div>
        </div>
        {policy && (
          <dl className="admin-kv">
            <div><dt>简历附件保留</dt><dd>{policy.resumeDays} 天</dd></div>
            <div><dt>敏感材料保留</dt><dd>{policy.sensitiveDays} 天</dd></div>
            <div><dt>批量大小</dt><dd>{policy.batchSize}</dd></div>
          </dl>
        )}
        <div className="admin-inline-form">
          <button className="button button-secondary button-sm" disabled={busy === 'purge-dry'} onClick={() => { void run('purge-dry', () => api.runRetentionPurge(true), '已试算到期数据') }}>试算到期数据</button>
          <button className="button button-primary button-sm" disabled={busy === 'purge'} onClick={() => {
            if (!window.confirm('确认执行到期清理？该操作会删除到期附件且不可恢复。')) return
            void run('purge', () => api.runRetentionPurge(false), '到期清理已执行')
          }}>执行清理</button>
        </div>
      </section>
    </>
  )
}

// ---------- 运行监控 ----------

function OperationsTab() {
  const { toast } = useApp()
  const [snapshot, setSnapshot] = useState<OperationsSnapshot | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    try {
      setSnapshot(await api.getOperationsSnapshot())
      setError('')
    } catch (err) {
      setError(msg(err))
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const run = async (key: string, action: () => Promise<unknown>, success: string) => {
    setBusy(key)
    try {
      await action()
      await load()
      toast(success)
    } catch (err) {
      toast(msg(err), 'info')
    } finally {
      setBusy('')
    }
  }

  if (error) return <div className="panel empty-state">{error}</div>
  if (!snapshot) return <div className="panel empty-state">正在加载运行状态…</div>

  const aiStatus = Object.entries(snapshot.tasks.aiByStatus).map(([status, count]) => `${status} ${count}`).join(' · ')
  const failedCount = snapshot.tasks.intakeFailures.length + snapshot.tasks.aiFailures.length + snapshot.tasks.browserImportFailures.length

  return (
    <>
      <section className="panel admin-section">
        <div className="panel-header">
          <div>
            <h3>服务连接</h3>
            <p className="hint">生成于 {snapshot.generatedAt.slice(0, 19).replace('T', ' ')}</p>
          </div>
          <button className="button button-secondary button-sm" onClick={() => { void run('reload', load, '状态已刷新') }}><RefreshCw size={13} />刷新</button>
        </div>
        <div className="admin-cards">
          {Object.values(snapshot.services).map((service) => (
            <div className="admin-card" key={service.name}>
              <div className="admin-card-head">
                <strong>{service.name}</strong>
                <span className={cn('status-chip', service.status === 'UP' ? 'status-on' : service.status === 'DOWN' ? 'status-err' : 'status-warn')}>{service.status}</span>
              </div>
              <p>{service.detail}</p>
            </div>
          ))}
          <div className="admin-card">
            <div className="admin-card-head"><strong>AI 任务</strong><span className="status-chip status-off">近 24h</span></div>
            <p>{aiStatus || '暂无任务'}</p>
          </div>
          <div className="admin-card">
            <div className="admin-card-head"><strong>通知通道</strong><span className={cn('status-chip', snapshot.notifications.integrated ? 'status-on' : 'status-warn')}>{snapshot.notifications.channel}</span></div>
            <p>已登记 {snapshot.notifications.events.length} 个通知事件</p>
          </div>
        </div>
      </section>

      <section className="panel admin-section">
        <div className="panel-header">
          <div>
            <h3>失败任务</h3>
            <p className="hint">只显示任务标识、错误码与脱敏后的错误信息；重试回到对应领域接口执行。</p>
          </div>
          <span className={cn('status-chip', failedCount > 0 ? 'status-err' : 'status-on')}>{failedCount} 条</span>
        </div>
        <table className="admin-table">
          <thead><tr><th>类型</th><th>标识</th><th>错误</th><th>时间</th><th>操作</th></tr></thead>
          <tbody>
            {snapshot.tasks.intakeFailures.map((task) => (
              <tr key={`intake-${task.id}`}>
                <td>简历解析 · {task.source}</td>
                <td><small>{task.id}</small></td>
                <td className="admin-note">{task.errorCode || '—'} {task.errorMessage || ''}</td>
                <td>{task.createdAt ? task.createdAt.slice(0, 16).replace('T', ' ') : '—'}</td>
                <td><button className="text-button" disabled={!task.retryable || busy === task.id} onClick={() => { void run(task.id, () => api.retryIntake(task.id), '已重新投递解析') }}>重试</button></td>
              </tr>
            ))}
            {snapshot.tasks.aiFailures.map((run) => (
              <tr key={`ai-${run.id}`}>
                <td>AI · {run.type}</td>
                <td><small>{run.id}</small></td>
                <td className="admin-note">{run.errorCode || '—'} {run.errorMessage || ''}</td>
                <td>{run.updatedAt ? run.updatedAt.slice(0, 16).replace('T', ' ') : '—'}</td>
                <td className="admin-note">需在简历入场重新解析</td>
              </tr>
            ))}
            {snapshot.tasks.browserImportFailures.map((task) => (
              <tr key={`browser-${task.taskId}`}>
                <td>插件导入</td>
                <td><small>{task.taskId}</small></td>
                <td className="admin-note">{task.errorStage || '—'} {task.errorCode || '—'} {task.errorMessage || ''}</td>
                <td>{task.createdAt ? task.createdAt.slice(0, 16).replace('T', ' ') : '—'}</td>
                <td className="admin-note">需插件侧重新导入</td>
              </tr>
            ))}
            {failedCount === 0 && <tr><td colSpan={5} className="empty-inline">暂无失败任务</td></tr>}
          </tbody>
        </table>
      </section>

      <section className="panel admin-section">
        <div className="panel-header">
          <div>
            <h3>保留清理记录</h3>
            <p className="hint">只显示计数与时间，不展示被清理的内容。</p>
          </div>
        </div>
        <table className="admin-table">
          <thead><tr><th>范围</th><th>截止</th><th>扫描 / 到期</th><th>删除文件 / 解绑</th><th>模式</th><th>时间</th></tr></thead>
          <tbody>
            {snapshot.tasks.retentionRuns.map((run) => (
              <tr key={run.id}>
                <td>{run.scope}</td>
                <td>{run.cutoff ? run.cutoff.slice(0, 10) : '—'}</td>
                <td>{run.scanned} / {run.expired}</td>
                <td>{run.deletedFiles} / {run.detachedIntakes}{run.failedDeletes > 0 ? `（失败 ${run.failedDeletes}）` : ''}</td>
                <td><span className={cn('status-chip', run.dryRun ? 'status-off' : 'status-on')}>{run.dryRun ? '试算' : '执行'}</span></td>
                <td>{run.createdAt ? run.createdAt.slice(0, 16).replace('T', ' ') : '—'}</td>
              </tr>
            ))}
            {snapshot.tasks.retentionRuns.length === 0 && <tr><td colSpan={6} className="empty-inline">暂无清理记录</td></tr>}
          </tbody>
        </table>
      </section>
    </>
  )
}

// ---------- 操作审计 ----------

function AuditTab() {
  const [filters, setFilters] = useState({ actorId: '', actionPrefix: '', resourceType: '', resourceId: '', from: '', to: '' })
  const [rows, setRows] = useState<AuditLogRow[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const reqIdRef = useRef(0)

  const buildQuery = useCallback((f: typeof filters) => ({
    actorId: f.actorId.trim() || undefined,
    actionPrefix: f.actionPrefix.trim() || undefined,
    resourceType: f.resourceType.trim() || undefined,
    resourceId: f.resourceId.trim() || undefined,
    from: f.from ? new Date(`${f.from}T00:00:00+08:00`).toISOString() : undefined,
    to: f.to ? new Date(`${f.to}T23:59:59.999+08:00`).toISOString() : undefined,
    limit: 200,
  }), [])

  const load = useCallback(async (f: typeof filters) => {
    const reqId = ++reqIdRef.current
    setLoading(true)
    try {
      const nextRows = await api.listAuditLogs(buildQuery(f))
      if (reqId !== reqIdRef.current) return
      setRows(nextRows)
      setError('')
    } catch (err) {
      if (reqId !== reqIdRef.current) return
      setError(msg(err))
    } finally {
      if (reqId === reqIdRef.current) setLoading(false)
    }
  }, [buildQuery])

  useEffect(() => {
    void load({ actorId: '', actionPrefix: '', resourceType: '', resourceId: '', from: '', to: '' })
    return () => { reqIdRef.current += 1 }
  }, [load])

  return (
    <section className="panel admin-section">
      <div className="panel-header">
        <div>
          <h3>操作审计</h3>
          <p className="hint">按对象、动作与时间检索；审计内容已脱敏，不包含凭据与密钥。</p>
        </div>
        <button className="button button-secondary button-sm" onClick={() => { void api.exportAuditLogs(buildQuery(filters)).catch((err: unknown) => setError(msg(err))) }}><Download size={13} />导出 CSV</button>
      </div>
      <form className="admin-filters" onSubmit={(event) => { event.preventDefault(); void load(filters) }}>
        <input className="admin-input" placeholder="操作者 ID" value={filters.actorId} onChange={(event) => setFilters({ ...filters, actorId: event.target.value })} />
        <input className="admin-input" placeholder="动作前缀，如 settings." value={filters.actionPrefix} onChange={(event) => setFilters({ ...filters, actionPrefix: event.target.value })} />
        <input className="admin-input" placeholder="对象类型" value={filters.resourceType} onChange={(event) => setFilters({ ...filters, resourceType: event.target.value })} />
        <input className="admin-input" placeholder="对象 ID" value={filters.resourceId} onChange={(event) => setFilters({ ...filters, resourceId: event.target.value })} />
        <input className="admin-input" type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} />
        <input className="admin-input" type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} />
        <button type="submit" className="button button-primary button-sm" disabled={loading}>{loading ? '查询中…' : '查询'}</button>
      </form>
      {error && <p className="form-error">{error}</p>}
      <table className="admin-table">
        <thead><tr><th>时间</th><th>操作者</th><th>动作</th><th>对象</th><th>结果</th><th>来源 IP</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.createdAt.slice(0, 19).replace('T', ' ')}</td>
              <td>{row.actorName || row.actorId}</td>
              <td><small>{row.action}</small></td>
              <td className="admin-note">{row.resourceType} · {row.resourceId}</td>
              <td><span className={cn('status-chip', row.outcome === 'FAILED' ? 'status-err' : 'status-on')}>{row.outcome || 'SUCCESS'}</span></td>
              <td><small>{row.ip || '—'}</small></td>
            </tr>
          ))}
          {rows.length === 0 && !loading && <tr><td colSpan={6} className="empty-inline">没有匹配的审计记录</td></tr>}
        </tbody>
      </table>
    </section>
  )
}

function statusLabel(status: string): string {
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

function scopeLabel(scope: string): string {
  const map: Record<string, string> = { SELF: '本人', DEPARTMENT: '本部门', DEPARTMENT_TREE: '本部门及下级', ALL: '全部' }
  return map[scope] || scope
}

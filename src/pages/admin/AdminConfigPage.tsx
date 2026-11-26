import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, BellRing, BookOpen, CalendarClock, Lock, RefreshCw, Save, SlidersHorizontal } from 'lucide-react'
import * as api from '../../api'
import { useApp } from '../../context'
import type { AdminOverview, DictItemView, InterviewPlanView, NotificationEventInfo, ReasonOptionView } from '../../types'
import { invalidateEffectiveSettings } from '../../useEffectiveSettings'
import { cn } from '../../utils'
import { msg, type RunFn } from './shared'

type ConfigTab = 'fields' | 'dicts' | 'plans' | 'reasons' | 'rules'

const REASON_TYPES = ['ARCHIVE', 'OFFER_REJECT', 'ONBOARD_ABANDON'] as const

export function AdminConfigPage() {
  const { toast } = useApp()
  const [tab, setTab] = useState<ConfigTab>('fields')
  const [overview, setOverview] = useState<AdminOverview | null>(null)
  const [notifications, setNotifications] = useState<{ channel: string; integrated: boolean; note: string; events: NotificationEventInfo[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    try {
      const [nextOverview, nextNotifications] = await Promise.all([
        api.getAdminOverview(),
        api.getNotificationSettings().catch(() => null),
      ])
      setOverview(nextOverview)
      setNotifications(nextNotifications)
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

  const run = useCallback<RunFn>(async (key, action, success) => {
    setBusy(key)
    setError('')
    try {
      await action()
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
    <div className="page-stack">
      <div className="page-title-row">
        <div>
          <div className="eyebrow">系统管理 <span className="eyebrow-separator">·</span> 表单、字典与业务规则</div>
          <h2>业务配置</h2>
          <p>维护职位与候选人的表单规则、业务字典、面试方案、归档/拒绝原因及通知事件。</p>
        </div>
        <div className="page-title-actions">
          <button className="button button-secondary" onClick={() => void run('reload', load, '配置已刷新')} disabled={loading}>
            <RefreshCw size={15} />刷新
          </button>
        </div>
      </div>

      <div className="stage-tabs stage-tabs-scroll">
        <button className={cn('stage-tab', tab === 'fields' && 'active')} onClick={() => setTab('fields')}>
          <SlidersHorizontal size={14} />字段配置
        </button>
        <button className={cn('stage-tab', tab === 'dicts' && 'active')} onClick={() => setTab('dicts')}>
          <BookOpen size={14} />业务字典
        </button>
        <button className={cn('stage-tab', tab === 'plans' && 'active')} onClick={() => setTab('plans')}>
          <CalendarClock size={14} />面试方案
        </button>
        <button className={cn('stage-tab', tab === 'reasons' && 'active')} onClick={() => setTab('reasons')}>
          原因选项
        </button>
        <button className={cn('stage-tab', tab === 'rules' && 'active')} onClick={() => setTab('rules')}>
          <BellRing size={14} />通知与固定规则
        </button>
      </div>

      {error && <div className="admin-error" role="alert"><AlertTriangle size={15} />{error}</div>}
      {loading && !overview && <div className="panel empty-state">正在加载配置…</div>}

      {overview && tab === 'fields' && <FieldsSection overview={overview} busy={busy} run={run} />}
      {overview && tab === 'dicts' && <DictSection overview={overview} busy={busy} run={run} />}
      {overview && tab === 'plans' && <PlanSection overview={overview} busy={busy} run={run} />}
      {overview && tab === 'reasons' && <ReasonsSection overview={overview} busy={busy} run={run} />}
      {overview && tab === 'rules' && <RulesAndNotifySection overview={overview} notifications={notifications} />}
    </div>
  )
}

function FieldsSection({ overview, busy, run }: { overview: AdminOverview; busy: string; run: RunFn }) {
  return (
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

function ReasonsSection({ overview, busy, run }: { overview: AdminOverview; busy: string; run: RunFn }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  return (
    <div className="page-stack">
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
    </div>
  )
}

function RulesAndNotifySection({
  overview,
  notifications,
}: {
  overview: AdminOverview
  notifications: { channel: string; integrated: boolean; note: string; events: NotificationEventInfo[] } | null
}) {
  return (
    <div className="page-stack">
      {notifications && (
        <section className="panel admin-section">
          <div className="panel-header">
            <div>
              <h3>通知事件清单</h3>
              <p className="hint">{notifications.note}</p>
            </div>
            <span className={cn('status-chip', notifications.integrated ? 'status-on' : 'status-warn')}>
              {notifications.integrated ? '已接入' : `通道 ${notifications.channel}`}
            </span>
          </div>
          <table className="admin-table">
            <thead><tr><th>事件</th><th>标识</th><th>优先级</th><th>说明</th></tr></thead>
            <tbody>
              {notifications.events.map((event) => (
                <tr key={event.key}>
                  <td><strong>{event.label}</strong></td>
                  <td><small className="mono-cell">{event.key}</small></td>
                  <td>{event.lowPriority ? <span className="status-chip status-off">可自行关闭</span> : <span className="status-chip status-on">必达</span>}</td>
                  <td className="admin-note">{event.description || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">个人可在右上角用户菜单「通知偏好」里关闭可自行关闭的事件；接收角色由业务规则确定，不在此维护。</p>
        </section>
      )}

      <section className="panel admin-section">
        <div className="panel-header">
          <div>
            <h3>固定业务规则</h3>
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
    </div>
  )
}

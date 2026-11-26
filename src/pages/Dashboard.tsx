import { useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, BellRing, CalendarDays, CheckCheck, ChevronRight, ClipboardList, RefreshCw, Target, Users, Video } from 'lucide-react'
import type { PageKey } from '../types'
import {
  getDashboardJob360,
  getDashboardNotifications,
  getDashboardSummary,
  listDashboardJobs,
  markDashboardNotificationsRead,
  type DashboardJob360,
  type DashboardJobItem,
  type DashboardNotifications,
  type DashboardSummary,
} from '../api'
import { cn } from '../utils'

type DashboardProps = { onNavigate: (page: PageKey) => void; onOpenCandidate: (id: string) => void }

const STAGE_LABELS: Record<string, string> = {
  UNASSIGNED: '待分配',
  VIRTUAL_POOL: '虚拟池',
  RECOMMENDED: '新简历',
  HR_SCREENING: 'HR 初筛',
  DEPT_SCREENING: '部门筛选',
  INTERVIEWING: '面试中',
  OFFERING: 'Offer 中',
  PENDING_ONBOARD: '待入职',
  ONBOARDED: '已入职',
  PROBATION: '试用期',
  ENDED: '已结束',
  ARCHIVED: '已归档',
}

const MODE_LABELS: Record<string, string> = {
  VIDEO: '视频',
  ONSITE: '现场',
  PHONE: '电话',
}

export function Dashboard({ onNavigate, onOpenCandidate }: DashboardProps) {
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [notifications, setNotifications] = useState<DashboardNotifications | null>(null)
  const [jobs, setJobs] = useState<DashboardJobItem[]>([])
  const [jobId, setJobId] = useState('')
  const [job360, setJob360] = useState<DashboardJob360 | null>(null)
  const [activeCategory, setActiveCategory] = useState('MENTION')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = () => {
    setLoading(true)
    setError('')
    Promise.all([getDashboardSummary(), getDashboardNotifications(), listDashboardJobs()])
      .then(([nextSummary, nextNotifications, nextJobs]) => {
        setSummary(nextSummary)
        setNotifications(nextNotifications)
        setJobs(nextJobs)
        setJobId((current) => current || nextJobs[0]?.id || '')
      })
      .catch((cause: Error) => setError(cause.message))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  useEffect(() => {
    if (!jobId) {
      setJob360(null)
      return
    }
    let cancelled = false
    getDashboardJob360(jobId)
      .then((detail) => {
        if (!cancelled) setJob360(detail)
      })
      .catch(() => {
        if (!cancelled) setJob360(null)
      })
    return () => {
      cancelled = true
    }
  }, [jobId])

  const today = new Date()
  const todayLabel = `${today.getMonth() + 1}月${today.getDate()}日`
  const todoTotal = summary?.todos.reduce((sum, todo) => sum + todo.count, 0) ?? 0
  const category = notifications?.categories.find((item) => item.key === activeCategory) ?? notifications?.categories[0]

  const handleReadAll = async () => {
    try {
      await markDashboardNotificationsRead({ all: true })
      setNotifications(await getDashboardNotifications())
    } catch (err) {
      setError(err instanceof Error ? err.message : '标记已读失败')
    }
  }

  const handleOpenNotification = async (id: string, page: string, candidateId: string | null) => {
    try {
      await markDashboardNotificationsRead({ ids: [id] })
      setNotifications(await getDashboardNotifications())
    } catch {
      // 标记已读失败不阻塞跳转
    }
    if (candidateId) onOpenCandidate(candidateId)
    else onNavigate(page as PageKey)
  }

  const activeJobs = useMemo(() => jobs.filter((job) => job.status === 'ACTIVE' && !job.isVirtual), [jobs])

  if (loading && !summary) {
    return <div className="page-stack"><div className="panel"><div className="panel-header"><div><h3>正在加载工作台</h3><p>待办、今日指标与通知均来自真实权限内数据</p></div></div></div></div>
  }

  if (error && !summary) {
    return (
      <div className="page-stack">
        <div className="panel">
          <div className="panel-header"><div><h3>工作台数据加载失败</h3><p>{error}</p></div></div>
          <button className="button button-secondary" onClick={load}><RefreshCw size={16} />重新加载</button>
        </div>
      </div>
    )
  }

  return (
    <div className="page-stack">
      <section className="welcome-row">
        <div>
          <div className="eyebrow"><span className="live-dot" /> 数据实时聚合 <span className="eyebrow-separator">·</span> {todayLabel}</div>
          <h2>招聘工作台</h2>
          <p>
            今天有 <strong>{summary?.today.interviews.count ?? 0} 场面试</strong>，<strong>{summary?.today.screening.count ?? 0} 份待筛选申请</strong>，共 <strong>{todoTotal} 项待办</strong>。
          </p>
        </div>
        <div className="welcome-actions">
          <button className="button button-secondary" onClick={load} disabled={loading}><RefreshCw size={16} />刷新</button>
          <button className="button button-primary" onClick={() => onNavigate('reports')}><ArrowUpRight size={16} />查看数据报告</button>
        </div>
      </section>

      <section className="metric-grid">
        <article className="metric-card metric-card-featured">
          <div className="metric-top"><span>我的待办</span><span className="metric-icon blue"><ClipboardList size={17} /></span></div>
          <div className="metric-value-row"><strong>{todoTotal}</strong></div>
          <div className="metric-foot"><span>按七类待办实时统计</span></div>
        </article>
        <article className="metric-card">
          <div className="metric-top"><span>今日待筛选申请</span><span className="metric-icon violet"><Users size={17} /></span></div>
          <div className="metric-value-row"><strong>{summary?.today.screening.count ?? 0}</strong></div>
          <div className="metric-foot"><span>{summary?.today.screening.denominator}</span></div>
        </article>
        <article className="metric-card">
          <div className="metric-top"><span>今日面试</span><span className="metric-icon green"><CalendarDays size={17} /></span></div>
          <div className="metric-value-row"><strong>{summary?.today.interviews.count ?? 0}</strong></div>
          <div className="metric-foot"><span>不含已取消的面试</span></div>
        </article>
        <article className="metric-card">
          <div className="metric-top"><span>在招职位</span><span className="metric-icon orange"><Target size={17} /></span></div>
          <div className="metric-value-row"><strong>{activeJobs.length}</strong></div>
          <div className="metric-foot"><span>权限范围内的在招职位</span></div>
        </article>
      </section>

      <section className="dashboard-main-grid">
        <article className="panel">
          <div className="panel-header"><div><h3>我的待办</h3><p>点击任一待办直达对应列表</p></div></div>
          <div className="dashboard-todo-grid">
            {(summary?.todos ?? []).map((todo) => (
              <button
                key={todo.key}
                className="today-item"
                style={{ justifyContent: 'space-between', gap: 8 }}
                onClick={() => onNavigate(todo.page as PageKey)}
                title={todo.detail}
              >
                <span className="today-item-copy"><strong>{todo.label}</strong><span>{todo.detail}</span></span>
                <span className="count-pill">{todo.count}</span>
              </button>
            ))}
          </div>
        </article>

        <article className="panel today-panel">
          <div className="panel-header">
            <div><h3>今日面试 <span className="count-pill">{summary?.today.interviews.count ?? 0}</span></h3><p>{todayLabel}</p></div>
            <button className="text-button" onClick={() => onNavigate('interviews')}>全部安排 <ChevronRight size={14} /></button>
          </div>
          <div className="today-list">
            {(summary?.today.interviews.items ?? []).slice(0, 5).map((interview) => {
              const at = new Date(interview.time)
              return (
                <button className="today-item" key={interview.id} onClick={() => onOpenCandidate(interview.candidateId)}>
                  <div className="time-block">
                    <strong>{`${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`}</strong>
                    <span>第 {interview.round} 轮</span>
                  </div>
                  <span className="today-item-copy">
                    <strong>{interview.candidateName || '候选人'}<small>{interview.jobTitle || '未关联职位'}</small></strong>
                    <span>{MODE_LABELS[interview.mode] ?? interview.mode}</span>
                  </span>
                  <span className="today-item-mode"><Video size={14} />{MODE_LABELS[interview.mode] ?? interview.mode}</span>
                  <ChevronRight size={15} className="muted-chevron" />
                </button>
              )
            })}
            {!summary?.today.interviews.count && <div className="empty-hint" style={{ padding: 16 }}>今日暂无面试安排</div>}
          </div>
          <button className="panel-bottom-action" onClick={() => onNavigate('interviews')}><CalendarDays size={15} />查看面试日历</button>
        </article>
      </section>

      <section className="dashboard-main-grid">
        <article className="panel">
          <div className="panel-header">
            <div><h3>通知 <span className="count-pill">{notifications?.unreadTotal ?? 0}</span></h3><p>{notifications?.source}</p></div>
            <button className="text-button" onClick={handleReadAll}><CheckCheck size={14} />全部已读</button>
          </div>
          <div className="dashboard-notify-tabs">
            {(notifications?.categories ?? []).map((item) => (
              <button
                key={item.key}
                className={cn('button button-sm', activeCategory === item.key ? 'button-primary' : 'button-secondary')}
                onClick={() => setActiveCategory(item.key)}
              >
                {item.label} {item.unread > 0 ? `(${item.unread})` : ''}
              </button>
            ))}
          </div>
          <div className="today-list">
            {(category?.items ?? []).map((item) => (
              <button
                key={item.id}
                className="today-item"
                onClick={() => handleOpenNotification(item.id, item.page, item.candidateId)}
              >
                <span className={cn('approval-icon', item.read ? '' : 'offer')}><BellRing size={16} /></span>
                <span className="today-item-copy">
                  <strong>{item.title}{!item.read && <small>未读</small>}</strong>
                  <span>{item.detail}</span>
                </span>
                <ChevronRight size={15} className="muted-chevron" />
              </button>
            ))}
            {!category?.items.length && <div className="empty-hint" style={{ padding: 16 }}>该分类暂无通知</div>}
          </div>
        </article>

        <article className="panel">
          <div className="panel-header">
            <div><h3>职位 360</h3><p>进展与 HC 详情</p></div>
            <label className="date-range">
              <select value={jobId} onChange={(event) => setJobId(event.target.value)}>
                {jobs.map((job) => <option key={job.id} value={job.id}>{job.title}</option>)}
              </select>
            </label>
          </div>
          {job360 ? (
            <div className="dashboard-job360-body">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10 }}>
                <Job360Stat label="HC" value={`${job360.hc.headcount}`} />
                <Job360Stat label="已入职" value={`${job360.hc.hiredCount}`} />
                <Job360Stat label="HC 缺口" value={`${job360.hc.gap}`} />
                <Job360Stat label="流程中" value={`${job360.hc.inProcess}`} />
              </div>
              <div className="today-item-copy">
                <strong>{job360.job.title} <small>{job360.job.departmentName || '未归属部门'}</small></strong>
                <span>招聘负责人：{job360.job.recruiterName || '未指定'} · 需求类型：{job360.job.requisition?.requisitionType || '未填写'}</span>
                <span>
                  需求周期：{job360.job.requisition?.cycleDays ? `${job360.job.requisition.cycleDays} 天` : '进行中'}
                  {job360.job.requisition?.recruitmentStartDate ? ` · 开始招聘 ${job360.job.requisition.recruitmentStartDate.slice(0, 10)}` : ''}
                </span>
              </div>
              <div className="dashboard-job360-stages">
                {Object.entries(job360.stageCounts).filter(([, count]) => count > 0).map(([stage, count]) => (
                  <div key={stage} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>{STAGE_LABELS[stage] ?? stage}</span>
                    <strong>{count}</strong>
                  </div>
                ))}
                {!Object.keys(job360.stageCounts).length && <div className="empty-hint">该职位暂无候选人</div>}
              </div>
              <div className="today-item-copy">
                <span>面试：待安排 {job360.interviews.toSchedule} 场 · 待评价 {job360.interviews.feedbackPending} 场</span>
                <span>Offer：{Object.entries(job360.offers).map(([stage, count]) => `${stage} ${count}`).join(' · ') || '暂无'}</span>
              </div>
            </div>
          ) : (
            <div className="empty-hint" style={{ padding: 16 }}>{jobs.length ? '正在加载职位详情' : '权限范围内暂无职位'}</div>
          )}
        </article>
      </section>

      <div className="reports-note" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <ClipboardList size={15} />
        <span>{summary?.note}；时间口径：{summary?.timezone}，数据生成于 {summary ? new Date(summary.generatedAt).toLocaleString() : '-'}</span>
      </div>
    </div>
  )
}

function Job360Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: '1px solid var(--border, #E5E8F0)', borderRadius: 10, padding: '10px 12px' }}>
      <span style={{ display: 'block', fontSize: 12, color: 'var(--muted, #7A8398)' }}>{label}</span>
      <strong style={{ fontSize: 20 }}>{value}</strong>
    </div>
  )
}

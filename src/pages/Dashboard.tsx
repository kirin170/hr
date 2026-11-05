import { useMemo, useState } from 'react'
import { ArrowUpRight, CalendarCheck2, CalendarDays, Check, CheckCircle2, ChevronRight, Clock3, MoreHorizontal, Plus, Target, TrendingUp, UserCheck, Users, Video } from 'lucide-react'
import type { PageKey } from '../types'
import { departments, getCandidate, getJob, jobs, weekdays } from '../data'
import { useApp } from '../context'
import { cn } from '../utils'

type DashboardProps = { onNavigate: (page: PageKey) => void; onOpenCandidate: (id: string) => void }

function Sparkline({ color = '#6675E8', points = '0,28 10,24 20,25 30,14 40,18 50,10 60,12 70,4' }: { color?: string; points?: string }) {
  return <svg className="sparkline" viewBox="0 0 70 34" preserveAspectRatio="none"><polyline points={points} fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /><polyline points={`${points} 70,34 0,34`} fill={color} opacity=".06" stroke="none" /></svg>
}

export function Dashboard({ onNavigate, onOpenCandidate }: DashboardProps) {
  const { data, setData, toast } = useApp()
  const [range] = useState('本月')
  const today = new Date()
  const todayLabel = `${today.getMonth() + 1}月${today.getDate()}日`
  const pending = data.approvals.filter((approval) => approval.status === 'pending')
  const activeCandidates = data.candidates.filter((candidate) => !['hired', 'rejected'].includes(candidate.stage))
  const todayInterviews = data.interviews.filter((interview) => interview.status === 'scheduled').slice(0, 3)
  const funnel = [
    { stage: 'new', count: data.candidates.filter(c => c.stage === 'new').length + 15, label: '新简历' },
    { stage: 'screening', count: data.candidates.filter(c => c.stage === 'screening').length + 10, label: '筛选中' },
    { stage: 'interview', count: data.candidates.filter(c => c.stage === 'interview').length + 7, label: '面试中' },
    { stage: 'offer', count: data.candidates.filter(c => c.stage === 'offer').length + 3, label: 'Offer' },
    { stage: 'hired', count: data.candidates.filter(c => c.stage === 'hired').length + 2, label: '已入职' },
  ]
  const maxFunnel = funnel[0].count

  const handleApproval = (id: string) => {
    setData((prev) => ({ ...prev, approvals: prev.approvals.map(a => a.id === id ? { ...a, status: 'approved' as const } : a) }))
    toast('审批已通过')
  }

  return (
    <div className="page-stack">
      <section className="welcome-row">
        <div>
          <div className="eyebrow"><span className="live-dot" /> 招聘运行正常 <span className="eyebrow-separator">·</span> {todayLabel} {weekdays[today.getDay()]}</div>
          <h2>早上好，邓文文 <span className="wave">👋</span></h2>
          <p>今天有 <strong>{todayInterviews.length + 2} 场面试</strong>等待推进，<strong>{pending.length} 项审批</strong>需要你处理。</p>
        </div>
        <div className="welcome-actions">
          <button className="button button-secondary" onClick={() => onNavigate('reports')}><TrendingUp size={16} />查看数据报告</button>
          <button className="button button-primary" onClick={() => onNavigate('candidates')}><Plus size={17} />新建职位</button>
        </div>
      </section>

      <section className="metric-grid">
        <article className="metric-card metric-card-featured">
          <div className="metric-top"><span>在招职位</span><span className="metric-icon blue"><BriefcaseIcon /></span></div>
          <div className="metric-value-row"><strong>12</strong><span className="metric-delta up">+2 <span>较上月</span></span></div>
          <div className="metric-foot"><span>覆盖 {departments.length} 个部门</span><Sparkline /></div>
        </article>
        <article className="metric-card">
          <div className="metric-top"><span>活跃候选人</span><span className="metric-icon violet"><Users size={17} /></span></div>
          <div className="metric-value-row"><strong>{activeCandidates.length + 34}</strong><span className="metric-delta up">+18.6% <span>较上月</span></span></div>
          <div className="metric-foot"><span>本周新增 9 人</span><Sparkline color="#9A71E8" points="0,24 10,22 20,25 30,18 40,20 50,12 60,15 70,6" /></div>
        </article>
        <article className="metric-card">
          <div className="metric-top"><span>本月面试</span><span className="metric-icon green"><CalendarDays size={17} /></span></div>
          <div className="metric-value-row"><strong>48</strong><span className="metric-delta up">+11.2% <span>较上月</span></span></div>
          <div className="metric-foot"><span>待反馈 6 场</span><Sparkline color="#18A77A" points="0,27 10,20 20,23 30,20 40,13 50,16 60,9 70,7" /></div>
        </article>
        <article className="metric-card">
          <div className="metric-top"><span>Offer 接受率</span><span className="metric-icon orange"><Target size={17} /></span></div>
          <div className="metric-value-row"><strong>83.3<span className="unit">%</span></strong><span className="metric-delta up">+4.8% <span>较上月</span></span></div>
          <div className="metric-foot"><span>本月发出 12 个</span><Sparkline color="#E49A3F" points="0,25 10,27 20,19 30,23 40,17 50,16 60,11 70,8" /></div>
        </article>
      </section>

      <section className="dashboard-main-grid">
        <article className="panel funnel-panel">
          <div className="panel-header">
            <div><h3>招聘漏斗</h3><p>从简历进入到入职的转化情况</p></div>
            <button className="range-select">{range}<ChevronRight size={14} /></button>
          </div>
          <div className="funnel-chart">
            <div className="funnel-labels">
              {funnel.map((item) => <div key={item.stage} className="funnel-label"><span>{item.label}</span><strong>{item.count}</strong></div>)}
            </div>
            <div className="funnel-bars">
              {funnel.map((item, index) => (
                <div className="funnel-bar-row" key={item.stage}>
                  <div className={cn('funnel-bar', `funnel-${item.stage}`)} style={{ width: `${Math.max((item.count / maxFunnel) * 100, 22)}%` }}>
                    {index < funnel.length - 1 && <span className="funnel-conversion">{Math.round((funnel[index + 1].count / item.count) * 100)}%</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="panel-footer-link"><span>整体转化率 <strong>8.3%</strong> <em>高于行业均值 2.1%</em></span><button onClick={() => onNavigate('pipeline')}>查看完整流程 <ArrowUpRight size={14} /></button></div>
        </article>

        <article className="panel today-panel">
          <div className="panel-header">
            <div><h3>今日面试 <span className="count-pill">{todayInterviews.length}</span></h3><p>{todayLabel} · {weekdays[today.getDay()]}</p></div>
            <button className="text-button" onClick={() => onNavigate('interviews')}>全部安排 <ChevronRight size={14} /></button>
          </div>
          <div className="today-list">
            {todayInterviews.map((interview) => {
              const candidate = getCandidate(data, interview.candidateId)
              const job = getJob(interview.jobId)
              if (!candidate) return null
              return (
                <button className="today-item" key={interview.id} onClick={() => onOpenCandidate(candidate.id)}>
                  <div className="time-block"><strong>{interview.start}</strong><span>{interview.end}</span></div>
                  <span className="avatar avatar-md" style={{ background: `${candidate.avatarColor}1f`, color: candidate.avatarColor }}>{candidate.name.slice(-2)}</span>
                  <span className="today-item-copy"><strong>{candidate.name}<small>{candidate.currentCompany}</small></strong><span>{interview.round} · {job?.title}</span></span>
                  <span className="today-item-mode"><Video size={14} />{interview.mode === 'video' ? '视频' : '现场'}</span>
                  <ChevronRight size={15} className="muted-chevron" />
                </button>
              )
            })}
          </div>
          <button className="panel-bottom-action" onClick={() => onNavigate('interviews')}><CalendarDays size={15} />查看面试日历</button>
        </article>
      </section>

      <section className="dashboard-bottom-grid">
        <article className="panel pipeline-panel">
          <div className="panel-header"><div><h3>部门招聘进展</h3><p>各部门当前在招职位与候选人分布</p></div><button className="icon-button"><MoreHorizontal size={18} /></button></div>
          <div className="department-table">
            <div className="department-table-head"><span>部门</span><span>在招职位</span><span>候选人</span><span>面试中</span><span>进度</span></div>
            {departments.slice(0, 4).map((department) => {
              const deptJobs = jobs.filter(job => job.departmentId === department.id)
              const deptCandidates = data.candidates.filter(candidate => candidate.departmentId === department.id)
              const interviews = deptCandidates.filter(candidate => candidate.stage === 'interview').length
              const percent = Math.min(92, 38 + deptCandidates.length * 7)
              return <div className="department-table-row" key={department.id}>
                <span className="department-name"><span className="department-badge" style={{ background: `${department.color}18`, color: department.color }}>{department.short}</span>{department.name}</span>
                <span>{deptJobs.length + (department.id === 'dept-rd' ? 2 : 0)}</span>
                <span><strong>{deptCandidates.length + (department.id === 'dept-rd' ? 8 : 2)}</strong> 人</span>
                <span className="muted-table-cell">{interviews + 1} 人</span>
                <span className="progress-cell"><span className="progress-track"><span className="progress-fill" style={{ width: `${percent}%`, background: department.color }} /></span><small>{percent}%</small></span>
              </div>
            })}
          </div>
          <button className="panel-bottom-action" onClick={() => onNavigate('team')}><Users size={15} />查看部门协同看板</button>
        </article>

        <article className="panel approval-panel">
          <div className="panel-header"><div><h3>待办审批 <span className="count-pill">{pending.length}</span></h3><p>需要你关注的事项</p></div><button className="text-button" onClick={() => onNavigate('probation')}>查看全部 <ChevronRight size={14} /></button></div>
          <div className="approval-list">
            {pending.slice(0, 3).map((approval) => (
              <div className="approval-item" key={approval.id}>
                <span className={cn('approval-icon', approval.type)}>{approval.type === 'offer' ? <UserCheck size={16} /> : approval.type === 'conversion' ? <CheckCircle2 size={16} /> : <Target size={16} />}</span>
                <div className="approval-copy"><strong>{approval.title}</strong><span>{approval.requester} · {approval.submittedAt}</span></div>
                <button className="approve-button" onClick={() => handleApproval(approval.id)}>通过</button>
              </div>
            ))}
          </div>
          <div className="approval-footer"><Clock3 size={14} /><span>有待处理审批时，系统会提醒你</span></div>
        </article>
      </section>

      <section className="panel activity-panel">
        <div className="panel-header"><div><h3>最近动态</h3><p>团队正在发生什么</p></div><button className="text-button">全部动态 <ChevronRight size={14} /></button></div>
        <div className="activity-grid">
          {data.activities.slice(0, 4).map((activity) => <div className="activity-card" key={activity.id}><span className="activity-icon" style={{ background: `${activity.color}15`, color: activity.color }}>{activity.icon === 'calendar' ? <CalendarCheck2 size={16} /> : activity.icon === 'check' ? <Check size={16} /> : <Users size={16} />}</span><div><p><strong>{activity.actor}</strong> {activity.action} <b>{activity.target}</b></p><span>{activity.time}</span></div></div>)}
        </div>
      </section>
    </div>
  )
}

function BriefcaseIcon() {
  return <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18M10 12v2h4v-2" /></svg>
}

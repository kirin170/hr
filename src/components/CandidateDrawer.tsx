import { ArrowLeft, BriefcaseBusiness, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronRight, Clock3, Download, ExternalLink, FileText, Mail, MapPin, MessageSquare, MoreHorizontal, Phone, Plus, Star, UserRound, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getCandidate, getCandidateDepartment, getCandidateJob } from '../data'
import { getCandidateDetail, getCandidateTimeline } from '../api'
import { useApp } from '../context'
import type { Candidate, CandidateStage, CandidateTimelineEvent } from '../types'
import { cn, stageMeta } from '../utils'
import { StageBadge } from '../pages/Candidates'

export function CandidateDrawer({ candidateId, onClose, onSchedule }: { candidateId: string; onClose: () => void; onSchedule: (candidate: Candidate) => void }) {
  const { data, updateCandidate, toast } = useApp()
  const candidateFromList = getCandidate(data, candidateId)
  const [detailCandidate, setDetailCandidate] = useState<Candidate | null>(null)
  const [timeline, setTimeline] = useState<CandidateTimelineEvent[]>([])
  const [timelineLoading, setTimelineLoading] = useState(true)
  const [tab, setTab] = useState<'overview' | 'resume' | 'timeline'>('overview')
  const [showStageMenu, setShowStageMenu] = useState(false)
  useEffect(() => {
    let active = true
    setDetailCandidate(null)
    setTimeline([])
    setTimelineLoading(true)
    getCandidateDetail(candidateId).then((item) => {
      if (active) setDetailCandidate(item)
    }).catch((error: unknown) => {
      if (active) toast(error instanceof Error ? error.message : '候选人详情加载失败', 'info')
    })
    getCandidateTimeline(candidateId).then((events) => {
      if (active) setTimeline(events)
    }).catch(() => {
      if (active) setTimeline([])
    }).finally(() => {
      if (active) setTimelineLoading(false)
    })
    return () => { active = false }
  }, [candidateId, toast])
  const candidate = detailCandidate?.id === candidateId
    ? { ...detailCandidate, ...candidateFromList }
    : candidateFromList
  if (!candidate) return null
  const job = getCandidateJob(candidate)
  const department = getCandidateDepartment(candidate)
  const interviews = data.interviews.filter(interview => interview.candidateId === candidate.id && interview.status !== 'cancelled')

  const moveTo = async (stage: CandidateStage) => {
    if (stage === candidate.stage) return
    try {
      await updateCandidate(candidate.id, { stage })
      setShowStageMenu(false)
      toast(`已推进至「${stageMeta[stage].label}」`)
    } catch (error) {
      toast(error instanceof Error ? error.message : '阶段更新失败', 'info')
    }
  }

  return <>
    <div className="drawer-backdrop" onClick={onClose} />
    <aside className="candidate-drawer">
      <header className="drawer-header">
        <button className="icon-button" onClick={onClose}><X size={19} /></button>
        <div className="drawer-header-actions"><button className="icon-button"><MoreHorizontal size={19} /></button><button className="button button-secondary button-sm"><Mail size={15} />发邮件</button><button className="button button-primary button-sm" onClick={() => onSchedule(candidate)}><CalendarDays size={15} />安排面试</button></div>
      </header>
      <div className="drawer-profile">
        <span className="avatar avatar-xl" style={{ background: `${candidate.avatarColor}18`, color: candidate.avatarColor }}>{candidate.name.slice(-2)}</span>
        <div className="drawer-profile-copy"><div className="drawer-name-row"><h2>{candidate.name}</h2><StageBadge stage={candidate.stage} /></div><p>{candidate.currentTitle} <span>·</span> {candidate.currentCompany}</p><div className="drawer-contact"><span><Phone size={14} />{candidate.phone}</span><span><Mail size={14} />{candidate.email}</span></div></div>
        <div className="drawer-rating"><span>综合评分</span><strong><Star size={16} fill="#EEA23E" stroke="#EEA23E" />{candidate.rating}.0</strong></div>
      </div>
      <div className="drawer-job-strip">
        <span className="department-badge" style={{ background: `${department?.color}18`, color: department?.color }}>{department?.short}</span>
        <span><small>应聘职位</small><strong>{job?.title}</strong></span>
        <span><small>简历来源</small><strong>{candidate.source}</strong></span>
        <span><small>投递时间</small><strong>{candidate.appliedAt}</strong></span>
        <span className="drawer-owner"><span className="avatar avatar-xs avatar-warm">{candidate.owner.slice(-1)}</span>{candidate.owner}</span>
      </div>
      <div className="drawer-tabs">
        <button className={cn(tab === 'overview' && 'active')} onClick={() => setTab('overview')}>候选人概览</button>
        <button className={cn(tab === 'resume' && 'active')} onClick={() => setTab('resume')}>简历详情</button>
        <button className={cn(tab === 'timeline' && 'active')} onClick={() => setTab('timeline')}>操作时间线 <span>{timeline.length}</span></button>
      </div>
      <div className="drawer-body">
        {tab === 'overview' && <>
          <section className="drawer-section">
            <div className="drawer-section-title"><h3>招聘进度</h3><div className="stage-action"><button className="text-button" onClick={() => setShowStageMenu(!showStageMenu)}>更新阶段 <ChevronDown size={14} /></button>{showStageMenu && <div className="stage-menu">{Object.entries(stageMeta).map(([key, meta]) => <button key={key} className={cn(candidate.stage === key && 'active')} onClick={() => moveTo(key as CandidateStage)}>{meta.label}{candidate.stage === key && <Check size={14} />}</button>)}</div>}</div></div>
            <div className="stage-progress">
              {(['new', 'screening', 'interview', 'offer', 'hired'] as CandidateStage[]).map((key, index) => {
                const activeIndex = ['new', 'screening', 'interview', 'offer', 'hired'].indexOf(candidate.stage)
                const complete = index < activeIndex || candidate.stage === 'hired'
                const active = key === candidate.stage
                return <div className={cn('stage-progress-item', complete && 'complete', active && 'active')} key={key}><span>{complete ? <Check size={13} /> : index + 1}</span><strong>{stageMeta[key].label}</strong>{index < 4 && <i />}</div>
              })}
            </div>
          </section>
          <section className="drawer-section">
            <div className="drawer-section-title"><h3>候选人信息</h3><button className="text-button">编辑</button></div>
            <div className="info-grid">
              <div><span>工作年限</span><strong>{candidate.experience}</strong></div><div><span>最高学历</span><strong>{candidate.education}</strong></div><div><span>毕业院校</span><strong>{candidate.school}</strong></div><div><span>当前公司</span><strong>{candidate.currentCompany}</strong></div>
            </div>
            <div className="tag-row drawer-tags">{candidate.tags.map(tag => <span key={tag}>{tag}</span>)}<button><Plus size={13} />添加标签</button></div>
          </section>
          <section className="drawer-section">
            <div className="drawer-section-title"><h3>简历摘要</h3><span className="subtle-label">系统提取</span></div>
            <p className="resume-summary">{candidate.summary}</p>
            <button className="resume-file" onClick={() => setTab('resume')}><span><FileText size={19} /></span><div><strong>{candidate.resumeName}</strong><small>PDF · 1.8 MB · 附件简历</small></div><ExternalLink size={15} /></button>
          </section>
          <section className="drawer-section">
            <div className="drawer-section-title"><h3>工作经历</h3></div>
            <div className="work-timeline">{candidate.workHistory.map((work, i) => <div className="work-item" key={i}><span className={cn('work-dot', i === 0 && 'current')} /><div><strong>{work.company}</strong><span>{work.title}</span><small>{work.period}</small></div></div>)}</div>
          </section>
          <section className="drawer-section">
            <div className="drawer-section-title"><h3>面试记录</h3><button className="text-button" onClick={() => onSchedule(candidate)}><Plus size={14} />添加</button></div>
            {interviews.length > 0 ? <div className="drawer-interviews">{interviews.map(interview => <div key={interview.id}><span className="interview-round">{interview.round.split(' · ')[0]}</span><div><strong>{interview.round}</strong><span>{interview.date} {interview.start} · {interview.interviewers.join('、')}</span></div><span className={cn('mini-status', interview.status)}>{interview.status === 'completed' ? '已完成' : interview.status === 'pending_feedback' ? '待反馈' : '待进行'}</span></div>)}</div> : <div className="empty-inline">暂无面试记录</div>}
          </section>
          <section className="drawer-note"><div className="drawer-section-title"><h3>招聘备注</h3><button className="text-button">编辑</button></div><p>{candidate.note || '暂无备注。记录候选人的沟通要点、期望与风险，让团队协作更顺畅。'}</p></section>
        </>}
        {tab === 'resume' && <ResumeTab candidate={candidate} />}
        {tab === 'timeline' && <TimelineTab entries={timeline} loading={timelineLoading} />}
      </div>
    </aside>
  </>
}

function ResumeTab({ candidate }: { candidate: Candidate }) {
  return <div className="resume-tab">
    <div className="resume-toolbar"><span><FileText size={17} />{candidate.resumeName}</span><div><button className="button button-secondary button-sm"><Download size={15} />下载</button><button className="button button-primary button-sm"><ExternalLink size={15} />新窗口打开</button></div></div>
    <div className="resume-paper">
      <div className="resume-paper-head"><div><h2>{candidate.name}</h2><p>{candidate.currentTitle} · {candidate.experience}工作经验</p></div><div>{candidate.phone}<br />{candidate.email}</div></div>
      <hr /><h3>个人简介</h3><p>{candidate.summary}</p><h3>工作经历</h3>{candidate.workHistory.map((work, i) => <div className="resume-work" key={i}><div><strong>{work.company}</strong><span>{work.period}</span></div><p>{work.title}</p><ul><li>负责核心业务系统的设计、开发与持续优化，保障项目按期高质量交付。</li><li>参与跨部门协作与技术方案评审，推动关键业务指标持续提升。</li></ul></div>)}<h3>教育经历</h3><div className="resume-education"><strong>{candidate.school}</strong><span>{candidate.education}</span></div>
    </div>
  </div>
}

function TimelineTab({ entries, loading }: { entries: CandidateTimelineEvent[]; loading: boolean }) {
  const messageFor = (entry: CandidateTimelineEvent) => {
    const payload = entry.payload || {}
    if (entry.action === 'candidate.created') {
      const stage = typeof payload.stage === 'string' ? stageMeta[payload.stage as CandidateStage]?.label : undefined
      return stage ? `候选人已创建，当前阶段为「${stage}」。` : '候选人档案已创建。'
    }
    if (entry.action === 'candidate.stage_changed') {
      const from = typeof payload.from === 'string' ? stageMeta[payload.from as CandidateStage]?.label : undefined
      const to = typeof payload.to === 'string' ? stageMeta[payload.to as CandidateStage]?.label : undefined
      return `阶段从「${from || '未知'}」更新为「${to || '未知'}」。`
    }
    return entry.action
  }
  return <div className="comms-list">
    {loading && <div className="empty-inline">正在加载操作时间线…</div>}
    {!loading && entries.length === 0 && <div className="empty-inline">暂无操作记录</div>}
    {entries.map((entry) => <div className="comm-item" key={entry.id}><span className="system-log-icon"><Clock3 size={15} /></span><div><div className="comm-head"><strong>{entry.actor}</strong><span>{new Date(entry.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</span></div><p>{messageFor(entry)}</p></div></div>)}
  </div>
}

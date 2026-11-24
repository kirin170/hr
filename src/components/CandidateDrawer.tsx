import { OnboardingPanel } from './OnboardingPanel'
import { OfferPanel } from './OfferPanel'
import { ArrowLeft, BriefcaseBusiness, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronRight, Clock3, Download, ExternalLink, FileText, Mail, MapPin, MessageSquare, MoreHorizontal, Phone, Plus, Star, UserRound, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getCandidate, getCandidateDepartment, getCandidateJob } from '../data'
import { activateCandidateFromPool, getCandidateDetail, getCandidatePoolHistory, getCandidateTimeline, listJobs, recordDepartmentScreening, setCandidateLockedState, undoCandidateStage, updateCandidateStage } from '../api'
import { useApp } from '../context'
import type { Candidate, CandidateMainStage, CandidatePoolHistoryEntry, CandidateStage, CandidateTimelineEvent, JobListItem } from '../types'
import { cn, stageMeta } from '../utils'
import { StageBadge } from '../pages/Candidates'

export function CandidateDrawer({ candidateId, onClose, onSchedule }: { candidateId: string; onClose: () => void; onSchedule: (candidate: Candidate) => void }) {
  const { data, setData, toast } = useApp()
  const candidateFromList = getCandidate(data, candidateId)
  const [detailCandidate, setDetailCandidate] = useState<Candidate | null>(null)
  const [timeline, setTimeline] = useState<CandidateTimelineEvent[]>([])
  const [timelineLoading, setTimelineLoading] = useState(true)
  const [tab, setTab] = useState<'overview' | 'resume' | 'timeline'>('overview')
  const [showStageMenu, setShowStageMenu] = useState(false)
  const [screeningResult, setScreeningResult] = useState<'PASS' | 'HOLD' | 'REJECT'>('PASS')
  const [screeningReason, setScreeningReason] = useState('')
  const [availabilitySlots, setAvailabilitySlots] = useState([{ startAt: '', endAt: '' }])
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [archiveReason, setArchiveReason] = useState('')
  const [activateOpen, setActivateOpen] = useState(false)
  const [activateJobId, setActivateJobId] = useState('')
  const [activateJobs, setActivateJobs] = useState<JobListItem[]>([])
  const [poolHistory, setPoolHistory] = useState<CandidatePoolHistoryEntry[]>([])
  useEffect(() => {
    setScreeningResult('PASS')
    setScreeningReason('')
    setAvailabilitySlots([{ startAt: '', endAt: '' }])
    setArchiveOpen(false)
    setArchiveReason('')
    setActivateOpen(false)
  }, [candidateId])
  // 人才库历史随详情一起刷新：激活/重复归档后仍展示全部归档与激活记录
  const refreshPoolHistory = (id: string) => getCandidatePoolHistory(id)
    .then((result) => setPoolHistory(result.items))
    .catch(() => setPoolHistory([]))
  useEffect(() => {
    let active = true
    setDetailCandidate(null)
    setTimeline([])
    setPoolHistory([])
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
    getCandidatePoolHistory(candidateId).then((result) => {
      if (active) setPoolHistory(result.items)
    }).catch(() => {
      if (active) setPoolHistory([])
    })
    return () => { active = false }
  }, [candidateId, toast])
  // 服务端详情是权威值：全局 store 里的列表副本可能停留在批量动作之前，
  // 只能用于详情返回前的首屏兜底，不能覆盖已返回的详情，否则阶段徽标与
  // 阶段动作菜单会按旧阶段计算，正确的下一步动作不可选。（ATS-012）
  const candidate = detailCandidate?.id === candidateId
    ? { ...candidateFromList, ...detailCandidate }
    : candidateFromList
  if (!candidate) return null
  const job = getCandidateJob(candidate)
  const department = getCandidateDepartment(candidate)
  const interviews = data.interviews.filter(interview => interview.candidateId === candidate.id && interview.status !== 'cancelled')

  const applyCandidateUpdate = (updated: Candidate) => {
    setDetailCandidate(updated)
    setData((current) => ({ ...current, candidates: current.candidates.map((item) => item.id === updated.id ? { ...item, ...updated } : item) }))
  }

  const moveTo = async (stage: CandidateMainStage) => {
    if (stage === candidate.stage) return
    try {
      const updated = await updateCandidateStage(candidate.id, stage)
      applyCandidateUpdate(updated)
      setShowStageMenu(false)
      toast(`已推进至「${stageMeta[stage].label}」`)
    } catch (error) {
      toast(error instanceof Error ? error.message : '阶段更新失败', 'info')
    }
  }

  // 归档：原因可选（未填写档），归档后自动入池并保留本次归档记录
  const submitArchive = async () => {
    try {
      const reason = archiveReason.trim()
      const updated = await updateCandidateStage(candidate.id, 'ARCHIVED', reason || undefined)
      applyCandidateUpdate(updated)
      setShowStageMenu(false)
      setArchiveOpen(false)
      setArchiveReason('')
      setTimeline(await getCandidateTimeline(candidate.id))
      refreshPoolHistory(candidate.id)
      toast(reason ? '候选人已归档并进入人才库' : '候选人已归档并进入人才库（归档原因未填写）')
    } catch (error) {
      toast(error instanceof Error ? error.message : '归档失败', 'info')
    }
  }

  // 激活：选择职位回流至 RECOMMENDED，归档记录与激活时间全部保留
  const openActivate = async () => {
    setActivateOpen(true)
    if (activateJobs.length) return
    try {
      const items = await listJobs({ status: 'ACTIVE', isVirtual: 'false', pageSize: 100 })
      setActivateJobs(items)
      setActivateJobId((current) => current || items[0]?.id || '')
    } catch (error) {
      toast(error instanceof Error ? error.message : '职位列表加载失败', 'info')
    }
  }

  const submitActivate = async () => {
    if (!activateJobId) return
    try {
      const updated = await activateCandidateFromPool(candidate.id, activateJobId)
      applyCandidateUpdate(updated)
      setActivateOpen(false)
      setTimeline(await getCandidateTimeline(candidate.id))
      refreshPoolHistory(candidate.id)
      toast('候选人已从人才库激活至人才推荐')
    } catch (error) {
      toast(error instanceof Error ? error.message : '人才库激活失败', 'info')
    }
  }

  const recordScreening = async () => {
    try {
      if (screeningResult === 'PASS' && !screeningReason.trim()) {
        throw new Error('部门筛选通过时必须填写筛选原因')
      }
      if (screeningResult === 'PASS' && availabilitySlots.some((slot) => !slot.startAt || !slot.endAt)) {
        throw new Error('请补齐所有可约面时间段的开始和结束时间')
      }
      const submittedSlots = screeningResult === 'PASS'
        ? availabilitySlots.map((slot) => ({ startAt: new Date(slot.startAt).toISOString(), endAt: new Date(slot.endAt).toISOString() }))
        : undefined
      const updated = await recordDepartmentScreening(candidate.id, { result: screeningResult, reason: screeningReason, availabilitySlots: submittedSlots })
      applyCandidateUpdate(updated)
      setTimeline(await getCandidateTimeline(candidate.id))
      toast(screeningResult === 'PASS' ? '部门筛选通过，候选人已进入面试阶段' : '部门筛选结论已记录')
    } catch (error) {
      toast(error instanceof Error ? error.message : '部门筛选记录失败', 'info')
    }
  }

  const toggleLock = async () => {
    try {
      const nextState = candidate.lockedState === 'INOPERABLE' ? 'OPERABLE' : 'INOPERABLE'
      applyCandidateUpdate(await setCandidateLockedState(candidate.id, nextState))
      toast(nextState === 'INOPERABLE' ? '候选人已锁定为不可操作' : '候选人已恢复可操作')
    } catch (error) {
      toast(error instanceof Error ? error.message : '锁定状态更新失败', 'info')
    }
  }

  const undoStage = async () => {
    try {
      applyCandidateUpdate(await undoCandidateStage(candidate.id))
      setTimeline(await getCandidateTimeline(candidate.id))
      toast('最近一次阶段动作已撤销')
    } catch (error) {
      toast(error instanceof Error ? error.message : '撤销阶段动作失败', 'info')
    }
  }

  const nextStage: Partial<Record<CandidateStage, CandidateMainStage>> = {
    RECOMMENDED: 'HR_SCREENING',
    HR_SCREENING: 'DEPT_SCREENING',
    INTERVIEWING: 'OFFERING',
    ONBOARDED: 'PROBATION',
  }
  const next = nextStage[candidate.stage as CandidateStage]
  const mainStages: CandidateMainStage[] = ['RECOMMENDED', 'HR_SCREENING', 'DEPT_SCREENING', 'INTERVIEWING', 'OFFERING', 'PENDING_ONBOARD', 'ONBOARDED', 'PROBATION', 'ENDED']
  const activeIndex = mainStages.indexOf(candidate.stage as CandidateMainStage)
  const isOperable = candidate.lockedState !== 'INOPERABLE'

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
            <div className="drawer-section-title"><h3>招聘进度</h3><div className="stage-action"><button className="text-button" disabled={!isOperable} onClick={() => setShowStageMenu(!showStageMenu)}>阶段动作 <ChevronDown size={14} /></button>{showStageMenu && <div className="stage-menu">{next && <button disabled={!isOperable} onClick={() => moveTo(next)}>推进至「{stageMeta[next].label}」</button>}{!['ARCHIVED', 'OFFERING', 'PENDING_ONBOARD'].includes(candidate.stage) && <button disabled={!isOperable} onClick={() => { setShowStageMenu(false); setArchiveOpen(true) }}>归档</button>}{candidate.stage === 'ARCHIVED' && <button disabled={!isOperable} onClick={() => { setShowStageMenu(false); void openActivate() }}>从人才库激活</button>}{candidate.stage === 'OFFERING' && <small>请在 Offer 协同中记录发送、接受及入职日期后推进待入职。</small>}</div>}</div></div>
            {archiveOpen && <div className="candidate-screening-form"><h4>归档至人才库</h4><label>归档原因（可选，未填写记为「未填写档」）<textarea value={archiveReason} onChange={(event) => setArchiveReason(event.target.value)} placeholder="如：薪资未谈拢、暂不匹配等" /></label><div className="candidate-stage-tools"><button className="button button-secondary button-sm" onClick={() => setArchiveOpen(false)}>取消</button><button className="button button-primary button-sm" disabled={!isOperable} onClick={submitArchive}>确认归档</button></div></div>}
            {activateOpen && <div className="candidate-screening-form"><h4>从人才库激活</h4><label>目标职位<select value={activateJobId} onChange={(event) => setActivateJobId(event.target.value)}>{activateJobs.map((job) => <option key={job.id} value={job.id}>{job.title} · {job.departmentId || '部门待补充'}</option>)}</select></label><p className="hint">激活后进入「人才推荐」，原归档记录与原因全部保留。</p><div className="candidate-stage-tools"><button className="button button-secondary button-sm" onClick={() => setActivateOpen(false)}>取消</button><button className="button button-primary button-sm" disabled={!activateJobId} onClick={submitActivate}>确认激活</button></div></div>}
            <div className="stage-progress">
              {mainStages.map((key, index) => {
                const complete = activeIndex >= 0 && index < activeIndex
                const active = key === candidate.stage
                return <div className={cn('stage-progress-item', complete && 'complete', active && 'active')} key={key}><span>{complete ? <Check size={13} /> : index + 1}</span><strong>{stageMeta[key].label}</strong>{index < 8 && <i />}</div>
              })}
            </div>
            {candidate.stage === 'DEPT_SCREENING' && <div className="candidate-screening-form"><h4>记录用人部门筛选</h4><label>结论<select value={screeningResult} onChange={(event) => setScreeningResult(event.target.value as 'PASS' | 'HOLD' | 'REJECT')}><option value="PASS">通过</option><option value="HOLD">待定</option><option value="REJECT">淘汰</option></select></label><label>筛选原因{screeningResult === 'PASS' && <strong>（必填）</strong>}<textarea value={screeningReason} onChange={(event) => setScreeningReason(event.target.value)} /></label>{screeningResult === 'PASS' && <div className="candidate-availability"><strong>可约面时间段</strong>{availabilitySlots.map((slot, index) => <div className="candidate-availability-row" key={index}><label>开始时间<input type="datetime-local" value={slot.startAt} onChange={(event) => setAvailabilitySlots((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, startAt: event.target.value } : item))} /></label><label>结束时间<input type="datetime-local" value={slot.endAt} onChange={(event) => setAvailabilitySlots((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, endAt: event.target.value } : item))} /></label><button className="icon-button" type="button" title="移除此时间段" aria-label="移除此时间段" disabled={availabilitySlots.length === 1} onClick={() => setAvailabilitySlots((current) => current.filter((_, itemIndex) => itemIndex !== index))}><X size={14} /></button></div>)}<button className="text-button" type="button" onClick={() => setAvailabilitySlots((current) => [...current, { startAt: '', endAt: '' }])}><Plus size={14} />添加可约时间段</button></div>}<button className="button button-primary button-sm" disabled={!isOperable} onClick={recordScreening}>保存筛选结论</button></div>}
            <div className="candidate-stage-tools"><button className="text-button" disabled={!isOperable} onClick={undoStage}>撤销最近阶段动作</button><button className="text-button" onClick={toggleLock}>{candidate.lockedState === 'INOPERABLE' ? '恢复为可操作' : '锁定为不可操作'}</button>{candidate.lockedState === 'INOPERABLE' && <span className="locked-indicator">不可操作已锁定</span>}</div>
          </section>
          {['PENDING_ONBOARD', 'PROBATION', 'ENDED'].includes(candidate.stage) && <OnboardingPanel candidate={candidate} onChanged={(updated) => { applyCandidateUpdate(updated); void getCandidateTimeline(candidate.id).then(setTimeline); void refreshPoolHistory(candidate.id) }} />}
          {candidate.stage === 'OFFERING' && <OfferPanel candidateId={candidate.id} onChanged={() => { void getCandidateDetail(candidate.id).then(applyCandidateUpdate); void getCandidateTimeline(candidate.id).then(setTimeline) }} />}
          <section className="drawer-section">
            <div className="drawer-section-title"><h3>候选人信息</h3><button className="text-button">编辑</button></div>
            <div className="info-grid">
              <div><span>工作年限</span><strong>{candidate.experience}</strong></div><div><span>最高学历</span><strong>{candidate.education}</strong></div><div><span>毕业院校</span><strong>{candidate.school}</strong></div><div><span>当前公司</span><strong>{candidate.currentCompany}</strong></div>
            </div>
            <div className="tag-row drawer-tags">{candidate.tags.map(tag => <span key={tag}>{tag}</span>)}<button><Plus size={13} />添加标签</button></div>
          </section>
          {poolHistory.length > 0 && <section className="drawer-section">
            <div className="drawer-section-title"><h3>人才库历史</h3><span className="subtle-label">{poolHistory.length} 次归档</span></div>
            <div className="work-timeline">{poolHistory.map((entry) => <div className="work-item" key={entry.id}><span className={cn('work-dot', !entry.reactivatedAt && 'current')} /><div><strong>{entry.reasonMissing ? '归档原因未填写' : entry.reasonText || entry.reasonId || '归档入池'}</strong><span>归档于 {new Date(entry.archivedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} · 来源阶段 <StageBadge stage={entry.sourceStage as Candidate['stage']} /></span><small>{entry.reactivatedAt ? `已于 ${new Date(entry.reactivatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} 激活回流` : '仍在人才库'}</small></div></div>)}</div>
          </section>}
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
      if (payload.action === 'ASSIGN_JOB') {
        const jobTitle = typeof payload.jobTitle === 'string' ? payload.jobTitle : '目标职位'
        return `已分配至「${jobTitle}」，候选人进入人才推荐。`
      }
      const reason = typeof payload.reason === 'string' && payload.reason.trim() ? `原因：${payload.reason}` : ''
      return `阶段从「${from || '未知'}」更新为「${to || '未知'}」。${reason}`
    }
    if (entry.action === 'candidate.department_screening_recorded') {
      const resultLabels: Record<string, string> = { PASS: '通过', HOLD: '待定', REJECT: '淘汰' }
      const result = typeof payload.result === 'string' ? resultLabels[payload.result] ?? payload.result : '未知'
      const reason = typeof payload.reason === 'string' && payload.reason.trim() ? `原因：${payload.reason}` : ''
      const slotCount = Array.isArray(payload.availabilitySlots) ? payload.availabilitySlots.length : 0
      const slots = slotCount ? `已记录 ${slotCount} 个可约面时间段。` : ''
      return `用人部门筛选：${result}。${reason}${slots}`
    }
    if (entry.action === 'candidate.stage_reverted') {
      const from = typeof payload.from === 'string' ? stageMeta[payload.from as CandidateStage]?.label : undefined
      const to = typeof payload.to === 'string' ? stageMeta[payload.to as CandidateStage]?.label : undefined
      return `撤销阶段动作，阶段从「${from || '未知'}」恢复为「${to || '未知'}」。`
    }
    if (entry.action === 'candidate.lock_changed') {
      return payload.to === 'INOPERABLE' ? '候选人已锁定为不可操作。' : '候选人已恢复为可操作。'
    }
    if (entry.action === 'candidate.tags_changed') {
      const added = Array.isArray(payload.added) ? payload.added.filter((tag): tag is string => typeof tag === 'string') : []
      const removed = Array.isArray(payload.removed) ? payload.removed.filter((tag): tag is string => typeof tag === 'string') : []
      const changes = [added.length ? `添加：${added.join('、')}` : '', removed.length ? `移除：${removed.join('、')}` : ''].filter(Boolean)
      return changes.length ? `候选人标签已更新（${changes.join('；')}）。` : '候选人标签已更新。'
    }
    return entry.action
  }
  return <div className="comms-list">
    {loading && <div className="empty-inline">正在加载操作时间线…</div>}
    {!loading && entries.length === 0 && <div className="empty-inline">暂无操作记录</div>}
    {entries.map((entry) => <div className="comm-item" key={entry.id}><span className="system-log-icon"><Clock3 size={15} /></span><div><div className="comm-head"><strong>{entry.actor}</strong><span>{new Date(entry.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</span></div><p>{messageFor(entry)}</p></div></div>)}
  </div>
}

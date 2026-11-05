import { ArrowLeft, BriefcaseBusiness, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronRight, Clock3, Download, ExternalLink, FileText, Mail, MapPin, MessageSquare, MoreHorizontal, Phone, Plus, Star, UserRound, X } from 'lucide-react'
import { useState } from 'react'
import { getCandidate, getDepartment, getJob } from '../data'
import { useApp } from '../context'
import type { Candidate, CandidateStage } from '../types'
import { cn, stageMeta } from '../utils'
import { StageBadge } from '../pages/Candidates'

export function CandidateDrawer({ candidateId, onClose, onSchedule }: { candidateId: string; onClose: () => void; onSchedule: (candidate: Candidate) => void }) {
  const { data, updateCandidate, toast } = useApp()
  const candidate = getCandidate(data, candidateId)
  const [tab, setTab] = useState<'overview' | 'resume' | 'timeline'>('overview')
  const [showStageMenu, setShowStageMenu] = useState(false)
  if (!candidate) return null
  const job = getJob(candidate.jobId)
  const department = getDepartment(candidate.departmentId)
  const interviews = data.interviews.filter(interview => interview.candidateId === candidate.id && interview.status !== 'cancelled')

  const moveTo = (stage: CandidateStage) => {
    updateCandidate(candidate.id, { stage, lastActivity: '刚刚' })
    setShowStageMenu(false)
    toast(`已推进至「${stageMeta[stage].label}」`)
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
        <button className={cn(tab === 'timeline' && 'active')} onClick={() => setTab('timeline')}>沟通记录 <span>3</span></button>
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
        {tab === 'timeline' && <TimelineTab />}
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

function TimelineTab() {
  return <div className="comms-list">
    <div className="comm-composer"><textarea placeholder="输入备注，或 @同事 协同处理…" /><div><button className="icon-button"><Plus size={17} /></button><span>支持输入 @ 提及同事</span><button className="button button-primary button-sm">发送</button></div></div>
    <div className="comm-item"><span className="avatar avatar-sm avatar-warm">邓</span><div><div className="comm-head"><strong>邓文文</strong><span>今天 09:42</span></div><p>已与候选人电话沟通，目前在看机会，期望薪资 35K 左右，可接受一周内到岗。</p></div></div>
    <div className="comm-item"><span className="avatar avatar-sm" style={{ background: '#6675E818', color: '#6675E8' }}>林夏</span><div><div className="comm-head"><strong>林夏</strong><span>昨天 16:18</span></div><p>技术初筛通过，基础扎实，项目复杂度符合岗位要求，建议安排技术二面。</p></div></div>
    <div className="comm-item"><span className="system-log-icon"><Clock3 size={15} /></span><div><div className="comm-head"><strong>系统</strong><span>11月3日 10:20</span></div><p>候选人从「筛选中」进入「面试中」。</p></div></div>
  </div>
}

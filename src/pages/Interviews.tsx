import { useMemo, useState } from 'react'
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Clock3, MapPin, MessageSquare, MoreHorizontal, Plus, Video, X } from 'lucide-react'
import { dateLabel, getCandidate, getJob, today, weekdayLabel } from '../data'
import { useApp } from '../context'
import type { Interview, InterviewStatus } from '../types'
import { cn, interviewModeLabel, interviewStatusMeta } from '../utils'

type InterviewsProps = { onOpenCandidate: (id: string) => void; openNew: number }

function addDays(date: string, amount: number) {
  const d = new Date(`${date}T00:00:00`)
  d.setDate(d.getDate() + amount)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function Interviews({ onOpenCandidate, openNew }: InterviewsProps) {
  const { data, updateInterview, toast } = useApp()
  const [selectedDate, setSelectedDate] = useState(today)
  const [view, setView] = useState<'day' | 'week'>('day')
  const [status, setStatus] = useState<InterviewStatus | 'all'>('all')
  const [showCreate, setShowCreate] = useState(openNew > 0)
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(today, i - 1))
  const interviews = useMemo(() => data.interviews.filter(item => {
    if (status !== 'all' && item.status !== status) return false
    return view === 'day' ? item.date === selectedDate : weekDates.includes(item.date)
  }).sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`)), [data.interviews, selectedDate, view, status])

  const markFeedback = (id: string) => {
    updateInterview(id, { status: 'completed', feedback: '面试反馈已提交。' })
    toast('面试反馈已记录')
  }

  return <div className="page-stack interviews-page">
    <div className="page-title-row">
      <div><div className="eyebrow">面试协同 <span className="eyebrow-separator">·</span> {data.interviews.filter(i => i.status === 'scheduled').length} 场待进行</div><h2>面试安排</h2><p>统一协调面试官与候选人时间，及时收集反馈。</p></div>
      <div className="page-title-actions"><button className="button button-secondary"><CalendarDays size={16} />同步日历</button><button className="button button-primary" onClick={() => setShowCreate(true)}><Plus size={17} />安排面试</button></div>
    </div>

    <div className="interview-summary-grid">
      <SummaryCard icon={<CalendarDays size={17} />} label="今日面试" value={data.interviews.filter(i => i.date === today && i.status === 'scheduled').length.toString()} note="较昨日 +2" tone="blue" />
      <SummaryCard icon={<Clock3 size={17} />} label="待反馈" value={data.interviews.filter(i => i.status === 'pending_feedback').length.toString()} note="需要及时跟进" tone="amber" />
      <SummaryCard icon={<Check size={17} />} label="本周已完成" value="34" note="完成率 92.6%" tone="green" />
      <SummaryCard icon={<MessageSquare size={17} />} label="平均反馈时长" value="6.4h" note="较上周 -1.2h" tone="violet" />
    </div>

    <div className="interview-layout">
      <div className="panel interview-main">
        <div className="interview-toolbar">
          <div className="date-navigator"><button className="icon-button icon-button-small" onClick={() => setSelectedDate(addDays(selectedDate, -1))}><ChevronLeft size={17} /></button><button className="date-title" onClick={() => setSelectedDate(today)}><strong>{selectedDate === today ? '今天' : dateLabel(selectedDate)}</strong><span>{selectedDate} · {weekdayLabel(selectedDate)}</span></button><button className="icon-button icon-button-small" onClick={() => setSelectedDate(addDays(selectedDate, 1))}><ChevronRight size={17} /></button></div>
          <div className="interview-toolbar-actions"><label className="filter-select mini"><select value={status} onChange={e => setStatus(e.target.value as typeof status)}><option value="all">全部状态</option><option value="scheduled">待进行</option><option value="pending_feedback">待反馈</option><option value="completed">已完成</option></select><ChevronDown size={13} /></label><div className="view-switch"><button className={cn(view === 'day' && 'active')} onClick={() => setView('day')}>日</button><button className={cn(view === 'week' && 'active')} onClick={() => setView('week')}>周</button></div></div>
        </div>
        {view === 'week' && <div className="week-strip">{weekDates.map(date => { const count = data.interviews.filter(i => i.date === date).length; return <button key={date} className={cn(selectedDate === date && 'active')} onClick={() => setSelectedDate(date)}><span>{weekdayLabel(date)}</span><strong>{Number(date.slice(-2))}</strong>{count > 0 && <i>{count}</i>}</button> })}</div>}
        <div className="interview-list">
          {interviews.map(interview => {
            const candidate = getCandidate(data, interview.candidateId)
            const job = getJob(interview.jobId)
            if (!candidate) return null
            const statusMeta = interviewStatusMeta[interview.status]
            return <div className="interview-card" key={interview.id}>
              <div className="interview-time"><strong>{interview.start}</strong><span>{interview.end}</span><i /></div>
              <button className="interview-candidate" onClick={() => onOpenCandidate(candidate.id)}><span className="avatar avatar-md" style={{background:`${candidate.avatarColor}18`,color:candidate.avatarColor}}>{candidate.name.slice(-2)}</span><span><strong>{candidate.name}<em className={cn('status-dot-label', statusMeta.tone)}>{statusMeta.label}</em></strong><small>{job?.title}</small></span></button>
              <div className="interview-detail"><strong>{interview.round}</strong><span>{interview.interviewers.join(' · ')}</span></div>
              <div className="interview-location"><span className={cn('mode-icon', interview.mode)}>{interview.mode === 'video' ? <Video size={15} /> : <MapPin size={15} />}</span><span><strong>{interviewModeLabel[interview.mode]}</strong><small>{interview.location}</small></span></div>
              <div className="interview-actions">{interview.status === 'pending_feedback' ? <button className="button button-secondary button-sm" onClick={() => markFeedback(interview.id)}>填写反馈</button> : <button className="icon-button"><MoreHorizontal size={18} /></button>}</div>
            </div>
          })}
          {interviews.length === 0 && <div className="empty-state interview-empty"><span><CalendarDays size={24} /></span><h4>这一天还没有面试</h4><p>安排一场面试，让候选人流程继续推进。</p><button className="button button-primary button-sm" onClick={() => setShowCreate(true)}><Plus size={15} />安排面试</button></div>}
        </div>
        <div className="interview-tip"><span className="tip-icon">i</span><span>面试开始前 30 分钟，系统会向面试官和候选人发送提醒。</span></div>
      </div>
      <aside className="interview-side">
        <div className="panel side-calendar">
          <div className="side-calendar-head"><strong>{today.slice(0,4)}年 {Number(today.slice(5,7))}月</strong><div><button className="icon-button icon-button-small"><ChevronLeft size={15} /></button><button className="icon-button icon-button-small"><ChevronRight size={15} /></button></div></div>
          <div className="calendar-weekdays">{['一','二','三','四','五','六','日'].map(d => <span key={d}>{d}</span>)}</div>
          <div className="calendar-days">{Array.from({length: 35}, (_, i) => { const day = i - 4; const active = day === Number(today.slice(-2)); const has = [1,3,5,6,10,12,18,20,24,26].includes(day); return <button key={i} className={cn(day < 1 || day > 30 ? 'muted' : '', active && 'active', has && 'has-event')} onClick={() => setSelectedDate(`${today.slice(0,8)}${String(Math.max(1, day)).padStart(2,'0')}`)}>{day < 1 ? 31 + day : day > 30 ? day - 30 : day}</button> })}</div>
        </div>
        <div className="panel interviewer-panel">
          <div className="panel-header"><div><h3>面试官负载</h3><p>本周面试场次</p></div></div>
          {[{name:'陈屿', job:'研发负责人', count:8, color:'#4D91D9'}, {name:'林夏', job:'招聘负责人', count:6, color:'#D58A28'}, {name:'周宁', job:'产品负责人', count:5, color:'#E27D62'}, {name:'苏嘉', job:'增长负责人', count:4, color:'#19A77C'}].map(person => <div className="load-row" key={person.name}><span className="avatar avatar-sm" style={{background:`${person.color}18`,color:person.color}}>{person.name.slice(-1)}</span><div><strong>{person.name}</strong><span>{person.job}</span></div><div className="load-bar"><span><i style={{width:`${person.count * 10}%`,background:person.color}} /></span><small>{person.count} 场</small></div></div>)}
        </div>
        <div className="panel quick-panel"><h3>面试小贴士</h3><p>面试结束后 24 小时内提交反馈，有助于团队更快做出决策。</p><button className="text-button">查看面试规范 <ChevronRight size={14} /></button></div>
      </aside>
    </div>
    {showCreate && <InterviewModal onClose={() => setShowCreate(false)} />}
  </div>
}

function SummaryCard({icon,label,value,note,tone}:{icon:React.ReactNode;label:string;value:string;note:string;tone:string}) {
  return <div className="summary-card"><span className={cn('summary-icon', tone)}>{icon}</span><div><span>{label}</span><strong>{value}</strong><small>{note}</small></div></div>
}

export function InterviewModal({onClose, initialCandidate}: {onClose:()=>void; initialCandidate?: string}) {
  const { data, addInterview, toast } = useApp()
  const [candidateId, setCandidateId] = useState(initialCandidate || data.candidates.find(c => !['hired','rejected'].includes(c.stage))?.id || '')
  const [round, setRound] = useState('一面 · 技术面试')
  const [date, setDate] = useState(today)
  const [start, setStart] = useState('10:00')
  const [end, setEnd] = useState('11:00')
  const [interviewer, setInterviewer] = useState('陈屿')
  const [mode, setMode] = useState<'video'|'onsite'|'phone'>('video')
  const [location, setLocation] = useState('飞书会议 · 待生成')
  const candidate = getCandidate(data, candidateId)
  const submit = () => {
    if (!candidate) { toast('请选择候选人', 'info'); return }
    const interview: Interview = { id: `i-${Date.now()}`, candidateId, jobId: candidate.jobId, round, type: '专业面试', date, start, end, interviewers: interviewer.split(/[、,，]/).filter(Boolean), location, mode, status: 'scheduled' }
    addInterview(interview)
    toast('面试已安排')
    onClose()
  }
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal interview-modal" onMouseDown={e => e.stopPropagation()}>
    <div className="modal-header"><div><span className="modal-icon"><CalendarDays size={18} /></span><div><h3>安排面试</h3><p>为候选人协调下一轮面试</p></div></div><button className="icon-button" onClick={onClose}><X size={18} /></button></div>
    <div className="modal-body">
      <label className="form-field"><span>候选人 <em>*</em></span><select value={candidateId} onChange={e => setCandidateId(e.target.value)}>{data.candidates.filter(c => !['hired','rejected'].includes(c.stage)).map(c => <option key={c.id} value={c.id}>{c.name} · {getJob(c.jobId)?.title}</option>)}</select></label>
      <div className="form-grid"><label className="form-field"><span>面试轮次</span><select value={round} onChange={e => setRound(e.target.value)}><option>一面 · 技术面试</option><option>二面 · 技术复试</option><option>三面 · 业务面试</option><option>终面 · 综合面试</option></select></label><label className="form-field"><span>面试形式</span><select value={mode} onChange={e => { const v=e.target.value as typeof mode; setMode(v); setLocation(v === 'video' ? '飞书会议 · 待生成' : v === 'onsite' ? '3F · 海棠会议室' : '电话面试') }}><option value="video">视频面试</option><option value="onsite">现场面试</option><option value="phone">电话面试</option></select></label></div>
      <div className="form-grid"><label className="form-field"><span>日期</span><input type="date" value={date} onChange={e => setDate(e.target.value)} /></label><div className="time-fields"><label className="form-field"><span>开始时间</span><input type="time" value={start} onChange={e => setStart(e.target.value)} /></label><span>-</span><label className="form-field"><span>结束时间</span><input type="time" value={end} onChange={e => setEnd(e.target.value)} /></label></div></div>
      <label className="form-field"><span>面试官 <small>多人用顿号分隔</small></span><input value={interviewer} onChange={e => setInterviewer(e.target.value)} placeholder="例如：陈屿、林夏" /></label>
      <label className="form-field"><span>地点 / 会议链接</span><input value={location} onChange={e => setLocation(e.target.value)} /></label>
      <div className="form-notice"><CalendarDays size={15} /><span>安排后将向面试官发送日历邀请，候选人确认状态会同步到流程中。</span></div>
    </div>
    <div className="modal-footer"><button className="button button-secondary" onClick={onClose}>取消</button><button className="button button-primary" onClick={submit}><Check size={16} />确认安排</button></div>
  </div></div>
}

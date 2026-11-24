import { useMemo, useState } from 'react'
import { ChevronDown, Filter, MoreHorizontal, Plus, Search, Users, X } from 'lucide-react'
import { departments, getCandidateDepartment, getCandidateJob, getDepartment, getJob, jobs } from '../data'
import { useApp } from '../context'
import type { CandidateStage } from '../types'
import { cn } from '../utils'
import { StageBadge } from './Candidates'

type PipelineProps = { onOpenCandidate: (id: string) => void; onAddCandidate: () => void }

const columns: { key: CandidateStage; title: string; color: string }[] = [
  { key: 'RECOMMENDED', title: '人才推荐', color: '#6E83E9' },
  { key: 'HR_SCREENING', title: '初筛', color: '#E4A03D' },
  { key: 'DEPT_SCREENING', title: '部门筛选', color: '#D58A28' },
  { key: 'INTERVIEWING', title: '面试', color: '#9A72DE' },
  { key: 'OFFERING', title: '沟通 Offer', color: '#E47D59' },
  { key: 'PENDING_ONBOARD', title: '待入职', color: '#DB8A4C' },
  { key: 'ONBOARDED', title: '已入职', color: '#22A97B' },
  { key: 'PROBATION', title: '试用期', color: '#31A783' },
  { key: 'ENDED', title: '结束', color: '#667085' },
]

export function Pipeline({ onOpenCandidate, onAddCandidate }: PipelineProps) {
  const { data, apiJobs } = useApp()
  const [department, setDepartment] = useState('all')
  const [job, setJob] = useState('all')
  const [search, setSearch] = useState('')
  const [view, setView] = useState<'kanban' | 'table'>('kanban')

  const departmentFilters = Array.from(new Set([
    ...departments.map(item => item.id),
    ...apiJobs.map(item => item.departmentId),
    ...data.candidates.map(item => item.departmentId),
  ].filter(Boolean))).map(value => ({
    value,
    label: getDepartment(value)?.name
      || apiJobs.find((item) => item.departmentId === value)?.departmentName
      || data.candidates.find((item) => item.departmentId === value && item.departmentName)?.departmentName
      || '部门待补充',
  }))
  const jobFilters = Array.from(new Map([
    ...jobs.map(item => [item.id, item.title] as const),
    ...apiJobs.map(item => [item.id, item.title] as const),
    ...data.candidates.filter(item => item.jobId).map(item => [item.jobId, item.jobTitle || item.jobId] as const),
  ]).entries()).map(([value, label]) => ({ value, label }))

  const filtered = useMemo(() => data.candidates.filter(candidate => {
    if (!columns.some((column) => column.key === candidate.stage)) return false
    if (department !== 'all' && candidate.departmentId !== department) return false
    if (job !== 'all' && candidate.jobId !== job) return false
    if (search && !`${candidate.name}${candidate.currentCompany}${candidate.currentTitle}`.toLowerCase().includes(search.toLowerCase())) return false
    return true
  }), [data.candidates, department, job, search])

  return <div className="page-stack pipeline-page">
    <div className="page-title-row">
      <div><div className="eyebrow">招聘流程 <span className="eyebrow-separator">·</span> 实时协同</div><h2>候选人流程</h2><p>阶段动作在候选人详情中明确执行并记录。</p></div>
      <div className="page-title-actions"><button className="button button-secondary"><Users size={16} />邀请协作</button><button className="button button-primary" onClick={onAddCandidate}><Plus size={17} />添加候选人</button></div>
    </div>
    <div className="pipeline-toolbar panel">
      <div className="pipeline-filters"><FilterSelectMini value={department} onChange={setDepartment} options={[{value:'all',label:'全部部门'}, ...departmentFilters]} /><FilterSelectMini value={job} onChange={setJob} options={[{value:'all',label:'全部职位'}, ...jobFilters]} /><label className="small-search"><Search size={15} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索候选人" />{search && <button onClick={() => setSearch('')}><X size={13} /></button>}</label></div>
      <div className="pipeline-toolbar-right"><div className="view-switch"><button className={cn(view === 'kanban' && 'active')} onClick={() => setView('kanban')}>看板</button><button className={cn(view === 'table' && 'active')} onClick={() => setView('table')}>列表</button></div><span className="result-count">{filtered.length} 位候选人</span></div>
    </div>
    {view === 'kanban' ? <div className="kanban-board">
      {columns.map(column => {
        const items = filtered.filter(candidate => candidate.stage === column.key)
        return <section className="kanban-column" key={column.key}>
          <header className="kanban-header"><div><i style={{background: column.color}} /><strong>{column.title}</strong><span>{items.length}</span></div><div><button className="icon-button icon-button-small"><MoreHorizontal size={16} /></button><button className="icon-button icon-button-small"><Plus size={16} /></button></div></header>
          <div className="kanban-list">
            {items.map(candidate => {
              const job = getCandidateJob(candidate)
              const department = getCandidateDepartment(candidate)
              return <button className="kanban-card" key={candidate.id} onClick={() => onOpenCandidate(candidate.id)}>
                <div className="kanban-card-top"><span className="avatar avatar-sm" style={{background: `${candidate.avatarColor}18`, color: candidate.avatarColor}}>{candidate.name.slice(-2)}</span><span className="kanban-name">{candidate.name}</span><span className="kanban-salary">{candidate.experience}</span></div>
                <p>{candidate.currentTitle} · {candidate.currentCompany}</p>
                <div className="kanban-job"><span className="department-dot" style={{background: department?.color}} />{job?.title}</div>
                <div className="kanban-tags">{candidate.tags.slice(0,2).map(tag => <span key={tag}>{tag}</span>)}</div>
                <div className="kanban-footer"><span className={cn('kanban-source', candidate.source === '内部推荐' && 'referral')}>{candidate.source}</span><span className="kanban-user"><span className="avatar avatar-xs avatar-warm">{candidate.owner.slice(-1)}</span>{candidate.owner}</span></div>
              </button>
            })}
            {items.length === 0 && <div className="kanban-empty">暂无候选人</div>}
          </div>
        </section>
      })}
    </div> : <div className="panel pipeline-table-panel"><table className="candidate-table"><thead><tr><th>候选人</th><th>应聘职位</th><th>当前阶段</th><th>负责人</th><th>最近动态</th></tr></thead><tbody>{filtered.map(candidate => { const job = getCandidateJob(candidate); return <tr key={candidate.id} onClick={() => onOpenCandidate(candidate.id)}><td><span className="candidate-cell"><span className="avatar avatar-sm" style={{background:`${candidate.avatarColor}18`,color:candidate.avatarColor}}>{candidate.name.slice(-2)}</span><span><strong>{candidate.name}</strong><small>{candidate.currentCompany}</small></span></span></td><td>{job?.title || '待分配'}</td><td><StageBadge stage={candidate.stage} /></td><td>{candidate.owner}</td><td>{candidate.lastActivity}</td></tr> })}</tbody></table></div>}
  </div>
}

function FilterSelectMini({ value, onChange, options }: {value:string; onChange:(v:string)=>void; options:{value:string;label:string}[]}) {
  return <label className="filter-select mini"><select value={value} onChange={e=>onChange(e.target.value)}>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select><ChevronDown size={13}/></label>
}

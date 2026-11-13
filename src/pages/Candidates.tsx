import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, BriefcaseBusiness, Check, ChevronDown, ChevronLeft, ChevronRight, Download, Filter, ListFilter, Mail, MapPin, MoreHorizontal, Phone, Plus, Search, SlidersHorizontal, Star, Upload, Users, X } from 'lucide-react'
import { departments, getCandidateDepartment, getCandidateJob, getDepartment, getJob, jobs } from '../data'
import { useApp } from '../context'
import type { Candidate, CandidateStage } from '../types'
import { cn, stageMeta } from '../utils'

type CandidatesProps = { search: string; onOpenCandidate: (id: string) => void; onAddCandidate: () => void }

const stageOrder: CandidateStage[] = ['new', 'screening', 'interview', 'offer', 'hired', 'rejected']
const PAGE_SIZE = 7

export function Candidates({ search, onOpenCandidate, onAddCandidate }: CandidatesProps) {
  const { data, candidatesLoading, candidatesError, apiJobs } = useApp()
  const [stage, setStage] = useState<CandidateStage | 'all'>('all')
  const [department, setDepartment] = useState('all')
  const [job, setJob] = useState('all')
  const [source, setSource] = useState('all')
  const [sort, setSort] = useState('latest')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<string[]>([])
  const [view, setView] = useState<'list' | 'cards'>('list')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [quickSearch, setQuickSearch] = useState('')

  const sources = Array.from(new Set(data.candidates.map(c => c.source)))
  const jobFilters = Array.from(new Map([
    ...jobs.map(item => [item.id, item.title] as const),
    ...apiJobs.map(item => [item.id, item.title] as const),
    ...data.candidates.filter(item => item.jobId).map(item => [item.jobId, item.jobTitle || item.jobId] as const),
  ]).entries()).map(([value, label]) => ({ value, label }))
  const departmentIds = Array.from(new Set([
    ...departments.map(item => item.id),
    ...apiJobs.map(item => item.departmentId),
    ...data.candidates.map(item => item.departmentId),
  ].filter(Boolean)))
  const departmentFilters = departmentIds.map((value) => ({
    value,
    label: getDepartment(value)?.name || data.candidates.find(item => item.departmentId === value)?.departmentName || value,
  }))
  const filtered = useMemo(() => {
    const q = `${search} ${quickSearch}`.trim().toLowerCase()
    return data.candidates.filter((candidate) => {
      if (stage !== 'all' && candidate.stage !== stage) return false
      if (department !== 'all' && candidate.departmentId !== department) return false
      if (job !== 'all' && candidate.jobId !== job) return false
      if (source !== 'all' && candidate.source !== source) return false
      if (q && !`${candidate.name} ${candidate.currentCompany} ${candidate.currentTitle} ${candidate.tags.join(' ')} ${candidate.email}`.toLowerCase().includes(q)) return false
      return true
    }).sort((a, b) => sort === 'rating' ? b.rating - a.rating : b.appliedAt.localeCompare(a.appliedAt))
  }, [data.candidates, stage, department, job, source, search, quickSearch, sort])

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const activeFilterCount = [stage !== 'all', department !== 'all', job !== 'all', source !== 'all'].filter(Boolean).length

  const toggleSelect = (id: string) => setSelected(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id])
  const resetFilters = () => { setStage('all'); setDepartment('all'); setJob('all'); setSource('all'); setPage(1) }
  const selectAll = () => setSelected(visible.every(c => selected.includes(c.id)) ? selected.filter(id => !visible.some(c => c.id === id)) : [...new Set([...selected, ...visible.map(c => c.id)])])

  return (
    <div className="page-stack candidates-page">
      <div className="page-title-row">
        <div><div className="eyebrow">人才库 <span className="eyebrow-separator">·</span> {data.candidates.length} 位候选人</div><h2>简历库</h2><p>集中管理人才信息，让每一份简历都进入清晰的招聘流程。</p></div>
        <div className="page-title-actions">
          <button className="button button-secondary"><Upload size={16} />批量导入</button>
          <button className="button button-primary" onClick={onAddCandidate}><Plus size={17} />添加候选人</button>
        </div>
      </div>

      <div className="stage-tabs">
        <button className={cn('stage-tab', stage === 'all' && 'active')} onClick={() => { setStage('all'); setPage(1) }}>全部候选人 <span>{data.candidates.length}</span></button>
        {stageOrder.map((key) => <button key={key} className={cn('stage-tab', stage === key && 'active')} onClick={() => { setStage(key); setPage(1) }}>{stageMeta[key].label}<span>{data.candidates.filter(c => c.stage === key).length}</span></button>)}
      </div>

      {candidatesLoading && <div className="panel empty-inline">正在从 ATS 加载候选人…</div>}
      {candidatesError && <div className="panel empty-inline">候选人加载失败：{candidatesError} 刷新页面后重试。</div>}

      <div className="panel candidates-panel">
        <div className="candidate-toolbar">
          <label className="table-search"><Search size={16} /><input placeholder="搜索姓名、公司、职位或标签" value={quickSearch} onChange={e => { setQuickSearch(e.target.value); setPage(1) }} />{quickSearch && <button onClick={() => setQuickSearch('')}><X size={14} /></button>}</label>
          <button className={cn('filter-button', filtersOpen && 'active')} onClick={() => setFiltersOpen(!filtersOpen)}><SlidersHorizontal size={16} />筛选{activeFilterCount > 0 && <span>{activeFilterCount}</span>}<ChevronDown size={14} /></button>
          <div className="toolbar-divider" />
          <div className="view-switch"><button className={cn(view === 'list' && 'active')} onClick={() => setView('list')} title="列表视图"><ListFilter size={16} /></button><button className={cn(view === 'cards' && 'active')} onClick={() => setView('cards')} title="卡片视图"><div className="grid-view-icon"><i /><i /><i /><i /></div></button></div>
          <span className="result-count">{filtered.length} 条结果</span>
          <div className="toolbar-spacer" />
          <button className="text-button"><Download size={15} />导出</button>
          <label className="sort-select"><span>排序：</span><select value={sort} onChange={e => setSort(e.target.value)}><option value="latest">最近投递</option><option value="rating">评分最高</option></select><ChevronDown size={13} /></label>
        </div>

        {filtersOpen && <div className="filter-panel">
          <FilterSelect label="所属部门" value={department} onChange={value => { setDepartment(value); setPage(1) }} options={[{ value: 'all', label: '全部部门' }, ...departmentFilters]} />
          <FilterSelect label="应聘职位" value={job} onChange={value => { setJob(value); setPage(1) }} options={[{ value: 'all', label: '全部职位' }, ...jobFilters]} />
          <FilterSelect label="简历来源" value={source} onChange={value => { setSource(value); setPage(1) }} options={[{ value: 'all', label: '全部来源' }, ...sources.map(s => ({ value: s, label: s }))]} />
          <button className="reset-filter" onClick={resetFilters}>重置条件</button>
        </div>}

        {selected.length > 0 && <div className="bulk-bar"><span>已选择 <strong>{selected.length}</strong> 位候选人</span><button>批量推进</button><button>添加标签</button><button>发送邮件</button><button className="bulk-close" onClick={() => setSelected([])}><X size={15} /></button></div>}

        {view === 'list' ? <div className="candidate-table-wrap">
          <table className="candidate-table">
            <thead><tr>
              <th className="check-column"><input type="checkbox" checked={visible.length > 0 && visible.every(c => selected.includes(c.id))} onChange={selectAll} /></th>
              <th>候选人</th><th>应聘职位</th><th>当前阶段</th><th>简历来源</th><th>评分</th><th>最近动态</th><th>负责人</th><th />
            </tr></thead>
            <tbody>
              {visible.map(candidate => {
                const department = getCandidateDepartment(candidate)
                const job = getCandidateJob(candidate)
                return <tr key={candidate.id}>
                  <td className="check-column"><input type="checkbox" checked={selected.includes(candidate.id)} onChange={() => toggleSelect(candidate.id)} onClick={e => e.stopPropagation()} /></td>
                  <td><button className="candidate-cell" onClick={() => onOpenCandidate(candidate.id)}><span className="avatar avatar-md" style={{ background: `${candidate.avatarColor}18`, color: candidate.avatarColor }}>{candidate.name.slice(-2)}</span><span><strong>{candidate.name}</strong><small>{candidate.currentCompany} · {candidate.currentTitle}</small></span></button></td>
                  <td><button className="job-cell" onClick={() => onOpenCandidate(candidate.id)}><strong>{job?.title || '待分配职位'}</strong><small><span className="department-dot" style={{ background: department?.color }} />{department?.name || '部门待补充'} · {job?.location?.split(' · ')[0] || '地点待补充'}</small></button></td>
                  <td><StageBadge stage={candidate.stage} /></td>
                  <td><span className="source-cell">{candidate.source}</span></td>
                  <td><span className="rating-cell"><Star size={14} fill="#EEA23E" stroke="#EEA23E" />{candidate.rating}.0</span></td>
                  <td><span className="last-activity">{candidate.lastActivity}<small>更新于</small></span></td>
                  <td><span className="owner-cell"><span className="avatar avatar-xs avatar-warm">{candidate.owner.slice(-1)}</span>{candidate.owner}</span></td>
                  <td><button className="icon-button row-more"><MoreHorizontal size={17} /></button></td>
                </tr>
              })}
            </tbody>
          </table>
          {visible.length === 0 && !candidatesLoading && !candidatesError && <EmptyState onReset={resetFilters} />}
        </div> : <div className="candidate-card-grid">
          {visible.map(candidate => {
            const job = getCandidateJob(candidate)
            const department = getCandidateDepartment(candidate)
            return <button className="candidate-card" key={candidate.id} onClick={() => onOpenCandidate(candidate.id)}>
              <div className="candidate-card-top"><span className="avatar avatar-lg" style={{ background: `${candidate.avatarColor}18`, color: candidate.avatarColor }}>{candidate.name.slice(-2)}</span><StageBadge stage={candidate.stage} /></div>
              <h4>{candidate.name}</h4><p>{candidate.currentTitle} · {candidate.currentCompany}</p>
              <div className="candidate-card-job"><span className="department-dot" style={{ background: department?.color }} />{job?.title}</div>
              <div className="tag-row">{candidate.tags.slice(0, 3).map(tag => <span key={tag}>{tag}</span>)}</div>
              <div className="candidate-card-footer"><span><Star size={14} fill="#EEA23E" stroke="#EEA23E" />{candidate.rating}.0</span><span>{candidate.lastActivity}</span></div>
            </button>
          })}
        </div>}

        <div className="table-footer"><span>显示 {filtered.length ? (page - 1) * PAGE_SIZE + 1 : 0}-{Math.min(page * PAGE_SIZE, filtered.length)}，共 {filtered.length} 条</span><div className="pagination"><button disabled={page === 1} onClick={() => setPage(page - 1)}><ChevronLeft size={15} /></button>{Array.from({ length: Math.min(pages, 5) }, (_, i) => <button key={i + 1} className={page === i + 1 ? 'active' : ''} onClick={() => setPage(i + 1)}>{i + 1}</button>)}<button disabled={page === pages} onClick={() => setPage(page + 1)}><ChevronRight size={15} /></button></div></div>
      </div>
    </div>
  )
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: {value: string; label: string}[] }) {
  return <label className="filter-select"><span>{label}</span><select value={value} onChange={e => onChange(e.target.value)}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown size={14} /></label>
}

export function StageBadge({ stage }: { stage: CandidateStage }) {
  const meta = stageMeta[stage]
  return <span className={cn('stage-badge', `stage-${meta.tone}`)}><i />{meta.label}</span>
}

function EmptyState({ onReset }: { onReset: () => void }) {
  return <div className="empty-state"><span><Users size={24} /></span><h4>没有找到匹配的候选人</h4><p>尝试调整搜索关键词或筛选条件。</p><button className="button button-secondary" onClick={onReset}>清除筛选</button></div>
}

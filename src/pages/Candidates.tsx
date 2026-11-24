import { useEffect, useMemo, useState } from 'react'
import { BriefcaseBusiness, ChevronDown, ChevronLeft, ChevronRight, ListFilter, LockKeyhole, Plus, Search, SlidersHorizontal, Star, Upload, Users, X } from 'lucide-react'
import { getDepartment } from '../data'
import { useApp } from '../context'
import {
  activateCandidateFromPool,
  assignCandidateJob,
  batchRecordDepartmentScreening,
  batchUpdateCandidateTags,
  batchUpdateCandidateStage,
  deleteSavedCandidateFilter,
  getCandidateDetail,
  listCandidatePage,
  listJobs,
  listSavedCandidateFilters,
  saveCandidateFilter,
} from '../api'
import type { Candidate, CandidateFilter, CandidateMainStage, CandidateStageFilter, JobListItem, SavedCandidateFilter } from '../types'
import { useEffectiveSettings } from '../useEffectiveSettings'
import { cn, stageMeta } from '../utils'

type CandidatesProps = { search: string; onOpenCandidate: (id: string) => void; onAddCandidate: () => void; onBulkImport?: () => void }

const PAGE_SIZE = 20
/** 只有人才库总量（已归档）达到万级才压缩展示；阶段 Tab 与报表始终展示真实数量（ATS-013） */
const POOL_ABBREVIATE_THRESHOLD = 10000
export const formatCount = (value: number, abbreviate: boolean) =>
  abbreviate && value >= POOL_ABBREVIATE_THRESHOLD ? '1w+' : String(value)
const stageTabs: { key: CandidateStageFilter; label: string }[] = [
  { key: 'UNASSIGNED', label: '待分配' },
  { key: 'RECOMMENDED', label: '人才推荐' },
  { key: 'HR_SCREENING', label: '初筛' },
  { key: 'DEPT_SCREENING', label: '用人部门筛选' },
  { key: 'INTERVIEWING', label: '面试' },
  { key: 'OFFERING', label: '沟通 Offer' },
  { key: 'PENDING_ONBOARD', label: '待入职' },
  { key: 'ONBOARDED', label: '已入职' },
  { key: 'PROBATION', label: '试用期' },
  { key: 'ENDED', label: '结束' },
  { key: 'ARCHIVED', label: '已归档' },
]
const bulkTargets: { key: CandidateMainStage | 'ARCHIVED'; label: string }[] = [
  { key: 'HR_SCREENING', label: '开始初筛' },
  { key: 'DEPT_SCREENING', label: '进入部门筛选' },
  { key: 'OFFERING', label: '人工推进至沟通 Offer' },
  { key: 'ONBOARDED', label: '确认入职' },
  { key: 'PROBATION', label: '开始试用期' },
  { key: 'ENDED', label: '结束试用期' },
  { key: 'ARCHIVED', label: '归档' },
]

const emptyFilters: CandidateFilter = {
  keyword: '', departmentId: '', jobId: '', company: '', channel: '', source: '', tag: '',
  lockedState: undefined, updatedBefore: '',
}

const poolPageSizes = [20, 50, 100] as const

export function Candidates({ search, onOpenCandidate, onAddCandidate, onBulkImport }: CandidatesProps) {
  const { data, setData, candidatesLoading, candidatesError, apiJobs, toast } = useApp()
  const effective = useEffectiveSettings()
  const channelOptions = effective?.dicts.CHANNEL ?? []
  const tagOptions = effective?.dicts.TAG ?? []
  const [rows, setRows] = useState<Candidate[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [total, setTotal] = useState(0)
  const [poolTotal, setPoolTotal] = useState(0)
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE)
  const [stage, setStage] = useState<CandidateStageFilter | 'ALL'>('ALL')
  const [filters, setFilters] = useState<CandidateFilter>(emptyFilters)
  const [page, setPage] = useState(1)
  // 跳页：万级数据下页码条只展示当前附近 5 页，配合直接输入页码定位
  const [jumpPage, setJumpPage] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [view, setView] = useState<'list' | 'cards'>('list')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [quickSearch, setQuickSearch] = useState('')
  const [savedFilters, setSavedFilters] = useState<SavedCandidateFilter[]>([])
  const [savedFilterName, setSavedFilterName] = useState('')
  const [savedFilterId, setSavedFilterId] = useState('')
  const [bulkTarget, setBulkTarget] = useState<CandidateMainStage | 'ARCHIVED'>('HR_SCREENING')
  const [bulkAction, setBulkAction] = useState<'STAGE' | 'SCREENING' | 'TAGS' | 'STATUS'>('STAGE')
  const [bulkScreeningResult, setBulkScreeningResult] = useState<'PASS' | 'HOLD' | 'REJECT'>('PASS')
  const [bulkScreeningReason, setBulkScreeningReason] = useState('')
  const [bulkAvailabilityStart, setBulkAvailabilityStart] = useState('')
  const [bulkAvailabilityEnd, setBulkAvailabilityEnd] = useState('')
  const [bulkTagsText, setBulkTagsText] = useState('')
  const [bulkTagMode, setBulkTagMode] = useState<'ADD' | 'REMOVE' | 'REPLACE'>('ADD')
  const [showStatusSummary, setShowStatusSummary] = useState(false)
  const [assignCandidateId, setAssignCandidateId] = useState<string | null>(null)
  // 人才库激活与待分配职位分配复用同一个职位选择弹窗，用来源区分动作
  const [assignMode, setAssignMode] = useState<'ASSIGN' | 'ACTIVATE'>('ASSIGN')
  const [assignJobId, setAssignJobId] = useState('')
  const [assignableJobs, setAssignableJobs] = useState<JobListItem[]>([])
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const keyword = [search, quickSearch, filters.keyword].map((value) => value?.trim()).filter(Boolean).join(' ')
  const queryFilters = useMemo(() => ({ ...filters, keyword }), [filters, keyword])
  const departmentGroups = useMemo(() => {
    const groups = new Map<string, typeof apiJobs>()
    apiJobs.forEach((job) => groups.set(job.departmentId, [...(groups.get(job.departmentId) ?? []), job]))
    // ATS-024：部门名称以服务端返回的 departmentName 为准；非管理员拿不到部门清单时不再回退为原始 ID
    return [...groups.entries()].map(([departmentId, jobs]) => ({
      departmentId,
      name: getDepartment(departmentId)?.name || jobs.find((job) => job.departmentName)?.departmentName
        || data.candidates.find((candidate) => candidate.departmentId === departmentId && candidate.departmentName)?.departmentName
        || '部门待补充',
      jobs,
    }))
  }, [apiJobs, data.candidates])

  useEffect(() => {
    let active = true
    setLoadError(null)
    listCandidatePage({
      ...queryFilters,
      stage: stage === 'ALL' ? undefined : stage,
      page,
      pageSize,
    }).then((result) => {
      if (!active) return
      setRows(result.items)
      setCounts(result.counts)
      setTotal(result.total)
      setPoolTotal(result.talentPool?.total ?? result.counts?.ARCHIVED ?? 0)
      setSelected((current) => current.filter((id) => result.items.some((candidate) => candidate.id === id)))
    }).catch((error: unknown) => {
      if (active) setLoadError(error instanceof Error ? error.message : '候选人列表加载失败')
    })
    return () => { active = false }
  }, [data.candidates, page, pageSize, queryFilters, refreshKey, stage])

  useEffect(() => {
    let active = true
    listSavedCandidateFilters().then((items) => { if (active) setSavedFilters(items) }).catch(() => {})
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    listJobs({ status: 'ACTIVE', isVirtual: 'false', pageSize: 100 }).then((items) => { if (active) setAssignableJobs(items) }).catch(() => {})
    return () => { active = false }
  }, [])

  const pages = Math.max(1, Math.ceil(total / pageSize))
  const goToPage = (next: number) => setPage(Math.min(Math.max(1, Math.trunc(next)), pages))
  const activeFilterCount = [filters.departmentId, filters.jobId, filters.company, filters.channel, filters.source, filters.tag, filters.lockedState, filters.updatedBefore].filter(Boolean).length
  const allCount = Object.entries(counts).reduce((sum, [key, value]) => sum + (key === 'VIRTUAL_POOL' ? 0 : value), 0)
  const archivedCount = poolTotal || counts.ARCHIVED || 0
  const visible = rows
  const jobOptions = assignableJobs

  const patchFilter = (key: keyof CandidateFilter, value: string | undefined) => {
    setFilters((current) => ({ ...current, [key]: value }))
    setPage(1)
  }
  const selectStage = (next: CandidateStageFilter | 'ALL') => {
    setStage(next)
    setPage(1)
    setSelected([])
  }
  const toggleSelect = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  const selectAll = () => setSelected((current) => visible.every((candidate) => current.includes(candidate.id))
    ? current.filter((id) => !visible.some((candidate) => candidate.id === id))
    : [...new Set([...current, ...visible.map((candidate) => candidate.id)])])
  const resetFilters = () => {
    setFilters(emptyFilters)
    setQuickSearch('')
    setStage('ALL')
    setPage(1)
  }

  const refresh = () => setRefreshKey((current) => current + 1)
  // 本页的批量/分配动作只改服务端状态，必须把结果写回全局 store，
  // 否则招聘流程看板等直接读 store 的页面会停留在动作前的阶段。（ATS-012）
  const mergeCandidatesIntoStore = (items: Candidate[]) => {
    if (!items.length) return
    setData((current) => {
      const byId = new Map(items.map((item) => [item.id, item]))
      return { ...current, candidates: current.candidates.map((item) => byId.get(item.id) ?? item) }
    })
  }
  // 批量接口只返回成功/失败计数，且成功的候选人可能已离开当前筛选页，
  // 因此按 id 重新取详情，而不是复用当前页列表。
  const syncCandidatesToStore = async (ids: string[]) => {
    if (!ids.length) return
    const results = await Promise.allSettled(ids.map((id) => getCandidateDetail(id)))
    mergeCandidatesIntoStore(results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []))
  }
  const runBatch = async () => {
    if (!selected.length) return
    if (bulkAction === 'STATUS') {
      setShowStatusSummary(true)
      return
    }
    if (bulkAction === 'SCREENING' && bulkScreeningResult === 'PASS' && !bulkScreeningReason.trim()) {
      toast('部门筛选通过时必须填写筛选原因', 'info')
      return
    }
    if (bulkAction === 'SCREENING' && bulkScreeningResult === 'PASS' && (!bulkAvailabilityStart || !bulkAvailabilityEnd)) {
      toast('请填写通过后的可约面开始和结束时间', 'info')
      return
    }
    const tags = bulkTagsText.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean)
    if (bulkAction === 'TAGS' && tags.length === 0) {
      toast('请至少输入一个标签', 'info')
      return
    }
    setBusy(true)
    try {
      const availabilitySlots = bulkAction === 'SCREENING' && bulkScreeningResult === 'PASS'
        ? [{ startAt: new Date(bulkAvailabilityStart).toISOString(), endAt: new Date(bulkAvailabilityEnd).toISOString() }]
        : undefined
      const result = bulkAction === 'STAGE'
        ? await batchUpdateCandidateStage(selected, bulkTarget)
        : bulkAction === 'SCREENING'
          ? await batchRecordDepartmentScreening(selected, {
            result: bulkScreeningResult,
            reason: bulkScreeningReason,
            availabilitySlots,
          })
          : await batchUpdateCandidateTags(selected, tags, bulkTagMode)
      toast(`批量动作完成：成功 ${result.updated} 位，失败 ${result.failed} 位`, result.failed ? 'info' : 'success')
      await syncCandidatesToStore(selected)
      setSelected([])
      setShowStatusSummary(false)
      refresh()
    } catch (error) {
      toast(error instanceof Error ? error.message : '批量动作失败', 'info')
    } finally {
      setBusy(false)
    }
  }
  const assignCandidate = (candidate: Candidate) => {
    setAssignMode(candidate.stage === 'ARCHIVED' ? 'ACTIVATE' : 'ASSIGN')
    setAssignCandidateId(candidate.id)
    setAssignJobId(jobOptions[0]?.id ?? '')
  }
  const activatingCandidate = assignMode === 'ACTIVATE'
  const confirmAssignCandidate = async () => {
    if (!assignCandidateId || !assignJobId) return
    setBusy(true)
    try {
      const updated = activatingCandidate
        ? await activateCandidateFromPool(assignCandidateId, assignJobId)
        : await assignCandidateJob(assignCandidateId, assignJobId)
      mergeCandidatesIntoStore([updated])
      toast(activatingCandidate ? '候选人已从人才库激活至人才推荐' : '候选人已分配到职位')
      setAssignCandidateId(null)
      refresh()
    } catch (error) {
      toast(error instanceof Error ? error.message : activatingCandidate ? '人才库激活失败' : '职位分配失败', 'info')
    } finally {
      setBusy(false)
    }
  }
  const saveCurrentFilter = async () => {
    const name = savedFilterName.trim()
    if (!name) return
    try {
      const filter = await saveCandidateFilter(name, { ...queryFilters, stage: stage === 'ALL' ? undefined : stage })
      setSavedFilters((current) => [filter, ...current.filter((item) => item.id !== filter.id)])
      setSavedFilterId(filter.id)
      setSavedFilterName('')
      toast('筛选条件已保存')
    } catch (error) {
      toast(error instanceof Error ? error.message : '保存筛选失败', 'info')
    }
  }
  const applySavedFilter = (id: string) => {
    setSavedFilterId(id)
    const filter = savedFilters.find((item) => item.id === id)
    if (!filter) return
    const next = filter.filters
    setStage(next.stage ?? 'ALL')
    setFilters({ ...emptyFilters, ...next })
    setQuickSearch('')
    setPage(1)
  }
  const removeSavedFilter = async () => {
    if (!savedFilterId) return
    try {
      await deleteSavedCandidateFilter(savedFilterId)
      setSavedFilters((current) => current.filter((item) => item.id !== savedFilterId))
      setSavedFilterId('')
      toast('已删除保存的筛选')
    } catch (error) {
      toast(error instanceof Error ? error.message : '删除筛选失败', 'info')
    }
  }

  return (
    <div className="page-stack candidates-page">
      {/* 渠道与标签候选项来自管理后台字典（ATS-024），筛选仍允许自由输入 */}
      <datalist id="candidate-channel-options">{channelOptions.map((item) => <option key={item} value={item} />)}</datalist>
      <datalist id="candidate-tag-options">{tagOptions.map((item) => <option key={item} value={item} />)}</datalist>
      <div className="page-title-row">
        <div><div className="eyebrow">候选人 <span className="eyebrow-separator">·</span> {allCount} 位</div><h2>简历库</h2><p>按招聘阶段和职位管理候选人，状态变更均由明确动作触发。</p></div>
        <div className="page-title-actions">
          <button className="button button-secondary" onClick={() => onBulkImport?.()}><Upload size={16} />批量导入</button>
          <button className="button button-primary" onClick={onAddCandidate}><Plus size={17} />添加候选人</button>
        </div>
      </div>

      <div className="stage-tabs stage-tabs-scroll">
        <button className={cn('stage-tab', stage === 'ALL' && 'active')} onClick={() => selectStage('ALL')}>全部 <span>{allCount}</span></button>
        {stageTabs.map((item) => {
          // 阶段 Tab 始终展示真实数量；仅人才库（已归档）总量在万级时压缩为 1w+
          const isPool = item.key === 'ARCHIVED'
          const count = isPool ? archivedCount : counts[item.key] ?? 0
          return <button key={item.key} className={cn('stage-tab', stage === item.key && 'active')} onClick={() => selectStage(item.key)}>{item.label}<span title={isPool ? `人才库总量 ${count} 人` : undefined}>{formatCount(count, isPool)}</span></button>
        })}
      </div>

      {stage === 'ARCHIVED' && (
        <div className="panel pool-summary">
          <div><strong>人才库</strong><span>人才库总量（已归档真实计数）：{archivedCount} 人。归档候选人自动入池，选择职位即可激活回人才推荐，归档与激活历史全部保留。</span></div>
          <label className="candidate-filter-input"><span>标签检索</span><input list="candidate-tag-options" value={filters.tag ?? ''} onChange={(event) => patchFilter('tag', event.target.value)} placeholder="如：Java、华为" /></label>
          <label className="candidate-filter-input"><span>归档渠道</span><input list="candidate-channel-options" value={filters.channel ?? ''} onChange={(event) => patchFilter('channel', event.target.value)} placeholder="渠道" /></label>
        </div>
      )}

      {(candidatesLoading || busy) && <div className="panel empty-inline">{candidatesLoading ? '正在加载候选人…' : '正在保存候选人状态…'}</div>}
      {(candidatesError || loadError) && <div className="panel empty-inline">候选人加载失败：{loadError || candidatesError} 刷新页面后重试。</div>}

      <div className="candidate-workspace">
        <aside className="candidate-job-tree panel">
          <div className="candidate-tree-heading"><BriefcaseBusiness size={16} /><strong>职位树</strong></div>
          <button className={cn('candidate-tree-item', !filters.departmentId && !filters.jobId && 'active')} onClick={() => { patchFilter('departmentId', ''); patchFilter('jobId', '') }}>全部职位</button>
          {departmentGroups.map((group) => <section key={group.departmentId}>
            <button className={cn('candidate-tree-item department', filters.departmentId === group.departmentId && 'active')} onClick={() => { patchFilter('departmentId', group.departmentId); patchFilter('jobId', '') }}>{group.name}</button>
            {group.jobs.map((job) => <button key={job.id} className={cn('candidate-tree-item job', filters.jobId === job.id && 'active')} onClick={() => { patchFilter('departmentId', group.departmentId); patchFilter('jobId', job.id) }}>{job.title}<small>{job.code || job.id}</small></button>)}
          </section>)}
        </aside>

        <div className="panel candidates-panel">
          <div className="candidate-toolbar">
            <label className="table-search"><Search size={16} /><input placeholder="搜索姓名、公司、职位或标签" value={quickSearch} onChange={(event) => { setQuickSearch(event.target.value); setPage(1) }} />{quickSearch && <button onClick={() => setQuickSearch('')}><X size={14} /></button>}</label>
            <button className={cn('filter-button', filtersOpen && 'active')} onClick={() => setFiltersOpen(!filtersOpen)}><SlidersHorizontal size={16} />筛选{activeFilterCount > 0 && <span>{activeFilterCount}</span>}<ChevronDown size={14} /></button>
            <label className="saved-filter-select"><ListFilter size={15} /><select value={savedFilterId} onChange={(event) => applySavedFilter(event.target.value)}><option value="">已保存筛选</option>{savedFilters.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            {savedFilterId && <button className="icon-button" title="删除保存的筛选" onClick={removeSavedFilter}><X size={14} /></button>}
            <span className="result-count">{total} 条结果</span>
            <div className="toolbar-spacer" />
            <div className="view-switch"><button className={cn(view === 'list' && 'active')} onClick={() => setView('list')} title="列表视图"><ListFilter size={16} /></button><button className={cn(view === 'cards' && 'active')} onClick={() => setView('cards')} title="卡片视图"><div className="grid-view-icon"><i /><i /><i /><i /></div></button></div>
          </div>

          {filtersOpen && <div className="filter-panel candidate-filter-panel">
            <FilterSelect label="部门" value={filters.departmentId ?? ''} onChange={(value) => patchFilter('departmentId', value)} options={[{ value: '', label: '全部部门' }, ...departmentGroups.map((item) => ({ value: item.departmentId, label: item.name }))]} />
            <FilterSelect label="职位" value={filters.jobId ?? ''} onChange={(value) => patchFilter('jobId', value)} options={[{ value: '', label: '全部职位' }, ...apiJobs.map((job) => ({ value: job.id, label: job.title }))]} />
            <label className="candidate-filter-input"><span>公司</span><input value={filters.company ?? ''} onChange={(event) => patchFilter('company', event.target.value)} placeholder="公司名称" /></label>
            <label className="candidate-filter-input"><span>渠道</span><input list="candidate-channel-options" value={filters.channel ?? ''} onChange={(event) => patchFilter('channel', event.target.value)} placeholder="渠道" /></label>
            <label className="candidate-filter-input"><span>来源</span><input value={filters.source ?? ''} onChange={(event) => patchFilter('source', event.target.value)} placeholder="来源" /></label>
            <label className="candidate-filter-input"><span>标签</span><input list="candidate-tag-options" value={filters.tag ?? ''} onChange={(event) => patchFilter('tag', event.target.value)} placeholder="标签" /></label>
            <FilterSelect label="锁定状态" value={filters.lockedState ?? ''} onChange={(value) => patchFilter('lockedState', value || undefined)} options={[{ value: '', label: '全部状态' }, { value: 'NONE', label: '未锁定' }, { value: 'OPERABLE', label: '可操作' }, { value: 'INOPERABLE', label: '不可操作' }]} />
            <label className="candidate-filter-input"><span>未处理至</span><input type="date" value={filters.updatedBefore?.slice(0, 10) ?? ''} onChange={(event) => patchFilter('updatedBefore', event.target.value ? `${event.target.value}T23:59:59.999Z` : '')} /></label>
            <div className="saved-filter-actions"><input value={savedFilterName} onChange={(event) => setSavedFilterName(event.target.value)} placeholder="筛选名称" /><button className="text-button" disabled={!savedFilterName.trim()} onClick={saveCurrentFilter}>保存当前筛选</button></div>
            <button className="reset-filter" onClick={resetFilters}>重置条件</button>
          </div>}

          {selected.length > 0 && <div className="bulk-bar">
            <span>已选择 <strong>{selected.length}</strong> 位候选人</span>
            <select value={bulkAction} onChange={(event) => { setBulkAction(event.target.value as typeof bulkAction); setShowStatusSummary(false) }} aria-label="批量操作类型"><option value="STAGE">批量转阶段</option><option value="SCREENING">部门筛选结论</option><option value="TAGS">批量标签</option><option value="STATUS">查看状态</option></select>
            {bulkAction === 'STAGE' && <select value={bulkTarget} onChange={(event) => setBulkTarget(event.target.value as CandidateMainStage | 'ARCHIVED')} aria-label="批量动作目标">{bulkTargets.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select>}
            {bulkAction === 'SCREENING' && <><select value={bulkScreeningResult} onChange={(event) => setBulkScreeningResult(event.target.value as 'PASS' | 'HOLD' | 'REJECT')} aria-label="部门筛选结论"><option value="PASS">通过</option><option value="HOLD">待定</option><option value="REJECT">淘汰</option></select>{bulkScreeningResult === 'PASS' && <><input value={bulkScreeningReason} onChange={(event) => setBulkScreeningReason(event.target.value)} placeholder="筛选原因（必填）" aria-label="筛选原因" /><input type="datetime-local" value={bulkAvailabilityStart} onChange={(event) => setBulkAvailabilityStart(event.target.value)} aria-label="可约开始时间" /><input type="datetime-local" value={bulkAvailabilityEnd} onChange={(event) => setBulkAvailabilityEnd(event.target.value)} aria-label="可约结束时间" /></>}</>}
            {bulkAction === 'TAGS' && <><select value={bulkTagMode} onChange={(event) => setBulkTagMode(event.target.value as typeof bulkTagMode)} aria-label="标签变更方式"><option value="ADD">添加标签</option><option value="REMOVE">移除标签</option><option value="REPLACE">替换标签</option></select><input value={bulkTagsText} onChange={(event) => setBulkTagsText(event.target.value)} placeholder="标签，多个用逗号分隔" aria-label="批量标签" /></>}
            <button disabled={busy} onClick={runBatch}>{bulkAction === 'STATUS' ? '查看状态' : '执行批量动作'}</button>
            <button className="bulk-close" onClick={() => { setSelected([]); setShowStatusSummary(false) }}><X size={15} /></button>
          </div>}
          {showStatusSummary && selected.length > 0 && <div className="bulk-status-summary"><strong>所选候选人状态</strong>{rows.filter((candidate) => selected.includes(candidate.id)).map((candidate) => <span key={candidate.id}>{candidate.name} · {stageMeta[candidate.stage]?.label ?? candidate.stage} · {candidate.lockedState === 'INOPERABLE' ? '不可操作' : '可操作'}</span>)}</div>}

          {view === 'list' ? <div className="candidate-table-wrap">
            <table className="candidate-table">
              <thead><tr><th className="check-column"><input type="checkbox" checked={visible.length > 0 && visible.every((candidate) => selected.includes(candidate.id))} onChange={selectAll} /></th><th>候选人</th><th>应聘职位</th><th>当前阶段</th><th>简历来源</th><th>评分</th><th>最近动态</th><th>锁定</th><th>操作</th></tr></thead>
              <tbody>{visible.map((candidate) => <CandidateRow key={candidate.id} candidate={candidate} selected={selected.includes(candidate.id)} onSelect={() => toggleSelect(candidate.id)} onOpen={() => onOpenCandidate(candidate.id)} onAssign={() => assignCandidate(candidate)} />)}</tbody>
            </table>
            {visible.length === 0 && !candidatesLoading && !loadError && <EmptyState onReset={resetFilters} />}
          </div> : <div className="candidate-card-grid">
            {visible.map((candidate) => <button className="candidate-card" key={candidate.id} onClick={() => onOpenCandidate(candidate.id)}>
              <div className="candidate-card-top"><span className="avatar avatar-lg" style={{ background: `${candidate.avatarColor}18`, color: candidate.avatarColor }}>{candidate.name.slice(-2)}</span><StageBadge stage={candidate.stage} /></div>
              <h4>{candidate.name}</h4><p>{candidate.currentTitle} · {candidate.currentCompany}</p>
              <div className="candidate-card-job">{candidate.jobTitle || '待分配职位'}</div>
              <div className="tag-row">{candidate.tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}</div>
              <div className="candidate-card-footer"><span><Star size={14} fill="#EEA23E" stroke="#EEA23E" />{candidate.rating}.0</span><span>{candidate.lastActivity}</span></div>
            </button>)}
            {visible.length === 0 && !candidatesLoading && <EmptyState onReset={resetFilters} />}
          </div>}

          <div className="table-footer"><span>显示 {total ? (page - 1) * pageSize + 1 : 0}-{Math.min(page * pageSize, total)}，共 {total} 条{archivedCount >= POOL_ABBREVIATE_THRESHOLD ? `（人才库总量 ${formatCount(archivedCount, true)}）` : ''}</span><div className="pagination"><button disabled={page === 1} onClick={() => goToPage(page - 1)}><ChevronLeft size={15} /></button>{Array.from({ length: Math.min(pages, 5) }, (_, index) => { const pageNumber = Math.max(1, Math.min(pages - 4, page - 2)) + index; return pageNumber <= pages ? <button key={pageNumber} className={page === pageNumber ? 'active' : ''} onClick={() => goToPage(pageNumber)}>{pageNumber}</button> : null })}<button disabled={page === pages} onClick={() => goToPage(page + 1)}><ChevronRight size={15} /></button><input className="page-jump" value={jumpPage} onChange={(event) => setJumpPage(event.target.value.replace(/\D/g, ''))} onKeyDown={(event) => { if (event.key === 'Enter' && jumpPage) { goToPage(Number(jumpPage)); setJumpPage('') } }} placeholder="跳至" aria-label="跳转页码" /><span className="page-jump-total">/ {pages}</span><select className="page-size" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1) }} aria-label="每页条数">{poolPageSizes.map((size) => <option key={size} value={size}>{size} 条/页</option>)}</select></div></div>
        </div>
      </div>
      {assignCandidateId && <div className="drawer-backdrop candidate-assign-backdrop" onClick={() => setAssignCandidateId(null)}><section className="candidate-assign-dialog" onClick={(event) => event.stopPropagation()}><h3>{activatingCandidate ? '从人才库激活' : '分配到职位'}</h3><label><span>目标职位</span><select value={assignJobId} onChange={(event) => setAssignJobId(event.target.value)}>{jobOptions.map((job) => <option key={job.id} value={job.id}>{job.title} · {job.departmentName || '部门待补充'}</option>)}</select></label>{activatingCandidate && <p className="hint">激活后候选人回流至「人才推荐」，原归档记录与原因全部保留。</p>}<div><button className="button button-secondary" onClick={() => setAssignCandidateId(null)}>取消</button><button className="button button-primary" disabled={!assignJobId || busy} onClick={confirmAssignCandidate}>{activatingCandidate ? '确认激活' : '确认分配'}</button></div></section></div>}
    </div>
  )
}

function CandidateRow({ candidate, selected, onSelect, onOpen, onAssign }: { candidate: Candidate; selected: boolean; onSelect: () => void; onOpen: () => void; onAssign: () => void }) {
  const unassigned = candidate.stage === 'UNASSIGNED' || candidate.stage === 'VIRTUAL_POOL'
  return <tr>
    <td className="check-column"><input type="checkbox" checked={selected} onChange={onSelect} onClick={(event) => event.stopPropagation()} /></td>
    <td><button className="candidate-cell" onClick={onOpen}><span className="avatar avatar-md" style={{ background: `${candidate.avatarColor}18`, color: candidate.avatarColor }}>{candidate.name.slice(-2)}</span><span><strong>{candidate.name}</strong><small>{candidate.currentCompany} · {candidate.currentTitle}</small></span></button></td>
    <td><button className="job-cell" onClick={onOpen}><strong>{candidate.jobTitle || '待分配职位'}</strong><small>{candidate.departmentName || '部门待补充'} · {candidate.jobLocation || '地点待补充'}</small></button></td>
    <td><StageBadge stage={candidate.stage} /></td>
    <td><span className="source-cell">{candidate.source}</span>{candidate.channel && <small className="candidate-channel">{candidate.channel}</small>}</td>
    <td><span className="rating-cell"><Star size={14} fill="#EEA23E" stroke="#EEA23E" />{candidate.rating}.0</span></td>
    <td><span className="last-activity">{candidate.lastActivity}<small>更新于</small></span></td>
    <td>{candidate.lockedState === 'INOPERABLE' ? <span className="locked-indicator"><LockKeyhole size={14} />不可操作</span> : <span className="locked-indicator muted">可操作</span>}</td>
    <td>{unassigned ? <button className="text-button" onClick={onAssign}>分配职位</button> : candidate.stage === 'ARCHIVED' ? <button className="text-button" onClick={onAssign}>激活</button> : <button className="text-button" onClick={onOpen}>查看</button>}</td>
  </tr>
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) {
  return <label className="filter-select"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown size={14} /></label>
}

export function StageBadge({ stage }: { stage: Candidate['stage'] }) {
  const meta = stageMeta[stage]
  return <span className={cn('stage-badge', `stage-${meta.tone}`)}><i />{meta.label}</span>
}

function EmptyState({ onReset }: { onReset: () => void }) {
  return <div className="empty-state"><span><Users size={24} /></span><h4>没有找到匹配的候选人</h4><p>尝试调整搜索关键词或筛选条件。</p><button className="button button-secondary" onClick={onReset}>清除筛选</button></div>
}

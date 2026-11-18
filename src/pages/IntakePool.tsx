import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  GitMerge,
  Inbox,
  Paperclip,
  RefreshCw,
  Search,
  UserCheck,
} from 'lucide-react'
import {
  batchAssignJobs,
  confirmAiRun,
  listDuplicateIntakes,
  listIntakePool,
  listJobs,
  listUsers,
  mergeDuplicateIntake,
  openAttachment,
} from '../api'
import { useApp } from '../context'
import type { ApiUser, IntakeList, IntakePoolItem, IntakePoolList, JobListItem } from '../types'
import { cn } from '../utils'

type Tab = 'pool' | 'duplicates'

const formatTime = (value: string | null) => {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', { hour12: false })
}

export function IntakePool() {
  const [tab, setTab] = useState<Tab>('pool')
  const [jobs, setJobs] = useState<JobListItem[]>([])
  const [users, setUsers] = useState<ApiUser[]>([])

  useEffect(() => {
    Promise.all([listJobs(), listJobs({ isVirtual: 'true' })])
      .then(([normal, virtual]) => {
        const map = new Map<string, JobListItem>()
        for (const job of [...normal, ...virtual]) map.set(job.id, job)
        setJobs([...map.values()])
      })
      .catch(() => setJobs([]))
    listUsers().then(setUsers).catch(() => setUsers([]))
  }, [])

  return (
    <div className="page-stack">
      <div className="page-title-row">
        <div>
          <div className="eyebrow">简历入场 <span className="eyebrow-separator">·</span> 待分配池 / 临时待处理区</div>
          <h2>待分配池</h2>
          <p>邮箱与插件入场的简历先停留在此，由人事手工选职位；负责人由职位的招聘负责人带出。</p>
        </div>
      </div>

      <div className="stage-tabs">
        <button className={cn('stage-tab', tab === 'pool' && 'active')} onClick={() => setTab('pool')}>
          <Inbox size={14} />待分配
        </button>
        <button className={cn('stage-tab', tab === 'duplicates' && 'active')} onClick={() => setTab('duplicates')}>
          <GitMerge size={14} />待合并查重
        </button>
      </div>

      {tab === 'pool' ? <PoolTab jobs={jobs} users={users} /> : <DuplicatesTab />}
    </div>
  )
}

function PoolTab({ jobs, users }: { jobs: JobListItem[]; users: ApiUser[] }) {
  const { toast } = useApp()
  const [data, setData] = useState<IntakePoolList | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<string[]>([])
  const [jobId, setJobId] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData(await listIntakePool({ keyword: keyword || undefined, page, pageSize: 10 }))
      setError(null)
    } catch (loadError) {
      setData(null)
      setError(loadError instanceof Error ? loadError.message : '待分配池加载失败')
    } finally {
      setLoading(false)
    }
  }, [keyword, page])

  useEffect(() => {
    void load()
  }, [load])

  const items = data?.items ?? []
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  const selectedJob = useMemo(() => jobs.find((job) => job.id === jobId) ?? null, [jobs, jobId])
  const recruiter = selectedJob?.recruiterId
    ? users.find((user) => user.id === selectedJob.recruiterId)?.displayName ?? selectedJob.recruiterId
    : null

  const toggle = (candidateId: string) =>
    setSelected((prev) => prev.includes(candidateId) ? prev.filter((id) => id !== candidateId) : [...prev, candidateId])

  const toggleAll = () =>
    setSelected(items.every((item) => selected.includes(item.candidateId))
      ? selected.filter((id) => !items.some((item) => item.candidateId === id))
      : [...new Set([...selected, ...items.map((item) => item.candidateId)])])

  const assign = async (targets: IntakePoolItem[]) => {
    if (!jobId) {
      toast('请先选择目标职位', 'info')
      return
    }
    const intakeIds = targets.map((item) => item.intakeId).filter((id): id is string => Boolean(id))
    if (!intakeIds.length) {
      toast('所选记录没有可分配的入场记录', 'info')
      return
    }
    setBusy(true)
    try {
      const result = await batchAssignJobs(intakeIds, jobId)
      toast(`已分配 ${result.assigned} 条${result.failed ? `，${result.failed} 条失败` : ''}`)
      setSelected([])
      await load()
    } catch (assignError) {
      toast(assignError instanceof Error ? assignError.message : '分配失败', 'info')
    } finally {
      setBusy(false)
    }
  }

  const confirm = async (runId: string) => {
    try {
      await confirmAiRun(runId)
      toast('草稿已确认')
      await load()
    } catch (confirmError) {
      toast(confirmError instanceof Error ? confirmError.message : '确认失败', 'info')
    }
  }

  return (
    <div className="panel">
      <div className="candidate-toolbar">
        <label className="table-search">
          <Search size={16} />
          <input value={keyword} onChange={(event) => { setKeyword(event.target.value); setPage(1) }} placeholder="搜索姓名、手机号或邮箱" />
        </label>
        <span className="result-count">{data?.total ?? 0} 条待分配</span>
        <div className="toolbar-spacer" />
        <label className="form-field form-field-inline">
          <span>目标职位</span>
          <select value={jobId} onChange={(event) => setJobId(event.target.value)}>
            <option value="">选择职位</option>
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>{job.code} · {job.title}{job.isVirtual ? '（虚拟职位）' : ''}</option>
            ))}
          </select>
        </label>
        {recruiter && <span className="cell-sub">负责人：{recruiter}（职位带出）</span>}
        <button className="button button-primary button-sm" disabled={busy || !jobId} onClick={() => void assign(items.filter((item) => selected.includes(item.candidateId)))}>
          <UserCheck size={14} />批量分配
        </button>
      </div>

      {loading && <div className="empty-inline">正在加载待分配池…</div>}
      {error && <div className="empty-inline">加载失败：{error}</div>}

      <div className="intake-table-wrap">
        <table className="intake-table">
          <thead>
            <tr>
              <th className="check-column"><input type="checkbox" checked={items.length > 0 && items.every((item) => selected.includes(item.candidateId))} onChange={toggleAll} /></th>
              <th>候选人</th><th>来源</th><th>进入方式</th><th>接收时间</th><th>解析状态</th><th>附件</th><th />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.candidateId}>
                <td className="check-column"><input type="checkbox" checked={selected.includes(item.candidateId)} onChange={() => toggle(item.candidateId)} /></td>
                <td>
                  <strong>{item.name}</strong>
                  <small className="cell-sub">{item.phone ?? '无手机号'} · {item.email ?? '无邮箱'}</small>
                </td>
                <td>
                  {item.source ?? '—'}
                  {item.mailboxAddress && <small className="cell-sub">{item.mailboxAddress}</small>}
                </td>
                <td>{item.entryMode ?? '—'}</td>
                <td>{formatTime(item.receivedAt ?? item.createdAt)}</td>
                <td>
                  {item.aiRun
                    ? <span className={cn('status-chip', item.aiRun.status === 'SUCCESS' ? 'status-on' : item.aiRun.status === 'FAILED' ? 'status-err' : 'status-warn')}>
                        {item.aiRun.status === 'SUCCESS' ? (item.aiRun.isDraft ? '草稿待确认' : '已确认') : item.aiRun.status === 'FAILED' ? '解析失败' : '解析中'}
                      </span>
                    : <span className="cell-sub">无解析任务</span>}
                </td>
                <td>
                  {item.resumeFileId
                    ? <button className="text-button" onClick={() => void openAttachment(item.resumeFileId as string).catch((openError) => toast(openError.message, 'info'))}>
                        <Paperclip size={14} />{item.resumeFileName ?? '附件'}
                      </button>
                    : <span className="cell-sub">—</span>}
                </td>
                <td>
                  <div className="row-actions">
                    {item.aiRun?.id && item.aiRun.isDraft && item.aiRun.status === 'SUCCESS' && (
                      <button className="text-button" onClick={() => void confirm(item.aiRun?.id as string)}>
                        <CheckCircle2 size={14} />确认草稿
                      </button>
                    )}
                    <button className="text-button" disabled={!jobId} onClick={() => void assign([item])}>
                      <UserCheck size={14} />分配
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && !error && items.length === 0 && (
          <div className="empty-state">
            <span><Inbox size={22} /></span>
            <h4>待分配池为空</h4>
            <p>邮箱附件与未指定职位的导入会进入这里。</p>
          </div>
        )}
      </div>

      <div className="table-footer">
        <span>共 {data?.total ?? 0} 条</span>
        <div className="pagination">
          <button disabled={page === 1} onClick={() => setPage(page - 1)}><ChevronLeft size={15} /></button>
          <span className="cell-sub">第 {page} / {pages} 页</span>
          <button disabled={page >= pages} onClick={() => setPage(page + 1)}><ChevronRight size={15} /></button>
        </div>
      </div>
    </div>
  )
}

function DuplicatesTab() {
  const { toast } = useApp()
  const [data, setData] = useState<IntakeList | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData(await listDuplicateIntakes({ page, pageSize: 10 }))
      setError(null)
    } catch (loadError) {
      setData(null)
      setError(loadError instanceof Error ? loadError.message : '查重记录加载失败')
    } finally {
      setLoading(false)
    }
  }, [page])

  useEffect(() => {
    void load()
  }, [load])

  const merge = async (intakeId: string) => {
    try {
      await mergeDuplicateIntake(intakeId)
      toast('已合并到原候选人，来源与附件保留')
      await load()
    } catch (mergeError) {
      toast(mergeError instanceof Error ? mergeError.message : '合并失败', 'info')
    }
  }

  const items = data?.items ?? []
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <div className="panel">
      <div className="candidate-toolbar">
        <span className="result-count">{data?.total ?? 0} 条待合并查重</span>
        <div className="toolbar-spacer" />
        <button className="button button-secondary button-sm" onClick={() => void load()}><RefreshCw size={14} />刷新</button>
      </div>

      {loading && <div className="empty-inline">正在加载查重记录…</div>}
      {error && <div className="empty-inline">加载失败：{error}</div>}

      <div className="intake-table-wrap">
        <table className="intake-table">
          <thead><tr><th>文件</th><th>来源</th><th>进入方式</th><th>命中候选人</th><th>接收时间</th><th /></tr></thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>
                  <strong>{item.resumeFile?.fileName ?? '—'}</strong>
                  <small className="cell-sub">{item.mailSubject ?? item.mailFrom ?? '—'}</small>
                </td>
                <td>{item.source}</td>
                <td>{item.entryMode}</td>
                <td>{item.duplicateCandidate?.name ?? item.duplicateOfCandidateId ?? '—'}</td>
                <td>{formatTime(item.receivedAt ?? item.createdAt)}</td>
                <td>
                  <div className="row-actions">
                    {item.resumeFileId && (
                      <button className="text-button" onClick={() => void openAttachment(item.resumeFileId as string).catch((openError) => toast(openError.message, 'info'))}>
                        <Paperclip size={14} />附件
                      </button>
                    )}
                    <button className="text-button" onClick={() => void merge(item.id)}>
                      <GitMerge size={14} />合并
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && !error && items.length === 0 && (
          <div className="empty-state">
            <span><GitMerge size={22} /></span>
            <h4>没有待合并的查重记录</h4>
            <p>查重命中已有候选人的入场记录会出现在这里。</p>
          </div>
        )}
      </div>

      <div className="table-footer">
        <span>共 {data?.total ?? 0} 条</span>
        <div className="pagination">
          <button disabled={page === 1} onClick={() => setPage(page - 1)}><ChevronLeft size={15} /></button>
          <span className="cell-sub">第 {page} / {pages} 页</span>
          <button disabled={page >= pages} onClick={() => setPage(page + 1)}><ChevronRight size={15} /></button>
        </div>
      </div>
    </div>
  )
}

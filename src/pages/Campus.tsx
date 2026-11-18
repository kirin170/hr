import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  GraduationCap,
  RefreshCw,
  Search,
  UserCheck,
} from 'lucide-react'
import { batchAssignCampusApplications, listCampusApplications, listJobs } from '../api'
import { useApp } from '../context'
import type { ApiCampusApplication, CampusApplicationList, JobListItem } from '../types'
import { cn } from '../utils'

const formatTime = (value: string | null) => {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', { hour12: false })
}

const preferenceSummary = (application: ApiCampusApplication) => {
  const positions = application.preferences.desiredPositions ?? []
  const parts = [
    positions.length ? `意向岗位：${positions.join('、')}` : null,
    application.expectedCity ? `意向城市：${application.expectedCity}` : null,
    application.school ? `${application.school}${application.major ? ` · ${application.major}` : ''}` : null,
    application.graduationYear ? `${application.graduationYear} 届` : null,
    application.remark ? `备注：${application.remark}` : null,
  ].filter(Boolean)
  return parts
}

export function Campus() {
  const { toast } = useApp()
  const [data, setData] = useState<CampusApplicationList | null>(null)
  const [jobs, setJobs] = useState<JobListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<string[]>([])
  const [jobId, setJobId] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    listJobs()
      .then((items) => setJobs(items.filter((job) => !job.isVirtual && job.status === 'ACTIVE')))
      .catch(() => setJobs([]))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData(await listCampusApplications({
        status: status || undefined,
        keyword: keyword.trim() || undefined,
        page,
        pageSize: 10,
      }))
      setError(null)
    } catch (loadError) {
      setData(null)
      setError(loadError instanceof Error ? loadError.message : '校招投递加载失败')
    } finally {
      setLoading(false)
    }
  }, [status, keyword, page])

  useEffect(() => {
    void load()
  }, [load])

  const items = data?.items ?? []
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  const selectedJob = useMemo(() => jobs.find((job) => job.id === jobId) ?? null, [jobs, jobId])

  const toggle = (id: string) =>
    setSelected((prev) => prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id])

  const toggleAll = () =>
    setSelected(items.every((item) => selected.includes(item.id))
      ? selected.filter((id) => !items.some((item) => item.id === id))
      : [...new Set([...selected, ...items.map((item) => item.id)])])

  const assign = async () => {
    if (!jobId) {
      toast('请先选择正式职位', 'info')
      return
    }
    if (!selected.length) {
      toast('请选择要分配的投递', 'info')
      return
    }
    setBusy(true)
    try {
      const result = await batchAssignCampusApplications(selected, jobId)
      toast(`已分配 ${result.assigned} 条${result.failed ? `，${result.failed} 条失败` : ''}；原始意愿已保留`)
      setSelected([])
      await load()
    } catch (assignError) {
      toast(assignError instanceof Error ? assignError.message : '分配失败', 'info')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page-stack">
      <div className="page-title-row">
        <div>
          <div className="eyebrow">简历入场 <span className="eyebrow-separator">·</span> 校园招聘</div>
          <h2>校招投递</h2>
          <p>虚拟职位作为校招统一入口，人事按简历与个人意愿人工分配正式职位；原始意愿完整保留。</p>
        </div>
        <div className="page-title-actions">
          <a className="button button-secondary" href="/campus" target="_blank" rel="noreferrer">
            <GraduationCap size={16} />打开投递门户
          </a>
        </div>
      </div>

      <div className="panel">
        <div className="candidate-toolbar">
          <label className="form-field form-field-inline">
            <span>状态</span>
            <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }}>
              <option value="">全部</option>
              <option value="SUBMITTED">待分配</option>
              <option value="ASSIGNED">已分配</option>
            </select>
          </label>
          <label className="table-search">
            <Search size={16} />
            <input
              value={keyword}
              onChange={(event) => { setKeyword(event.target.value); setPage(1) }}
              placeholder="搜索姓名、手机号或邮箱"
            />
          </label>
          <span className="result-count">{data?.total ?? 0} 条投递</span>
          <div className="toolbar-spacer" />
          <label className="form-field form-field-inline">
            <span>正式职位</span>
            <select value={jobId} onChange={(event) => setJobId(event.target.value)}>
              <option value="">选择正式职位</option>
              {jobs.map((job) => (
                <option key={job.id} value={job.id}>{job.code} · {job.title}</option>
              ))}
            </select>
          </label>
          {selectedJob?.recruiterId && <span className="cell-sub">负责人由职位带出</span>}
          <button className="button button-primary button-sm" disabled={busy || !jobId} onClick={() => void assign()}>
            <UserCheck size={14} />批量分配
          </button>
          <button className="button button-secondary button-sm" onClick={() => void load()}>
            <RefreshCw size={14} />刷新
          </button>
        </div>

        {loading && <div className="empty-inline">正在加载校招投递…</div>}
        {error && <div className="empty-inline">加载失败：{error}</div>}

        <div className="intake-table-wrap">
          <table className="intake-table">
            <thead>
              <tr>
                <th className="check-column">
                  <input
                    type="checkbox"
                    checked={items.length > 0 && items.every((item) => selected.includes(item.id))}
                    onChange={toggleAll}
                  />
                </th>
                <th>候选人</th><th>投递职位</th><th>个人意愿</th><th>分配结果</th><th>投递时间</th><th>状态</th>
              </tr>
            </thead>
            <tbody>
              {items.map((application) => (
                <tr key={application.id}>
                  <td className="check-column">
                    <input
                      type="checkbox"
                      checked={selected.includes(application.id)}
                      onChange={() => toggle(application.id)}
                    />
                  </td>
                  <td>
                    <strong>{application.candidate?.name ?? '—'}</strong>
                    <small className="cell-sub">
                      {application.candidate?.phone ?? '无手机号'} · {application.candidate?.email ?? '无邮箱'}
                    </small>
                  </td>
                  <td>
                    {application.job ? `${application.job.code} · ${application.job.title}` : '—'}
                    {application.jobIsVirtual && <small className="cell-sub">虚拟职位 · 校招统一入口</small>}
                  </td>
                  <td>
                    {preferenceSummary(application).length
                      ? preferenceSummary(application).map((line) => <small className="cell-sub" key={line}>{line}</small>)
                      : <span className="cell-sub">未填写</span>}
                  </td>
                  <td>
                    {application.assignedJob
                      ? `${application.assignedJob.code} · ${application.assignedJob.title}`
                      : '待人工分配'}
                    {application.assignedAt && <small className="cell-sub">{formatTime(application.assignedAt)}</small>}
                  </td>
                  <td>{formatTime(application.createdAt)}</td>
                  <td>
                    <span className={cn('status-chip', application.status === 'ASSIGNED' ? 'status-on' : 'status-warn')}>
                      {application.status === 'ASSIGNED' ? '已分配' : '待分配'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && !error && items.length === 0 && (
            <div className="empty-state">
              <span><GraduationCap size={22} /></span>
              <h4>暂无校招投递</h4>
              <p>候选人通过校招投递门户提交后会出现在这里。</p>
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
    </div>
  )
}

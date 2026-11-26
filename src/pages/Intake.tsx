import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  Inbox,
  Mail,
  PenLine,
  Paperclip,
  RefreshCw,
  Tags,
  Upload,
} from 'lucide-react'
import {
  confirmAiRun,
  createManualIntake,
  downloadExcelTemplate,
  downloadFailedRows,
  importResumeExcel,
  listIntakes,
  listJobs,
  listMailboxes,
  mockEmailIntake,
  openAttachment,
  retryIntake,
  uploadResumes,
} from '../api'
import { useApp } from '../context'
import type {
  ExcelImportResult,
  IntakeList,
  IntakeResult,
  IntakeStatus,
  JobListItem,
  MailboxConfig,
} from '../types'
import { cn } from '../utils'
import { SourceRecords } from './SourceRecords'

type Tab = 'upload' | 'manual' | 'email' | 'excel' | 'records' | 'sources'

const tabs: { key: Tab; label: string; icon: typeof Upload }[] = [
  { key: 'upload', label: '上传简历', icon: Upload },
  { key: 'manual', label: '手工录入', icon: PenLine },
  { key: 'email', label: '邮箱模拟', icon: Mail },
  { key: 'excel', label: 'Excel 批量导入', icon: FileSpreadsheet },
  { key: 'records', label: '入场记录', icon: Inbox },
  { key: 'sources', label: '来源记录', icon: Tags },
]

const sourceOptions = [
  { value: 'UPLOAD', label: '上传' },
  { value: 'JOB_BOARD', label: '招聘网站' },
  { value: 'CAMPUS', label: '校招' },
  { value: 'REFERRAL', label: '内推' },
  { value: 'EMAIL', label: '邮箱' },
  { value: 'MANUAL', label: '手工' },
]

const statusMeta: Record<IntakeStatus, { label: string; tone: string }> = {
  RECEIVED: { label: '已接收', tone: 'status-on' },
  PARSING: { label: '解析中', tone: 'status-warn' },
  PARSED: { label: '已解析', tone: 'status-on' },
  DUPLICATE: { label: '查重', tone: 'status-warn' },
  NEEDS_MANUAL: { label: '待人工', tone: 'status-err' },
  FAILED: { label: '失败', tone: 'status-err' },
}

const entryModeLabel: Record<string, string> = {
  APPLICATION: '投递',
  EMAIL_AUTO: '邮箱自动',
  BATCH_UPLOAD: '批量上传',
  SINGLE_UPLOAD: '单个上传',
  MANUAL: '手工录入',
  BROWSER_EXTENSION: '插件导入',
  EXCEL_IMPORT: 'Excel 导入',
}

const sourceLabel = (value: string | null) =>
  sourceOptions.find((option) => option.value === value)?.label ?? value ?? '—'

const formatTime = (value: string | null) => {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('zh-CN', { hour12: false })
}

const fileToBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? '')
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => reject(new Error(`读取文件失败：${file.name}`))
    reader.readAsDataURL(file)
  })

export function Intake() {
  const { toast } = useApp()
  const [tab, setTab] = useState<Tab>('upload')
  const [jobs, setJobs] = useState<JobListItem[]>([])

  useEffect(() => {
    Promise.all([listJobs(), listJobs({ isVirtual: 'true' })])
      .then(([normal, virtual]) => {
        const map = new Map<string, JobListItem>()
        for (const job of [...normal, ...virtual]) map.set(job.id, job)
        setJobs([...map.values()])
      })
      .catch(() => setJobs([]))
  }, [])

  return (
    <div className="page-stack">
      <div className="page-title-row">
        <div>
          <div className="eyebrow">简历入场 <span className="eyebrow-separator">·</span> 上传 / 手工 / 邮箱 / Excel</div>
          <h2>简历入场</h2>
          <p>PDF、Word、图片走 AI 解析草稿；Excel 走独立表格导入，不进入 AI 解析管道。</p>
        </div>
        <div className="page-title-actions">
          <button className="button button-secondary" onClick={() => void downloadExcelTemplate().catch((error) => toast(error.message, 'info'))}>
            <Download size={16} />下载 Excel 模板
          </button>
        </div>
      </div>

      <div className="stage-tabs">
        {tabs.map((item) => {
          const Icon = item.icon
          return (
            <button key={item.key} className={cn('stage-tab', tab === item.key && 'active')} onClick={() => setTab(item.key)}>
              <Icon size={14} />{item.label}
            </button>
          )
        })}
      </div>

      {tab === 'upload' && <UploadTab jobs={jobs} />}
      {tab === 'manual' && <ManualTab jobs={jobs} />}
      {tab === 'email' && <EmailTab jobs={jobs} />}
      {tab === 'excel' && <ExcelTab />}
      {tab === 'records' && <RecordsTab jobs={jobs} />}
      {tab === 'sources' && <SourceRecords />}
    </div>
  )
}

function JobPicker({ jobs, value, onChange, placeholder = '不指定职位（进待分配池）' }: {
  jobs: JobListItem[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <label className="form-field">
      <span>目标职位</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{placeholder}</option>
        {jobs.map((job) => (
          <option key={job.id} value={job.id}>
            {job.code} · {job.title}{job.isVirtual ? '（虚拟职位）' : ''}
          </option>
        ))}
      </select>
    </label>
  )
}

function ResultList({ results, onRetry, onConfirm }: {
  results: IntakeResult[]
  onRetry: (intakeId: string) => void
  onConfirm: (runId: string) => void
}) {
  if (!results.length) return null
  return (
    <div className="intake-file-list">
      {results.map((result) => {
        const meta = statusMeta[result.status]
        return (
          <div className="intake-file-row" key={result.intakeId}>
            <span className={cn('status-chip', meta.tone)}>{meta.label}</span>
            <span className="mono-cell">{result.intakeId.slice(-8)}</span>
            {result.duplicate && <span className="pill-tag pill-warn">查重命中</span>}
            {result.errorCode && <span className="cell-sub">{result.errorCode}：{result.errorMessage}</span>}
            <div className="toolbar-spacer" />
            {result.airRunId && result.status === 'PARSED' && (
              <button className="text-button" onClick={() => onConfirm(result.airRunId as string)}>
                <CheckCircle2 size={14} />确认草稿
              </button>
            )}
            {(result.status === 'FAILED' || result.status === 'NEEDS_MANUAL') && (
              <button className="text-button" onClick={() => onRetry(result.intakeId)}>
                <RefreshCw size={14} />重试解析
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

function UploadTab({ jobs }: { jobs: JobListItem[] }) {
  const { toast } = useApp()
  const inputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [jobId, setJobId] = useState('')
  const [source, setSource] = useState('UPLOAD')
  const [referrerName, setReferrerName] = useState('')
  const [referralCode, setReferralCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<IntakeResult[]>([])

  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    setFiles(Array.from(event.target.files ?? []))
  }

  const submit = async () => {
    if (!files.length) {
      toast('请先选择简历文件', 'info')
      return
    }
    setBusy(true)
    try {
      const created = await uploadResumes(files, {
        jobId: jobId || undefined,
        source,
        referrerName: referrerName.trim() || undefined,
        referralCode: referralCode.trim() || undefined,
      })
      setResults(created)
      setFiles([])
      setReferrerName('')
      setReferralCode('')
      if (inputRef.current) inputRef.current.value = ''
      toast(`已提交 ${created.length} 份简历，正在解析`)
    } catch (error) {
      toast(error instanceof Error ? error.message : '上传失败', 'info')
    } finally {
      setBusy(false)
    }
  }

  const retry = async (intakeId: string) => {
    try {
      await retryIntake(intakeId)
      toast('已重新提交解析')
    } catch (error) {
      toast(error instanceof Error ? error.message : '重试失败', 'info')
    }
  }

  const confirm = async (runId: string) => {
    try {
      await confirmAiRun(runId)
      toast('草稿已确认并转为正式档案')
    } catch (error) {
      toast(error instanceof Error ? error.message : '确认失败', 'info')
    }
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <h3><Upload size={15} />上传简历</h3>
          <p>支持 PDF / Word / 图片，单个文件不超过后端配置上限；多选即批量上传。</p>
        </div>
      </div>
      <div className="intake-form-grid">
        <div className="form-field">
          <span>简历文件</span>
          <label className="file-picker">
            <input ref={inputRef} type="file" multiple accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp" onChange={pick} />
            <span className="file-picker-btn"><Upload size={12} />选择文件</span>
            <span className={cn('file-picker-name', !files.length && 'empty')}>
              {files.length ? (files.length === 1 ? files[0].name : `已选择 ${files.length} 个文件`) : '未选择文件（支持多选）'}
            </span>
          </label>
        </div>
        <JobPicker jobs={jobs} value={jobId} onChange={setJobId} />
        <label className="form-field">
          <span>简历来源</span>
          <select value={source} onChange={(event) => setSource(event.target.value)}>
            {sourceOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="form-field">
          <span>推荐人</span>
          <input value={referrerName} onChange={(event) => setReferrerName(event.target.value)} placeholder="内推人姓名或员工标识" />
        </label>
        <label className="form-field">
          <span>来源标识</span>
          <input value={referralCode} onChange={(event) => setReferralCode(event.target.value)} placeholder="内推码或渠道活动标识" />
        </label>
        <div className="intake-form-actions">
          <button className="button button-primary" onClick={() => void submit()} disabled={busy}>
            <Upload size={16} />{busy ? '提交中…' : '开始上传'}
          </button>
        </div>
      </div>
      <ResultList results={results} onRetry={(id) => void retry(id)} onConfirm={(id) => void confirm(id)} />
    </div>
  )
}

function ManualTab({ jobs }: { jobs: JobListItem[] }) {
  const { toast } = useApp()
  const [form, setForm] = useState({
    name: '',
    phone: '',
    email: '',
    jobId: '',
    source: 'MANUAL',
    referrerName: '',
    referrerContact: '',
    referralCode: '',
    sourceNote: '',
  })
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<IntakeResult[]>([])

  const submit = async () => {
    if (!form.name.trim()) {
      toast('姓名必填', 'info')
      return
    }
    setBusy(true)
    try {
      const created = await createManualIntake({
        name: form.name.trim(),
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
        jobId: form.jobId || undefined,
        source: form.source,
        referrerName: form.referrerName.trim() || undefined,
        referrerContact: form.referrerContact.trim() || undefined,
        referralCode: form.referralCode.trim() || undefined,
        sourceNote: form.sourceNote.trim() || undefined,
      })
      setResults([created])
      setForm({
        name: '',
        phone: '',
        email: '',
        jobId: '',
        source: 'MANUAL',
        referrerName: '',
        referrerContact: '',
        referralCode: '',
        sourceNote: '',
      })
      toast('已创建候选人')
    } catch (error) {
      toast(error instanceof Error ? error.message : '创建失败', 'info')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <h3><PenLine size={15} />手工录入</h3>
          <p>解析失败降级人工录入的兜底入口；手机号与邮箱参与查重。</p>
        </div>
      </div>
      <div className="intake-form-grid">
        <label className="form-field"><span>姓名<em>*</em></span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="候选人姓名" /></label>
        <label className="form-field"><span>手机号</span><input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="11 位手机号" /></label>
        <label className="form-field"><span>邮箱</span><input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="name@example.com" /></label>
        <JobPicker jobs={jobs} value={form.jobId} onChange={(jobId) => setForm({ ...form, jobId })} />
        <label className="form-field">
          <span>简历来源</span>
          <select value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })}>
            {sourceOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="form-field">
          <span>推荐人</span>
          <input value={form.referrerName} onChange={(event) => setForm({ ...form, referrerName: event.target.value })} placeholder="内推人姓名或员工标识" />
        </label>
        <label className="form-field">
          <span>推荐人联系方式</span>
          <input value={form.referrerContact} onChange={(event) => setForm({ ...form, referrerContact: event.target.value })} placeholder="工号、手机号或邮箱" />
        </label>
        <label className="form-field">
          <span>来源标识</span>
          <input value={form.referralCode} onChange={(event) => setForm({ ...form, referralCode: event.target.value })} placeholder="内推码或渠道活动标识" />
        </label>
        <label className="form-field">
          <span>来源备注</span>
          <input value={form.sourceNote} onChange={(event) => setForm({ ...form, sourceNote: event.target.value })} placeholder="选填，仅记录来源信息" />
        </label>
        <div className="intake-form-actions">
          <button className="button button-primary" onClick={() => void submit()} disabled={busy}>
            <PenLine size={16} />{busy ? '提交中…' : '创建候选人'}
          </button>
        </div>
      </div>
      <ResultList
        results={results}
        onRetry={() => toast('手工录入无需重试解析', 'info')}
        onConfirm={() => toast('手工录入已是正式档案', 'info')}
      />
    </div>
  )
}

function EmailTab({ jobs }: { jobs: JobListItem[] }) {
  const { toast } = useApp()
  const [mailboxes, setMailboxes] = useState<MailboxConfig[]>([])
  const [form, setForm] = useState({
    mailboxAddress: '',
    from: '',
    subject: '',
    receivedAt: '',
    jobId: '',
  })
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<IntakeResult[]>([])

  useEffect(() => {
    listMailboxes()
      .then((result) => {
        setMailboxes(result.items)
        if (result.items[0]) setForm((prev) => ({ ...prev, mailboxAddress: result.items[0].address }))
      })
      .catch(() => setMailboxes([]))
  }, [])

  const submit = async () => {
    if (!files.length) {
      toast('请选择邮件附件', 'info')
      return
    }
    setBusy(true)
    try {
      const attachments = await Promise.all(files.map(async (file) => ({
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        contentBase64: await fileToBase64(file),
      })))
      const created = await mockEmailIntake({
        mailboxAddress: form.mailboxAddress.trim() || undefined,
        from: form.from.trim() || undefined,
        subject: form.subject.trim() || undefined,
        receivedAt: form.receivedAt ? new Date(form.receivedAt).toISOString() : undefined,
        jobId: form.jobId || undefined,
        attachments,
      })
      setResults(created)
      setFiles([])
      toast(`邮箱附件已入场 ${created.length} 份`)
    } catch (error) {
      toast(error instanceof Error ? error.message : '邮箱模拟失败', 'info')
    } finally {
      setBusy(false)
    }
  }

  const retry = async (intakeId: string) => {
    try {
      await retryIntake(intakeId)
      toast('已重新提交解析')
    } catch (error) {
      toast(error instanceof Error ? error.message : '重试失败', 'info')
    }
  }

  const confirm = async (runId: string) => {
    try {
      await confirmAiRun(runId)
      toast('草稿已确认')
    } catch (error) {
      toast(error instanceof Error ? error.message : '确认失败', 'info')
    }
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <h3><Mail size={15} />邮箱附件模拟</h3>
          <p>本期邮箱为 Mock：附件先入待分配池，由人事在「待分配池」手工选职位，不自动匹配。</p>
        </div>
      </div>
      <div className="intake-form-grid">
        <label className="form-field">
          <span>接收邮箱</span>
          <input list="intake-mailboxes" value={form.mailboxAddress} onChange={(event) => setForm({ ...form, mailboxAddress: event.target.value })} placeholder="hr@example.com" />
          <datalist id="intake-mailboxes">
            {mailboxes.map((mailbox) => <option key={mailbox.id} value={mailbox.address} />)}
          </datalist>
        </label>
        <label className="form-field"><span>发件人</span><input value={form.from} onChange={(event) => setForm({ ...form, from: event.target.value })} placeholder="candidate@example.com" /></label>
        <label className="form-field"><span>邮件主题</span><input value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} placeholder="应聘后端工程师" /></label>
        <label className="form-field"><span>接收时间</span><input type="datetime-local" value={form.receivedAt} onChange={(event) => setForm({ ...form, receivedAt: event.target.value })} /></label>
        <JobPicker jobs={jobs} value={form.jobId} onChange={(jobId) => setForm({ ...form, jobId })} />
        <div className="form-field">
          <span>邮件附件</span>
          <label className="file-picker">
            <input type="file" multiple accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp,.xlsx" onChange={(event) => setFiles(Array.from(event.target.files ?? []))} />
            <span className="file-picker-btn"><Paperclip size={12} />选择附件</span>
            <span className={cn('file-picker-name', !files.length && 'empty')}>
              {files.length ? (files.length === 1 ? files[0].name : `已选择 ${files.length} 个附件`) : '未选择附件（支持多选）'}
            </span>
          </label>
        </div>
        <div className="intake-form-actions">
          <button className="button button-primary" onClick={() => void submit()} disabled={busy}>
            <Mail size={16} />{busy ? '提交中…' : '模拟接收'}
          </button>
        </div>
      </div>
      <ResultList results={results} onRetry={(id) => void retry(id)} onConfirm={(id) => void confirm(id)} />
    </div>
  )
}

function ExcelTab() {
  const { toast } = useApp()
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ExcelImportResult | null>(null)

  const submit = async () => {
    if (!file) {
      toast('请选择 .xlsx 文件', 'info')
      return
    }
    setBusy(true)
    try {
      const imported = await importResumeExcel(file)
      setResult(imported)
      toast(`导入完成：成功 ${imported.successRows}，查重 ${imported.duplicateRows}，失败 ${imported.failedRows}`)
    } catch (error) {
      toast(error instanceof Error ? error.message : '导入失败', 'info')
    } finally {
      setBusy(false)
    }
  }

  const failedRows = useMemo(
    () => result?.rows.filter((row) => row.status === 'FAILED') ?? [],
    [result],
  )

  return (
    <div className="page-stack">
      <div className="panel">
        <div className="panel-header">
          <div>
            <h3><FileSpreadsheet size={15} />Excel 批量导入</h3>
            <p>Excel 为结构化数据，直接建档并标记已解析，不进入 AI 解析管道；单文件最多 500 行。</p>
          </div>
          <button className="text-button" onClick={() => void downloadExcelTemplate().catch((error) => toast(error.message, 'info'))}>
            <Download size={15} />下载模板
          </button>
        </div>
        <div className="intake-form-grid">
          <div className="form-field">
            <span>Excel 文件</span>
            <label className="file-picker">
              <input type="file" accept=".xlsx" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
              <span className="file-picker-btn"><FileSpreadsheet size={12} />选择表格</span>
              <span className={cn('file-picker-name', !file && 'empty')}>
                {file ? file.name : '请选择 .xlsx 文件'}
              </span>
            </label>
          </div>
          <div className="intake-form-actions">
            <button className="button button-primary" onClick={() => void submit()} disabled={busy}>
              <Upload size={16} />{busy ? '导入中…' : '开始导入'}
            </button>
          </div>
        </div>
      </div>

      {result && (
        <div className="panel">
          <div className="metric-strip">
            <div><span>总行数</span><strong>{result.totalRows}</strong></div>
            <div><span>成功建档</span><strong>{result.successRows}</strong></div>
            <div><span>查重跳过</span><strong>{result.duplicateRows}</strong></div>
            <div><span>失败行</span><strong>{result.failedRows}</strong></div>
          </div>
          {failedRows.length > 0 && (
            <div className="panel-header">
              <div><h3><AlertCircle size={15} />失败行</h3><p>可下载失败行修正后重新导入。</p></div>
              <button className="text-button" onClick={() => void downloadFailedRows(result.batchId).catch((error) => toast(error.message, 'info'))}>
                <Download size={15} />下载失败行
              </button>
            </div>
          )}
          <div className="intake-table-wrap">
            <table className="intake-table">
              <thead><tr><th>行号</th><th>姓名</th><th>手机号</th><th>职位编号</th><th>结果</th><th>说明</th></tr></thead>
              <tbody>
                {result.rows.map((row) => (
                  <tr key={`${row.rowNumber}-${row.status}`}>
                    <td className="mono-cell">{row.rowNumber}</td>
                    <td>{row.name ?? '—'}</td>
                    <td>{row.phone ?? '—'}</td>
                    <td>{row.jobCode ?? '—'}</td>
                    <td>
                      <span className={cn('status-chip', row.status === 'SUCCESS' ? 'status-on' : row.status === 'DUPLICATE' ? 'status-warn' : 'status-err')}>
                        {row.status === 'SUCCESS' ? '成功' : row.status === 'DUPLICATE' ? '查重' : '失败'}
                      </span>
                    </td>
                    <td className="cell-sub">{row.errorCode ? `${row.errorCode}：${row.errorMessage}` : row.errorMessage ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function RecordsTab({ jobs }: { jobs: JobListItem[] }) {
  const { toast } = useApp()
  const [data, setData] = useState<IntakeList | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const [mailbox, setMailbox] = useState('')
  const [entryMode, setEntryMode] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await listIntakes({
        status: status || undefined,
        mailbox: mailbox || undefined,
        entryMode: entryMode || undefined,
        page,
        pageSize: 10,
      })
      setData(result)
      setError(null)
    } catch (loadError) {
      setData(null)
      setError(loadError instanceof Error ? loadError.message : '入场记录加载失败')
    } finally {
      setLoading(false)
    }
  }, [status, mailbox, entryMode, page])

  useEffect(() => {
    void load()
  }, [load])

  const jobName = (jobId: string | null) => {
    const job = jobs.find((item) => item.id === jobId)
    return job ? `${job.code} · ${job.title}` : jobId ?? '待分配'
  }

  const retry = async (intakeId: string) => {
    try {
      await retryIntake(intakeId)
      toast('已重新提交解析')
      void load()
    } catch (retryError) {
      toast(retryError instanceof Error ? retryError.message : '重试失败', 'info')
    }
  }

  const confirm = async (runId: string) => {
    try {
      await confirmAiRun(runId)
      toast('草稿已确认')
      void load()
    } catch (confirmError) {
      toast(confirmError instanceof Error ? confirmError.message : '确认失败', 'info')
    }
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <div className="panel">
      <div className="filter-panel">
        <label className="form-field"><span>状态</span>
          <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }}>
            <option value="">全部状态</option>
            {Object.entries(statusMeta).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}
          </select>
        </label>
        <label className="form-field"><span>进入方式</span>
          <select value={entryMode} onChange={(event) => { setEntryMode(event.target.value); setPage(1) }}>
            <option value="">全部方式</option>
            {Object.entries(entryModeLabel).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <label className="form-field"><span>接收邮箱</span><input value={mailbox} onChange={(event) => { setMailbox(event.target.value); setPage(1) }} placeholder="按发件邮箱筛选" /></label>
        <button className="button button-secondary button-sm" onClick={() => void load()}><RefreshCw size={14} />刷新</button>
      </div>

      {loading && <div className="empty-inline">正在加载入场记录…</div>}
      {error && <div className="empty-inline">加载失败：{error}</div>}

      <div className="intake-table-wrap">
        <table className="intake-table">
          <thead><tr><th>候选人 / 文件</th><th>来源</th><th>进入方式</th><th>状态</th><th>职位</th><th>接收时间</th><th>失败原因</th><th /></tr></thead>
          <tbody>
            {(data?.items ?? []).map((item) => {
              const meta = statusMeta[item.status]
              return (
                <tr key={item.id}>
                  <td>
                    <strong>{item.candidate?.name ?? item.resumeFile?.fileName ?? '—'}</strong>
                    <small className="cell-sub">{item.resumeFile?.fileName ?? '无附件'}</small>
                  </td>
                  <td>{sourceLabel(item.source)}</td>
                  <td>{entryModeLabel[item.entryMode] ?? item.entryMode}</td>
                  <td>
                    <span className={cn('status-chip', meta.tone)}>{meta.label}</span>
                    {item.mergedAt && <span className="pill-tag">已合并</span>}
                  </td>
                  <td>{jobName(item.jobId)}</td>
                  <td>
                    {formatTime(item.receivedAt ?? item.createdAt)}
                    {item.mailboxAddress && <small className="cell-sub">{item.mailboxAddress}</small>}
                  </td>
                  <td className="cell-sub">{item.errorCode ? `${item.errorCode}：${item.errorMessage ?? ''}` : '—'}</td>
                  <td>
                    <div className="row-actions">
                      {item.resumeFileId && (
                        <button className="text-button" onClick={() => void openAttachment(item.resumeFileId as string).catch((openError) => toast(openError.message, 'info'))}>
                          <Paperclip size={14} />附件
                        </button>
                      )}
                      {item.airRunId && item.status === 'PARSED' && item.aiRun?.isDraft && (
                        <button className="text-button" onClick={() => void confirm(item.airRunId as string)}>
                          <CheckCircle2 size={14} />确认草稿
                        </button>
                      )}
                      {(item.status === 'FAILED' || item.status === 'NEEDS_MANUAL') && (
                        <button className="text-button" onClick={() => void retry(item.id)}>
                          <RefreshCw size={14} />重试
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {!loading && !error && (data?.items.length ?? 0) === 0 && (
          <div className="empty-state">
            <span><Inbox size={22} /></span>
            <h4>暂无入场记录</h4>
            <p>从上传、手工、邮箱或 Excel 入口开始导入简历。</p>
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

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, ChevronDown, Download, Plus, Search, Settings2, X } from 'lucide-react'
import { useApp } from '../context'
import { getCandidateDetail, request } from '../api'
import type { Candidate } from '../types'
import { cn } from '../utils'

type Row = {
  id: string
  candidateId: string
  jobId: string
  candidate: { name: string }
  round: number
  mode: string
  time: string
  endTime: string | null
  location: string | null
  status: string
  interviewerIds: string[]
  responses: Record<string, string> | null
}
type Person = { id: string; displayName: string }
type Field = { key: string; label: string; type: 'text' | 'textarea' | 'select'; required: boolean; options: string[] }
type Template = { id: string; fields: Field[] }
type Feedback = {
  conclusion: string | null
  id: string
  interviewerId: string
  filledById: string
  filledByMode: string
  proxyName: string | null
  proxyAt: string | null
  content: string
  createdAt: string
}
type TranscriptMaterial = {
  id: string
  source: string
  title: string | null
  summary: string | null
  originalText: string | null
  sourceRef: string
  fetchedAt: string
}
type Transcript = {
  id: string
  round: number
  url: string
  source: string
  minutesId: string | null
  materials: { id: string; source: string; title: string | null; fetchedAt: string }[]
  createdAt: string
}
type MinutesCapability = {
  state: 'AVAILABLE' | 'DENIED' | 'UNSUPPORTED' | 'UNAVAILABLE'
  configured: boolean
  checkedAt: string
  code: string | null
  manualEntryAvailable: boolean
}

const MODE_LABELS: Record<string, string> = {
  VIDEO: '视频',
  ONSITE: '现场',
  PHONE: '电话',
}

const STATUS_META: Record<string, { label: string; tone: string }> = {
  TO_SCHEDULE: { label: '待进行', tone: 'status-warn' },
  FEEDBACK_PENDING: { label: '待反馈', tone: 'status-warn' },
  COMPLETED: { label: '已完成', tone: 'status-on' },
  CANCELLED: { label: '已取消', tone: 'status-off' },
}

const RESPONSE_META: Record<string, { label: string; tone: string }> = {
  PENDING: { label: '待确认', tone: 'status-off' },
  ACCEPTED: { label: '已接受', tone: 'status-on' },
  DECLINED: { label: '已拒绝', tone: 'status-err' },
}

const CHANGE_ACTION_LABELS: Record<string, string> = {
  RESCHEDULE: '改期',
  CANCEL: '取消',
}

const CONCLUSION_LABELS: Record<string, string> = {
  PASS: '通过',
  HOLD: '待定',
  REJECT: '不通过',
}

const capabilityLabel = (capability: MinutesCapability | null) =>
  !capability
    ? '检测中'
    : `${({ AVAILABLE: '可用', DENIED: '无权限', UNSUPPORTED: '未配置', UNAVAILABLE: '不可用' } as Record<string, string>)[capability.state] ?? capability.state}${capability.code ? `（${capability.code}）` : ''}`

const send = <T,>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) })
const datePart = (s: string) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(s))
const localInput = (s: string) =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .format(new Date(s))
    .replace(' ', 'T')
const today = () => datePart(new Date().toISOString())
const timeLabel = (s: string) => new Date(s).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
const shortTimeLabel = (s: string) =>
  new Date(s).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
const message = (e: unknown) => (e instanceof Error ? e.message : '操作失败')
type ScheduleResult = { conflicts: string[]; availabilityStatus: string; calendar: string; calendarSyncStatus: string }
const scheduleMessage = (result: ScheduleResult, prefix: string) =>
  [
    prefix,
    result.availabilityStatus === 'UNAVAILABLE'
      ? '忙闲查询失败，请人工确认时间'
      : result.conflicts.length
        ? `${result.calendar === 'MOCK' ? 'Mock ' : ''}忙闲冲突：${result.conflicts.join('、')}`
        : '',
    result.calendarSyncStatus === 'PENDING'
      ? '日历同步排队中'
      : result.calendarSyncStatus === 'UNAVAILABLE'
        ? '日历同步入队失败，请联系管理员'
        : '日程邀请未启用',
  ]
    .filter(Boolean)
    .join('；')
const refreshEvent = () => window.dispatchEvent(new Event('interviews-changed'))

export function Interviews({ onOpenCandidate, openNew }: { onOpenCandidate: (id: string) => void; openNew: number }) {
  const { toast, apiJobs } = useApp()
  const [jobId, setJobId] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [error, setError] = useState('')
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [selected, setSelected] = useState<Row | null>(null)
  const [configure, setConfigure] = useState(false)

  const jobMap = useMemo(() => new Map(apiJobs.map((job) => [job.id, job.title])), [apiJobs])
  const peopleMap = useMemo(() => new Map(people.map((person) => [person.id, person.displayName])), [people])
  const personName = (id: string) => peopleMap.get(id) ?? id

  const load = useCallback(() => {
    const q = new URLSearchParams()
    if (keyword.trim()) q.set('keyword', keyword.trim())
    if (status) q.set('status', status)
    if (jobId) q.set('jobId', jobId)
    request<Row[]>(`/interviews?${q}`)
      .then((data) => {
        setRows(data)
        setError('')
      })
      .catch((e) => setError(message(e)))
  }, [keyword, status, jobId])

  useEffect(() => {
    load()
    window.addEventListener('interviews-changed', load)
    return () => window.removeEventListener('interviews-changed', load)
  }, [load])

  useEffect(() => {
    request<Person[]>('/interviews/interviewers').then(setPeople).catch(() => setPeople([]))
  }, [])

  useEffect(() => {
    if (openNew > 0) setShowCreate(true)
  }, [openNew])

  const exportCsv = () => {
    const quote = (v: unknown) => `"${String(v ?? '').replace(/^[=+\-@\t\r]/, "'$&").replace(/"/g, '""')}"`
    const csv = [
      ['候选人', '职位', '轮次', '开始', '结束', '形式', '面试官', '状态'],
      ...rows.map((r) => [
        r.candidate.name,
        jobMap.get(r.jobId) || r.jobId,
        r.round,
        timeLabel(r.time),
        r.endTime ? timeLabel(r.endTime) : '',
        MODE_LABELS[r.mode] ?? r.mode,
        r.interviewerIds.map(personName).join('、'),
        STATUS_META[r.status]?.label ?? r.status,
      ]),
    ]
      .map((line) => line.map(quote).join(','))
      .join('\r\n')
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }))
    link.download = '面试列表.csv'
    link.click()
    URL.revokeObjectURL(link.href)
  }

  const change = async (row: Row, action: 'CANCEL' | 'RESCHEDULE') => {
    const reason = window.prompt(action === 'CANCEL' ? '请输入取消原因' : '请输入改期原因')?.trim()
    if (!reason) {
      toast('原因必填', 'info')
      return
    }
    const startAt = action === 'RESCHEDULE' ? window.prompt('新开始时间（例如 2026-11-24T10:00:00+08:00）') : undefined
    const endAt = action === 'RESCHEDULE' ? window.prompt('新结束时间（例如 2026-11-24T11:00:00+08:00）') : undefined
    if (action === 'RESCHEDULE' && (!startAt || !endAt)) return
    try {
      const result = await send<ScheduleResult>(`/interviews/${row.id}/change`, { action, reason, startAt, endAt })
      toast(scheduleMessage(result, '已保存'))
      refreshEvent()
    } catch (e) {
      toast(message(e), 'info')
    }
  }

  const groups = [
    { title: '今天', test: (r: Row) => datePart(r.time) === today() },
    { title: '明天及以后', test: (r: Row) => datePart(r.time) > today() },
    { title: '昨天及以前', test: (r: Row) => datePart(r.time) < today() },
  ]

  return (
    <div className="page-stack">
      <div className="page-title-row">
        <div>
          <div className="eyebrow">面试协作 <span className="eyebrow-separator">·</span> 日程与反馈</div>
          <h2>面试安排</h2>
          <p>面试官响应状态以本系统记录为准；钉钉日历响应回读尚未接入。</p>
        </div>
        <div className="page-title-actions">
          <button className="button button-secondary" onClick={() => setConfigure(true)}><Settings2 size={15} />登记表字段</button>
          <button className="button button-secondary" onClick={exportCsv}><Download size={15} />导出筛选结果</button>
          <button className="button button-primary" onClick={() => setShowCreate(true)}><Plus size={16} />安排面试</button>
        </div>
      </div>

      <div className="panel">
        <div className="interview-filter-bar">
          <label className="table-search">
            <Search size={15} />
            <input placeholder="搜索候选人姓名" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
            {keyword && <button type="button" onClick={() => setKeyword('')} aria-label="清空搜索"><X size={13} /></button>}
          </label>
          <label className="filter-select">
            <span>职位</span>
            <select value={jobId} onChange={(e) => setJobId(e.target.value)}>
              <option value="">全部职位</option>
              {apiJobs.map((job) => <option key={job.id} value={job.id}>{job.title}</option>)}
            </select>
            <ChevronDown size={13} />
          </label>
          <label className="filter-select">
            <span>状态</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">全部状态</option>
              <option value="TO_SCHEDULE">待进行</option>
              <option value="FEEDBACK_PENDING">待反馈</option>
              <option value="COMPLETED">已完成</option>
              <option value="CANCELLED">已取消</option>
            </select>
            <ChevronDown size={13} />
          </label>
          <span className="result-count">共 {rows.length} 场面试</span>
        </div>

        {error && <p className="form-error" role="alert" style={{ padding: '0 19px' }}>{error}</p>}

        {groups.map((group) => {
          const list = rows.filter(group.test)
          return (
            <section className="interview-group" key={group.title}>
              <div className="interview-group-head">
                <h3>{group.title}</h3>
                <span className="count-pill">{list.length}</span>
              </div>
              {list.length > 0 ? (
                <div className="interview-group-list">
                  {list.map((row) => {
                    const statusMeta = STATUS_META[row.status] ?? { label: row.status, tone: 'status-off' }
                    return (
                      <div className="interview-card" data-interview-id={row.id} key={row.id}>
                        <div className="interview-time">
                          <i />
                          <strong>{shortTimeLabel(row.time)}</strong>
                          <span>{row.endTime ? `至 ${shortTimeLabel(row.endTime)}` : '未设置结束时间'}</span>
                        </div>
                        <div className="interview-candidate">
                          <div className="interview-candidate-copy">
                            <button className="interview-candidate-name" onClick={() => onOpenCandidate(row.candidateId)}>
                              {row.candidate.name}
                            </button>
                            <small>{jobMap.get(row.jobId) || row.jobId}</small>
                          </div>
                        </div>
                        <div className="interview-detail">
                          <strong>第 {row.round} 轮 · {MODE_LABELS[row.mode] ?? row.mode}</strong>
                          <span>{row.location || '未填写地点或会议链接'}</span>
                        </div>
                        <div className="interview-interviewers">
                          {row.interviewerIds.length > 0 ? (
                            row.interviewerIds.map((id) => {
                              const resp = row.responses?.[id] || 'PENDING'
                              const respMeta = RESPONSE_META[resp] ?? { label: resp, tone: 'status-off' }
                              return (
                                <span className="interviewer-pill" key={id}>
                                  <span>{personName(id)}</span>
                                  <span className={cn('status-chip', respMeta.tone)}>{respMeta.label}</span>
                                </span>
                              )
                            })
                          ) : (
                            <span className="cell-sub">未指定面试官</span>
                          )}
                        </div>
                        <div className="interview-actions">
                          <span className={cn('status-chip', statusMeta.tone)}>{statusMeta.label}</span>
                          <div className="interview-action-links">
                            <button className="text-button" onClick={() => setSelected(row)}>协同详情</button>
                            {row.status !== 'CANCELLED' && (
                              <>
                                <button className="text-button" onClick={() => change(row, 'RESCHEDULE')}>改期</button>
                                <button className="text-button" onClick={() => change(row, 'CANCEL')}>取消</button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="interview-group-empty">暂无面试</div>
              )}
            </section>
          )
        })}
      </div>

      {showCreate && <InterviewModal onClose={() => setShowCreate(false)} />}
      {selected && <InterviewDetail row={selected} personName={personName} onClose={() => setSelected(null)} />}
      {configure && <TemplateEditor onClose={() => setConfigure(false)} />}
    </div>
  )
}

const toBeijingIso = (localDateTime: string) => {
  const normalized = localDateTime.length === 16 ? `${localDateTime}:00` : localDateTime
  const parsed = new Date(`${normalized}+08:00`)
  if (Number.isNaN(parsed.getTime())) throw new Error('面试时间格式无效')
  return parsed.toISOString()
}

export function InterviewModal({ onClose, initialCandidate }: { onClose: () => void; initialCandidate?: string }) {
  const { data, toast } = useApp()
  const [candidateId, setCandidateId] = useState(initialCandidate || '')
  const [fetchedCandidate, setFetchedCandidate] = useState<Candidate | null>(null)
  const [people, setPeople] = useState<Person[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [round, setRound] = useState(1)
  const [mode, setMode] = useState('VIDEO')
  const [startAt, setStart] = useState('')
  const [endAt, setEnd] = useState('')
  const [location, setLocation] = useState('')
  const [busy, setBusy] = useState(false)
  const [availability, setAvailability] = useState<{ id: string; availabilitySlots: { startAt: string; endAt: string }[] }[]>([])

  const candidateList =
    fetchedCandidate && !data.candidates.some((c) => c.id === fetchedCandidate.id)
      ? [fetchedCandidate, ...data.candidates]
      : data.candidates
  const candidate = candidateList.find((c) => c.id === candidateId)

  useEffect(() => {
    if (!initialCandidate || data.candidates.some((c) => c.id === initialCandidate)) return
    let active = true
    void getCandidateDetail(initialCandidate)
      .then((item) => {
        if (active) setFetchedCandidate(item)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [initialCandidate, data.candidates])

  useEffect(() => {
    request<Person[]>('/interviews/interviewers')
      .then(setPeople)
      .catch((e) => toast(message(e), 'info'))
  }, [toast])

  useEffect(() => {
    if (!candidateId) {
      setAvailability([])
      return
    }
    request<typeof availability>(`/interviews/availability/${encodeURIComponent(candidateId)}`)
      .then(setAvailability)
      .catch((e) => toast(message(e), 'info'))
  }, [candidateId, toast])

  const slots = availability.flatMap((a) => (a.availabilitySlots || []).map((slot, index) => ({ key: `${a.id}-${index}`, slot })))

  const submit = async () => {
    if (busy) return
    setBusy(true)
    try {
      if (!candidate || !candidate.jobId || !startAt || !endAt) throw new Error('请选择已分配职位的候选人并填写时间')
      const result = await send<ScheduleResult>('/interviews', {
        candidateId,
        jobId: candidate.jobId,
        round,
        mode,
        startAt: toBeijingIso(startAt),
        endAt: toBeijingIso(endAt),
        location,
        interviewerIds: selected,
      })
      toast(scheduleMessage(result, '已安排'))
      refreshEvent()
      onClose()
    } catch (e) {
      toast(message(e), 'info')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal interview-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <span className="modal-icon"><CalendarDays size={18} /></span>
            <div>
              <h3>安排面试</h3>
              <p>时间按北京时间录入，排期将保留业务协作记录</p>
            </div>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭"><X size={18} /></button>
        </div>
        <div className="modal-body">
          <label className="form-field">
            <span>候选人</span>
            <select value={candidateId} onChange={(e) => setCandidateId(e.target.value)}>
              <option value="">请选择</option>
              {candidateList.filter((c) => c.jobId).map((c) => (
                <option key={c.id} value={c.id}>{c.name} · {c.jobTitle || c.jobId}</option>
              ))}
            </select>
          </label>

          {slots.length > 0 && (
            <div className="form-field">
              <span>筛选通过时记录的可约面时间（点击自动填入）</span>
              <div className="availability-chip-list">
                {slots.map(({ key, slot }) => (
                  <button
                    type="button"
                    className="availability-chip"
                    key={key}
                    onClick={() => {
                      setStart(localInput(slot.startAt))
                      setEnd(localInput(slot.endAt))
                    }}
                  >
                    {shortTimeLabel(slot.startAt)} — {shortTimeLabel(slot.endAt)}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="form-grid">
            <label className="form-field">
              <span>轮次</span>
              <input type="number" min="1" value={round} onChange={(e) => setRound(Number(e.target.value))} />
            </label>
            <label className="form-field">
              <span>形式</span>
              <select value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="VIDEO">视频</option>
                <option value="ONSITE">现场</option>
                <option value="PHONE">电话</option>
              </select>
            </label>
          </div>
          <div className="form-grid">
            <label className="form-field">
              <span>开始时间</span>
              <input type="datetime-local" value={startAt} onChange={(e) => setStart(e.target.value)} />
            </label>
            <label className="form-field">
              <span>结束时间</span>
              <input type="datetime-local" value={endAt} onChange={(e) => setEnd(e.target.value)} />
            </label>
          </div>
          <label className="form-field">
            <span>地点或会议链接</span>
            <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="例如：3F 海棠会议室 或视频会议链接" />
          </label>
          <div className="form-field">
            <span>面试官（可多选）</span>
            <div className="interviewer-checklist">
              {people.map((p) => (
                <label key={p.id} className="interviewer-check-item">
                  <input
                    type="checkbox"
                    checked={selected.includes(p.id)}
                    onChange={(e) => setSelected(e.target.checked ? [...selected, p.id] : selected.filter((id) => id !== p.id))}
                  />
                  <span>{p.displayName}</span>
                </label>
              ))}
              {people.length === 0 && <span className="cell-sub">暂无可选面试官</span>}
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="button button-secondary" onClick={onClose}>取消</button>
          <button className="button button-primary" disabled={busy} onClick={submit}>{busy ? '提交中…' : '安排'}</button>
        </div>
      </div>
    </div>
  )
}

function TemplateEditor({ onClose }: { onClose: () => void }) {
  const { toast } = useApp()
  const [fields, setFields] = useState<Field[]>([{ key: 'name', label: '姓名', type: 'text', required: true, options: [] }])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    request<Template | null>('/interviews/registration/template')
      .then((t) => {
        if (t) setFields(t.fields)
      })
      .catch((e) => toast(message(e), 'info'))
  }, [toast])

  const update = (i: number, patch: Partial<Field>) => setFields(fields.map((f, index) => (i === index ? { ...f, ...patch } : f)))
  const save = async () => {
    setSaving(true)
    try {
      await send('/interviews/registration/template', { fields })
      toast('登记表模板已保存，新提交使用新版本')
      onClose()
    } catch (e) {
      toast(message(e), 'info')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal interview-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <span className="modal-icon"><Settings2 size={18} /></span>
            <div>
              <h3>配置登记表字段</h3>
              <p>保存后立即生成新模板版本，不影响已提交记录</p>
            </div>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭"><X size={18} /></button>
        </div>
        <div className="modal-body">
          {fields.map((f, i) => (
            <div className="template-field-card" key={i}>
              <div className="form-grid">
                <label className="form-field"><span>字段标识</span><input value={f.key} onChange={(e) => update(i, { key: e.target.value })} /></label>
                <label className="form-field"><span>显示名称</span><input value={f.label} onChange={(e) => update(i, { label: e.target.value })} /></label>
              </div>
              <div className="template-field-row">
                <label className="form-field form-field-inline">
                  <span>类型</span>
                  <select value={f.type} onChange={(e) => update(i, { type: e.target.value as Field['type'] })}>
                    <option value="text">文本</option>
                    <option value="textarea">多行文本</option>
                    <option value="select">单选</option>
                  </select>
                </label>
                <label className="admin-check">
                  <input type="checkbox" checked={f.required} onChange={(e) => update(i, { required: e.target.checked })} />
                  <span>必填</span>
                </label>
                <button type="button" className="text-button" style={{ marginLeft: 'auto' }} onClick={() => setFields(fields.filter((_, n) => n !== i))}>
                  删除字段
                </button>
              </div>
              {f.type === 'select' && (
                <label className="form-field">
                  <span>单选选项（逗号分隔）</span>
                  <input value={f.options.join(',')} onChange={(e) => update(i, { options: e.target.value.split(',') })} />
                </label>
              )}
            </div>
          ))}
          <button
            type="button"
            className="button button-secondary button-sm"
            onClick={() => setFields([...fields, { key: '', label: '', type: 'text', required: false, options: [] }])}
          >
            <Plus size={14} />添加字段
          </button>
        </div>
        <div className="modal-footer">
          <button className="button button-secondary" onClick={onClose}>取消</button>
          <button className="button button-primary" disabled={saving} onClick={save}>{saving ? '保存中…' : '保存模板'}</button>
        </div>
      </div>
    </div>
  )
}

function TranscriptMaterials({ interviewId, link, onChanged }: { interviewId: string; link: Transcript; onChanged: () => void }) {
  const { toast } = useApp()
  const [materials, setMaterials] = useState<TranscriptMaterial[] | null>(null)
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [originalText, setOriginalText] = useState('')
  const [busy, setBusy] = useState(false)

  const run = async (path: string, body: unknown, success: string) => {
    setBusy(true)
    try {
      await send(path, body)
      toast(success)
      onChanged()
    } catch (e) {
      toast(message(e), 'info')
    } finally {
      setBusy(false)
    }
  }

  const loadMaterials = async () => {
    try {
      const result = await request<{ materials: TranscriptMaterial[] }>(`/interviews/${interviewId}/transcripts/${link.id}/materials`)
      setMaterials(result.materials ?? [])
    } catch (e) {
      toast(message(e), 'info')
    }
  }

  return (
    <div className="transcript-card">
      <div className="button-row">
        <button className="button button-secondary button-sm" disabled={busy} onClick={() => run(`/interviews/${interviewId}/transcripts/${link.id}/fetch`, {}, '听记素材已读取')}>
          读取听记素材
        </button>
        <button className="button button-secondary button-sm" onClick={loadMaterials}>
          查看素材（{link.materials.length}）
        </button>
        <button className="button button-primary button-sm" disabled={busy || link.materials.length === 0} onClick={() => run(`/interviews/${interviewId}/transcripts/${link.id}/interview-eval`, {}, '已生成 INTERVIEW_EVAL 草稿任务')}>
          交付 AI 评估
        </button>
      </div>
      {materials && materials.length === 0 && <p className="hint">暂无素材，可读取钉钉听记或粘贴原文。</p>}
      {materials && materials.map((material) => (
        <details className="transcript-material-item" key={material.id}>
          <summary>{material.source === 'DINGTALK' ? '钉钉听记' : '人工录入'} · {material.title || '未命名'} · {timeLabel(material.fetchedAt)}</summary>
          <pre>{material.originalText || material.summary}</pre>
          <p className="hint">来源：{material.sourceRef}</p>
        </details>
      ))}
      <details>
        <summary className="text-button">粘贴原文或摘要（听记不可用时的降级通道）</summary>
        <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
          <label className="form-field"><span>标题</span><input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
          <label className="form-field"><span>摘要</span><textarea rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} /></label>
          <label className="form-field"><span>转写原文</span><textarea rows={3} value={originalText} onChange={(e) => setOriginalText(e.target.value)} /></label>
          <div className="button-row">
            <button
              className="button button-secondary button-sm"
              disabled={busy || (!summary.trim() && !originalText.trim())}
              onClick={async () => {
                await run(`/interviews/${interviewId}/transcripts/${link.id}/materials`, { title, summary, originalText }, '素材已保存')
                setTitle('')
                setSummary('')
                setOriginalText('')
              }}
            >
              保存人工素材
            </button>
          </div>
        </div>
      </details>
    </div>
  )
}

function InterviewDetail({
  row,
  personName,
  onClose,
}: {
  row: Row
  personName: (id: string) => string
  onClose: () => void
}) {
  const { toast } = useApp()
  const [feedback, setFeedback] = useState<Feedback[]>([])
  const [transcripts, setTranscripts] = useState<Transcript[]>([])
  const [template, setTemplate] = useState<Template | null>(null)
  const [forms, setForms] = useState<{ id: string; values: Record<string, string>; createdAt: string }[]>([])
  const [values, setValues] = useState<Record<string, string>>({})
  const [interviewerId, setInterviewerId] = useState(row.interviewerIds[0] || '')
  const [content, setContent] = useState('')
  const [conclusion, setConclusion] = useState('HOLD')
  const [url, setUrl] = useState('')
  const [history, setHistory] = useState<{ id: string; action: string; actorId: string; reason: string; createdAt: string }[]>([])
  const [inviteLink, setInviteLink] = useState('')
  const [notifications, setNotifications] = useState<{ id: string; action: string; recipient: string }[]>([])
  const [capability, setCapability] = useState<MinutesCapability | null>(null)

  const loadCapability = () => request<MinutesCapability>('/interviews/minutes/capability').then(setCapability).catch(() => setCapability(null))
  const load = useCallback(() => {
    request<typeof history>(`/interviews/${row.id}/history`).then(setHistory).catch(() => setHistory([]))
    request<typeof notifications>(`/interviews/${row.id}/mock-notifications`).then(setNotifications).catch(() => setNotifications([]))
    Promise.all([
      request<Feedback[]>(`/interviews/${row.id}/feedback`),
      request<Transcript[]>(`/interviews/${row.id}/transcripts`),
      request<Template | null>('/interviews/registration/template'),
      request<typeof forms>(`/interviews/${row.id}/registration`).catch(() => []),
    ])
      .then(([f, t, templateResult, formResult]) => {
        setFeedback(f)
        setTranscripts(t)
        setTemplate(templateResult)
        setForms(formResult)
      })
      .catch((e) => toast(message(e), 'info'))
  }, [row.id, toast])

  useEffect(load, [load])
  useEffect(() => {
    loadCapability()
  }, [])

  const act = async (path: string, body: unknown, success: string) => {
    try {
      await send(path, body)
      toast(success)
      load()
      refreshEvent()
    } catch (e) {
      toast(message(e), 'info')
    }
  }

  const nudge = async () => {
    try {
      const result = await send<{ queued: number }>(`/interviews/${row.id}/feedback/nudge`, {})
      toast(result.queued ? `已为 ${result.queued} 位面试官排队催评，实际投递取决于通知配置` : '没有需要催评的面试官')
      load()
      refreshEvent()
    } catch (e) {
      toast(message(e), 'info')
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal interview-detail-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <span className="modal-icon"><CalendarDays size={18} /></span>
            <div>
              <h3>{row.candidate.name} · 第 {row.round} 轮面试协同</h3>
              <p>{timeLabel(row.time)} · {MODE_LABELS[row.mode] ?? row.mode}{row.location ? ` · ${row.location}` : ''}</p>
            </div>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭"><X size={18} /></button>
        </div>

        <div className="modal-body">
          <section className="interview-section">
            <div className="interview-section-head">
              <h4>Mock 邀请响应</h4>
              <span className="hint">仅受邀面试官本人可操作</span>
            </div>
            <div className="button-row">
              <button className="button button-secondary button-sm" onClick={() => act(`/interviews/${row.id}/response`, { response: 'ACCEPTED' }, '已模拟接受')}>接受邀请</button>
              <button className="button button-secondary button-sm" onClick={() => act(`/interviews/${row.id}/response`, { response: 'DECLINED' }, '已模拟拒绝')}>拒绝邀请</button>
            </div>
          </section>

          <section className="interview-section">
            <div className="interview-section-head">
              <h4>改期与取消记录</h4>
            </div>
            <div className="interview-meta-list">
              {history.length > 0 ? history.map((h) => (
                <p key={h.id}>{timeLabel(h.createdAt)} · {CHANGE_ACTION_LABELS[h.action] ?? h.action} · {personName(h.actorId)} · {h.reason}</p>
              )) : <span className="cell-sub">暂无变更记录</span>}
            </div>
            {notifications.length > 0 && (
              <>
                <div className="interview-section-head"><h4>Mock 通知记录</h4></div>
                <div className="interview-meta-list">
                  {notifications.map((n) => <p key={n.id}>{n.action} · {personName(n.recipient)}（模拟）</p>)}
                </div>
              </>
            )}
          </section>

          <section className="interview-section">
            <div className="interview-section-head">
              <h4>面试评价</h4>
              <button className="button button-secondary button-sm" onClick={nudge}>催促未评价面试官</button>
            </div>
            {feedback.length > 0 && (
              <div className="interview-meta-list">
                {feedback.map((f) => (
                  <p key={f.id}>
                    <strong>{personName(f.interviewerId)}</strong> · {CONCLUSION_LABELS[f.conclusion ?? ''] ?? (f.conclusion || '未记录结论')}：{f.content}
                    {f.filledByMode === 'PROXY' && <span>（代填 · {f.proxyName || personName(f.filledById)}{f.proxyAt ? ` · ${timeLabel(f.proxyAt)}` : ''}）</span>}
                  </p>
                ))}
              </div>
            )}
            <div className="form-grid">
              <label className="form-field">
                <span>评价人</span>
                <select value={interviewerId} onChange={(e) => setInterviewerId(e.target.value)}>
                  {row.interviewerIds.map((id) => <option key={id} value={id}>{personName(id)}</option>)}
                </select>
              </label>
              <label className="form-field">
                <span>评价结论</span>
                <select value={conclusion} onChange={(e) => setConclusion(e.target.value)}>
                  <option value="PASS">通过</option>
                  <option value="HOLD">待定</option>
                  <option value="REJECT">不通过</option>
                </select>
              </label>
            </div>
            <label className="form-field">
              <span>评价内容</span>
              <textarea rows={2} value={content} onChange={(e) => setContent(e.target.value)} placeholder="记录面试评价要点" />
            </label>
            <div className="button-row">
              <button className="button button-primary button-sm" onClick={() => act(`/interviews/${row.id}/feedback`, { interviewerId, content, conclusion }, '评价已记录，候选人阶段未改变')}>
                提交评价
              </button>
            </div>
          </section>

          <section className="interview-section">
            <div className="interview-section-head">
              <h4>听记链接与 AI 评估</h4>
              <button className="text-button" onClick={loadCapability}>读取能力：{capabilityLabel(capability)} · 重新检测</button>
            </div>
            {transcripts.map((t) => (
              <div key={t.id} style={{ display: 'grid', gap: 6 }}>
                <p style={{ fontSize: 12 }}>
                  第 {t.round} 轮：<a href={t.url} target="_blank" rel="noreferrer">{t.url}</a>
                  {t.source === 'DINGTALK' && <span className="hint">（钉钉听记{t.minutesId ? ` ${t.minutesId}` : '，待解析'}）</span>}
                </p>
                <TranscriptMaterials interviewId={row.id} link={t} onChanged={load} />
              </div>
            ))}
            <div className="admin-inline-form" style={{ marginTop: 4, paddingTop: 10 }}>
              <input className="admin-input" style={{ flex: 1 }} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://shanji.dingtalk.com/..." />
              <button className="button button-secondary button-sm" onClick={() => act(`/interviews/${row.id}/transcripts`, { url }, '链接已追加')}>追加链接</button>
            </div>
          </section>

          <section className="interview-section">
            <div className="interview-section-head">
              <h4>面试登记表</h4>
              <button
                className="button button-secondary button-sm"
                onClick={async () => {
                  try {
                    const invite = await send<{ token: string }>(`/interviews/${row.id}/registration-invite`, {})
                    setInviteLink(`${window.location.origin}/registration#${invite.token}`)
                  } catch (e) {
                    toast(message(e), 'info')
                  }
                }}
              >
                生成候选人填写链接
              </button>
            </div>
            {inviteLink && (
              <label className="form-field">
                <span>一次性链接（请通过授权渠道交给候选人）</span>
                <input readOnly value={inviteLink} />
              </label>
            )}
            {forms.length > 0 && (
              <div className="interview-meta-list">
                {forms.map((f) => (
                  <p key={f.id}>{timeLabel(f.createdAt)}：{Object.entries(f.values).map(([k, v]) => `${k}: ${v}`).join('；')}</p>
                ))}
              </div>
            )}
            {template ? (
              <div style={{ display: 'grid', gap: 10 }}>
                {template.fields.map((f) => (
                  <label className="form-field" key={f.key}>
                    <span>{f.label}{f.required && <em>*</em>}</span>
                    {f.type === 'select' ? (
                      <select value={values[f.key] || ''} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}>
                        <option value="">请选择</option>
                        {f.options.map((o) => <option key={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input value={values[f.key] || ''} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
                    )}
                  </label>
                ))}
                <div className="button-row">
                  <button className="button button-primary button-sm" onClick={() => act(`/interviews/${row.id}/registration`, { templateId: template.id, values }, '登记表已保存')}>
                    保存登记表
                  </button>
                </div>
              </div>
            ) : (
              <p className="hint">请先配置登记表字段。</p>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

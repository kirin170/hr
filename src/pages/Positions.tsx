import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { AlertCircle, BriefcaseBusiness, CalendarClock, ChevronDown, Plus, RefreshCw, Search, X } from 'lucide-react'
import {
  changeRequisitionStartDate,
  closeJob,
  closeRequisition,
  createJob,
  listDepartments,
  listJobs,
  listRequisitions,
  listUsers,
  revertRequisition,
  syncRequisition,
  updateJob,
  updateRequisition,
} from '../api'
import { useApp } from '../context'
import type { ApiDepartment, ApiRequisition, ApiUser, JobListItem } from '../types'
import { cn } from '../utils'

type Tab = 'jobs' | 'requisitions'

const statusLabel: Record<string, string> = { ACTIVE: '招聘中', CLOSED: '已关闭' }

const today = () => new Date().toISOString().slice(0, 10)

export function Positions() {
  const { toast } = useApp()
  const [tab, setTab] = useState<Tab>('jobs')
  const [departments, setDepartments] = useState<ApiDepartment[]>([])
  const [users, setUsers] = useState<ApiUser[]>([])

  const [jobs, setJobs] = useState<JobListItem[]>([])
  const [jobsLoading, setJobsLoading] = useState(true)
  const [jobsError, setJobsError] = useState<string | null>(null)
  const [jobKeyword, setJobKeyword] = useState('')
  const [jobStatus, setJobStatus] = useState('')
  const [jobChannel, setJobChannel] = useState('')
  const [jobForm, setJobForm] = useState<JobListItem | 'new' | null>(null)

  const [requisitions, setRequisitions] = useState<ApiRequisition[]>([])
  const [requisitionTotal, setRequisitionTotal] = useState(0)
  const [requisitionLoading, setRequisitionLoading] = useState(true)
  const [requisitionError, setRequisitionError] = useState<string | null>(null)
  const [requisitionKeyword, setRequisitionKeyword] = useState('')
  const [requisitionStatus, setRequisitionStatus] = useState('')
  const [cycleMin, setCycleMin] = useState('')
  const [cycleMax, setCycleMax] = useState('')
  const [requisitionSort, setRequisitionSort] = useState('updatedAt')
  const [requisitionForm, setRequisitionForm] = useState<ApiRequisition | 'new' | null>(null)
  const [closingRequisition, setClosingRequisition] = useState<ApiRequisition | null>(null)
  const [startDateTarget, setStartDateTarget] = useState<ApiRequisition | null>(null)

  const departmentName = useMemo(() => {
    const map = new Map(departments.map((department) => [department.id, department.name]))
    return (id: string) => map.get(id) ?? id
  }, [departments])

  const userName = useMemo(() => {
    const map = new Map(users.map((user) => [user.id, user.displayName]))
    return (id: string | null) => (id ? map.get(id) ?? id : '未指定')
  }, [users])

  const loadJobs = useCallback(async () => {
    setJobsLoading(true)
    try {
      setJobs(await listJobs({ keyword: jobKeyword, status: jobStatus, channel: jobChannel }))
      setJobsError(null)
    } catch (error) {
      setJobs([])
      setJobsError(error instanceof Error ? error.message : '职位加载失败')
    } finally {
      setJobsLoading(false)
    }
  }, [jobKeyword, jobStatus, jobChannel])

  const loadRequisitions = useCallback(async () => {
    setRequisitionLoading(true)
    try {
      const result = await listRequisitions({
        keyword: requisitionKeyword,
        status: requisitionStatus,
        cycleMin: cycleMin ? Number(cycleMin) : undefined,
        cycleMax: cycleMax ? Number(cycleMax) : undefined,
        sort: requisitionSort,
        order: 'desc',
      })
      setRequisitions(result.items)
      setRequisitionTotal(result.total)
      setRequisitionError(null)
    } catch (error) {
      setRequisitions([])
      setRequisitionTotal(0)
      setRequisitionError(error instanceof Error ? error.message : '招聘需求加载失败')
    } finally {
      setRequisitionLoading(false)
    }
  }, [requisitionKeyword, requisitionStatus, cycleMin, cycleMax, requisitionSort])

  useEffect(() => {
    void loadJobs()
  }, [loadJobs])

  useEffect(() => {
    void loadRequisitions()
  }, [loadRequisitions])

  useEffect(() => {
    listDepartments().then(setDepartments).catch(() => setDepartments([]))
    listUsers().then(setUsers).catch(() => setUsers([]))
  }, [])

  const refreshAll = () => {
    void loadJobs()
    void loadRequisitions()
  }

  const handleCloseJob = async (job: JobListItem) => {
    try {
      const result = await closeJob(job.id)
      toast(result.changed ? `职位 ${job.code} 已关闭，流程中候选人不受影响` : '职位已是关闭状态')
      void loadJobs()
    } catch (error) {
      toast(error instanceof Error ? error.message : '关闭职位失败', 'info')
    }
  }

  const handleRevert = async (requisition: ApiRequisition) => {
    try {
      await revertRequisition(requisition.id)
      toast('需求已回退为招聘中，历次关闭记录保留在时间线')
      void loadRequisitions()
    } catch (error) {
      toast(error instanceof Error ? error.message : '回退失败', 'info')
    }
  }

  const activeCount = requisitions.filter((item) => item.status === 'ACTIVE').length
  const closedCount = requisitions.filter((item) => item.status === 'CLOSED').length

  return <div className="page-stack">
    <div className="page-title-row">
      <div>
        <div className="eyebrow">职位与 HC <span className="eyebrow-separator">·</span> 需求级招聘周期</div>
        <h2>职位与招聘需求</h2>
        <p>HC 审批与职位发布分离；招聘周期按需求计算，职位变动不改变已算周期。</p>
      </div>
      <div className="page-title-actions">
        <button className="button button-secondary" onClick={refreshAll}><RefreshCw size={16} />刷新</button>
        {tab === 'jobs'
          ? <button className="button button-primary" onClick={() => setJobForm('new')}><Plus size={17} />新建职位</button>
          : <button className="button button-primary" onClick={() => setRequisitionForm('new')}><Plus size={17} />同步 OA 需求</button>}
      </div>
    </div>

    <div className="team-tabs">
      <button className={cn(tab === 'jobs' && 'active')} onClick={() => setTab('jobs')}>职位 <span>{jobs.length}</span></button>
      <button className={cn(tab === 'requisitions' && 'active')} onClick={() => setTab('requisitions')}>招聘需求 <span>{requisitionTotal}</span></button>
    </div>

    {tab === 'jobs' && <section className="panel">
      <div className="filter-panel">
        <label className="table-search"><Search size={15} /><input placeholder="搜索职位名称或编号" value={jobKeyword} onChange={(event) => setJobKeyword(event.target.value)} />{jobKeyword && <button onClick={() => setJobKeyword('')}><X size={13} /></button>}</label>
        <label className="filter-select"><span>状态</span><select value={jobStatus} onChange={(event) => setJobStatus(event.target.value)}><option value="">全部</option><option value="ACTIVE">招聘中</option><option value="CLOSED">已关闭</option></select><ChevronDown size={13} /></label>
        <label className="filter-select"><span>渠道</span><select value={jobChannel} onChange={(event) => setJobChannel(event.target.value)}><option value="">全部</option><option value="BOSS">BOSS直聘</option><option value="猎聘">猎聘</option><option value="内推">内推</option><option value="校招">校招</option></select><ChevronDown size={13} /></label>
      </div>
      {jobsError && <Notice tone="error">{jobsError}</Notice>}
      <table className="candidate-table">
        <thead><tr><th>编号</th><th>职位</th><th>部门</th><th>招聘负责人</th><th>渠道</th><th>HC（入职/招聘）</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>
          {jobs.map((job) => <tr key={job.id}>
            <td><span className="mono-cell">{job.code}</span></td>
            <td><strong>{job.title}</strong>{job.isVirtual && <span className="pill-tag">虚拟职位</span>}</td>
            <td>{departmentName(job.departmentId)}</td>
            <td>{userName(job.recruiterId)}</td>
            <td>{job.channel ?? '—'}</td>
            <td>
              <span>{job.hiredCount}/{job.headcount}</span>
              {job.headcountHint && <span className="pill-tag pill-warn" title={job.headcountHint}>HC 已满</span>}
            </td>
            <td><span className={cn('status-chip', job.status === 'ACTIVE' ? 'status-on' : 'status-off')}>{statusLabel[job.status]}</span></td>
            <td className="row-actions">
              <button className="text-button" onClick={() => setJobForm(job)}>编辑</button>
              {job.status === 'ACTIVE' && <button className="text-button" onClick={() => void handleCloseJob(job)}>关闭</button>}
            </td>
          </tr>)}
        </tbody>
      </table>
      <div className="table-footer"><span>{jobsLoading ? '加载中…' : `共 ${jobs.length} 个职位（默认不含虚拟职位）`}</span></div>
    </section>}

    {tab === 'requisitions' && <section className="panel">
      <div className="filter-panel">
        <label className="table-search"><Search size={15} /><input placeholder="搜索需求名称或 OA 单号" value={requisitionKeyword} onChange={(event) => setRequisitionKeyword(event.target.value)} />{requisitionKeyword && <button onClick={() => setRequisitionKeyword('')}><X size={13} /></button>}</label>
        <label className="filter-select"><span>状态</span><select value={requisitionStatus} onChange={(event) => setRequisitionStatus(event.target.value)}><option value="">全部</option><option value="ACTIVE">招聘中</option><option value="CLOSED">已关闭</option></select><ChevronDown size={13} /></label>
        <label className="filter-select"><span>周期 ≥</span><input className="mini-input" inputMode="numeric" value={cycleMin} onChange={(event) => setCycleMin(event.target.value.replace(/\D/g, ''))} placeholder="天" /></label>
        <label className="filter-select"><span>周期 ≤</span><input className="mini-input" inputMode="numeric" value={cycleMax} onChange={(event) => setCycleMax(event.target.value.replace(/\D/g, ''))} placeholder="天" /></label>
        <label className="filter-select"><span>排序</span><select value={requisitionSort} onChange={(event) => setRequisitionSort(event.target.value)}><option value="updatedAt">最近更新</option><option value="cycleDays">招聘周期</option><option value="recruitmentStartDate">开始招聘时间</option><option value="closedAt">关闭时间</option><option value="inProgressDays">在招时长</option></select><ChevronDown size={13} /></label>
      </div>
      {requisitionError && <Notice tone="error">{requisitionError}</Notice>}
      <div className="metric-strip">
        <div><span>在招需求</span><strong>{activeCount}</strong></div>
        <div><span>已关闭需求</span><strong>{closedCount}</strong></div>
        <div><span>周期口径</span><strong>自然日</strong><small>同日计 1 天</small></div>
      </div>
      <table className="candidate-table">
        <thead><tr><th>OA 单号</th><th>需求</th><th>部门</th><th>状态</th><th>提报时间</th><th>开始招聘时间</th><th>关闭时间</th><th>招聘周期</th><th>操作</th></tr></thead>
        <tbody>
          {requisitions.map((requisition) => <tr key={requisition.id}>
            <td><span className="mono-cell">{requisition.oaApprovalId}</span></td>
            <td><strong>{requisition.title}</strong><small className="cell-sub">{requisition.headcount} HC · {userName(requisition.recruiterId)}</small></td>
            <td>{departmentName(requisition.departmentId)}</td>
            <td><span className={cn('status-chip', requisition.status === 'ACTIVE' ? 'status-on' : 'status-off')}>{statusLabel[requisition.status]}</span></td>
            <td>{requisition.submittedAt ?? '—'}<small className="cell-sub">仅记录</small></td>
            <td>{requisition.recruitmentStartDate ?? '—'}</td>
            <td>{requisition.closedAt ?? '—'}</td>
            <td>{requisition.status === 'ACTIVE'
              ? <span className="cycle-live">{requisition.inProgressLabel ?? '—'}</span>
              : requisition.cycleDays === null
                ? <span className="cell-sub">存量未补录，不纳入统计</span>
                : <strong>{requisition.cycleDays} 天</strong>}</td>
            <td className="row-actions">
              <button className="text-button" onClick={() => setRequisitionForm(requisition)}>编辑</button>
              {requisition.status === 'ACTIVE' && <button className="text-button" onClick={() => setStartDateTarget(requisition)}>改开始时间</button>}
              {requisition.status === 'ACTIVE' && <button className="text-button" onClick={() => setClosingRequisition(requisition)}>关闭</button>}
              {requisition.status === 'CLOSED' && requisition.cycleEligible && <button className="text-button" onClick={() => void handleRevert(requisition)}>回退</button>}
            </td>
          </tr>)}
        </tbody>
      </table>
      <div className="table-footer"><span>{requisitionLoading ? '加载中…' : `共 ${requisitionTotal} 条需求；周期筛选与排序均在招聘需求列表内`}</span></div>
    </section>}

    {jobForm && <JobFormModal job={jobForm} departments={departments} users={users} onClose={() => setJobForm(null)} onSaved={() => { setJobForm(null); void loadJobs() }} />}
    {requisitionForm && <RequisitionFormModal requisition={requisitionForm} departments={departments} users={users} onClose={() => setRequisitionForm(null)} onSaved={() => { setRequisitionForm(null); void loadRequisitions() }} />}
    {closingRequisition && <DateActionModal title="关闭招聘需求" description="关闭后系统写入关闭时间并计算需求级自然日周期；HC 满员仅提示，不会自动关闭。" initialDate={today()} confirmLabel="确认关闭" onClose={() => setClosingRequisition(null)} onSubmit={async (date) => { await closeRequisition(closingRequisition.id, date); toast('需求已关闭并计算招聘周期'); setClosingRequisition(null); void loadRequisitions() }} />}
    {startDateTarget && <DateActionModal title="修改开始招聘时间" description="仅招聘中可修改；修改后重算在招天数，招聘周期按关闭时的最新开始时间计算。" initialDate={startDateTarget.recruitmentStartDate ?? today()} confirmLabel="保存并重算" onClose={() => setStartDateTarget(null)} onSubmit={async (date) => { await changeRequisitionStartDate(startDateTarget.id, date); toast('开始招聘时间已更新'); setStartDateTarget(null); void loadRequisitions() }} />}
  </div>
}

function Notice({ tone, children }: { tone: 'error' | 'info'; children: ReactNode }) {
  return <div className={cn('form-notice', tone === 'error' && 'form-notice-error')}><AlertCircle size={15} /><span>{children}</span></div>
}

function Modal({ title, subtitle, onClose, children, footer }: { title: string; subtitle: string; onClose: () => void; children: ReactNode; footer: ReactNode }) {
  return <div className="modal-backdrop" onMouseDown={onClose}>
    <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
      <div className="modal-header">
        <div><span className="modal-icon"><BriefcaseBusiness size={18} /></span><div><h3>{title}</h3><p>{subtitle}</p></div></div>
        <button className="icon-button" onClick={onClose}><X size={18} /></button>
      </div>
      <div className="modal-body">{children}</div>
      <div className="modal-footer">{footer}</div>
    </div>
  </div>
}

function JobFormModal({ job, departments, users, onClose, onSaved }: {
  job: JobListItem | 'new'
  departments: ApiDepartment[]
  users: ApiUser[]
  onClose: () => void
  onSaved: () => void
}) {
  const isNew = job === 'new'
  const current = isNew ? null : job
  const [title, setTitle] = useState(current?.title ?? '')
  const [departmentId, setDepartmentId] = useState(current?.departmentId ?? departments[0]?.id ?? '')
  const [headcount, setHeadcount] = useState(String(current?.headcount ?? 1))
  const [recruiterId, setRecruiterId] = useState(current?.recruiterId ?? '')
  const [channel, setChannel] = useState(current?.channel ?? '')
  const [location, setLocation] = useState(current?.location ?? '')
  const [requirements, setRequirements] = useState(current?.requirements ?? '')
  const [isVirtual, setIsVirtual] = useState(current?.isVirtual ?? false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setSaving(true)
    setError(null)
    try {
      const payload = {
        title,
        departmentId,
        headcount: Number(headcount) || 0,
        recruiterId: recruiterId || null,
        requirements,
        sources: channel,
        location,
      }
      if (isNew) await createJob({ ...payload, isVirtual })
      else await updateJob(current!.id, { ...payload, isVirtual })
      onSaved()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return <Modal
    title={isNew ? '新建职位' : `编辑职位 ${current?.code ?? ''}`}
    subtitle={isNew ? '职位编号由系统按 MJ%06d 自动生成' : '招聘要求仅该职位招聘负责人可编辑'}
    onClose={onClose}
    footer={<><button className="button button-secondary" onClick={onClose}>取消</button><button className="button button-primary" disabled={saving} onClick={() => void submit()}>{saving ? '保存中…' : '保存'}</button></>}
  >
    {error && <Notice tone="error">{error}</Notice>}
    <label className="form-field"><span>职位名称 <em>*</em></span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：高级后端工程师" /></label>
    <label className="form-field"><span>部门 <em>*</em></span>
      <select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}>
        <option value="">请选择部门</option>
        {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
      </select>
      {departments.length === 0 && <small>无法加载部门列表，请确认已登录且具备组织读取权限</small>}
    </label>
    <label className="form-field"><span>招聘人数</span><input inputMode="numeric" value={headcount} onChange={(event) => setHeadcount(event.target.value.replace(/\D/g, ''))} /></label>
    <label className="form-field"><span>招聘负责人</span>
      <select value={recruiterId} onChange={(event) => setRecruiterId(event.target.value)}>
        <option value="">未指定</option>
        {users.map((user) => <option key={user.id} value={user.id}>{user.displayName}</option>)}
      </select>
    </label>
    <label className="form-field"><span>招聘渠道</span><input value={channel} onChange={(event) => setChannel(event.target.value)} placeholder="例如：BOSS直聘、猎聘、内推" /></label>
    <label className="form-field"><span>工作地点</span><input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="例如：上海" /></label>
    <label className="form-field"><span>招聘要求</span><textarea rows={4} value={requirements} onChange={(event) => setRequirements(event.target.value)} placeholder="为空时 AI 评估入口禁用并提示补录" /></label>
    <label className="form-field form-field-inline"><input type="checkbox" checked={isVirtual} onChange={(event) => setIsVirtual(event.target.checked)} /><span>虚拟职位（校招容器，不进入普通职位筛选默认集）</span></label>
  </Modal>
}

function RequisitionFormModal({ requisition, departments, users, onClose, onSaved }: {
  requisition: ApiRequisition | 'new'
  departments: ApiDepartment[]
  users: ApiUser[]
  onClose: () => void
  onSaved: () => void
}) {
  const isNew = requisition === 'new'
  const current = isNew ? null : requisition
  const [oaApprovalId, setOaApprovalId] = useState(current?.oaApprovalId ?? '')
  const [title, setTitle] = useState(current?.title ?? '')
  const [departmentId, setDepartmentId] = useState(current?.departmentId ?? departments[0]?.id ?? '')
  const [headcount, setHeadcount] = useState(String(current?.headcount ?? 1))
  const [recruiterId, setRecruiterId] = useState(current?.recruiterId ?? '')
  const [jobLevel, setJobLevel] = useState(current?.jobLevel ?? '')
  const [submittedAt, setSubmittedAt] = useState(current?.submittedAt ?? today())
  const [startDate, setStartDate] = useState(current?.recruitmentStartDate ?? today())
  const [note, setNote] = useState(current?.note ?? '')
  const [requirements, setRequirements] = useState(current?.requirements ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setSaving(true)
    setError(null)
    try {
      if (isNew) {
        await syncRequisition({ oaApprovalId, title, departmentId, headcount: Number(headcount) || 0, submittedAt, recruitmentStartDate: startDate, recruiterId: recruiterId || undefined, jobLevel, note, requirements })
      } else {
        await updateRequisition(current!.id, { title, headcount: Number(headcount) || 0, recruiterId: recruiterId || null, jobLevel, note, requirements })
      }
      onSaved()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return <Modal
    title={isNew ? '同步 OA 招聘需求（Mock）' : `编辑需求 ${current?.oaApprovalId ?? ''}`}
    subtitle={isNew ? '按 OA 审批单号幂等生成需求；开始招聘时间必填，提报时间只读' : '同步信息与人事修改保存在同一条需求记录'}
    onClose={onClose}
    footer={<><button className="button button-secondary" onClick={onClose}>取消</button><button className="button button-primary" disabled={saving} onClick={() => void submit()}>{saving ? '保存中…' : '保存'}</button></>}
  >
    {error && <Notice tone="error">{error}</Notice>}
    {isNew && <label className="form-field"><span>OA 审批单号 <em>*</em></span><input value={oaApprovalId} onChange={(event) => setOaApprovalId(event.target.value)} placeholder="例如：OA-2026-0001" /></label>}
    <label className="form-field"><span>需求名称 <em>*</em></span><input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
    {isNew && <label className="form-field"><span>部门 <em>*</em></span>
      <select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}>
        <option value="">请选择部门</option>
        {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
      </select>
    </label>}
    <label className="form-field"><span>招聘人数</span><input inputMode="numeric" value={headcount} onChange={(event) => setHeadcount(event.target.value.replace(/\D/g, ''))} /></label>
    <label className="form-field"><span>招聘负责人</span>
      <select value={recruiterId} onChange={(event) => setRecruiterId(event.target.value)}>
        <option value="">未指定</option>
        {users.map((user) => <option key={user.id} value={user.id}>{user.displayName}</option>)}
      </select>
    </label>
    <label className="form-field"><span>职级</span><input value={jobLevel} onChange={(event) => setJobLevel(event.target.value)} placeholder="例如：P6" /></label>
    {isNew && <label className="form-field"><span>需求提报时间 <em>*</em></span><input type="date" value={submittedAt} onChange={(event) => setSubmittedAt(event.target.value)} /><small>仅记录，不参与周期计算</small></label>}
    {isNew && <label className="form-field"><span>开始招聘时间 <em>*</em></span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /><small>周期计算起点，不可事后补录</small></label>}
    <label className="form-field"><span>备注</span><textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} /></label>
    <label className="form-field"><span>招聘要求</span><textarea rows={3} value={requirements} onChange={(event) => setRequirements(event.target.value)} /></label>
  </Modal>
}

function DateActionModal({ title, description, initialDate, confirmLabel, onClose, onSubmit }: {
  title: string
  description: string
  initialDate: string
  confirmLabel: string
  onClose: () => void
  onSubmit: (date: string) => Promise<void>
}) {
  const [date, setDate] = useState(initialDate)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setSaving(true)
    setError(null)
    try {
      await onSubmit(date)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '操作失败')
    } finally {
      setSaving(false)
    }
  }

  return <Modal
    title={title}
    subtitle={description}
    onClose={onClose}
    footer={<><button className="button button-secondary" onClick={onClose}>取消</button><button className="button button-primary" disabled={saving} onClick={() => void submit()}>{saving ? '提交中…' : confirmLabel}</button></>}
  >
    {error && <Notice tone="error">{error}</Notice>}
    <label className="form-field"><span>日期 <em>*</em></span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
    <div className="form-notice"><CalendarClock size={15} /><span>日期精确到日；同日计 1 天，多日按自然日差且不额外累加首尾日。</span></div>
  </Modal>
}

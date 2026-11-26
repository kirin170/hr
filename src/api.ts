import type {
  AdminOverview,
  ApiCampusApplication,
  ApiDepartment,
  ApiJob,
  ApiRequisition,
  ApiSourceRecord,
  ApiUser,
  CampusApplicationList,
  CampusApplyResult,
  CampusAssignResult,
  CampusJob,
  Candidate,
  CandidateFilter,
  CandidatePage,
  CandidatePoolHistoryEntry,
  CandidateStage,
  LegacyCandidateStage,
  CandidateTimelineEvent,
  CurrentUser,
  DictItemView,
  EffectiveSettings,
  ExcelImportResult,
  FieldConfigView,
  FixedRule,
  InterviewPlanView,
  NotificationEventInfo,
  ReasonOptionView,
  AuditLogRow,
  AuthzGroup,
  AuthzRole,
  AuthzUser,
  FieldGrantRow,
  IntakeList,
  IntakeMonitor,
  IntakePoolList,
  IntakeResult,
  JobListItem,
  MailboxConfig,
  MyNotificationPreferences,
  OperationsSnapshot,
  RequisitionList,
  SavedCandidateFilter,
  SourceRecordList,
} from './types'
const apiBase = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '')
const authApiBase = (import.meta.env.VITE_AUTH_API_BASE_URL || '/api/v1').replace(/\/$/, '')
const tokenKey = 'talentflow.accessToken'
const refreshLockName = 'talentflow-token-refresh'
let refreshInFlight: Promise<string | null> | null = null

export function getAccessToken(): string | null {
  try {
    const token = window.localStorage.getItem(tokenKey)
    if (token === 'local-preview-session') {
      window.localStorage.removeItem(tokenKey)
      return null
    }
    return token
  } catch {
    return null
  }
}

export function setAccessToken(token: string | null): void {
  try {
    if (token) window.localStorage.setItem(tokenKey, token)
    else window.localStorage.removeItem(tokenKey)
  } catch {
    // 隐私模式下 localStorage 不可用，忽略
  }
}

async function runWithRefreshLock<T>(task: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  if (locks && typeof locks.request === 'function') {
    return locks.request(refreshLockName, task)
  }
  return task()
}

async function performRefreshRequest(failedToken?: string | null): Promise<string | null> {
  return runWithRefreshLock(async () => {
    // 跨标签页去重：若其他标签页或并发请求已完成轮换，直接复用最新令牌，避免重复提交已消费 Cookie 触发整族吊销
    if (failedToken !== undefined) {
      const current = getAccessToken()
      if (current && current !== failedToken) {
        return current
      }
    }
    try {
      const response = await fetch(`${authApiBase}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!response.ok) return null
      const session = await response.json() as { accessToken?: unknown }
      if (typeof session.accessToken !== 'string' || !session.accessToken) return null
      setAccessToken(session.accessToken)
      return session.accessToken
    } catch {
      return null
    }
  })
}

export function refreshAccessToken(failedToken?: string | null): Promise<string | null> {
  if (failedToken !== undefined) {
    const current = getAccessToken()
    if (current && current !== failedToken) {
      return Promise.resolve(current)
    }
  }
  if (!refreshInFlight) {
    refreshInFlight = performRefreshRequest(failedToken).finally(() => {
      refreshInFlight = null
    })
  }
  return refreshInFlight
}

export function startDingTalkLogin(): void {
  window.location.assign(`${authApiBase}/auth/dingtalk/login`)
}

export async function logout(): Promise<void> {
  try {
    await fetch(`${authApiBase}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    })
  } catch {
    // 即使后端不可达，仍清理本地令牌并回到登录页
  } finally {
    setAccessToken(null)
    window.dispatchEvent(new Event('talentflow-auth-required'))
  }
}

export async function loginLocal(identifier: string, secret: string): Promise<string> {
  let response: Response
  try {
    response = await fetch(`${authApiBase}/auth/local`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, secret }),
    })
  } catch {
    throw new Error('无法连接 ATS 后端，请确认后端服务已启动。')
  }

  const body = await response.json().catch(() => null) as {
    accessToken?: unknown
    message?: string | string[]
  } | null
  if (!response.ok) {
    const message = Array.isArray(body?.message) ? body.message.join('；') : body?.message
    throw new Error(message || `登录失败（${response.status}）`)
  }
  if (typeof body?.accessToken !== 'string' || !body.accessToken) {
    throw new Error('登录响应缺少访问令牌，请检查后端配置。')
  }

  setAccessToken(body.accessToken)
  return body.accessToken
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let token = getAccessToken()
  let response: Response
  try {
    const send = (accessToken: string | null) => fetch(`${apiBase}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...init?.headers,
      },
    })
    response = await send(token)
    if (response.status === 401) {
      const renewed = await refreshAccessToken(token)
      if (renewed) {
        token = renewed
        response = await send(token)
      }
      if (!renewed || response.status === 401) {
        setAccessToken(null)
        window.dispatchEvent(new Event('talentflow-auth-required'))
      }
    }
  } catch {
    throw new Error('无法连接 ATS 后端，请确认后端服务已启动。')
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string | string[] } | null
    const message = Array.isArray(body?.message) ? body.message.join('；') : body?.message
    if (response.status === 401) {
      throw new Error(message || '登录已失效，请重新使用钉钉登录。')
    }
    throw new Error(message || `请求失败（${response.status}）`)
  }
  return response.json() as Promise<T>
}

function toQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue
    search.set(key, String(value))
  }
  const query = search.toString()
  return query ? `?${query}` : ''
}

export async function listCandidates(): Promise<Candidate[]> {
  const result = await request<{ items: Candidate[] }>('/candidates?page=1&pageSize=100')
  return result.items
}

export function listCandidatePage(query: CandidateFilter & { page?: number; pageSize?: number } = {}): Promise<CandidatePage> {
  return request<CandidatePage>(`/candidates${toQuery({ page: 1, pageSize: 20, ...query })}`)
}

export function listSavedCandidateFilters(): Promise<SavedCandidateFilter[]> {
  return request<SavedCandidateFilter[]>('/candidates/filters')
}

export function saveCandidateFilter(name: string, filters: CandidateFilter): Promise<SavedCandidateFilter> {
  return request<SavedCandidateFilter>('/candidates/filters', {
    method: 'POST', body: JSON.stringify({ name, filters }),
  })
}

export function deleteSavedCandidateFilter(id: string): Promise<{ deleted: boolean }> {
  return request(`/candidates/filters/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function getCandidateDetail(id: string): Promise<Candidate> {
  return request<Candidate>(`/candidates/${encodeURIComponent(id)}`)
}

export function getCandidateTimeline(id: string): Promise<CandidateTimelineEvent[]> {
  return request<CandidateTimelineEvent[]>(`/candidates/${encodeURIComponent(id)}/timeline`)
}

export function createCandidate(candidate: Candidate): Promise<Candidate> {
  return request<Candidate>('/candidates', {
    method: 'POST',
    body: JSON.stringify(candidate),
  })
}

export function updateCandidateStage(id: string, stage: CandidateStage | LegacyCandidateStage, reason?: string, reasonId?: string): Promise<Candidate> {
  return request<Candidate>(`/candidates/${encodeURIComponent(id)}/stage`, {
    method: 'PATCH',
    body: JSON.stringify({ stage, reason, reasonId }),
  })
}

/** 人才库激活（FR-POOL-4）：选择职位后回流至人才推荐，归档历史保留 */
export function activateCandidateFromPool(id: string, jobId: string): Promise<Candidate> {
  return request<Candidate>(`/candidates/${encodeURIComponent(id)}/activate`, {
    method: 'POST', body: JSON.stringify({ jobId }),
  })
}

export function getCandidatePoolHistory(id: string): Promise<{ items: CandidatePoolHistoryEntry[] }> {
  return request<{ items: CandidatePoolHistoryEntry[] }>(`/candidates/${encodeURIComponent(id)}/pool-history`)
}

export function assignCandidateJob(id: string, jobId: string): Promise<Candidate> {
  return request<Candidate>(`/candidates/${encodeURIComponent(id)}/assign-job`, {
    method: 'POST', body: JSON.stringify({ jobId }),
  })
}

export function recordDepartmentScreening(id: string, payload: {
  result: 'PASS' | 'HOLD' | 'REJECT'
  reason?: string
  availabilitySlots?: { startAt: string; endAt: string }[]
}): Promise<Candidate> {
  return request<Candidate>(`/candidates/${encodeURIComponent(id)}/department-screening`, {
    method: 'POST', body: JSON.stringify(payload),
  })
}

export function setCandidateLockedState(id: string, lockedState: 'NONE' | 'OPERABLE' | 'INOPERABLE'): Promise<Candidate> {
  return request<Candidate>(`/candidates/${encodeURIComponent(id)}/lock`, {
    method: 'PATCH', body: JSON.stringify({ lockedState }),
  })
}

export function undoCandidateStage(id: string): Promise<Candidate> {
  return request<Candidate>(`/candidates/${encodeURIComponent(id)}/stage/undo`, { method: 'POST' })
}

export function batchUpdateCandidateStage(candidateIds: string[], stage: CandidateStage | LegacyCandidateStage, reason?: string) {
  return request<{ updated: number; failed: number; results: { id: string; ok: boolean; error?: string }[] }>(
    '/candidates/batch/stage',
    { method: 'POST', body: JSON.stringify({ candidateIds, stage, reason }) },
  )
}

export function batchRecordDepartmentScreening(candidateIds: string[], payload: {
  result: 'PASS' | 'HOLD' | 'REJECT'
  reason?: string
  availabilitySlots?: { startAt: string; endAt: string }[]
}) {
  return request<{ updated: number; failed: number; results: { id: string; ok: boolean; error?: string }[] }>(
    '/candidates/batch/department-screening',
    { method: 'POST', body: JSON.stringify({ candidateIds, ...payload }) },
  )
}

export function batchUpdateCandidateTags(candidateIds: string[], tags: string[], mode: 'ADD' | 'REMOVE' | 'REPLACE') {
  return request<{ updated: number; failed: number; results: { id: string; ok: boolean; error?: string }[] }>(
    '/candidates/batch/tags',
    { method: 'POST', body: JSON.stringify({ candidateIds, tags, mode }) },
  )
}

// ---------- 职位（FR-JOB） ----------

export type JobQuery = {
  keyword?: string
  code?: string
  status?: string
  channel?: string
  departmentId?: string
  recruiterId?: string
  isVirtual?: string
  page?: number
  pageSize?: number
}

export async function listJobs(query: JobQuery = {}): Promise<JobListItem[]> {
  const result = await request<{ items: JobListItem[] }>(`/jobs${toQuery({ pageSize: 100, ...query })}`)
  return result.items
}

export function getJob(id: string): Promise<JobListItem> {
  return request<JobListItem>(`/jobs/${encodeURIComponent(id)}`)
}

export function createJob(payload: {
  title: string
  departmentId: string
  headcount: number
  recruiterId?: string | null
  requirements?: string
  sources?: string
  location?: string
  interviewPlanId?: string
  isVirtual?: boolean
  requisitionId?: string
}): Promise<JobListItem> {
  return request<JobListItem>('/jobs', { method: 'POST', body: JSON.stringify(payload) })
}

export function updateJob(id: string, payload: Record<string, unknown>): Promise<JobListItem> {
  return request<JobListItem>(`/jobs/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function closeJob(id: string): Promise<{ changed: boolean; candidatesInProcess: number; note: string }> {
  return request(`/jobs/${encodeURIComponent(id)}/close`, { method: 'POST' })
}

// ---------- 招聘需求与周期（FR-REQ） ----------

export type RequisitionQuery = {
  keyword?: string
  oaApprovalId?: string
  status?: string
  departmentId?: string
  recruiterId?: string
  startFrom?: string
  startTo?: string
  closedFrom?: string
  closedTo?: string
  cycleMin?: number
  cycleMax?: number
  sort?: string
  order?: string
  page?: number
  pageSize?: number
}

export function listRequisitions(query: RequisitionQuery = {}): Promise<RequisitionList> {
  return request<RequisitionList>(`/requisitions${toQuery({ pageSize: 50, ...query })}`)
}

export function getRequisition(id: string): Promise<ApiRequisition> {
  return request<ApiRequisition>(`/requisitions/${encodeURIComponent(id)}`)
}

/** 人工触发 OA 需求同步：只提交审批实例标识，需求字段一律由服务端回读 OA 核实，不接受前端直传。 */
export function syncRequisition(payload: {
  processInstanceRef: string
  /** OA 表单缺少开始招聘时间时由人事补录；OA 已带出时忽略 */
  recruitmentStartDate?: string
}): Promise<{ created: boolean; requisition: ApiRequisition }> {
  return request('/v1/requisitions/sync-from-oa', { method: 'POST', body: JSON.stringify(payload) })
}

export type OaCapability = {
  valid: boolean
  code: string | null
  requisition: { configured: boolean }
  offer: { configured: boolean; approverLevelSizes: number[]; approverAction: 'AND' | 'OR' | 'NONE' }
  note: string
}

/** 管理端展示真实 OA 模板配置状态；未配置时只保留人工通道。 */
export function getOaCapability(): Promise<OaCapability> {
  return request<OaCapability>('/v1/requisitions/oa-sync/capability')
}

export type OaSyncEvent = {
  id: string
  eventType: string
  subjectId: string | null
  status: string
  attempts: number
  receivedAt: string
  processedAt: string | null
  lastError: string | null
}

export function listOaSyncEvents(): Promise<OaSyncEvent[]> {
  return request<OaSyncEvent[]>('/v1/requisitions/oa-sync/events')
}

export function retryOaSyncEvent(id: string): Promise<{ id: string; status: string }> {
  return request(`/v1/requisitions/oa-sync/events/${encodeURIComponent(id)}/retry`, { method: 'POST' })
}

/** 由系统发起录用审批（材料固定为简历信息、面试登记表、录用职级）。 */
export function submitOfferOa(candidateId: string): Promise<{ offer: Record<string, unknown> }> {
  return request(`/v1/candidates/${encodeURIComponent(candidateId)}/offer/oa`, { method: 'POST' })
}

/** 刷新系统发起的 OA 实例状态；只更新展示字段，不改变 Offer 阶段结果。 */
export function refreshOfferOa(candidateId: string): Promise<{ offer: Record<string, unknown> }> {
  return request(`/v1/candidates/${encodeURIComponent(candidateId)}/offer/oa/refresh`, { method: 'POST' })
}

export function updateRequisition(id: string, payload: Record<string, unknown>): Promise<ApiRequisition> {
  return request<ApiRequisition>(`/requisitions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function changeRequisitionStartDate(id: string, recruitmentStartDate: string): Promise<ApiRequisition> {
  return request<ApiRequisition>(`/requisitions/${encodeURIComponent(id)}/start-date`, {
    method: 'PATCH',
    body: JSON.stringify({ recruitmentStartDate }),
  })
}

export function closeRequisition(id: string, closedAt?: string): Promise<ApiRequisition> {
  return request<ApiRequisition>(`/requisitions/${encodeURIComponent(id)}/close`, {
    method: 'POST',
    body: JSON.stringify(closedAt ? { closedAt } : {}),
  })
}

export function revertRequisition(id: string): Promise<ApiRequisition> {
  return request<ApiRequisition>(`/requisitions/${encodeURIComponent(id)}/revert`, { method: 'POST' })
}

export function listRequisitionTimeline(id: string): Promise<CandidateTimelineEvent[]> {
  return request<CandidateTimelineEvent[]>(`/requisitions/${encodeURIComponent(id)}/timeline`)
}

// ---------- 组织基础数据 ----------

export function getDirectory(): Promise<{ departments: ApiDepartment[]; users: ApiUser[] }> {
  return request<{ departments: ApiDepartment[]; users: ApiUser[] }>('/v1/authz/directory')
}

export function listDepartments(): Promise<ApiDepartment[]> {
  return request<ApiDepartment[]>('/v1/authz/departments')
}

export function listUsers(): Promise<ApiUser[]> {
  return request<ApiUser[]>('/v1/authz/users')
}

export type CandidateInterviewSummary = {
  id: string
  candidateId: string
  jobId: string
  round: number
  mode: string
  time: string
  endTime: string | null
  location: string | null
  interviewerIds: string[]
  status: string
}

export function listCandidateInterviews(candidateId: string): Promise<CandidateInterviewSummary[]> {
  return request<CandidateInterviewSummary[]>(`/interviews${toQuery({ candidateId })}`)
}

// ---------- 简历入场（FR-ENT-1/3～10） ----------

const intakeBase = '/v1/intake'

async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  let token = getAccessToken()
  const send = (accessToken: string | null) => fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...init.headers,
    },
  })
  let response: Response
  try {
    response = await send(token)
    if (response.status === 401) {
      const renewed = await refreshAccessToken(token)
      if (renewed) {
        token = renewed
        response = await send(token)
      }
      if (!renewed || response.status === 401) {
        setAccessToken(null)
        window.dispatchEvent(new Event('talentflow-auth-required'))
      }
    }
  } catch {
    throw new Error('无法连接 ATS 后端，请确认后端服务已启动。')
  }
  return response
}

async function responseError(response: Response): Promise<Error> {
  const body = await response.json().catch(() => null) as
    | { message?: string | string[]; code?: string }
    | null
  const message = Array.isArray(body?.message) ? body.message.join('；') : body?.message
  if (response.status === 401) {
    return new Error(message || '登录已失效，请重新使用钉钉登录。')
  }
  return new Error(message || `请求失败（${response.status}）`)
}

async function requestForm<T>(path: string, form: FormData): Promise<T> {
  const response = await authFetch(path, { method: 'POST', body: form })
  if (!response.ok) throw await responseError(response)
  return response.json() as Promise<T>
}

async function requestBlob(path: string): Promise<{ blob: Blob; filename: string }> {
  const response = await authFetch(path)
  if (!response.ok) throw await responseError(response)
  const disposition = response.headers.get('content-disposition') ?? ''
  const match = /filename="?([^";]+)"?/i.exec(disposition)
  return { blob: await response.blob(), filename: match?.[1] ?? 'download' }
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export type IntakeQuery = {
  status?: string
  entryMode?: string
  source?: string
  jobId?: string
  mailbox?: string
  createdFrom?: string
  createdTo?: string
  receivedFrom?: string
  receivedTo?: string
  page?: number
  pageSize?: number
}

export function listIntakes(query: IntakeQuery = {}): Promise<IntakeList> {
  return request<IntakeList>(`${intakeBase}${toQuery({ pageSize: 20, ...query })}`)
}

export function listIntakePool(query: { keyword?: string; page?: number; pageSize?: number } = {}): Promise<IntakePoolList> {
  return request<IntakePoolList>(`${intakeBase}/pool${toQuery({ pageSize: 20, ...query })}`)
}

export function listDuplicateIntakes(query: { page?: number; pageSize?: number } = {}): Promise<IntakeList> {
  return request<IntakeList>(`${intakeBase}/duplicates${toQuery({ pageSize: 20, ...query })}`)
}

export function getIntakeMonitor(query: {
  jobId?: string
  mailbox?: string
  entryMode?: string
  source?: string
  receivedFrom?: string
  receivedTo?: string
} = {}): Promise<IntakeMonitor> {
  return request<IntakeMonitor>(`${intakeBase}/monitor${toQuery(query)}`)
}

export function listMailboxes(): Promise<{ items: MailboxConfig[]; total: number }> {
  return request(`${intakeBase}/mailboxes`)
}

export type SourceInput = {
  referrerName?: string
  referrerContact?: string
  referralCode?: string
  sourceNote?: string
}

export function uploadResumes(
  files: File[],
  options: { jobId?: string; source?: string; entryMode?: string } & SourceInput = {},
): Promise<IntakeResult[]> {
  const form = new FormData()
  for (const file of files) form.append('files', file)
  if (options.jobId) form.append('jobId', options.jobId)
  if (options.source) form.append('source', options.source)
  if (options.entryMode) form.append('entryMode', options.entryMode)
  if (options.referrerName) form.append('referrerName', options.referrerName)
  if (options.referrerContact) form.append('referrerContact', options.referrerContact)
  if (options.referralCode) form.append('referralCode', options.referralCode)
  if (options.sourceNote) form.append('sourceNote', options.sourceNote)
  return requestForm<IntakeResult[]>(`${intakeBase}/upload`, form)
}

export function createManualIntake(payload: {
  name: string
  phone?: string
  email?: string
  jobId?: string
  source?: string
} & SourceInput): Promise<IntakeResult> {
  return request<IntakeResult>(`${intakeBase}/manual`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function mockEmailIntake(payload: {
  mailboxAddress?: string
  from?: string
  subject?: string
  receivedAt?: string
  jobId?: string
  attachments: { fileName: string; mimeType: string; contentBase64: string }[]
}): Promise<IntakeResult[]> {
  return request<IntakeResult[]>(`${intakeBase}/email/mock`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function assignIntakeJob(intakeId: string, jobId: string): Promise<{ candidateId: string }> {
  return request(`${intakeBase}/${encodeURIComponent(intakeId)}/assign-job`, {
    method: 'POST',
    body: JSON.stringify({ jobId }),
  })
}

export function batchAssignJobs(
  intakeIds: string[],
  jobId: string,
): Promise<{ assigned: number; failed: number; results: { intakeId: string; ok: boolean; error?: string }[] }> {
  return request(`${intakeBase}/batch-assign-job`, {
    method: 'POST',
    body: JSON.stringify({ intakeIds, jobId }),
  })
}

export function mergeDuplicateIntake(intakeId: string): Promise<{ candidateId: string }> {
  return request(`${intakeBase}/${encodeURIComponent(intakeId)}/merge`, { method: 'POST' })
}

export function retryIntake(intakeId: string, mockOutcome?: 'SUCCESS' | 'FAIL'): Promise<{ parseQueued: boolean }> {
  return request(`${intakeBase}/${encodeURIComponent(intakeId)}/retry`, {
    method: 'POST',
    body: JSON.stringify(mockOutcome ? { mockOutcome } : {}),
  })
}

export function confirmAiRun(runId: string): Promise<{ id: string; isDraft: boolean }> {
  return request(`/v1/ai-runs/${encodeURIComponent(runId)}/confirm`, { method: 'POST' })
}

export function importResumeExcel(file: File): Promise<ExcelImportResult> {
  const form = new FormData()
  form.append('file', file)
  return requestForm<ExcelImportResult>(`${intakeBase}/excel/import`, form)
}

export async function downloadExcelTemplate(): Promise<void> {
  const { blob, filename } = await requestBlob(`${intakeBase}/excel/template`)
  saveBlob(blob, filename || 'resume-import-template.xlsx')
}

export async function downloadFailedRows(batchId: string): Promise<void> {
  const { blob, filename } = await requestBlob(
    `${intakeBase}/excel/batches/${encodeURIComponent(batchId)}/failed-rows`,
  )
  saveBlob(blob, filename || 'resume-import-failed.xlsx')
}

export async function openAttachment(fileId: string): Promise<void> {
  const signed = await request<{ url: string; fileName: string }>(
    `/v1/attachments/${encodeURIComponent(fileId)}/read-url`,
  )
  window.open(signed.url, '_blank', 'noopener,noreferrer')
}

// ---------- 来源记录与校招投递（ATS-009） ----------

export type SourceRecordQuery = {
  source?: string
  referrer?: string
  candidateId?: string
  jobId?: string
  createdFrom?: string
  createdTo?: string
  page?: number
  pageSize?: number
}

export function listSourceRecords(query: SourceRecordQuery = {}): Promise<SourceRecordList> {
  return request<SourceRecordList>(`${intakeBase}/sources${toQuery({ pageSize: 20, ...query })}`)
}

export function updateSourceRecord(
  id: string,
  payload: SourceInput,
): Promise<ApiSourceRecord> {
  return request<ApiSourceRecord>(`${intakeBase}/sources/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

const campusBase = '/v1/campus'

async function publicFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${apiBase}${path}`, init)
  } catch {
    throw new Error('无法连接投递服务，请稍后重试。')
  }
  if (!response.ok) throw await responseError(response)
  return response.json() as Promise<T>
}

export function listCampusJobs(): Promise<{ items: CampusJob[] }> {
  return publicFetch<{ items: CampusJob[] }>(`${campusBase}/jobs`)
}

export type CampusApplyPayload = {
  name: string
  phone?: string
  email?: string
  jobId: string
  school?: string
  major?: string
  graduationYear?: string
  expectedCity?: string
  availableFrom?: string
  desiredPositions?: string
  remark?: string
} & SourceInput

export function submitCampusApplication(
  payload: CampusApplyPayload,
  resume?: File | null,
): Promise<CampusApplyResult> {
  const form = new FormData()
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined || value === null || value === '') continue
    form.append(key, String(value))
  }
  if (resume) form.append('resume', resume)
  return publicFetch<CampusApplyResult>(`${campusBase}/applications`, {
    method: 'POST',
    body: form,
  })
}

export function listCampusApplications(query: {
  status?: string
  jobId?: string
  keyword?: string
  page?: number
  pageSize?: number
} = {}): Promise<CampusApplicationList> {
  return request<CampusApplicationList>(
    `${campusBase}/applications${toQuery({ pageSize: 20, ...query })}`,
  )
}

export function batchAssignCampusApplications(
  applicationIds: string[],
  jobId: string,
): Promise<CampusAssignResult> {
  return request<CampusAssignResult>(`${campusBase}/applications/batch-assign`, {
    method: 'POST',
    body: JSON.stringify({ applicationIds, jobId }),
  })
}

export function uploadOfferMaterial(candidateId: string, category: string, file: File): Promise<unknown> {
  const form = new FormData()
  form.append('category', category)
  form.append('file', file)
  return requestForm(`/v1/candidates/${encodeURIComponent(candidateId)}/offer/materials`, form)
}

// ---------- 业务设置 / 管理后台（ATS-024） ----------

const settingsBase = '/v1/admin/settings'
const auditBase = '/v1/audit-logs'
const mailBase = '/v1/mail/mailboxes'
const authzBase = '/v1/authz'

export function getCurrentUser(): Promise<CurrentUser> {
  return request<CurrentUser>(`${authzBase}/me`)
}

/** 任何登录用户可读的有效配置：表单必填/显示标记、启用中的字典与原因、启用中的面试方案。 */
export function getEffectiveSettings(): Promise<EffectiveSettings> {
  return request<EffectiveSettings>(`${settingsBase}/effective`)
}

export function getAdminOverview(): Promise<AdminOverview> {
  return request<AdminOverview>(`${settingsBase}/overview`)
}

export function getSettingRules(): Promise<{ items: FixedRule[] }> {
  return request<{ items: FixedRule[] }>(`${settingsBase}/rules`)
}

export function getOperationsSnapshot(): Promise<OperationsSnapshot> {
  return request<OperationsSnapshot>(`${settingsBase}/operations`)
}

export function getNotificationSettings(): Promise<{ channel: string; integrated: boolean; note: string; events: NotificationEventInfo[] }> {
  return request(`${settingsBase}/notifications`)
}

export function getMyNotificationPreferences(): Promise<MyNotificationPreferences> {
  return request<MyNotificationPreferences>(`${settingsBase}/me/notification-preferences`)
}

export function updateMyNotificationPreferences(muted: string[]): Promise<MyNotificationPreferences> {
  return request<MyNotificationPreferences>(`${settingsBase}/me/notification-preferences`, {
    method: 'PUT',
    body: JSON.stringify({ muted }),
  })
}

export function createReasonOption(payload: { type: string; label: string }): Promise<ReasonOptionView> {
  return request<ReasonOptionView>(`${settingsBase}/reasons`, { method: 'POST', body: JSON.stringify(payload) })
}

export function updateReasonOption(
  id: string,
  payload: { version: number; label?: string; active?: boolean },
): Promise<ReasonOptionView> {
  return request<ReasonOptionView>(`${settingsBase}/reasons/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function reorderReasonOptions(type: string, ids: string[]) {
  return request<{ items: ReasonOptionView[] }>(`${settingsBase}/reasons/reorder`, {
    method: 'POST',
    body: JSON.stringify({ type, ids }),
  })
}

export function createDictItem(payload: { type: string; label: string }): Promise<DictItemView> {
  return request<DictItemView>(`${settingsBase}/dicts`, { method: 'POST', body: JSON.stringify(payload) })
}

export function updateDictItem(
  id: string,
  payload: { version: number; label?: string; active?: boolean },
): Promise<DictItemView> {
  return request<DictItemView>(`${settingsBase}/dicts/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function reorderDictItems(type: string, ids: string[]) {
  return request<{ items: DictItemView[] }>(`${settingsBase}/dicts/reorder`, {
    method: 'POST',
    body: JSON.stringify({ type, ids }),
  })
}

export function updateFieldConfig(
  id: string,
  payload: { version: number; required?: boolean; visible?: boolean },
): Promise<FieldConfigView> {
  return request<FieldConfigView>(`${settingsBase}/fields/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function createInterviewPlan(payload: {
  name: string
  rounds: number
  description?: string
}): Promise<InterviewPlanView> {
  return request<InterviewPlanView>(`${settingsBase}/interview-plans`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateInterviewPlan(
  id: string,
  payload: { version: number; name?: string; rounds?: number; description?: string | null; active?: boolean },
): Promise<InterviewPlanView> {
  return request<InterviewPlanView>(`${settingsBase}/interview-plans/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export type AuditLogQuery = {
  actorId?: string
  from?: string
  to?: string
  limit?: number
  resourceType?: string
  resourceId?: string
  action?: string
  actionPrefix?: string
}

export function listAuditLogs(query: AuditLogQuery = {}): Promise<AuditLogRow[]> {
  return request<AuditLogRow[]>(`${auditBase}${toQuery({ ...query })}`)
}

export async function exportAuditLogs(query: AuditLogQuery = {}): Promise<void> {
  const { blob, filename } = await requestBlob(`${auditBase}/export.csv${toQuery({ ...query })}`)
  saveBlob(blob, filename || 'audit-logs.csv')
}

export function getRetentionPolicy(): Promise<{ resumeDays: number; sensitiveDays: number; batchSize: number; note: string }> {
  return request('/v1/retention/policy')
}

export function runRetentionPurge(dryRun: boolean): Promise<Record<string, unknown>> {
  return request('/v1/retention/purge', { method: 'POST', body: JSON.stringify({ dryRun }) })
}

export function listMailboxConfigs(): Promise<{ items: MailboxConfig[]; total: number }> {
  return request<{ items: MailboxConfig[]; total: number }>(mailBase)
}

export function createMailboxConfig(payload: Record<string, unknown>): Promise<MailboxConfig> {
  return request<MailboxConfig>(mailBase, { method: 'POST', body: JSON.stringify(payload) })
}

export function updateMailboxConfig(id: string, payload: Record<string, unknown>): Promise<MailboxConfig> {
  return request<MailboxConfig>(`${mailBase}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function deleteMailboxConfig(id: string): Promise<{ deleted: boolean }> {
  return request(`${mailBase}/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function testMailboxConfig(id: string): Promise<Record<string, unknown>> {
  return request(`${mailBase}/${encodeURIComponent(id)}/test-connection`, { method: 'POST' })
}

export function pollMailboxConfig(id: string): Promise<Record<string, unknown>> {
  return request(`${mailBase}/${encodeURIComponent(id)}/poll`, { method: 'POST' })
}

export function revokeBrowserImportTokens(operatorId: string): Promise<{ revoked: number }> {
  return request<{ revoked: number }>(`/v1/browser-import/token/revoke/${encodeURIComponent(operatorId)}`, {
    method: 'POST',
  })
}

export function triggerDingTalkSync(): Promise<Record<string, unknown>> {
  return request('/v1/admin/organization/dingtalk/sync', { method: 'POST', body: JSON.stringify({}) })
}

export function retryDingTalkEvent(id: string): Promise<Record<string, unknown>> {
  return request(`/v1/admin/organization/dingtalk/events/${encodeURIComponent(id)}/retry`, { method: 'POST' })
}

// 组织与权限：沿用 ATS-005 已交付的授权接口，管理后台只做展示与最小维护
export function listAuthzRoles(): Promise<AuthzRole[]> {
  return request<AuthzRole[]>(`${authzBase}/roles`)
}

export function listAuthzGroups(): Promise<AuthzGroup[]> {
  return request<AuthzGroup[]>(`${authzBase}/groups`)
}

export function listAuthzUsers(): Promise<AuthzUser[]> {
  return request<AuthzUser[]>(`${authzBase}/users`)
}

export function listFieldGrants(): Promise<FieldGrantRow[]> {
  return request<FieldGrantRow[]>(`${authzBase}/field-grants`)
}

export function createAuthzGroup(payload: { code: string; name: string; description?: string }): Promise<AuthzGroup> {
  return request<AuthzGroup>(`${authzBase}/groups`, { method: 'POST', body: JSON.stringify(payload) })
}

export function createAuthzDepartment(payload: { code: string; name: string; parentId?: string }): Promise<unknown> {
  return request(`${authzBase}/departments`, { method: 'POST', body: JSON.stringify(payload) })
}

export function assignUserRoles(
  userId: string,
  roles: { roleCode: string; scopeOverride?: string }[],
): Promise<unknown> {
  return request(`${authzBase}/users/${encodeURIComponent(userId)}/roles`, {
    method: 'PUT',
    body: JSON.stringify({ roles }),
  })
}

export function createFieldGrant(payload: {
  field: string
  userId?: string
  userGroupId?: string
  canRead: boolean
  canWrite: boolean
  expiresAt?: string
}): Promise<FieldGrantRow> {
  return request<FieldGrantRow>(`${authzBase}/field-grants`, { method: 'POST', body: JSON.stringify(payload) })
}

export function revokeFieldGrant(id: string): Promise<{ revoked: boolean }> {
  return request(`${authzBase}/field-grants/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

// ---------- 工作台（ATS-023） ----------

export type DashboardTodo = {
  key: string
  label: string
  detail: string
  page: string
  count: number
}

export type DashboardInterviewItem = {
  id: string
  candidateId: string
  candidateName: string | null
  jobTitle: string | null
  round: number
  mode: string
  time: string
}

export type DashboardSummary = {
  generatedAt: string
  date: string
  timezone: string
  todos: DashboardTodo[]
  today: {
    screening: { count: number; label: string; denominator: string }
    interviews: { count: number; label: string; items: DashboardInterviewItem[] }
  }
  note: string
}

export type DashboardJobItem = {
  id: string
  code: string
  title: string
  departmentId: string
  departmentName: string | null
  headcount: number
  hiredCount: number
  status: string
  isVirtual: boolean
}

export type DashboardJob360 = {
  job: {
    id: string
    code: string
    title: string
    departmentName: string | null
    recruiterName: string | null
    headcount: number
    hiredCount: number
    status: string
    requisition: {
      id: string
      title: string
      status: string
      headcount: number
      requisitionType: string | null
      submittedAt: string
      recruitmentStartDate: string | null
      closedAt: string | null
      cycleDays: number | null
    } | null
  }
  hc: { headcount: number; hiredCount: number; gap: number; inProcess: number }
  stageCounts: Record<string, number>
  progress: { total: number; interviewed: number; offered: number; onboarded: number }
  interviews: { toSchedule: number; feedbackPending: number; items: { id: string; candidateId: string; status: string; time: string; round: number }[] }
  offers: Record<string, number>
  channels: { channel: string; count: number }[]
}

export type DashboardNotification = {
  id: string
  category: 'MENTION' | 'FOLLOW_UP' | 'FEEDBACK' | 'OFFER'
  title: string
  detail: string
  at: string | null
  page: string
  candidateId: string | null
  read: boolean
}

export type DashboardNotifications = {
  generatedAt: string
  categories: { key: string; label: string; count: number; unread: number; items: DashboardNotification[] }[]
  total: number
  unreadTotal: number
  source: string
}

export function getDashboardSummary(): Promise<DashboardSummary> {
  return request<DashboardSummary>('/v1/dashboard/summary')
}

export function listDashboardJobs(): Promise<DashboardJobItem[]> {
  return request<DashboardJobItem[]>('/v1/dashboard/jobs')
}

export function getDashboardJob360(jobId: string): Promise<DashboardJob360> {
  return request<DashboardJob360>(`/v1/dashboard/job-360${toQuery({ jobId })}`)
}

export function getDashboardNotifications(): Promise<DashboardNotifications> {
  return request<DashboardNotifications>('/v1/dashboard/notifications')
}

export function markDashboardNotificationsRead(payload: { ids?: string[]; all?: boolean }): Promise<{ allReadAt: string | null; readIds: number }> {
  return request('/v1/dashboard/notifications/read', { method: 'POST', body: JSON.stringify(payload) })
}

// ---------- 招聘报表（ATS-023） ----------

export type ReportFilters = {
  from?: string
  to?: string
  departmentId?: string
  recruiterId?: string
  requisitionType?: string
}

export type ReportFilterOptions = {
  departments: { id: string; name: string }[]
  recruiters: { id: string; name: string }[]
  requisitionTypes: string[]
  dimensions: { key: string; label: string }[]
}

export type ReportFunnelStage = {
  key: string
  label: string
  reached: number
  inStage: number
  conversionFromPrevious: number | null
}

export type ReportDrillCandidate = {
  id: string
  name: string
  stage: string
  jobTitle: string | null
  departmentName: string | null
  channel: string | null
  appliedAt: string | null
}

export type ReportFunnel = {
  generatedAt: string
  denominator: string
  total: number
  stages: ReportFunnelStage[]
  excluded: { archived: number; pool: number }
  drill?: { stage: string; total: number; items: ReportDrillCandidate[] }
}

export type ReportChannelRow = {
  key: string
  label: string
  total: number
  interviewed: number
  offered: number
  onboarded: number
  archived: number
  share: number | null
}

export type ReportChannels = {
  generatedAt: string
  denominator: string
  total: number
  unfilled: number
  rows: ReportChannelRow[]
  drill?: { key: string; items: ReportDrillCandidate[] }
}

export type ReportReasonRow = {
  key: string
  label: string
  count: number
  share: number | null
  unfilled: boolean
}

export type ReportReasons = {
  type: string
  label: string
  denominator: string
  total: number
  unfilled: number
  rows: ReportReasonRow[]
  drill?: { key: string; label: string; items: { id: string; name: string; jobTitle: string | null; at: string | null; detail: string | null }[] }
}

export type ReportProbation = {
  denominator: string
  total: number
  converted: number
  rate: number | null
  rows: { key: string; label: string; total: number; converted: number; rate: number | null }[]
  drill?: { key: string; items: { id: string; name: string; jobTitle: string | null; converted: boolean; at: string | null }[] }
}

export type ReportCycleSummary = {
  count: number
  average: number | null
  median: number | null
  max: number | null
  min: number | null
}

export type ReportCycles = {
  accessible: boolean
  note?: string
  formula: string
  denominator: string | null
  dimensions: string[]
  dimensionLabels?: string[]
  eligible: ReportCycleSummary
  excluded: { active: number; ineligible: number; missingDate: number; closedBeforeStart: number; outOfPeriod: number } | null
  rows: { key: string; labels: string[]; summary: ReportCycleSummary }[]
  drill?: { key: string; labels: string[]; items: { id: string; title: string; departmentName: string | null; recruiterName: string | null; requisitionType: string; recruitmentStartDate: string | null; closedAt: string | null; cycleDays: number }[] }
  unit: string
}

function reportQuery(filters: ReportFilters, extra: Record<string, string | number | undefined> = {}): string {
  return toQuery({ ...filters, ...extra })
}

export function getReportFilterOptions(): Promise<ReportFilterOptions> {
  return request<ReportFilterOptions>('/v1/reports/filters')
}

export function getReportFunnel(filters: ReportFilters, drillStage?: string): Promise<ReportFunnel> {
  return request<ReportFunnel>(`/v1/reports/funnel${reportQuery(filters, { drillStage })}`)
}

export function getReportChannels(filters: ReportFilters, drillChannel?: string): Promise<ReportChannels> {
  return request<ReportChannels>(`/v1/reports/channels${reportQuery(filters, { drillChannel })}`)
}

export function getReportReasons(type: 'ARCHIVE' | 'OFFER_REJECT' | 'ONBOARD_ABANDON', filters: ReportFilters, drillKey?: string): Promise<ReportReasons> {
  return request<ReportReasons>(`/v1/reports/reasons${reportQuery(filters, { type, drillKey })}`)
}

export function getReportProbation(filters: ReportFilters, drillGroup?: string): Promise<ReportProbation> {
  return request<ReportProbation>(`/v1/reports/probation${reportQuery(filters, { drillGroup })}`)
}

export function getReportCycles(filters: ReportFilters, dimensions: string[], drillGroup?: string): Promise<ReportCycles> {
  return request<ReportCycles>(`/v1/reports/cycles${reportQuery(filters, { dimensions: dimensions.join(','), drillGroup })}`)
}

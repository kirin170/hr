import type {
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
  ExcelImportResult,
  IntakeList,
  IntakeMonitor,
  IntakePoolList,
  IntakeResult,
  JobListItem,
  MailboxConfig,
  RequisitionList,
  SavedCandidateFilter,
  SourceRecordList,
} from './types'
const apiBase = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '')
const authApiBase = (import.meta.env.VITE_AUTH_API_BASE_URL || '/api/v1').replace(/\/$/, '')
const tokenKey = 'talentflow.accessToken'
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

export function refreshAccessToken(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
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
    })().finally(() => {
      refreshInFlight = null
    })
  }
  return refreshInFlight
}

export function startDingTalkLogin(): void {
  window.location.assign(`${authApiBase}/auth/dingtalk/login`)
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
      const renewed = await refreshAccessToken()
      if (renewed) {
        token = renewed
        response = await send(token)
      } else {
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

export function syncRequisition(payload: {
  oaApprovalId: string
  title: string
  departmentId: string
  headcount: number
  submittedAt: string
  recruitmentStartDate: string
  recruiterId?: string
  jobLevel?: string
  note?: string
  requirements?: string
}): Promise<{ created: boolean; requisition: ApiRequisition }> {
  return request('/requisitions/oa-sync', { method: 'POST', body: JSON.stringify(payload) })
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

export function listDepartments(): Promise<ApiDepartment[]> {
  return request<ApiDepartment[]>('/api/v1/authz/departments')
}

export function listUsers(): Promise<ApiUser[]> {
  return request<ApiUser[]>('/api/v1/authz/users')
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
      const renewed = await refreshAccessToken()
      if (renewed) {
        token = renewed
        response = await send(token)
      } else {
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
  window.open(signed.url, '_blank', 'noopener')
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

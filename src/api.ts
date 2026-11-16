import type {
  ApiDepartment,
  ApiJob,
  ApiRequisition,
  ApiUser,
  Candidate,
  CandidateStage,
  CandidateTimelineEvent,
  JobListItem,
  RequisitionList,
} from './types'

const apiBase = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '')
const tokenKey = 'talentflow.accessToken'

export function getAccessToken(): string | null {
  try {
    return window.localStorage.getItem(tokenKey)
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAccessToken()
  let response: Response
  try {
    response = await fetch(`${apiBase}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    })
  } catch {
    throw new Error('无法连接 ATS 后端，请确认后端服务已启动。')
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string | string[] } | null
    const message = Array.isArray(body?.message) ? body.message.join('；') : body?.message
    if (response.status === 401) {
      throw new Error(message || '需要登录后访问：前端尚未接入登录页，请先获取访问令牌。')
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

export function updateCandidateStage(id: string, stage: CandidateStage): Promise<Candidate> {
  return request<Candidate>(`/candidates/${encodeURIComponent(id)}/stage`, {
    method: 'PATCH',
    body: JSON.stringify({ stage }),
  })
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

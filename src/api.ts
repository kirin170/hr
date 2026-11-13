import type { ApiJob, Candidate, CandidateStage, CandidateTimelineEvent } from './types'

const apiBase = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '')

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${apiBase}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    })
  } catch {
    throw new Error('无法连接 ATS 后端，请确认后端服务已启动。')
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string | string[] } | null
    const message = Array.isArray(body?.message) ? body.message.join('；') : body?.message
    throw new Error(message || `请求失败（${response.status}）`)
  }
  return response.json() as Promise<T>
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

export function listJobs(): Promise<ApiJob[]> {
  return request<ApiJob[]>('/jobs')
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

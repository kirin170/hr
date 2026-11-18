import { useCallback, useEffect, useState } from 'react'
import type { AppData } from './types'
import type { ApiJob } from './types'
import { initialData, jobs as demoJobs, seedCandidates } from './data'
import { listCandidates, listJobs } from './api'
import { isLocalPreviewSession } from './localPreview'

const sessionInitialData: AppData = { ...initialData, candidates: [] }

export function useAppData() {
  const [data, setData] = useState<AppData>(sessionInitialData)
  const [candidatesLoading, setCandidatesLoading] = useState(true)
  const [candidatesError, setCandidatesError] = useState<string | null>(null)
  const [apiJobs, setApiJobs] = useState<ApiJob[]>([])

  useEffect(() => {
    let active = true
    if (isLocalPreviewSession()) {
      setData({ ...initialData, candidates: [...seedCandidates] })
      setCandidatesError(null)
      setCandidatesLoading(false)
      return () => { active = false }
    }
    listCandidates().then((candidates) => {
      if (!active) return
      setData((current) => ({ ...current, candidates }))
      setCandidatesError(null)
    }).catch((error: unknown) => {
      if (!active) return
      setCandidatesError(error instanceof Error ? error.message : '候选人加载失败')
    }).finally(() => {
      if (active) setCandidatesLoading(false)
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    if (isLocalPreviewSession()) {
      setApiJobs(demoJobs.map((job) => ({
        id: job.id,
        title: job.title,
        departmentId: job.departmentId,
        location: job.location,
        headcount: job.headcount,
        hiredCount: job.hired,
      })))
      return () => { active = false }
    }
    listJobs().then((jobs) => {
      if (active) setApiJobs(jobs)
    }).catch(() => {
      if (active) setApiJobs([])
    })
    return () => { active = false }
  }, [])

  const resetData = useCallback(() => {
    setData((current) => ({ ...initialData, candidates: current.candidates }))
  }, [])

  return { data, setData, resetData, candidatesLoading, candidatesError, apiJobs }
}

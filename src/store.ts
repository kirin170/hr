import { useCallback, useEffect, useState } from 'react'
import type { AppData } from './types'
import type { ApiJob } from './types'
import { initialData } from './data'
import { listCandidates, listJobs } from './api'

const sessionInitialData: AppData = { ...initialData, candidates: [] }

export function useAppData() {
  const [data, setData] = useState<AppData>(sessionInitialData)
  const [candidatesLoading, setCandidatesLoading] = useState(true)
  const [candidatesError, setCandidatesError] = useState<string | null>(null)
  const [apiJobs, setApiJobs] = useState<ApiJob[]>([])

  useEffect(() => {
    let active = true
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

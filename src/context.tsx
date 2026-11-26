import React, { createContext, useCallback, useContext, useMemo } from 'react'
import type { ApiJob, AppData, Candidate, Interview } from './types'
import { createCandidate as createCandidateRequest, updateCandidateStage } from './api'

export type Toast = { id: number; message: string; type?: 'success' | 'info' }

type AppContextValue = {
  data: AppData
  setData: React.Dispatch<React.SetStateAction<AppData>>
  resetData: () => void
  candidatesLoading: boolean
  candidatesError: string | null
  apiJobs: ApiJob[]
  toast: (message: string, type?: Toast['type']) => void
  toasts: Toast[]
  dismissToast: (id: number) => void
  selectedCandidateId: string | null
  openCandidate: (id: string | null) => void
  addCandidate: (candidate: Candidate) => Promise<Candidate>
  updateCandidate: (id: string, patch: Partial<Candidate>) => Promise<Candidate | null>
  addInterview: (interview: Interview) => void
  updateInterview: (id: string, patch: Partial<Interview>) => void
}

type AppProviderProps = {
  data: AppData
  setData: React.Dispatch<React.SetStateAction<AppData>>
  resetData: () => void
  candidatesLoading: boolean
  candidatesError: string | null
  apiJobs: ApiJob[]
  selectedCandidateId: string | null
  openCandidate: (id: string | null) => void
  addToast: (message: string, type?: Toast['type']) => void
  toasts: Toast[]
  dismissToast: (id: number) => void
  children: React.ReactNode
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ data, setData, resetData, candidatesLoading, candidatesError, apiJobs, selectedCandidateId, openCandidate, addToast, toasts, dismissToast, children }: AppProviderProps) {
  const addCandidate = useCallback(async (candidate: Candidate) => {
    const created = await createCandidateRequest(candidate)
    setData((prev) => ({
      ...prev,
      candidates: [created, ...prev.candidates.filter((item) => item.id !== created.id)],
      activities: [{ id: `ac-${Date.now()}`, actor: '我', action: '新建了候选人', target: created.name, time: '刚刚', color: '#6675E8', icon: 'user' as const }, ...prev.activities],
    }))
    return created
  }, [setData])

  const updateCandidate = useCallback(async (id: string, patch: Partial<Candidate>) => {
    if (patch.stage === undefined) return null
    const updated = await updateCandidateStage(id, patch.stage)
    setData((prev) => ({ ...prev, candidates: prev.candidates.map((candidate) => candidate.id === id ? { ...candidate, ...updated } : candidate) }))
    return updated
  }, [setData])

  const addInterview = useCallback((interview: Interview) => {
    setData((prev) => ({
      ...prev,
      interviews: [interview, ...prev.interviews],
      activities: [{ id: `ac-${Date.now()}`, actor: '我', action: '安排了面试', target: `${prev.candidates.find(c => c.id === interview.candidateId)?.name || '候选人'} · ${interview.round}`, time: '刚刚', color: '#D58A28', icon: 'calendar' as const }, ...prev.activities],
    }))
  }, [setData])

  const updateInterview = useCallback((id: string, patch: Partial<Interview>) => {
    setData((prev) => ({ ...prev, interviews: prev.interviews.map((interview) => interview.id === id ? { ...interview, ...patch } : interview) }))
  }, [setData])

  const value = useMemo<AppContextValue>(
    () => ({
      data,
      setData,
      resetData,
      candidatesLoading,
      candidatesError,
      apiJobs,
      selectedCandidateId,
      openCandidate,
      toasts,
      dismissToast,
      toast: addToast,
      addCandidate,
      updateCandidate,
      addInterview,
      updateInterview,
    }),
    [
      data,
      setData,
      resetData,
      candidatesLoading,
      candidatesError,
      apiJobs,
      selectedCandidateId,
      openCandidate,
      toasts,
      dismissToast,
      addToast,
      addCandidate,
      updateCandidate,
      addInterview,
      updateInterview,
    ],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const context = useContext(AppContext)
  if (!context) throw new Error('useApp must be used within AppProvider')
  return context
}

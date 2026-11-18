import React, { createContext, useContext, useState } from 'react'
import type { ApiJob, AppData, Candidate, Interview } from './types'
import { createCandidate as createCandidateRequest, listCandidates, updateCandidateStage } from './api'
import { isLocalPreviewSession } from './localPreview'

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
  const addCandidate = async (candidate: Candidate) => {
    const created = isLocalPreviewSession() ? candidate : await createCandidateRequest(candidate)
    setData((prev) => ({
      ...prev,
      candidates: [created, ...prev.candidates.filter((item) => item.id !== created.id)],
      activities: [{ id: `ac-${Date.now()}`, actor: '我', action: '新建了候选人', target: created.name, time: '刚刚', color: '#6675E8', icon: 'user' as const }, ...prev.activities],
    }))
    return created
  }

  const updateCandidate = async (id: string, patch: Partial<Candidate>) => {
    if (patch.stage === undefined) return null
    if (isLocalPreviewSession()) {
      const current = data.candidates.find((candidate) => candidate.id === id)
      if (!current) return null
      const updated = { ...current, ...patch, stage: patch.stage }
      setData((prev) => ({ ...prev, candidates: prev.candidates.map((candidate) => candidate.id === id ? updated : candidate) }))
      return updated
    }
    const updated = await updateCandidateStage(id, patch.stage)
    setData((prev) => ({ ...prev, candidates: prev.candidates.map((candidate) => candidate.id === id ? { ...candidate, ...updated } : candidate) }))
    return updated
  }

  const addInterview = (interview: Interview) => {
    setData((prev) => ({
      ...prev,
      interviews: [interview, ...prev.interviews],
      activities: [{ id: `ac-${Date.now()}`, actor: '我', action: '安排了面试', target: `${prev.candidates.find(c => c.id === interview.candidateId)?.name || '候选人'} · ${interview.round}`, time: '刚刚', color: '#D58A28', icon: 'calendar' as const }, ...prev.activities],
    }))
  }

  const updateInterview = (id: string, patch: Partial<Interview>) => {
    setData((prev) => ({ ...prev, interviews: prev.interviews.map((interview) => interview.id === id ? { ...interview, ...patch } : interview) }))
  }

  return <AppContext.Provider value={{ data, setData, resetData, candidatesLoading, candidatesError, apiJobs, selectedCandidateId, openCandidate, toasts, dismissToast, toast: addToast, addCandidate, updateCandidate, addInterview, updateInterview }}>{children}</AppContext.Provider>
}

export function useApp() {
  const context = useContext(AppContext)
  if (!context) throw new Error('useApp must be used within AppProvider')
  return context
}

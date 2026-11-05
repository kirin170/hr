import React, { createContext, useContext, useState } from 'react'
import type { AppData, Candidate, Interview } from './types'

export type Toast = { id: number; message: string; type?: 'success' | 'info' }

type AppContextValue = {
  data: AppData
  setData: React.Dispatch<React.SetStateAction<AppData>>
  resetData: () => void
  toast: (message: string, type?: Toast['type']) => void
  toasts: Toast[]
  dismissToast: (id: number) => void
  selectedCandidateId: string | null
  openCandidate: (id: string | null) => void
  addCandidate: (candidate: Candidate) => void
  updateCandidate: (id: string, patch: Partial<Candidate>) => void
  addInterview: (interview: Interview) => void
  updateInterview: (id: string, patch: Partial<Interview>) => void
}

type AppProviderProps = {
  data: AppData
  setData: React.Dispatch<React.SetStateAction<AppData>>
  resetData: () => void
  selectedCandidateId: string | null
  openCandidate: (id: string | null) => void
  addToast: (message: string, type?: Toast['type']) => void
  toasts: Toast[]
  dismissToast: (id: number) => void
  children: React.ReactNode
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ data, setData, resetData, selectedCandidateId, openCandidate, addToast, toasts, dismissToast, children }: AppProviderProps) {
  const addCandidate = (candidate: Candidate) => {
    setData((prev) => ({
      ...prev,
      candidates: [candidate, ...prev.candidates],
      activities: [{ id: `ac-${Date.now()}`, actor: '我', action: '新建了候选人', target: candidate.name, time: '刚刚', color: '#6675E8', icon: 'user' as const }, ...prev.activities],
    }))
  }

  const updateCandidate = (id: string, patch: Partial<Candidate>) => {
    setData((prev) => ({ ...prev, candidates: prev.candidates.map((candidate) => candidate.id === id ? { ...candidate, ...patch } : candidate) }))
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

  return <AppContext.Provider value={{ data, setData, resetData, selectedCandidateId, openCandidate, toasts, dismissToast, toast: addToast, addCandidate, updateCandidate, addInterview, updateInterview }}>{children}</AppContext.Provider>
}

export function useApp() {
  const context = useContext(AppContext)
  if (!context) throw new Error('useApp must be used within AppProvider')
  return context
}

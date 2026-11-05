import { useCallback, useEffect, useState } from 'react'
import type { AppData } from './types'
import { initialData } from './data'

const STORAGE_KEY = 'talentflow-demo-v1'

export function useAppData() {
  const [data, setData] = useState<AppData>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      return stored ? JSON.parse(stored) as AppData : initialData
    } catch {
      return initialData
    }
  })

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  }, [data])

  const resetData = useCallback(() => {
    setData(initialData)
  }, [])

  return { data, setData, resetData }
}

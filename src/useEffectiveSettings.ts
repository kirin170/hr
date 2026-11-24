import { useEffect, useState } from 'react'
import type { EffectiveSettings } from './types'
import { getEffectiveSettings } from './api'

let cached: EffectiveSettings | null = null
let pending: Promise<EffectiveSettings> | null = null

/** 管理后台改动配置后调用，让表单拿到新的必填/字典/原因选项 */
export function invalidateEffectiveSettings(): void {
  cached = null
  pending = null
}

/**
 * 有效配置（ATS-024）：必填与显示标记、启用中的字典与归档原因、启用中的面试方案。
 * 整站共享一份缓存，避免每个表单各自拉取。
 */
export function useEffectiveSettings(): EffectiveSettings | null {
  const [value, setValue] = useState<EffectiveSettings | null>(cached)
  useEffect(() => {
    let active = true
    if (!pending) {
      pending = getEffectiveSettings().catch((error: unknown) => {
        pending = null
        throw error
      })
    }
    pending.then((next) => {
      cached = next
      if (active) setValue(next)
    }).catch(() => {
      if (active) setValue(null)
    })
    return () => { active = false }
  }, [])
  return value
}

import { useEffect, useState } from 'react'
import type { EffectiveSettings } from './types'
import { getEffectiveSettings } from './api'

let cached: EffectiveSettings | null = null
let pending: Promise<EffectiveSettings> | null = null
let version = 0

/** 管理后台改动配置或切换登录态后调用，让表单拿到新的必填/字典/原因选项 */
export function invalidateEffectiveSettings(): void {
  version += 1
  cached = null
  pending = null
}

if (typeof window !== 'undefined') {
  window.addEventListener('talentflow-auth-required', invalidateEffectiveSettings)
}

/**
 * 有效配置（ATS-024）：必填与显示标记、启用中的字典与归档原因、启用中的面试方案。
 * 整站共享一份缓存，避免每个表单各自拉取。
 */
export function useEffectiveSettings(): EffectiveSettings | null {
  const [value, setValue] = useState<EffectiveSettings | null>(cached)
  useEffect(() => {
    let active = true
    const ticket = version
    if (!pending) {
      pending = getEffectiveSettings().catch((error: unknown) => {
        if (ticket === version) pending = null
        throw error
      })
    }
    pending.then((next) => {
      if (ticket !== version) return
      cached = next
      if (active) setValue(next)
    }).catch(() => {
      if (active && ticket === version) setValue(null)
    })
    return () => { active = false }
  }, [])
  return value
}

import { useEffect, useState } from 'react'
import { BellRing, LogOut, ShieldCheck, UserRound } from 'lucide-react'
import type { CurrentUser, MyNotificationPreferences } from '../types'
import { getDirectory, getMyNotificationPreferences, logout, updateMyNotificationPreferences } from '../api'
import { cn } from '../utils'

type UserMenuProps = {
  me: CurrentUser | null
  onClose: () => void
  onOpenAdmin?: () => void
}

/**
 * 用户菜单（ATS-024）：个人资料与个人通知偏好集中在这里。
 * 组织级的通知规则在管理后台「通知与提醒」里维护，这里只放本人可关闭的低优先级事件。
 */
export function UserMenu({ me, onClose, onOpenAdmin }: UserMenuProps) {
  const [tab, setTab] = useState<'profile' | 'notifications'>('profile')
  const [departmentName, setDepartmentName] = useState('')
  const [preferences, setPreferences] = useState<MyNotificationPreferences | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let active = true
    if (me?.departmentId) {
      void getDirectory()
        .then((dir) => {
          if (!active) return
          const hit = dir.departments.find((item) => item.id === me.departmentId)
          setDepartmentName(hit?.name || '')
        })
        .catch(() => { if (active) setDepartmentName('') })
    }
    return () => { active = false }
  }, [me?.departmentId])

  useEffect(() => {
    let active = true
    void getMyNotificationPreferences()
      .then((data) => { if (active) setPreferences(data) })
      .catch((err: unknown) => { if (active) setError(err instanceof Error ? err.message : '通知偏好加载失败') })
    return () => { active = false }
  }, [])

  const toggleMuted = async (key: string) => {
    if (!preferences) return
    const muted = preferences.muted.includes(key)
      ? preferences.muted.filter((item) => item !== key)
      : [...preferences.muted, key]
    setSaving(true)
    setError('')
    try {
      setPreferences(await updateMyNotificationPreferences(muted))
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const userPerms = new Set(me?.roles.flatMap((role) => role.permissions) ?? [])
  const canOpenAdmin = ['setting:read', 'authz:read', 'authz:field-grant:manage', 'organization:sync', 'audit:read']
    .some((code) => userPerms.has(code))

  return (
    <div className="user-menu" role="dialog" aria-label="用户菜单">
      <div className="user-menu-head">
        <span className="avatar avatar-sm avatar-warm">{(me?.displayName || '未').slice(0, 1)}</span>
        <div>
          <strong>{me?.displayName || '未登录'}</strong>
          <small>{me?.roles.map((role) => role.name).join(' · ') || '暂无角色'}</small>
        </div>
      </div>
      <div className="user-menu-tabs">
        <button className={cn(tab === 'profile' && 'active')} onClick={() => setTab('profile')}><UserRound size={14} />个人资料</button>
        <button className={cn(tab === 'notifications' && 'active')} onClick={() => setTab('notifications')}><BellRing size={14} />通知偏好</button>
      </div>
      {tab === 'profile' && (
        <dl className="user-menu-profile">
          <div><dt>姓名</dt><dd>{me?.displayName || '—'}</dd></div>
          <div><dt>部门</dt><dd>{departmentName || '未设置'}</dd></div>
          <div><dt>角色</dt><dd>{me?.roles.map((role) => `${role.name}（${scopeLabel(role.dataScope)}）`).join('、') || '暂无角色'}</dd></div>
        </dl>
      )}
      {tab === 'notifications' && (
        <div className="user-menu-notifications">
          {preferences?.closable.length ? (
            preferences.closable.map((item) => (
              <label key={item.key}>
                <input
                  type="checkbox"
                  checked={!preferences.muted.includes(item.key)}
                  disabled={saving}
                  onChange={() => { void toggleMuted(item.key) }}
                />
                <span>{item.label}</span>
              </label>
            ))
          ) : (
            <p className="hint">暂无可自行关闭的通知：当前事件均要求送达。</p>
          )}
          <p className="hint">接收角色与高优先级事件由业务规则确定，不能在此关闭。</p>
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
      <div className="user-menu-foot">
        {canOpenAdmin && onOpenAdmin && (
          <button className="text-button" onClick={() => { onOpenAdmin(); onClose() }}><ShieldCheck size={14} />系统管理</button>
        )}
        <button className="text-button" style={{ marginLeft: 'auto' }} onClick={() => { onClose(); void logout() }}><LogOut size={14} />退出登录</button>
      </div>
    </div>
  )
}

function scopeLabel(scope: string): string {
  const map: Record<string, string> = {
    SELF: '本人',
    DEPARTMENT: '本部门',
    DEPARTMENT_TREE: '本部门及下级',
    OWN_JOBS: '负责职位',
    PARTICIPATING: '参与面试或筛选',
    DEPARTMENT_AND_PARTICIPATING: '本部门及参与',
    ALL: '全部',
  }
  return map[scope] || scope
}

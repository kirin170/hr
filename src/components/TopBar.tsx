import { useEffect, useRef, useState } from 'react'
import { Bell, ChevronDown, Command, Search } from 'lucide-react'
import { cn } from '../utils'
import { request } from '../api'
import type { CurrentUser } from '../types'
import { UserMenu } from './UserMenu'

export type TopBarProps = {
  title: string
  subtitle?: string
  search: string
  onSearch: (value: string) => void
  onSearchSubmit?: () => void
  me: CurrentUser | null
  onOpenAdmin?: () => void
}

export function TopBar({ title, subtitle, search, onSearch, onSearchSubmit, me, onOpenAdmin }: TopBarProps) {
  const [open, setOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [notifications, setNotifications] = useState<{ id: string; name: string; onboardDate: string; readAt: string | null }[]>([])
  const canReadOnboardingReminders =
    me?.roles.some((role) => role.permissions.includes('candidate:stage:update')) ?? false

  useEffect(() => {
    if (!canReadOnboardingReminders) {
      setNotifications([])
      return
    }
    let active = true
    const load = () =>
      request<typeof notifications>('/onboarding-reminders')
        .then((rows) => { if (active) setNotifications(rows) })
        .catch(() => { if (active) setNotifications([]) })
    void load()
    const timer = window.setInterval(load, 60_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [canReadOnboardingReminders])

  const inputRef = useRef<HTMLInputElement>(null)
  const profileRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])
  useEffect(() => {
    if (!menuOpen) return
    const handleOutside = (event: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    window.addEventListener('mousedown', handleOutside)
    return () => window.removeEventListener('mousedown', handleOutside)
  }, [menuOpen])

  return (
    <header className="topbar">
      <div className="topbar-heading">
        <h1>{title}</h1>
        {subtitle && <span className="topbar-subtitle">{subtitle}</span>}
      </div>
      <div className="topbar-actions">
        <label className="global-search">
          <Search size={17} />
          <input
            ref={inputRef}
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && search.trim()) onSearchSubmit?.()
            }}
            placeholder="搜索候选人，按 Enter 跳转"
          />
          <kbd><Command size={11} /> K</kbd>
        </label>
        <button className="icon-button notification-button" title="待入职保温提醒" onClick={() => setOpen(!open)}>
          <Bell size={19} />
          {notifications.some((n) => !n.readAt) && <span className="notification-dot" />}
        </button>
        {open && (
          <div className="onboarding-notifications" role="region" aria-label="保温提醒">
            <strong>待入职保温提醒</strong>
            {notifications.length === 0 ? (
              <p>暂无提醒</p>
            ) : (
              notifications.map((item) => (
                <div key={item.id}>
                  <span>{item.name} · 入职日期 {item.onboardDate.slice(0, 10)}</span>
                  {!item.readAt && (
                    <button
                      className="text-button"
                      onClick={() => {
                        void request(`/onboarding-reminders/${encodeURIComponent(item.id)}/read`, { method: 'POST' }).then(() =>
                          setNotifications((current) =>
                            current.map((row) => (row.id === item.id ? { ...row, readAt: new Date().toISOString() } : row)),
                          ),
                        )
                      }}
                    >
                      标为已读
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        )}
        <div className="profile-anchor" ref={profileRef}>
          <button
            className={cn('profile-compact', menuOpen && 'profile-compact-open')}
            onClick={() => setMenuOpen(!menuOpen)}
            aria-expanded={menuOpen}
          >
            <span className="avatar avatar-sm avatar-warm">{(me?.displayName || '未').slice(0, 1)}</span>
            <span className="profile-name">{me?.displayName || '未登录'}</span>
            <ChevronDown size={14} />
          </button>
          {menuOpen && <UserMenu me={me} onClose={() => setMenuOpen(false)} onOpenAdmin={onOpenAdmin} />}
        </div>
      </div>
    </header>
  )
}

import { useEffect, useRef, useState } from 'react'
import { Bell, ChevronDown, Command, HelpCircle, Search, Settings2 } from 'lucide-react'
import { cn } from '../utils'
import { request } from '../api'
import type { CurrentUser } from '../types'
import { UserMenu } from './UserMenu'

export type TopBarProps = {
  title: string
  subtitle?: string
  onSearch: (value: string) => void
  onOpenSettings: () => void
  me: CurrentUser | null
  onOpenAdmin?: () => void
}

export function TopBar({ title, subtitle, onSearch, onOpenSettings, me, onOpenAdmin }: TopBarProps) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [notifications, setNotifications] = useState<{id:string; name:string; onboardDate:string; readAt:string | null}[]>([])
  useEffect(() => {
    let active = true
    const load = () => request<typeof notifications>('/onboarding-reminders').then(rows => { if (active) setNotifications(rows) }).catch(() => { if (active) setNotifications([]) })
    void load(); const timer = window.setInterval(load, 60_000)
    return () => { active = false; window.clearInterval(timer) }
  }, [])
  const inputRef = useRef<HTMLInputElement>(null)
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
            onChange={(event) => { setSearch(event.target.value); onSearch(event.target.value) }}
            placeholder="搜索候选人、职位或流程"
          />
          <kbd><Command size={11} /> K</kbd>
        </label>
        <button className="icon-button help-button" title="帮助中心"><HelpCircle size={19} /></button>
        <button className="icon-button notification-button" title="通知" onClick={() => setOpen(!open)}>
          <Bell size={19} />
          {notifications.some(n => !n.readAt) && <span className="notification-dot" />}
        </button>
        {open && <div className="onboarding-notifications" role="region" aria-label="保温提醒"><strong>待入职保温提醒</strong>{notifications.length === 0 ? <p>暂无提醒</p> : notifications.map(item => <div key={item.id}><span>{item.name} · 入职日期 {item.onboardDate.slice(0,10)}</span>{!item.readAt && <button onClick={() => { void request(`/onboarding-reminders/${encodeURIComponent(item.id)}/read`, {method:'POST'}).then(() => setNotifications(current => current.map(row => row.id === item.id ? {...row,readAt:new Date().toISOString()} : row))) }}>标为已读</button>}</div>)}</div>}
        <button className="icon-button" title="设置" onClick={onOpenSettings}><Settings2 size={18} /></button>
        <div className="profile-anchor">
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

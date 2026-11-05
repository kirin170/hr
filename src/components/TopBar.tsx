import { useEffect, useRef, useState } from 'react'
import { Bell, ChevronDown, Command, HelpCircle, Search, Settings2 } from 'lucide-react'
import { cn } from '../utils'

export type TopBarProps = {
  title: string
  subtitle?: string
  onSearch: (value: string) => void
  onOpenSettings: () => void
}

export function TopBar({ title, subtitle, onSearch, onOpenSettings }: TopBarProps) {
  const [search, setSearch] = useState('')
  const [notifications, setNotifications] = useState(true)
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
        <button className="icon-button notification-button" title="通知" onClick={() => setNotifications(false)}>
          <Bell size={19} />
          {notifications && <span className="notification-dot" />}
        </button>
        <button className="icon-button" title="设置" onClick={onOpenSettings}><Settings2 size={18} /></button>
        <button className="profile-compact">
          <span className="avatar avatar-sm avatar-warm">邓</span>
          <span className="profile-name">邓文文</span>
          <ChevronDown size={14} />
        </button>
      </div>
    </header>
  )
}

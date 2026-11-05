import { useState } from 'react'
import { ArrowUpRight, BarChart3, BriefcaseBusiness, CalendarDays, ChevronDown, CircleHelp, ClipboardCheck, FileSearch, LayoutDashboard, LogOut, Settings, Sparkles, Users, UsersRound } from 'lucide-react'
import type { PageKey } from '../types'
import { cn } from '../utils'

type SidebarProps = { page: PageKey; onNavigate: (page: PageKey) => void; onSettings: () => void }

const navPrimary: { key: PageKey; label: string; icon: typeof LayoutDashboard; badge?: string }[] = [
  { key: 'dashboard', label: '工作台', icon: LayoutDashboard },
  { key: 'candidates', label: '简历库', icon: Users },
  { key: 'pipeline', label: '招聘流程', icon: BriefcaseBusiness },
  { key: 'interviews', label: '面试安排', icon: CalendarDays, badge: '3' },
]

const navSecondary: { key: PageKey; label: string; icon: typeof LayoutDashboard }[] = [
  { key: 'probation', label: '试用期管理', icon: ClipboardCheck },
  { key: 'team', label: '部门协同', icon: UsersRound },
  { key: 'reports', label: '招聘数据', icon: BarChart3 },
]

export function Sidebar({ page, onNavigate, onSettings }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <aside className={cn('sidebar', collapsed && 'sidebar-collapsed')}>
      <div className="sidebar-brand">
        <div className="brand-mark"><span /><span /><span /></div>
        {!collapsed && <span className="brand-word">TalentFlow</span>}
      </div>
      <button className="workspace-switch">
        <span className="workspace-logo">P</span>
        {!collapsed && <><span className="workspace-copy"><strong>派派科技</strong><small>招聘管理工作台</small></span><ChevronDown size={14} /></>}
      </button>
      <nav className="sidebar-nav">
        <span className="nav-label">{!collapsed && '招聘管理'}</span>
        {navPrimary.map((item) => {
          const Icon = item.icon
          return (
            <button key={item.key} className={cn('nav-item', page === item.key && 'nav-item-active')} onClick={() => onNavigate(item.key)} title={item.label}>
              <Icon size={18} strokeWidth={1.9} />
              {!collapsed && <span>{item.label}</span>}
              {!collapsed && item.badge && <span className="nav-badge">{item.badge}</span>}
            </button>
          )
        })}
        <span className="nav-label nav-label-space">{!collapsed && '团队与组织'}</span>
        {navSecondary.map((item) => {
          const Icon = item.icon
          return (
            <button key={item.key} className={cn('nav-item', page === item.key && 'nav-item-active')} onClick={() => onNavigate(item.key)} title={item.label}>
              <Icon size={18} strokeWidth={1.9} />
              {!collapsed && <span>{item.label}</span>}
            </button>
          )
        })}
      </nav>
      {!collapsed && (
        <div className="sidebar-tip">
          <div className="sidebar-tip-icon"><Sparkles size={15} /></div>
          <div><strong>让招聘更有序</strong><p>统一管理人才与协作流程</p></div>
          <ArrowUpRight size={15} />
        </div>
      )}
      <div className="sidebar-footer">
        <button className="nav-item" title="设置" onClick={onSettings}><Settings size={18} />{!collapsed && <span>设置</span>}</button>
        <button className="nav-item" title="帮助中心"><CircleHelp size={18} />{!collapsed && <span>帮助中心</span>}</button>
        <div className="sidebar-user">
          <span className="avatar avatar-sm avatar-warm">邓</span>
          {!collapsed && <span className="sidebar-user-copy"><strong>邓文文</strong><small>超级管理员</small></span>}
          {!collapsed && <button className="icon-button icon-button-small" title="退出登录"><LogOut size={15} /></button>}
        </div>
        <button className="collapse-button" onClick={() => setCollapsed(!collapsed)} title={collapsed ? '展开侧栏' : '收起侧栏'}>
          <span className={cn('collapse-chevron', collapsed && 'collapse-chevron-forward')}>‹</span>
        </button>
      </div>
    </aside>
  )
}

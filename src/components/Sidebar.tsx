import { useEffect, useState } from 'react'
import { Activity, ArrowUpRight, BarChart3, BriefcaseBusiness, Building2, CalendarDays, ChevronDown, CircleHelp, ClipboardCheck, FileSearch, GraduationCap, Inbox, LayoutDashboard, LogOut, Settings, ShieldCheck, Sparkles, Users, UsersRound } from 'lucide-react'
import type { CurrentUser, PageKey } from '../types'
import { getDashboardSummary } from '../api'
import { cn } from '../utils'

type SidebarProps = { page: PageKey; onNavigate: (page: PageKey) => void; onSettings: () => void; me: CurrentUser | null }

const navPrimary: { key: PageKey; label: string; icon: typeof LayoutDashboard; badge?: string }[] = [
  { key: 'dashboard', label: '工作台', icon: LayoutDashboard },
  { key: 'positions', label: '职位与需求', icon: Building2 },
  { key: 'intake', label: '简历入场', icon: FileSearch },
  { key: 'pool', label: '待分配池', icon: Inbox },
  { key: 'intakeMonitor', label: '入场监控', icon: Activity },
  { key: 'campus', label: '校招投递', icon: GraduationCap },
  { key: 'candidates', label: '简历库', icon: Users },
  { key: 'pipeline', label: '招聘流程', icon: BriefcaseBusiness },
  { key: 'interviews', label: '面试安排', icon: CalendarDays },
]

const navSecondary: { key: PageKey; label: string; icon: typeof LayoutDashboard }[] = [
  { key: 'probation', label: '试用期管理', icon: ClipboardCheck },
  { key: 'team', label: '部门协同', icon: UsersRound },
  { key: 'reports', label: '招聘数据', icon: BarChart3 },
]

export function Sidebar({ page, onNavigate, onSettings, me }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false)
  // 面试安排角标使用今日面试真实数量，登录后再拉取，避免未登录时触发鉴权跳转
  const [interviewCount, setInterviewCount] = useState<number | null>(null)
  const meId = me?.id
  useEffect(() => {
    if (!meId) {
      setInterviewCount(null)
      return
    }
    let cancelled = false
    getDashboardSummary()
      .then((summary) => {
        if (!cancelled) setInterviewCount(summary.today.interviews.count)
      })
      .catch(() => {
        if (!cancelled) setInterviewCount(null)
      })
    return () => {
      cancelled = true
    }
  }, [meId])
  // 管理后台只对具备设置读取权限的角色开放，其余角色看不到入口
  const canManageSettings = me?.roles.some((role) => role.permissions.includes('setting:read')) ?? false
  return (
    <aside className={cn('sidebar', collapsed && 'sidebar-collapsed')}>
      <div className="sidebar-brand">
        <div className="brand-mark"><span /><span /><span /></div>
        {!collapsed && <span className="brand-copy">
          <span className="brand-word">TalentFlow</span>
          <span className="brand-subtitle">招聘管理系统</span>
        </span>}
      </div>
      <button className="workspace-switch">
        <span className="workspace-logo">P</span>
        {!collapsed && <><span className="workspace-copy"><strong>派派科技</strong><small>招聘管理工作台</small></span><ChevronDown size={14} /></>}
      </button>
      <nav className="sidebar-nav">
        <span className="nav-label">{!collapsed && '招聘管理'}</span>
        {navPrimary.map((item) => {
          const Icon = item.icon
          const badge = item.key === 'interviews' ? (interviewCount ? String(interviewCount) : undefined) : item.badge
          return (
            <button key={item.key} className={cn('nav-item', page === item.key && 'nav-item-active')} onClick={() => onNavigate(item.key)} title={item.label}>
              <Icon size={18} strokeWidth={1.9} />
              {!collapsed && <span>{item.label}</span>}
              {!collapsed && badge && <span className="nav-badge">{badge}</span>}
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
        {canManageSettings && <>
          <span className="nav-label nav-label-space">{!collapsed && '系统管理'}</span>
          <button className={cn('nav-item', page === 'admin' && 'nav-item-active')} onClick={() => onNavigate('admin')} title="管理后台">
            <ShieldCheck size={18} strokeWidth={1.9} />
            {!collapsed && <span>管理后台</span>}
          </button>
        </>}
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
          <span className="avatar avatar-sm avatar-warm">{(me?.displayName || '未').slice(0, 1)}</span>
          {!collapsed && <span className="sidebar-user-copy"><strong>{me?.displayName || '未登录'}</strong><small>{me?.roles.map((role) => role.name).join(' · ') || '暂无角色'}</small></span>}
          {!collapsed && <button className="icon-button icon-button-small" title="退出登录"><LogOut size={15} /></button>}
        </div>
        <button className="collapse-button" onClick={() => setCollapsed(!collapsed)} title={collapsed ? '展开侧栏' : '收起侧栏'}>
          <span className={cn('collapse-chevron', collapsed && 'collapse-chevron-forward')}>‹</span>
        </button>
      </div>
    </aside>
  )
}

import { useEffect, useState } from 'react'
import {
  Activity,
  BarChart3,
  Building2,
  CalendarDays,
  ChevronDown,
  ClipboardCheck,
  FileSearch,
  FileText,
  KeyRound,
  LayoutDashboard,
  Network,
  SlidersHorizontal,
  UserCog,
  Users,
} from 'lucide-react'
import { getDashboardSummary } from '../api'
import type { CurrentUser, PageKey } from '../types'
import { cn } from '../utils'

type SidebarProps = {
  page: PageKey
  onNavigate: (page: PageKey) => void
  me: CurrentUser | null
}

type NavItem = {
  key: PageKey
  label: string
  icon: typeof LayoutDashboard
  permissionAny?: string[]
}

const navOverview: NavItem[] = [
  { key: 'dashboard', label: '工作台', icon: LayoutDashboard },
]

const navRecruiting: NavItem[] = [
  { key: 'positions', label: '职位与需求', icon: Building2 },
  { key: 'intake', label: '简历入场', icon: FileSearch },
  { key: 'candidates', label: '候选人', icon: Users },
  { key: 'interviews', label: '面试安排', icon: CalendarDays },
  { key: 'probation', label: '入职与试用期', icon: ClipboardCheck },
]

const navAnalytics: NavItem[] = [
  { key: 'reports', label: '招聘数据', icon: BarChart3 },
]

const navAdmin: NavItem[] = [
  { key: 'adminOrg', label: '组织架构', icon: Network, permissionAny: ['authz:read', 'organization:sync'] },
  { key: 'adminUsers', label: '成员管理', icon: UserCog, permissionAny: ['authz:read'] },
  { key: 'adminAuth', label: '角色与权限', icon: KeyRound, permissionAny: ['authz:read', 'authz:field-grant:manage'] },
  { key: 'adminConfig', label: '业务配置', icon: SlidersHorizontal, permissionAny: ['setting:read'] },
  { key: 'adminOps', label: '集成与运维', icon: Activity, permissionAny: ['setting:read'] },
  { key: 'adminAudit', label: '操作审计', icon: FileText, permissionAny: ['audit:read'] },
]

export function Sidebar({ page, onNavigate, me }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [adminOpen, setAdminOpen] = useState(() => page.startsWith('admin'))
  const [interviewCount, setInterviewCount] = useState<number | null>(null)
  const meId = me?.id

  useEffect(() => {
    if (page.startsWith('admin')) setAdminOpen(true)
  }, [page])

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

  const userPerms = new Set(me?.roles.flatMap((role) => role.permissions) ?? [])
  const visibleAdmin = navAdmin.filter(
    (item) => !item.permissionAny || item.permissionAny.some((code) => userPerms.has(code)),
  )

  const renderItem = (item: NavItem) => {
    const Icon = item.icon
    const badge = item.key === 'interviews' ? (interviewCount ? String(interviewCount) : undefined) : undefined
    return (
      <button
        key={item.key}
        className={cn('nav-item', page === item.key && 'nav-item-active')}
        onClick={() => onNavigate(item.key)}
        title={item.label}
      >
        <Icon size={18} strokeWidth={1.9} />
        {!collapsed && <span>{item.label}</span>}
        {!collapsed && badge && <span className="nav-badge">{badge}</span>}
      </button>
    )
  }

  return (
    <aside className={cn('sidebar', collapsed && 'sidebar-collapsed')}>
      <div className="sidebar-brand">
        <div className="brand-mark"><span /><span /><span /></div>
        {!collapsed && (
          <span className="brand-copy">
            <span className="brand-word">TalentFlow</span>
            <span className="brand-subtitle">招聘管理系统</span>
          </span>
        )}
      </div>

      <div className="workspace-badge">
        <span className="workspace-logo">P</span>
        {!collapsed && (
          <span className="workspace-copy">
            <strong>派派科技</strong>
            <small>招聘管理工作台</small>
          </span>
        )}
      </div>

      <nav className="sidebar-nav">
        <span className="nav-label">{!collapsed && '概览'}</span>
        {navOverview.map(renderItem)}

        <span className="nav-label nav-label-space">{!collapsed && '招聘执行'}</span>
        {navRecruiting.map(renderItem)}

        <span className="nav-label nav-label-space">{!collapsed && '数据分析'}</span>
        {navAnalytics.map(renderItem)}

        {visibleAdmin.length > 0 && (
          <>
            {!collapsed ? (
              <button
                type="button"
                className="nav-group-toggle"
                onClick={() => setAdminOpen((open) => !open)}
                aria-expanded={adminOpen}
              >
                <span>系统管理</span>
                <ChevronDown size={13} className={cn('nav-group-chevron', adminOpen && 'open')} />
              </button>
            ) : (
              <span className="nav-label nav-label-space" />
            )}
            {(collapsed || adminOpen) && visibleAdmin.map(renderItem)}
          </>
        )}
      </nav>

      <div className="sidebar-footer">
        <button
          className="collapse-button"
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? '展开侧栏' : '收起侧栏'}
        >
          <span className={cn('collapse-chevron', collapsed && 'collapse-chevron-forward')}>‹</span>
        </button>
      </div>
    </aside>
  )
}

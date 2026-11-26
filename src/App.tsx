import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Info, X } from 'lucide-react'
import { getCurrentUser } from './api'
import { AddCandidateModal } from './components/AddCandidateModal'
import { CandidateDrawer } from './components/CandidateDrawer'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { AppProvider, type Toast } from './context'
import { Candidates } from './pages/Candidates'
import { Dashboard } from './pages/Dashboard'
import { IntakeHub, type IntakeHubTab } from './pages/IntakeHub'
import { InterviewModal, Interviews } from './pages/Interviews'
import { Positions } from './pages/Positions'
import { Probation } from './pages/Probation'
import { Reports } from './pages/Reports'
import { AdminAuditPage } from './pages/admin/AdminAuditPage'
import { AdminAuthPage } from './pages/admin/AdminAuthPage'
import { AdminConfigPage } from './pages/admin/AdminConfigPage'
import { AdminOpsPage } from './pages/admin/AdminOpsPage'
import { AdminOrgPage } from './pages/admin/AdminOrgPage'
import { AdminUsersPage } from './pages/admin/AdminUsersPage'
import { useAppData } from './store'
import type { Candidate, CurrentUser, PageKey } from './types'

const pageMeta: Record<PageKey, { title: string; subtitle: string }> = {
  dashboard: { title: '工作台', subtitle: '招聘进展一览' },
  positions: { title: '职位与招聘需求', subtitle: 'HC、招聘要求与需求级周期' },
  intake: { title: '简历入场', subtitle: '上传、手工、邮箱、Excel、待分配与监控' },
  pool: { title: '简历入场', subtitle: '待分配池与查重合并' },
  intakeMonitor: { title: '简历入场', subtitle: '入场监控与失败重试' },
  campus: { title: '简历入场', subtitle: '校招投递与人工分配' },
  candidates: { title: '候选人', subtitle: '列表、卡片与流程看板' },
  pipeline: { title: '候选人', subtitle: '流程看板视图' },
  interviews: { title: '面试安排', subtitle: '协调面试与反馈' },
  probation: { title: '入职与试用期', subtitle: '待入职日程与转正结论' },
  reports: { title: '招聘数据', subtitle: '用数据优化招聘决策' },
  adminOrg: { title: '组织架构', subtitle: '部门层级与钉钉组织同步' },
  adminUsers: { title: '成员管理', subtitle: '成员台账、新建账号与角色授予' },
  adminAuth: { title: '角色与权限', subtitle: '角色数据范围、权限组与敏感字段授权' },
  adminConfig: { title: '业务配置', subtitle: '字段、字典、面试方案、原因与通知规则' },
  adminOps: { title: '集成与运维', subtitle: '运行监控、邮箱配置、令牌与数据清理' },
  adminAudit: { title: '操作审计', subtitle: '按操作人、对象与时间检索记录' },
  admin: { title: '业务配置', subtitle: '字段、字典、面试方案、原因与通知规则' },
}

export default function App() {
  const { data, setData, resetData, candidatesLoading, candidatesError, apiJobs } = useAppData()
  const [page, setPage] = useState<PageKey>('dashboard')
  const [intakeTab, setIntakeTab] = useState<IntakeHubTab>('ingest')
  const [candidateView, setCandidateView] = useState<'list' | 'cards' | 'kanban'>('list')
  const [search, setSearch] = useState('')
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null)
  const [showAddCandidate, setShowAddCandidate] = useState(false)
  const [interviewCandidateId, setInterviewCandidateId] = useState<string | null>(null)
  const [showInterview, setShowInterview] = useState(false)
  const [interviewOpenKey, setInterviewOpenKey] = useState(0)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [me, setMe] = useState<CurrentUser | null>(null)

  useEffect(() => {
    let active = true
    void getCurrentUser()
      .then((user) => { if (active) setMe(user) })
      .catch(() => { if (active) setMe(null) })
    return () => { active = false }
  }, [])

  const addToast = useCallback((message: string, type?: Toast['type']) => {
    const id = Date.now() + Math.floor(Math.random() * 1000)
    setToasts((prev) => [...prev, { id, message, type }])
    window.setTimeout(() => setToasts((prev) => prev.filter((item) => item.id !== id)), 3000)
  }, [])

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((item) => item.id !== id))
  }, [])

  const navigate = useCallback((next: PageKey) => {
    setSearch('')
    if (next === 'pool') {
      setIntakeTab('pool')
      setPage('intake')
      return
    }
    if (next === 'intakeMonitor') {
      setIntakeTab('monitor')
      setPage('intake')
      return
    }
    if (next === 'campus') {
      setIntakeTab('campus')
      setPage('intake')
      return
    }
    if (next === 'intake') {
      setIntakeTab('ingest')
      setPage('intake')
      return
    }
    if (next === 'pipeline') {
      setCandidateView('kanban')
      setPage('candidates')
      return
    }
    if (next === 'candidates') {
      setCandidateView('list')
      setPage('candidates')
      return
    }
    if (next === 'admin') {
      setPage('adminConfig')
      return
    }
    setPage(next)
    if (next === 'interviews') setInterviewOpenKey(0)
  }, [])

  const openCandidate = useCallback((id: string | null) => setSelectedCandidateId(id), [])

  const scheduleCandidate = (candidate: Candidate) => {
    setSelectedCandidateId(null)
    setInterviewCandidateId(candidate.id)
    setShowInterview(true)
  }

  const firstAdminPage = useCallback((): PageKey => {
    const perms = new Set(me?.roles.flatMap((role) => role.permissions) ?? [])
    if (perms.has('setting:read')) return 'adminConfig'
    if (perms.has('authz:read')) return 'adminUsers'
    if (perms.has('organization:sync')) return 'adminOrg'
    if (perms.has('authz:field-grant:manage')) return 'adminAuth'
    if (perms.has('audit:read')) return 'adminAudit'
    return 'dashboard'
  }, [me])

  const meta = pageMeta[page]

  return (
    <AppProvider {...{ data, setData, resetData, candidatesLoading, candidatesError, apiJobs, selectedCandidateId, openCandidate, addToast, toasts, dismissToast }}>
      <div className="app-shell">
        <Sidebar page={page} onNavigate={navigate} me={me} />
        <div className="app-main">
          <TopBar
            title={meta.title}
            subtitle={meta.subtitle}
            search={search}
            onSearch={setSearch}
            onSearchSubmit={() => {
              setCandidateView('list')
              setPage('candidates')
            }}
            me={me}
            onOpenAdmin={() => navigate(firstAdminPage())}
          />
          <main className="content">
            {page === 'dashboard' && <Dashboard onNavigate={navigate} onOpenCandidate={openCandidate} />}
            {page === 'positions' && <Positions />}
            {page === 'intake' && <IntakeHub initialTab={intakeTab} />}
            {page === 'candidates' && (
              <Candidates
                search={search}
                initialView={candidateView}
                onOpenCandidate={openCandidate}
                onAddCandidate={() => setShowAddCandidate(true)}
                onBulkImport={() => navigate('intake')}
              />
            )}
            {page === 'interviews' && <Interviews onOpenCandidate={openCandidate} openNew={interviewOpenKey} />}
            {page === 'probation' && <Probation onOpenCandidate={openCandidate} refreshKey={selectedCandidateId} />}
            {page === 'reports' && <Reports />}
            {page === 'adminOrg' && <AdminOrgPage />}
            {page === 'adminUsers' && <AdminUsersPage />}
            {page === 'adminAuth' && <AdminAuthPage />}
            {page === 'adminConfig' && <AdminConfigPage />}
            {page === 'adminOps' && <AdminOpsPage />}
            {page === 'adminAudit' && <AdminAuditPage />}
          </main>
        </div>
        {selectedCandidateId && <CandidateDrawer candidateId={selectedCandidateId} onClose={() => setSelectedCandidateId(null)} onSchedule={scheduleCandidate} />}
        {showAddCandidate && <AddCandidateModal onClose={() => setShowAddCandidate(false)} />}
        {showInterview && <InterviewModal initialCandidate={interviewCandidateId || undefined} onClose={() => { setShowInterview(false); setInterviewCandidateId(null) }} />}
        <div className="toast-stack" aria-live="polite">
          {toasts.map((item) => (
            <div className="toast" key={item.id}>
              <span className={`toast-icon ${item.type || 'success'}`}>{item.type === 'info' ? <Info size={16} /> : <CheckCircle2 size={16} />}</span>
              <span>{item.message}</span>
              <button onClick={() => dismissToast(item.id)}><X size={14} /></button>
            </div>
          ))}
        </div>
      </div>
    </AppProvider>
  )
}

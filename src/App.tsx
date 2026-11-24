import { useCallback, useState } from 'react'
import type { PageKey, Candidate } from './types'
import { useAppData } from './store'
import { AppProvider } from './context'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { CandidateDrawer } from './components/CandidateDrawer'
import { AddCandidateModal } from './components/AddCandidateModal'
import { SettingsModal } from './components/SettingsModal'
import { Dashboard } from './pages/Dashboard'
import { Positions } from './pages/Positions'
import { Intake } from './pages/Intake'
import { IntakePool } from './pages/IntakePool'
import { IntakeMonitor } from './pages/IntakeMonitor'
import { Campus } from './pages/Campus'
import { Candidates } from './pages/Candidates'
import { Pipeline } from './pages/Pipeline'
import { Interviews, InterviewModal } from './pages/Interviews'
import { Probation } from './pages/Probation'
import { Team } from './pages/Team'
import { Reports } from './pages/Reports'
import { CheckCircle2, Info, X } from 'lucide-react'
import type { Toast } from './context'

const pageMeta: Record<Exclude<PageKey, 'settings'>, { title: string; subtitle: string }> = {
  dashboard: { title: '工作台', subtitle: '招聘进展一览' },
  positions: { title: '职位与招聘需求', subtitle: 'HC、招聘要求与需求级周期' },
  intake: { title: '简历入场', subtitle: '上传、手工、邮箱与 Excel 导入' },
  pool: { title: '待分配池', subtitle: '手工选职位与查重合并' },
  intakeMonitor: { title: '入场监控', subtitle: '进入、时延与失败归因' },
  campus: { title: '校招投递', subtitle: '个人意愿与人工分配' },
  candidates: { title: '简历库', subtitle: '人才档案与筛选' },
  pipeline: { title: '招聘流程', subtitle: '推进候选人阶段' },
  interviews: { title: '面试安排', subtitle: '协调面试与反馈' },
  probation: { title: '试用期管理', subtitle: '记录转正结果' },
  team: { title: '部门协同', subtitle: '业务与 HR 同频协作' },
  reports: { title: '招聘数据', subtitle: '用数据优化招聘决策' },
}

export default function App() {
  const { data, setData, resetData, candidatesLoading, candidatesError, apiJobs } = useAppData()
  const [page, setPage] = useState<PageKey>('dashboard')
  const [search, setSearch] = useState('')
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null)
  const [showAddCandidate, setShowAddCandidate] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [interviewCandidateId, setInterviewCandidateId] = useState<string | null>(null)
  const [showInterview, setShowInterview] = useState(false)
  const [interviewOpenKey, setInterviewOpenKey] = useState(0)
  const [toasts, setToasts] = useState<Toast[]>([])

  const addToast = useCallback((message: string, type?: Toast['type']) => {
    const id = Date.now() + Math.floor(Math.random() * 1000)
    setToasts(prev => [...prev, { id, message, type }])
    window.setTimeout(() => setToasts(prev => prev.filter(item => item.id !== id)), 3000)
  }, [])

  const dismissToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(item => item.id !== id))
  }, [])

  const navigate = (next: PageKey) => {
    setPage(next)
    setSearch('')
    if (next === 'interviews') setInterviewOpenKey(0)
  }

  const openCandidate = (id: string | null) => setSelectedCandidateId(id)

  const scheduleCandidate = (candidate: Candidate) => {
    setSelectedCandidateId(null)
    setInterviewCandidateId(candidate.id)
    setShowInterview(true)
  }

  const openInterviewFromPage = () => {
    setInterviewCandidateId(null)
    setInterviewOpenKey(prev => prev + 1)
  }

  const meta = page === 'settings' ? pageMeta.dashboard : pageMeta[page]

  return <AppProvider {...{ data, setData, resetData, candidatesLoading, candidatesError, apiJobs, selectedCandidateId, openCandidate, addToast, toasts, dismissToast }}>
    <div className="app-shell">
      <Sidebar page={page} onNavigate={navigate} onSettings={() => setShowSettings(true)} />
      <div className="app-main">
        <TopBar title={meta.title} subtitle={meta.subtitle} onSearch={setSearch} onOpenSettings={() => setShowSettings(true)} />
        <main className="content">
          {page === 'dashboard' && <Dashboard onNavigate={navigate} onOpenCandidate={openCandidate} />}
          {page === 'positions' && <Positions />}
          {page === 'intake' && <Intake />}
          {page === 'pool' && <IntakePool />}
          {page === 'intakeMonitor' && <IntakeMonitor />}
          {page === 'campus' && <Campus />}
          {page === 'candidates' && <Candidates search={search} onOpenCandidate={openCandidate} onAddCandidate={() => setShowAddCandidate(true)} onBulkImport={() => navigate('intake')} />}
          {page === 'pipeline' && <Pipeline onOpenCandidate={openCandidate} onAddCandidate={() => setShowAddCandidate(true)} />}
          {page === 'interviews' && <Interviews onOpenCandidate={openCandidate} openNew={interviewOpenKey} />}
          {page === 'probation' && <Probation onOpenCandidate={openCandidate} refreshKey={selectedCandidateId} />}
          {page === 'team' && <Team onOpenCandidate={openCandidate} />}
          {page === 'reports' && <Reports />}
        </main>
      </div>
      {selectedCandidateId && <CandidateDrawer candidateId={selectedCandidateId} onClose={() => setSelectedCandidateId(null)} onSchedule={scheduleCandidate} />}
      {showAddCandidate && <AddCandidateModal onClose={() => setShowAddCandidate(false)} />}
      {showInterview && <InterviewModal initialCandidate={interviewCandidateId || undefined} onClose={() => { setShowInterview(false); setInterviewCandidateId(null) }} />}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} onReset={resetData} />}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((item) => <div className="toast" key={item.id}><span className={`toast-icon ${item.type || 'success'}`}>{item.type === 'info' ? <Info size={16} /> : <CheckCircle2 size={16} />}</span><span>{item.message}</span><button onClick={() => dismissToast(item.id)}><X size={14} /></button></div>)}
      </div>
    </div>
  </AppProvider>
}

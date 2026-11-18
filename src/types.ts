export type PageKey =
  | 'dashboard'
  | 'positions'
  | 'intake'
  | 'pool'
  | 'intakeMonitor'
  | 'campus'
  | 'candidates'
  | 'pipeline'
  | 'interviews'
  | 'probation'
  | 'team'
  | 'reports'
  | 'settings'

export type CandidateMainStage =
  | 'RECOMMENDED'
  | 'HR_SCREENING'
  | 'DEPT_SCREENING'
  | 'INTERVIEWING'
  | 'OFFERING'
  | 'PENDING_ONBOARD'
  | 'ONBOARDED'
  | 'PROBATION'
  | 'ENDED'
export type CandidatePoolStage = 'UNASSIGNED' | 'VIRTUAL_POOL'
export type CandidateStage = CandidateMainStage | CandidatePoolStage | 'ARCHIVED'
export type LegacyCandidateStage = 'new' | 'screening' | 'interview' | 'offer' | 'hired' | 'rejected'
export type CandidateStageFilter = 'UNASSIGNED' | CandidateMainStage | 'ARCHIVED'

export type Department = {
  id: string
  name: string
  short: string
  color: string
  lead: string
  openRoles: number
}

export type Job = {
  id: string
  title: string
  departmentId: string
  location: string
  owner: string
  headcount: number
  hired: number
  status: 'active' | 'paused' | 'closed'
  priority: 'high' | 'normal'
  createdAt: string
}

export type Candidate = {
  id: string
  name: string
  phone: string
  email: string
  jobId: string
  jobTitle?: string
  jobLocation?: string
  departmentId: string
  departmentName?: string
  departmentColor?: string
  stage: CandidateStage | LegacyCandidateStage
  poolType?: 'NONE' | 'UNASSIGNED' | 'VIRTUAL'
  lockedState?: 'NONE' | 'OPERABLE' | 'INOPERABLE'
  source: string
  channel?: string
  archiveReasonText?: string
  experience: string
  education: string
  school: string
  currentCompany: string
  currentTitle: string
  tags: string[]
  rating: number
  appliedAt: string
  lastActivity: string
  owner: string
  avatarColor: string
  summary: string
  resumeName: string
  workHistory: { company: string; title: string; period: string }[]
  note?: string
  updatedAt?: string
  timeline?: CandidateTimelineEvent[]
}

export type CandidateTimelineEvent = {
  id: string
  action: string
  payload?: Record<string, unknown> | null
  actor: string
  createdAt: string
}

export type CandidatePage = {
  items: Candidate[]
  page: number
  pageSize: number
  total: number
  counts: Record<CandidateStageFilter | 'VIRTUAL_POOL', number>
}

export type CandidateFilter = {
  stage?: CandidateStageFilter
  keyword?: string
  departmentId?: string
  jobId?: string
  company?: string
  channel?: string
  source?: string
  tag?: string
  lockedState?: 'NONE' | 'OPERABLE' | 'INOPERABLE'
  updatedBefore?: string
}

export type SavedCandidateFilter = {
  id: string
  name: string
  filters: CandidateFilter
  createdAt: string
  updatedAt: string
}

export type ApiJob = {
  id: string
  title: string
  departmentId: string
  location: string | null
  headcount: number
  hiredCount: number
}

export type JobListItem = ApiJob & {
  code: string
  status: 'ACTIVE' | 'CLOSED'
  recruiterId: string | null
  requirements: string | null
  channel: string | null
  isVirtual: boolean
  requisitionId: string | null
  headcountFull: boolean
  headcountHint: string | null
  createdAt: string
  updatedAt: string
}

export type ApiRequisition = {
  id: string
  oaApprovalId: string
  oaApprovalTitle: string | null
  title: string
  departmentId: string
  recruiterId: string | null
  jobLevel: string | null
  headcount: number
  source: string
  status: 'ACTIVE' | 'CLOSED'
  submittedAt: string | null
  recruitmentStartDate: string | null
  closedAt: string | null
  cycleDays: number | null
  cycleEligible: boolean
  inProgressDays: number | null
  inProgressLabel: string | null
  note: string | null
  requirements: string | null
  version: number
  createdAt: string
  updatedAt: string
}

export type RequisitionList = {
  items: ApiRequisition[]
  page: number
  pageSize: number
  total: number
}

// ---------- 简历入场（FR-ENT） ----------

export type IntakeStatus =
  | 'RECEIVED'
  | 'PARSING'
  | 'PARSED'
  | 'DUPLICATE'
  | 'NEEDS_MANUAL'
  | 'FAILED'

export type ApiIntakeCandidate = {
  id: string
  name: string
  stage: string
  poolType: string
  jobId: string | null
  appliedAt: string | null
}

export type ApiIntakeJob = {
  id: string
  code: string
  title: string
  isVirtual: boolean
  recruiterId: string | null
}

export type ApiIntakeFile = {
  id: string
  fileName: string
  mimeType: string
  size: number
}

export type ApiIntakeAirRun = {
  id: string
  status: string
  isDraft: boolean
  attempts?: number
  errorCode?: string | null
}

export type ApiIntake = {
  id: string
  source: string
  entryMode: string
  status: IntakeStatus
  candidateId: string | null
  jobId: string | null
  resumeFileId: string | null
  airRunId: string | null
  duplicateOfCandidateId: string | null
  mailFrom: string | null
  mailSubject: string | null
  mailboxAddress: string | null
  referrerName: string | null
  referrerContact: string | null
  referralCode: string | null
  sourceNote: string | null
  receivedAt: string | null
  attempts: number
  errorCode: string | null
  errorMessage: string | null
  mergedAt: string | null
  mergedById: string | null
  createdAt: string
  updatedAt: string
  resumeFile: ApiIntakeFile | null
  candidate: ApiIntakeCandidate | null
  duplicateCandidate: ApiIntakeCandidate | null
  job: ApiIntakeJob | null
  aiRun: ApiIntakeAirRun | null
}

export type IntakeList = {
  items: ApiIntake[]
  page: number
  pageSize: number
  total: number
}

export type IntakePoolItem = {
  candidateId: string
  name: string
  phone: string | null
  email: string | null
  source: string | null
  entryMode: string | null
  appliedAt: string | null
  createdAt: string
  intakeId: string | null
  intakeStatus: IntakeStatus | null
  mailFrom: string | null
  mailSubject: string | null
  mailboxAddress: string | null
  receivedAt: string | null
  resumeFileId: string | null
  resumeFileName: string | null
  aiRun: ApiIntakeAirRun | null
}

export type IntakePoolList = {
  items: IntakePoolItem[]
  page: number
  pageSize: number
  total: number
}

export type IntakeMonitor = {
  totals: {
    total: number
    entered: number
    notEntered: number
    enteredRate: number
    assigned: number
    pool: number
    latencySamples: number
    averageLatencySeconds: number | null
    p90LatencySeconds: number | null
    maxLatencySeconds: number | null
  }
  byStatus: { status: string; count: number }[]
  bySource: { source: string; count: number }[]
  byEntryMode: { entryMode: string; count: number }[]
  byMailbox: { mailbox: string; count: number; lastReceivedAt: string | null }[]
  failureReasons: { errorCode: string; count: number }[]
  recentFailures: {
    id: string
    source: string
    entryMode: string
    status: IntakeStatus
    errorCode: string | null
    errorMessage: string | null
    mailFrom: string | null
    createdAt: string
    jobId: string | null
  }[]
}

export type IntakeResult = {
  intakeId: string
  candidateId: string | null
  airRunId: string | null
  status: IntakeStatus
  duplicate: boolean
  parseQueued: boolean
  errorCode?: string | null
  errorMessage?: string | null
}

export type ExcelImportRowResult = {
  rowNumber: number
  status: 'SUCCESS' | 'DUPLICATE' | 'FAILED'
  name: string | null
  phone: string | null
  email: string | null
  jobCode: string | null
  source: string | null
  candidateId: string | null
  intakeId: string | null
  errorCode: string | null
  errorMessage: string | null
}

export type ExcelImportResult = {
  batchId: string
  fileName: string
  totalRows: number
  successRows: number
  duplicateRows: number
  failedRows: number
  rows: ExcelImportRowResult[]
}

export type MailboxConfig = {
  id: string
  address: string
  provider: string
  active: boolean
  lastPolledAt: string | null
}

export type ApiDepartment = {
  id: string
  code: string
  name: string
  parentId: string | null
}

export type ApiUser = {
  id: string
  displayName: string
  employeeNo?: string | null
  email?: string | null
  status?: string
}

export type InterviewStatus = 'scheduled' | 'completed' | 'pending_feedback' | 'cancelled'

export type Interview = {
  id: string
  candidateId: string
  jobId: string
  round: string
  type: string
  date: string
  start: string
  end: string
  interviewers: string[]
  location: string
  mode: 'video' | 'onsite' | 'phone'
  status: InterviewStatus
  feedback?: string
}

export type ProbationStatus = 'pending' | 'probation' | 'converting' | 'converted'

export type ProbationEmployee = {
  id: string
  name: string
  job: string
  departmentId: string
  manager: string
  startDate: string
  endDate: string
  status: ProbationStatus
  avatarColor: string
  score: number
  reviewDate: string
  goalProgress: number
  checkins: number
  lastFeedback: string
}

export type Approval = {
  id: string
  type: 'offer' | 'conversion' | 'headcount' | 'transfer'
  title: string
  requester: string
  departmentId: string
  amount?: string
  submittedAt: string
  status: 'pending' | 'approved' | 'transferred'
}

export type Activity = {
  id: string
  actor: string
  action: string
  target: string
  time: string
  color: string
  icon: 'user' | 'calendar' | 'check' | 'message'
}

export type AppData = {
  candidates: Candidate[]
  interviews: Interview[]
  probation: ProbationEmployee[]
  approvals: Approval[]
  activities: Activity[]
}

// ---------- 简历来源与校招投递（ATS-009） ----------

export type ApiSourceCandidate = {
  id: string
  name: string
  phone: string | null
  email: string | null
  stage: string
  jobId: string | null
}

export type ApiSourceJob = {
  id: string
  code: string
  title: string
  isVirtual: boolean
}

export type ApiSourceRecord = {
  id: string
  candidateId: string
  intakeId: string | null
  source: string
  entryMode: string | null
  jobId: string | null
  referrerName: string | null
  referrerContact: string | null
  referralCode: string | null
  note: string | null
  mergedFromCandidateId: string | null
  createdById: string | null
  createdAt: string
  candidate: ApiSourceCandidate | null
  job: ApiSourceJob | null
}

export type SourceRecordList = {
  items: ApiSourceRecord[]
  page: number
  pageSize: number
  total: number
}

export type CampusJob = {
  id: string
  code: string
  title: string
  location: string | null
  isVirtual: boolean
  headcount: number
}

export type CampusPreferences = {
  desiredPositions?: string[]
  expectedCity?: string | null
  school?: string | null
  major?: string | null
  graduationYear?: string | null
  availableFrom?: string | null
  remark?: string | null
}

export type ApiCampusApplication = {
  id: string
  intakeId: string
  candidateId: string | null
  jobId: string | null
  jobIsVirtual: boolean
  preferences: CampusPreferences
  school: string | null
  major: string | null
  graduationYear: string | null
  expectedCity: string | null
  availableFrom: string | null
  remark: string | null
  status: 'SUBMITTED' | 'ASSIGNED' | string
  assignedJobId: string | null
  assignedAt: string | null
  assignedById: string | null
  createdAt: string
  updatedAt: string
  candidate: ApiSourceCandidate | null
  job: ApiSourceJob | null
  assignedJob: ApiSourceJob | null
}

export type CampusApplicationList = {
  items: ApiCampusApplication[]
  page: number
  pageSize: number
  total: number
}

export type CampusApplyResult = {
  applicationId: string
  intakeId: string
  candidateId: string | null
  status: string
  duplicate: boolean
  jobIsVirtual: boolean
  message: string
}

export type CampusAssignResult = {
  job: { id: string; code: string; title: string; isVirtual: boolean } | null
  assigned: number
  failed: number
  results: { applicationId: string; ok: boolean; candidateId?: string | null; error?: string }[]
}

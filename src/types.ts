export type PageKey =
  | 'dashboard'
  | 'positions'
  | 'candidates'
  | 'pipeline'
  | 'interviews'
  | 'probation'
  | 'team'
  | 'reports'
  | 'settings'

export type CandidateStage = 'new' | 'screening' | 'interview' | 'offer' | 'hired' | 'rejected'

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
  stage: CandidateStage
  source: string
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

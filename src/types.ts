export type PageKey =
  | 'dashboard'
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
  departmentId: string
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

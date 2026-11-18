export const cn = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(' ')

export const stageMeta = {
  UNASSIGNED: { label: '待分配', short: '待', tone: 'gray' },
  VIRTUAL_POOL: { label: '虚拟职位池', short: '虚拟', tone: 'gray' },
  RECOMMENDED: { label: '人才推荐', short: '推荐', tone: 'blue' },
  HR_SCREENING: { label: '初筛', short: '初筛', tone: 'amber' },
  DEPT_SCREENING: { label: '用人部门筛选', short: '部门', tone: 'amber' },
  INTERVIEWING: { label: '面试', short: '面试', tone: 'violet' },
  OFFERING: { label: '沟通 Offer', short: 'Offer', tone: 'orange' },
  PENDING_ONBOARD: { label: '待入职', short: '待入', tone: 'orange' },
  ONBOARDED: { label: '已入职', short: '入职', tone: 'green' },
  PROBATION: { label: '试用期', short: '试用', tone: 'green' },
  ENDED: { label: '结束', short: '结束', tone: 'gray' },
  ARCHIVED: { label: '已归档', short: '归档', tone: 'gray' },
  // 旧 UI 兼容；真实候选人接口返回上方的持久化阶段枚举。
  new: { label: '新简历', short: '新', tone: 'blue' },
  screening: { label: '筛选中', short: '筛', tone: 'amber' },
  interview: { label: '面试中', short: '面', tone: 'violet' },
  offer: { label: 'Offer', short: 'Offer', tone: 'orange' },
  hired: { label: '已入职', short: '入职', tone: 'green' },
  rejected: { label: '已淘汰', short: '淘汰', tone: 'gray' },
} as const

export const interviewModeLabel = {
  video: '视频面试',
  onsite: '现场面试',
  phone: '电话面试',
} as const

export const interviewStatusMeta = {
  scheduled: { label: '待进行', tone: 'blue' },
  completed: { label: '已完成', tone: 'green' },
  pending_feedback: { label: '待反馈', tone: 'amber' },
  cancelled: { label: '已取消', tone: 'gray' },
} as const

export const probationStatusMeta = {
  pending: { label: '待入职', tone: 'blue' },
  probation: { label: '试用期中', tone: 'violet' },
  converting: { label: '待转正', tone: 'amber' },
  converted: { label: '已转正', tone: 'green' },
} as const

export const initials = (name: string) => name.slice(-2)

export const salaryNumber = (value?: string) => value?.match(/[\d.]+/)?.[0] || ''

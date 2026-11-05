export const cn = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(' ')

export const stageMeta = {
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

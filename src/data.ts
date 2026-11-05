import type { AppData, Candidate, Department, Interview, Job, ProbationEmployee } from './types'

const pad = (n: number) => String(n).padStart(2, '0')
const dateOffset = (days: number) => {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export const today = dateOffset(0)
export const dateLabel = (value: string) => {
  const date = new Date(`${value}T00:00:00`)
  return `${date.getMonth() + 1}月${date.getDate()}日`
}
export const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
export const weekdayLabel = (value: string) => weekdays[new Date(`${value}T00:00:00`).getDay()]

export const departments: Department[] = [
  { id: 'dept-rd', name: '研发中心', short: '研', color: '#5865F2', lead: '陈屿', openRoles: 8 },
  { id: 'dept-product', name: '产品设计', short: '产', color: '#FF8A65', lead: '周宁', openRoles: 3 },
  { id: 'dept-growth', name: '市场增长', short: '市', color: '#18A77A', lead: '苏嘉', openRoles: 4 },
  { id: 'dept-hr', name: '人力资源', short: '人', color: '#D58A28', lead: '邓文文', openRoles: 2 },
  { id: 'dept-finance', name: '财务与法务', short: '财', color: '#8B6FD6', lead: '林夏', openRoles: 1 },
]

export const jobs: Job[] = [
  { id: 'job-fe', title: '高级前端工程师', departmentId: 'dept-rd', location: '上海 · 混合办公', owner: '林夏', headcount: 4, hired: 2, status: 'active', priority: 'high', createdAt: dateOffset(-46) },
  { id: 'job-be', title: '后端开发工程师', departmentId: 'dept-rd', location: '上海', owner: '陈屿', headcount: 6, hired: 3, status: 'active', priority: 'high', createdAt: dateOffset(-39) },
  { id: 'job-pd', title: '资深产品经理', departmentId: 'dept-product', location: '北京', owner: '周宁', headcount: 2, hired: 0, status: 'active', priority: 'high', createdAt: dateOffset(-24) },
  { id: 'job-ux', title: '用户体验设计师', departmentId: 'dept-product', location: '上海', owner: '周宁', headcount: 2, hired: 1, status: 'active', priority: 'normal', createdAt: dateOffset(-18) },
  { id: 'job-ops', title: '用户增长运营', departmentId: 'dept-growth', location: '杭州', owner: '苏嘉', headcount: 3, hired: 1, status: 'active', priority: 'normal', createdAt: dateOffset(-14) },
  { id: 'job-brand', title: '品牌内容经理', departmentId: 'dept-growth', location: '上海', owner: '苏嘉', headcount: 1, hired: 0, status: 'active', priority: 'normal', createdAt: dateOffset(-9) },
  { id: 'job-hrbp', title: 'HRBP', departmentId: 'dept-hr', location: '上海', owner: '邓文文', headcount: 2, hired: 1, status: 'active', priority: 'normal', createdAt: dateOffset(-30) },
]

const names = { r: 'rgba(88,101,242,.13)', g: 'rgba(24,167,122,.13)', o: 'rgba(255,138,101,.14)', y: 'rgba(213,138,40,.14)' }

export const seedCandidates: Candidate[] = [
  {
    id: 'c-001', name: '顾若安', phone: '138 **** 7291', email: 'ruoan.gu@example.com', jobId: 'job-fe', departmentId: 'dept-rd', stage: 'interview', source: 'BOSS直聘', experience: '6年', education: '硕士', school: '同济大学', currentCompany: '哔哩哔哩', currentTitle: '高级前端工程师', tags: ['React', '中后台', '性能优化'], rating: 5, appliedAt: dateOffset(-8), lastActivity: '10分钟前', owner: '林夏', avatarColor: '#6675E8', summary: '6 年前端研发经验，长期负责复杂中后台与数据可视化产品，技术基础扎实，沟通表达清晰。', resumeName: '顾若安_高级前端工程师.pdf', workHistory: [{ company: '哔哩哔哩', title: '高级前端工程师', period: '2021.06 - 至今' }, { company: '字节跳动', title: '前端工程师', period: '2019.04 - 2021.05' }],
  },
  {
    id: 'c-002', name: '何知远', phone: '186 **** 3140', email: 'zhiyuan.he@example.com', jobId: 'job-pd', departmentId: 'dept-product', stage: 'offer', source: '内部推荐', experience: '8年', education: '本科', school: '浙江大学', currentCompany: '小红书', currentTitle: '产品负责人', tags: ['商业化', '增长', '团队管理'], rating: 5, appliedAt: dateOffset(-13), lastActivity: '1小时前', owner: '周宁', avatarColor: '#E27D62', summary: '拥有 8 年互联网产品经验，主导过从 0 到 1 的商业化产品，有成熟的跨团队协作与团队管理经验。', resumeName: '何知远_资深产品经理.pdf', workHistory: [{ company: '小红书', title: '产品负责人', period: '2020.08 - 至今' }, { company: '美团', title: '高级产品经理', period: '2017.03 - 2020.07' }],
  },
  {
    id: 'c-003', name: '苏晚晴', phone: '137 **** 5082', email: 'wanqing.su@example.com', jobId: 'job-be', departmentId: 'dept-rd', stage: 'screening', source: '猎聘', experience: '5年', education: '硕士', school: '上海交通大学', currentCompany: '携程集团', currentTitle: '后端工程师', tags: ['Go', '微服务', '高并发'], rating: 4, appliedAt: dateOffset(-5), lastActivity: '2小时前', owner: '陈屿', avatarColor: '#19A77C', summary: '5 年 Go 服务端研发经验，负责过核心交易链路，对高并发与分布式系统有深入实践。', resumeName: '苏晚晴_后端开发工程师.pdf', workHistory: [{ company: '携程集团', title: '后端工程师', period: '2021.02 - 至今' }, { company: '拼多多', title: '研发工程师', period: '2019.07 - 2021.01' }],
  },
  {
    id: 'c-004', name: '林见鹿', phone: '159 **** 6638', email: 'jianlu.lin@example.com', jobId: 'job-ux', departmentId: 'dept-product', stage: 'new', source: '官网投递', experience: '4年', education: '本科', school: '中国美术学院', currentCompany: '网易', currentTitle: '交互设计师', tags: ['B端', '设计系统', '用户研究'], rating: 4, appliedAt: dateOffset(-1), lastActivity: '3小时前', owner: '周宁', avatarColor: '#BF7BD5', summary: '专注 B 端产品体验与设计系统建设，具备从用户研究到方案落地的完整能力。', resumeName: '林见鹿_用户体验设计师.pdf', workHistory: [{ company: '网易', title: '交互设计师', period: '2022.03 - 至今' }, { company: '有赞', title: 'UI/UX 设计师', period: '2020.08 - 2022.02' }],
  },
  {
    id: 'c-005', name: '陈墨', phone: '136 **** 9245', email: 'mo.chen@example.com', jobId: 'job-ops', departmentId: 'dept-growth', stage: 'interview', source: '脉脉', experience: '5年', education: '本科', school: '武汉大学', currentCompany: '得物', currentTitle: '用户增长经理', tags: ['用户增长', '活动运营', '数据分析'], rating: 4, appliedAt: dateOffset(-6), lastActivity: '昨天', owner: '苏嘉', avatarColor: '#EEA23E', summary: '负责过千万级用户增长项目，擅长以数据驱动活动策略和转化链路优化。', resumeName: '陈墨_用户增长运营.pdf', workHistory: [{ company: '得物', title: '用户增长经理', period: '2021.09 - 至今' }, { company: '叮咚买菜', title: '运营策略', period: '2019.06 - 2021.08' }],
  },
  {
    id: 'c-006', name: '许棠', phone: '135 **** 1874', email: 'tang.xu@example.com', jobId: 'job-hrbp', departmentId: 'dept-hr', stage: 'hired', source: '内部推荐', experience: '7年', education: '硕士', school: '华东师范大学', currentCompany: '字节跳动', currentTitle: 'HRBP', tags: ['组织发展', '人才盘点', '员工关系'], rating: 5, appliedAt: dateOffset(-22), lastActivity: '昨天', owner: '邓文文', avatarColor: '#E26D82', summary: '7 年互联网 HRBP 经验，支持过 500 人以上研发团队，在组织诊断和人才发展方面经验丰富。', resumeName: '许棠_HRBP.pdf', workHistory: [{ company: '字节跳动', title: 'HRBP', period: '2020.05 - 至今' }, { company: '哔哩哔哩', title: '招聘与组织发展', period: '2017.08 - 2020.04' }],
  },
  {
    id: 'c-007', name: '江屿', phone: '152 **** 3412', email: 'yu.jiang@example.com', jobId: 'job-fe', departmentId: 'dept-rd', stage: 'offer', source: '猎聘', experience: '7年', education: '本科', school: '南京大学', currentCompany: '蚂蚁集团', currentTitle: '前端技术专家', tags: ['TypeScript', '架构', '跨端'], rating: 5, appliedAt: dateOffset(-17), lastActivity: '2天前', owner: '林夏', avatarColor: '#4D9BE8', summary: '7 年前端研发经验，具有大型前端架构与跨端产品落地经验，技术视野开阔。', resumeName: '江屿_高级前端工程师.pdf', workHistory: [{ company: '蚂蚁集团', title: '前端技术专家', period: '2020.02 - 至今' }, { company: '阿里云', title: '前端工程师', period: '2017.06 - 2020.01' }],
  },
  {
    id: 'c-008', name: '白露', phone: '188 **** 7750', email: 'lu.bai@example.com', jobId: 'job-brand', departmentId: 'dept-growth', stage: 'screening', source: '官网投递', experience: '4年', education: '硕士', school: '复旦大学', currentCompany: '蔚来汽车', currentTitle: '内容营销主管', tags: ['品牌内容', '新媒体', '项目管理'], rating: 4, appliedAt: dateOffset(-3), lastActivity: '3天前', owner: '苏嘉', avatarColor: '#28AD9B', summary: '拥有品牌内容与整合营销经验，擅长从策略到内容生产的一体化管理。', resumeName: '白露_品牌内容经理.pdf', workHistory: [{ company: '蔚来汽车', title: '内容营销主管', period: '2022.01 - 至今' }, { company: '小红书', title: '品牌策划', period: '2020.06 - 2021.12' }],
  },
  {
    id: 'c-009', name: '沈听澜', phone: '177 **** 6158', email: 'tinglan.shen@example.com', jobId: 'job-be', departmentId: 'dept-rd', stage: 'new', source: '校园招聘', experience: '2年', education: '硕士', school: '华中科技大学', currentCompany: '腾讯云', currentTitle: '后端开发工程师', tags: ['Java', '云原生', 'Spring'], rating: 3, appliedAt: dateOffset(-2), lastActivity: '3天前', owner: '陈屿', avatarColor: '#6E84D9', summary: '2 年云服务研发经验，Java 基础扎实，具备云原生应用开发实践。', resumeName: '沈听澜_后端开发工程师.pdf', workHistory: [{ company: '腾讯云', title: '后端开发工程师', period: '2023.07 - 至今' }],
  },
  {
    id: 'c-010', name: '宋照野', phone: '180 **** 2291', email: 'zhaoye.song@example.com', jobId: 'job-fe', departmentId: 'dept-rd', stage: 'rejected', source: 'BOSS直聘', experience: '4年', education: '本科', school: '北京邮电大学', currentCompany: '快手', currentTitle: '前端工程师', tags: ['Vue', '小程序'], rating: 3, appliedAt: dateOffset(-11), lastActivity: '5天前', owner: '林夏', avatarColor: '#D47A8A', summary: '4 年前端开发经验，技术基础良好，但与当前岗位的复杂中后台经验匹配度有限。', resumeName: '宋照野_前端工程师.pdf', workHistory: [{ company: '快手', title: '前端工程师', period: '2022.04 - 至今' }],
  },
  {
    id: 'c-011', name: '温以宁', phone: '139 **** 8026', email: 'yining.wen@example.com', jobId: 'job-ux', departmentId: 'dept-product', stage: 'interview', source: '内部推荐', experience: '5年', education: '本科', school: '江南大学', currentCompany: '钉钉', currentTitle: '体验设计师', tags: ['协同办公', '设计系统', '动效'], rating: 5, appliedAt: dateOffset(-9), lastActivity: '今天', owner: '周宁', avatarColor: '#B66ED1', summary: '5 年 B 端体验设计经验，参与过大型协同办公产品设计体系建设。', resumeName: '温以宁_用户体验设计师.pdf', workHistory: [{ company: '钉钉', title: '体验设计师', period: '2021.04 - 至今' }, { company: '字节跳动', title: '交互设计师', period: '2019.07 - 2021.03' }],
  },
  {
    id: 'c-012', name: '谢怀川', phone: '131 **** 4489', email: 'huaichuan.xie@example.com', jobId: 'job-be', departmentId: 'dept-rd', stage: 'screening', source: '猎聘', experience: '6年', education: '硕士', school: '电子科技大学', currentCompany: 'OPPO', currentTitle: '高级后端工程师', tags: ['Java', '分布式', '中间件'], rating: 4, appliedAt: dateOffset(-4), lastActivity: '4小时前', owner: '陈屿', avatarColor: '#3D99C9', summary: '6 年后端研发经验，专注分布式架构与中间件建设，工程能力扎实。', resumeName: '谢怀川_后端开发工程师.pdf', workHistory: [{ company: 'OPPO', title: '高级后端工程师', period: '2020.10 - 至今' }, { company: '中兴通讯', title: '软件工程师', period: '2018.07 - 2020.09' }],
  },
]

export const seedInterviews: Interview[] = [
  { id: 'i-001', candidateId: 'c-001', jobId: 'job-fe', round: '二面 · 技术复试', type: '专业面试', date: today, start: '10:00', end: '11:00', interviewers: ['陈屿', '林夏'], location: '飞书会议 · 768 204 119', mode: 'video', status: 'scheduled' },
  { id: 'i-002', candidateId: 'c-005', jobId: 'job-ops', round: '一面 · 业务面试', type: '业务面试', date: today, start: '14:00', end: '14:45', interviewers: ['苏嘉'], location: '3F · 海棠会议室', mode: 'onsite', status: 'scheduled' },
  { id: 'i-003', candidateId: 'c-011', jobId: 'job-ux', round: '终面 · 设计负责人', type: '综合面试', date: today, start: '16:00', end: '17:00', interviewers: ['周宁', '温若'], location: '飞书会议 · 210 883 456', mode: 'video', status: 'scheduled' },
  { id: 'i-004', candidateId: 'c-003', jobId: 'job-be', round: '一面 · 技术面试', type: '专业面试', date: dateOffset(1), start: '11:00', end: '12:00', interviewers: ['陈屿'], location: '飞书会议 · 391 002 781', mode: 'video', status: 'scheduled' },
  { id: 'i-005', candidateId: 'c-012', jobId: 'job-be', round: '一面 · 技术面试', type: '专业面试', date: dateOffset(1), start: '15:30', end: '16:30', interviewers: ['陈屿', '唐越'], location: '4F · 松柏会议室', mode: 'onsite', status: 'scheduled' },
  { id: 'i-006', candidateId: 'c-007', jobId: 'job-fe', round: '终面 · 技术负责人', type: '综合面试', date: dateOffset(-1), start: '10:00', end: '11:00', interviewers: ['陈屿'], location: '飞书会议 · 809 121 344', mode: 'video', status: 'pending_feedback' },
  { id: 'i-007', candidateId: 'c-008', jobId: 'job-brand', round: '一面 · 业务面试', type: '业务面试', date: dateOffset(2), start: '14:00', end: '15:00', interviewers: ['苏嘉'], location: '飞书会议 · 502 731 662', mode: 'video', status: 'scheduled' },
  { id: 'i-008', candidateId: 'c-006', jobId: 'job-hrbp', round: '终面 · HR 负责人', type: '综合面试', date: dateOffset(-7), start: '10:30', end: '11:15', interviewers: ['邓文文'], location: '5F · 汀兰会议室', mode: 'onsite', status: 'completed', feedback: '沟通沉稳，组织诊断经验与业务需要匹配，建议录用。' },
]

export const seedProbation: ProbationEmployee[] = [
  { id: 'p-001', name: '周也', job: '产品经理', departmentId: 'dept-product', manager: '周宁', startDate: dateOffset(-72), endDate: dateOffset(18), status: 'probation', avatarColor: '#E57B5F', score: 4.5, reviewDate: dateOffset(7), goalProgress: 78, checkins: 5, lastFeedback: '需求分析与跨团队推进表现稳定，下一阶段重点关注数据指标意识。' },
  { id: 'p-002', name: '唐越', job: '后端开发工程师', departmentId: 'dept-rd', manager: '陈屿', startDate: dateOffset(-56), endDate: dateOffset(34), status: 'probation', avatarColor: '#4C91D9', score: 4.2, reviewDate: dateOffset(14), goalProgress: 65, checkins: 4, lastFeedback: '工程交付质量良好，已独立负责订单服务模块。' },
  { id: 'p-003', name: '夏禾', job: '用户增长运营', departmentId: 'dept-growth', manager: '苏嘉', startDate: dateOffset(-84), endDate: dateOffset(6), status: 'converting', avatarColor: '#2AAA85', score: 4.7, reviewDate: dateOffset(1), goalProgress: 94, checkins: 6, lastFeedback: '试用期目标全部达成，活动转化效果超出预期，建议按期转正。' },
  { id: 'p-004', name: '叶青', job: '交互设计师', departmentId: 'dept-product', manager: '周宁', startDate: dateOffset(-88), endDate: dateOffset(2), status: 'converting', avatarColor: '#B878C9', score: 4.3, reviewDate: dateOffset(0), goalProgress: 90, checkins: 6, lastFeedback: '设计产出质量稳定，主动补位意愿强。' },
  { id: 'p-005', name: '许棠', job: 'HRBP', departmentId: 'dept-hr', manager: '邓文文', startDate: dateOffset(7), endDate: dateOffset(97), status: 'pending', avatarColor: '#E26D82', score: 0, reviewDate: dateOffset(7), goalProgress: 0, checkins: 0, lastFeedback: 'Offer 已接受，预计下周一入职。' },
  { id: 'p-006', name: '梁澄', job: '前端工程师', departmentId: 'dept-rd', manager: '林夏', startDate: dateOffset(-104), endDate: dateOffset(-14), status: 'converted', avatarColor: '#6377E7', score: 4.6, reviewDate: dateOffset(-14), goalProgress: 100, checkins: 6, lastFeedback: '转正通过，已纳入核心业务前端小组。' },
  { id: 'p-007', name: '姜惟', job: '品牌内容经理', departmentId: 'dept-growth', manager: '苏嘉', startDate: dateOffset(-42), endDate: dateOffset(48), status: 'probation', avatarColor: '#E6A33C', score: 3.9, reviewDate: dateOffset(21), goalProgress: 48, checkins: 3, lastFeedback: '内容策划能力符合要求，需进一步提升项目节奏把控。' },
]

export const seedApprovals = [
  { id: 'a-001', type: 'offer' as const, title: '高级前端工程师 · Offer 审批', requester: '林夏', departmentId: 'dept-rd', amount: '¥35K × 16薪', submittedAt: '今天 09:24', status: 'pending' as const },
  { id: 'a-002', type: 'conversion' as const, title: '叶青 · 试用期转正审批', requester: '周宁', departmentId: 'dept-product', submittedAt: '昨天 18:06', status: 'pending' as const },
  { id: 'a-003', type: 'headcount' as const, title: '市场增长 · 新增 2 个 HC', requester: '苏嘉', departmentId: 'dept-growth', amount: '新增编制', submittedAt: '11月3日 14:32', status: 'pending' as const },
  { id: 'a-004', type: 'transfer' as const, title: '林见鹿 · 候选岗位调整', requester: '周宁', departmentId: 'dept-product', submittedAt: '11月2日 11:10', status: 'approved' as const },
]

export const seedActivities = [
  { id: 'ac-001', actor: '林夏', action: '将候选人推进至', target: '二面', time: '10分钟前', color: '#6675E8', icon: 'user' as const },
  { id: 'ac-002', actor: '苏嘉', action: '完成了面试反馈', target: '陈墨 · 业务一面', time: '45分钟前', color: '#19A77C', icon: 'check' as const },
  { id: 'ac-003', actor: '周宁', action: '提交了 Offer 审批', target: '何知远', time: '1小时前', color: '#E27D62', icon: 'message' as const },
  { id: 'ac-004', actor: '邓文文', action: '安排了终面', target: '温以宁 · 今天 16:00', time: '2小时前', color: '#D58A28', icon: 'calendar' as const },
]

export const initialData: AppData = {
  candidates: seedCandidates,
  interviews: seedInterviews,
  probation: seedProbation,
  approvals: seedApprovals,
  activities: seedActivities,
}

export const getJob = (id: string) => jobs.find((job) => job.id === id)
export const getDepartment = (id: string) => departments.find((department) => department.id === id)
export const getCandidate = (data: AppData, id: string) => data.candidates.find((candidate) => candidate.id === id)

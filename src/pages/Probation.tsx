import { useState } from 'react'
import { ArrowRight, BarChart3, CalendarCheck2, Check, CheckCircle2, ChevronDown, ChevronRight, ClipboardCheck, Clock3, MoreHorizontal, Plus, Search, Star, Users, X } from 'lucide-react'
import { departments, getDepartment, today } from '../data'
import { useApp } from '../context'
import type { ProbationEmployee, ProbationStatus } from '../types'
import { cn, probationStatusMeta } from '../utils'

type ProbationProps = { onOpenApproval?: () => void }

const statusTabs: { key: ProbationStatus | 'all'; label: string }[] = [
  { key: 'all', label: '全部员工' },
  { key: 'probation', label: '试用期中' },
  { key: 'converting', label: '待转正' },
  { key: 'pending', label: '待入职' },
  { key: 'converted', label: '已转正' },
]

export function Probation({ onOpenApproval }: ProbationProps) {
  const { data, setData, toast } = useApp()
  const [tab, setTab] = useState<ProbationStatus | 'all'>('all')
  const [dept, setDept] = useState('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [showReview, setShowReview] = useState(false)

  const employees = data.probation.filter(employee => {
    if (tab !== 'all' && employee.status !== tab) return false
    if (dept !== 'all' && employee.departmentId !== dept) return false
    if (search && !`${employee.name}${employee.job}${employee.manager}`.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })
  const selectedEmployee = data.probation.find(e => e.id === selected)

  const approveConversion = (id: string, employeeName: string) => {
    setData(prev => ({ ...prev, probation: prev.probation.map(e => e.id === id ? { ...e, status: 'converted' as const } : e) }))
    toast(`${employeeName} 已转为正式员工`)
    setSelected(null)
  }

  return <div className="page-stack probation-page">
    <div className="page-title-row">
      <div><div className="eyebrow">员工发展 <span className="eyebrow-separator">·</span> {data.probation.filter(e => e.status === 'converting').length} 人待转正</div><h2>试用期管理</h2><p>跟踪新员工融入、目标达成与转正评审，让每一步都有依据。</p></div>
      <div className="page-title-actions"><button className="button button-secondary"><CalendarCheck2 size={16} />转正日历</button><button className="button button-primary" onClick={() => setShowReview(true)}><Plus size={17} />发起转正评审</button></div>
    </div>

    <div className="probation-overview">
      <div className="probation-stat main"><span className="stat-icon blue"><Users size={19} /></span><div><span>试用期员工</span><strong>{data.probation.filter(e => e.status === 'probation').length}</strong><small>占总人数 5.2%</small></div><div className="probation-mini-chart"><span style={{height:'30%'}}/><span style={{height:'50%'}}/><span style={{height:'42%'}}/><span style={{height:'70%'}}/><span style={{height:'62%'}}/><span style={{height:'88%'}}/></div></div>
      <div className="probation-stat"><span className="stat-icon amber"><Clock3 size={19} /></span><div><span>30 天内待转正</span><strong>{data.probation.filter(e => e.status === 'converting').length}</strong><small>请及时完成评审</small></div><span className="stat-alert">需关注</span></div>
      <div className="probation-stat"><span className="stat-icon green"><CheckCircle2 size={19} /></span><div><span>转正通过率</span><strong>91.7<span>%</span></strong><small>较上季度 +3.4%</small></div></div>
      <div className="probation-stat"><span className="stat-icon violet"><Star size={19} /></span><div><span>平均试用期评分</span><strong>4.3<span>/5</span></strong><small>表现良好</small></div></div>
    </div>

    <div className="panel probation-panel">
      <div className="probation-toolbar">
        <div className="probation-tabs">{statusTabs.map(item => <button key={item.key} className={cn(tab === item.key && 'active')} onClick={() => setTab(item.key)}>{item.label}<span>{item.key === 'all' ? data.probation.length : data.probation.filter(e => e.status === item.key).length}</span></button>)}</div>
        <div className="probation-filters"><label className="small-search"><Search size={15} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索员工" /></label><label className="filter-select mini"><select value={dept} onChange={e => setDept(e.target.value)}><option value="all">全部部门</option>{departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select><ChevronDown size={13} /></label><button className="icon-button"><MoreHorizontal size={18} /></button></div>
      </div>
      <div className="probation-table-wrap">
        <table className="probation-table">
          <thead><tr><th>员工</th><th>所属部门 / 岗位</th><th>直属主管</th><th>试用期</th><th>目标进度</th><th>最近反馈</th><th>状态</th><th /></tr></thead>
          <tbody>{employees.map(employee => {
            const department = getDepartment(employee.departmentId)
            const meta = probationStatusMeta[employee.status]
            const days = Math.max(0, Math.ceil((new Date(`${employee.endDate}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86400000))
            return <tr key={employee.id}>
              <td><button className="employee-cell" onClick={() => setSelected(employee.id)}><span className="avatar avatar-md" style={{background:`${employee.avatarColor}18`,color:employee.avatarColor}}>{employee.name.slice(-2)}</span><span><strong>{employee.name}</strong><small>{employee.job}</small></span></button></td>
              <td><span className="dept-position"><span className="department-dot" style={{background:department?.color}} />{department?.name}<small>{employee.job}</small></span></td>
              <td><span className="owner-cell"><span className="avatar avatar-xs avatar-warm">{employee.manager.slice(-1)}</span>{employee.manager}</span></td>
              <td><span className="probation-date"><strong>{employee.startDate} 至 {employee.endDate}</strong><small>{employee.status === 'converted' ? '已完成' : employee.status === 'pending' ? '即将开始' : `剩余 ${days} 天`}</small></span></td>
              <td><span className="goal-cell"><span><i style={{width:`${employee.goalProgress}%`, background: employee.goalProgress >= 90 ? '#18A77A' : employee.goalProgress >= 60 ? '#E4A03D' : '#8B93A7'}} /></span><small>{employee.goalProgress}%</small></span></td>
              <td><span className="feedback-cell">{employee.lastFeedback}</span></td>
              <td><span className={cn('status-badge', `status-${meta.tone}`)}><i />{meta.label}</span></td>
              <td><button className="icon-button row-more" onClick={() => setSelected(employee.id)}><ChevronRight size={17} /></button></td>
            </tr>
          })}</tbody>
        </table>
      </div>
    </div>

    <section className="probation-bottom-grid">
      <div className="panel conversion-panel"><div className="panel-header"><div><h3>即将转正</h3><p>未来 30 天内需要完成评审</p></div><button className="text-button">转正日历 <ChevronRight size={14} /></button></div>{data.probation.filter(e => e.status === 'converting').slice(0, 2).map(employee => <div className="conversion-item" key={employee.id}><span className="avatar avatar-md" style={{background:`${employee.avatarColor}18`,color:employee.avatarColor}}>{employee.name.slice(-2)}</span><div><strong>{employee.name}</strong><span>{employee.job} · {getDepartment(employee.departmentId)?.name}</span></div><div className="conversion-date"><span>转正日期</span><strong>{employee.endDate}</strong></div><button className="button button-secondary button-sm" onClick={() => setSelected(employee.id)}>评审</button></div>)}</div>
      <div className="panel guide-panel"><span className="guide-icon"><ClipboardCheck size={21} /></span><div><h3>建立更好的试用期体验</h3><p>设置清晰的 30-60-90 天目标，定期完成 1:1 反馈，让新员工更快融入团队。</p><button className="text-button">查看管理指南 <ArrowRight size={14} /></button></div></div>
    </section>

    {selectedEmployee && <ProbationDrawer employee={selectedEmployee} onClose={() => setSelected(null)} onApprove={() => approveConversion(selectedEmployee.id, selectedEmployee.name)} />}
    {showReview && <ReviewModal onClose={() => setShowReview(false)} />}
  </div>
}

function ProbationDrawer({employee,onClose,onApprove}:{employee:ProbationEmployee;onClose:()=>void;onApprove:()=>void}) {
  const department = getDepartment(employee.departmentId)
  const meta = probationStatusMeta[employee.status]
  return <><div className="drawer-backdrop" onClick={onClose}/><aside className="probation-drawer">
    <header className="drawer-header"><button className="icon-button" onClick={onClose}><X size={19}/></button><div className="drawer-header-actions"><button className="button button-secondary button-sm">发送提醒</button>{employee.status === 'converting' && <button className="button button-primary button-sm" onClick={onApprove}><Check size={15}/>确认转正</button>}</div></header>
    <div className="probation-drawer-head"><span className="avatar avatar-xl" style={{background:`${employee.avatarColor}18`,color:employee.avatarColor}}>{employee.name.slice(-2)}</span><h2>{employee.name}</h2><p>{employee.job} · {department?.name}</p><span className={cn('status-badge', `status-${meta.tone}`)}><i/>{meta.label}</span></div>
    <div className="probation-drawer-stats"><div><span>试用期评分</span><strong><Star size={15} fill="#EEA23E" stroke="#EEA23E"/>{employee.score || '-'}</strong></div><div><span>目标进度</span><strong>{employee.goalProgress}%</strong></div><div><span>1:1 沟通</span><strong>{employee.checkins} 次</strong></div></div>
    <div className="drawer-body">
      <section className="drawer-section"><div className="drawer-section-title"><h3>试用期概览</h3></div><div className="probation-detail-grid"><div><span>入职日期</span><strong>{employee.startDate}</strong></div><div><span>预计转正</span><strong>{employee.endDate}</strong></div><div><span>直属主管</span><strong>{employee.manager}</strong></div><div><span>下次评审</span><strong>{employee.reviewDate}</strong></div></div></section>
      <section className="drawer-section"><div className="drawer-section-title"><h3>目标完成情况</h3><span className="subtle-label">已完成 {employee.goalProgress}%</span></div><div className="goal-progress-big"><span><i style={{width:`${employee.goalProgress}%`}}/></span><strong>{employee.goalProgress}%</strong></div>{[{name:'熟悉业务与团队协作流程',done:true},{name:'独立完成核心项目交付',done:employee.goalProgress > 70},{name:'达成试用期业务指标',done:employee.goalProgress > 90}].map(goal=><div className="goal-row" key={goal.name}><span className={cn('goal-check', goal.done && 'done')}>{goal.done && <Check size={12}/>}</span><span>{goal.name}</span></div>)}</section>
      <section className="drawer-section"><div className="drawer-section-title"><h3>最近反馈</h3><button className="text-button">查看全部</button></div><div className="feedback-quote">“{employee.lastFeedback}”<span>— {employee.manager} · 直属主管</span></div></section>
      <section className="drawer-section"><div className="drawer-section-title"><h3>评审记录</h3></div><div className="review-timeline"><div><span className="review-dot done"><Check size={12}/></span><div><strong>30 天沟通</strong><span>已完成 · 反馈良好</span></div></div><div><span className="review-dot done"><Check size={12}/></span><div><strong>60 天沟通</strong><span>已完成 · 目标达成</span></div></div><div><span className={cn('review-dot', employee.status === 'converting' && 'current')} /><div><strong>转正评审</strong><span>{employee.status === 'converting' ? '待完成' : employee.status === 'converted' ? '已通过' : '尚未开始'}</span></div></div></div></section>
    </div>
  </aside></>
}

function ReviewModal({onClose}:{onClose:()=>void}) {
  const { toast } = useApp()
  const [name, setName] = useState('')
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal review-modal" onMouseDown={e=>e.stopPropagation()}><div className="modal-header"><div><span className="modal-icon"><ClipboardCheck size={18}/></span><div><h3>发起转正评审</h3><p>邀请相关同事完成试用期评估</p></div></div><button className="icon-button" onClick={onClose}><X size={18}/></button></div><div className="modal-body"><label className="form-field"><span>员工姓名</span><input value={name} onChange={e=>setName(e.target.value)} placeholder="输入员工姓名" /></label><label className="form-field"><span>评审类型</span><select><option>标准转正评审</option><option>提前转正评审</option><option>延期转正评估</option></select></label><label className="form-field"><span>评审人</span><input defaultValue="直属主管、部门负责人、HRBP" /></label><div className="form-notice"><Users size={15}/><span>评审发起后，相关同事会收到待办通知，结果将自动归档到员工档案。</span></div></div><div className="modal-footer"><button className="button button-secondary" onClick={onClose}>取消</button><button className="button button-primary" onClick={()=>{toast(name ? `已发起 ${name} 的转正评审` : '转正评审已发起');onClose()}}>发起评审</button></div></div></div>
}

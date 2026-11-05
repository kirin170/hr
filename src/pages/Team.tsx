import { useState } from 'react'
import { ArrowRight, ChevronDown, ChevronRight, Mail, MoreHorizontal, Plus, Search, Send, Settings2, UserPlus, Users, X } from 'lucide-react'
import { departments, getDepartment, getJob, jobs } from '../data'
import { useApp } from '../context'
import { cn } from '../utils'

type TeamProps = { onOpenCandidate: (id: string) => void }

export function Team({ onOpenCandidate }: TeamProps) {
  const { data, toast } = useApp()
  const [activeDept, setActiveDept] = useState('dept-rd')
  const [tab, setTab] = useState<'overview'|'members'|'collaboration'>('overview')
  const [showInvite, setShowInvite] = useState(false)
  const dept = getDepartment(activeDept)!
  const deptCandidates = data.candidates.filter(c => c.departmentId === activeDept)
  const deptJobs = jobs.filter(j => j.departmentId === activeDept)
  const members = [{name:'陈屿', role:'研发负责人', email:'chenyu@papa360.com', status:'在线', color:'#4D91D9'},{name:'林夏', role:'高级招聘专员', email:'linxia@papa360.com', status:'在线', color:'#D58A28'},{name:'唐越', role:'后端工程师', email:'tangyue@papa360.com', status:'忙碌', color:'#6675E8'},{name:'梁澄', role:'前端工程师', email:'liangcheng@papa360.com', status:'离线', color:'#19A77C'}]
  return <div className="page-stack team-page">
    <div className="page-title-row"><div><div className="eyebrow">跨部门协作 <span className="eyebrow-separator">·</span> 5 个部门</div><h2>部门协同</h2><p>共享招聘进展，明确责任分工，让业务与 HR 同频决策。</p></div><div className="page-title-actions"><button className="button button-secondary" onClick={() => setShowInvite(true)}><UserPlus size={16} />邀请成员</button><button className="button button-primary"><Plus size={17} />新建部门</button></div></div>

    <div className="team-layout">
      <aside className="panel dept-list-panel">
        <div className="dept-list-head"><strong>组织部门</strong><button className="icon-button icon-button-small"><Plus size={16}/></button></div>
        <div className="dept-list">{departments.map(department => { const count = data.candidates.filter(c => c.departmentId === department.id).length; return <button key={department.id} className={cn(activeDept === department.id && 'active')} onClick={() => setActiveDept(department.id)}><span className="department-badge" style={{background:`${department.color}18`,color:department.color}}>{department.short}</span><span><strong>{department.name}</strong><small>{department.lead} · {count} 位候选人</small></span><ChevronRight size={15}/></button> })}</div>
        <div className="dept-list-bottom"><button className="text-button"><Settings2 size={14}/>组织架构设置</button></div>
      </aside>

      <main className="team-main">
        <section className="team-hero panel">
          <div className="team-hero-top"><span className="department-badge dept-badge-lg" style={{background:`${dept.color}18`,color:dept.color}}>{dept.short}</span><div><h3>{dept.name}</h3><p>{dept.lead} 负责 · {deptJobs.length} 个在招职位 · {deptCandidates.length} 位候选人</p></div><button className="button button-secondary button-sm">部门设置</button></div>
          <div className="team-hero-metrics"><div><span>招聘完成度</span><strong>72%</strong><span className="mini-track"><i style={{width:'72%',background:dept.color}}/></span></div><div><span>本周面试</span><strong>{deptCandidates.filter(c=>c.stage==='interview').length + 3}</strong><small>场</small></div><div><span>待处理事项</span><strong>4</strong><small>项</small></div><div><span>平均招聘周期</span><strong>18</strong><small>天</small></div></div>
        </section>
        <div className="team-tabs"><button className={cn(tab==='overview'&&'active')} onClick={()=>setTab('overview')}>概览</button><button className={cn(tab==='members'&&'active')} onClick={()=>setTab('members')}>协作成员 <span>8</span></button><button className={cn(tab==='collaboration'&&'active')} onClick={()=>setTab('collaboration')}>协同记录 <span>12</span></button></div>
        {tab === 'overview' && <>
          <div className="team-overview-grid">
            <section className="panel team-jobs"><div className="panel-header"><div><h3>在招职位</h3><p>实时同步招聘进展</p></div><button className="text-button">全部职位 <ChevronRight size={14}/></button></div>{deptJobs.map(job => { const candidates = data.candidates.filter(c=>c.jobId===job.id); return <div className="team-job-row" key={job.id}><div><strong>{job.title}</strong><span>{job.location} · {job.owner}</span></div><div className="job-progress"><span><i style={{width:`${Math.min(100, job.hired/job.headcount*100+30)}%`,background:dept.color}}/></span><small>{job.hired}/{job.headcount} HC</small></div><span className="job-candidate-count">{candidates.length} 人</span><button className="icon-button icon-button-small"><MoreHorizontal size={16}/></button></div> })}</section>
            <section className="panel team-activity"><div className="panel-header"><div><h3>协同动态</h3><p>部门最新进展</p></div><button className="text-button">全部 <ChevronRight size={14}/></button></div><div className="team-activity-list">{data.activities.slice(0,3).map(a=><div key={a.id}><span className="avatar avatar-xs avatar-warm">{a.actor.slice(-1)}</span><div><p><strong>{a.actor}</strong> {a.action} <b>{a.target}</b></p><span>{a.time}</span></div></div>)}</div></section>
          </div>
          <section className="panel team-candidates"><div className="panel-header"><div><h3>部门候选人</h3><p>当前需要关注的人才</p></div><button className="button button-secondary button-sm">查看全部</button></div><div className="team-candidate-list">{deptCandidates.slice(0,5).map(candidate=><button key={candidate.id} onClick={()=>onOpenCandidate(candidate.id)}><span className="avatar avatar-sm" style={{background:`${candidate.avatarColor}18`,color:candidate.avatarColor}}>{candidate.name.slice(-2)}</span><span><strong>{candidate.name}</strong><small>{getJob(candidate.jobId)?.title}</small></span><span className={cn('stage-badge', `stage-${candidate.stage==='interview'?'violet':candidate.stage==='offer'?'orange':candidate.stage==='hired'?'green':'blue'}`)}><i/>{candidate.stage==='interview'?'面试中':candidate.stage==='offer'?'Offer':candidate.stage==='hired'?'已入职':'筛选中'}</span><ChevronRight size={15}/></button>)}</div></section>
        </>}
        {tab === 'members' && <section className="panel members-panel"><div className="panel-header"><div><h3>协作成员</h3><p>共同参与 {dept.name} 的招聘工作</p></div><button className="button button-secondary button-sm" onClick={()=>setShowInvite(true)}><UserPlus size={15}/>邀请成员</button></div><div className="member-grid">{members.map(member=><div className="member-card" key={member.email}><span className="avatar avatar-lg" style={{background:`${member.color}18`,color:member.color}}>{member.name.slice(-2)}</span><div><strong>{member.name}</strong><span>{member.role}</span><small><span className={cn('presence',member.status==='在线'?'online':member.status==='忙碌'?'busy':'')}/>{member.status}</small></div><button className="icon-button"><MoreHorizontal size={17}/></button><div className="member-contact"><span><Mail size={13}/>{member.email}</span></div></div>)}</div></section>}
        {tab === 'collaboration' && <section className="panel collaboration-panel"><div className="panel-header"><div><h3>协同记录</h3><p>最近 30 天的跨部门协作</p></div><button className="button button-secondary button-sm"><Plus size={15}/>发起协作</button></div>{[{title:'高级前端工程师 · 面试标准对齐',people:'林夏、陈屿',time:'今天 10:24',status:'已完成'},{title:'产品设计 · 新增 HC 评估',people:'周宁、邓文文',time:'昨天 16:40',status:'进行中'},{title:'市场增长 · 候选人推荐',people:'苏嘉、林夏',time:'11月3日',status:'已完成'}].map(item=><div className="collab-row" key={item.title}><span className="collab-icon"><Users size={17}/></span><div><strong>{item.title}</strong><span>{item.people} · {item.time}</span></div><span className={cn('collab-status',item.status==='已完成'?'done':'')}>{item.status}</span><ChevronRight size={15}/></div>)}</section>}
      </main>
    </div>
    {showInvite && <InviteModal onClose={()=>setShowInvite(false)} onInvite={()=>{toast('成员邀请已发送');setShowInvite(false)}} />}
  </div>
}

function InviteModal({onClose,onInvite}:{onClose:()=>void;onInvite:()=>void}) {
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal" onMouseDown={e=>e.stopPropagation()}><div className="modal-header"><div><span className="modal-icon"><UserPlus size={18}/></span><div><h3>邀请协作成员</h3><p>邀请业务同事加入招聘协作</p></div></div><button className="icon-button" onClick={onClose}><X size={18}/></button></div><div className="modal-body"><label className="form-field"><span>成员邮箱</span><input placeholder="name@papa360.com" autoFocus/><small>支持输入多个邮箱，用逗号分隔</small></label><label className="form-field"><span>协作角色</span><select><option>面试官</option><option>招聘协作人</option><option>部门管理员</option></select></label><label className="form-field"><span>权限范围</span><select><option>仅查看分配给我的候选人</option><option>查看本部门全部候选人</option><option>查看全部候选人</option></select></label><div className="form-notice"><Send size={15}/><span>邀请成员将通过邮件收到加入链接。</span></div></div><div className="modal-footer"><button className="button button-secondary" onClick={onClose}>取消</button><button className="button button-primary" onClick={onInvite}>发送邀请</button></div></div></div>
}

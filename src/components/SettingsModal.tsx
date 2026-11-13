import { useState } from 'react'
import { Check, Database, RotateCcw, Shield, UserRound, X } from 'lucide-react'
import { useApp } from '../context'

export function SettingsModal({ onClose, onReset }: { onClose: () => void; onReset: () => void }) {
  const { toast } = useApp()
  const [tab, setTab] = useState<'profile'|'organization'|'pipeline'>('profile')
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal settings-modal" onMouseDown={e=>e.stopPropagation()}>
    <div className="modal-header"><div><span className="modal-icon"><Shield size={18}/></span><div><h3>系统设置</h3><p>管理工作区与招聘配置</p></div></div><button className="icon-button" onClick={onClose}><X size={18}/></button></div>
    <div className="settings-layout"><aside className="settings-nav"><button className={tab==='profile'?'active':''} onClick={()=>setTab('profile')}><UserRound size={16}/>个人资料</button><button className={tab==='organization'?'active':''} onClick={()=>setTab('organization')}><Database size={16}/>工作区</button><button className={tab==='pipeline'?'active':''} onClick={()=>setTab('pipeline')}><Check size={16}/>招聘流程</button></aside><div className="settings-content">
      {tab==='profile'&&<><h3>个人资料</h3><p className="settings-desc">这些信息会展示给招聘协作成员。</p><div className="settings-profile"><span className="avatar avatar-xl avatar-warm">邓</span><button className="button button-secondary button-sm">更换头像</button></div><div className="form-grid"><label className="form-field"><span>姓名</span><input defaultValue="邓文文"/></label><label className="form-field"><span>职位</span><input defaultValue="招聘负责人"/></label></div><label className="form-field"><span>邮箱</span><input defaultValue="dengwenwen@example.com"/></label><label className="form-field"><span>所在部门</span><select defaultValue="人力资源"><option>人力资源</option><option>研发中心</option></select></label></>}
      {tab==='organization'&&<><h3>工作区设置</h3><p className="settings-desc">候选人档案来自 ATS 后端，其他模块的演示数据仅在当前会话有效。</p><div className="workspace-setting"><span className="workspace-logo">P</span><div><strong>派派科技</strong><span>5 个部门 · 12 个在招职位</span></div></div><div className="form-field"><span>工作区名称</span><input defaultValue="派派科技"/></div><div className="danger-box"><div><strong>重置演示数据</strong><span>恢复面试、试用期与审批演示数据，不会清除 ATS 候选人。</span></div><button className="button button-secondary button-sm" onClick={()=>{onReset();toast('演示数据已恢复')}}><RotateCcw size={14}/>重置数据</button></div></>}
      {tab==='pipeline'&&<><h3>招聘流程</h3><p className="settings-desc">自定义候选人从投递到入职的阶段。</p><div className="pipeline-setting-list">{[{name:'新简历',color:'#6E83E9'},{name:'筛选中',color:'#E4A03D'},{name:'面试中',color:'#9A72DE'},{name:'Offer',color:'#E47D59'},{name:'已入职',color:'#22A97B'}].map((stage,i)=><div key={stage.name}><span className="drag-handle">⋮⋮</span><i style={{background:stage.color}}/><strong>{stage.name}</strong><span className="stage-count">{i===4?'终态':'普通阶段'}</span></div>)}</div></>}
    </div></div>
    <div className="modal-footer"><button className="button button-primary" onClick={onClose}>完成</button></div>
  </div></div>
}


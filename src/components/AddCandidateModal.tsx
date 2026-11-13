import { useEffect, useState } from 'react'
import { ChevronDown, Mail, Plus, Search, Upload, UserRound, X } from 'lucide-react'
import { getDepartment } from '../data'
import { useApp } from '../context'
import type { Candidate } from '../types'

type AddCandidateProps = { onClose: () => void; initialJob?: string }

export function AddCandidateModal({ onClose, initialJob }: AddCandidateProps) {
  const { addCandidate, toast, apiJobs: availableJobs } = useApp()
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [jobId, setJobId] = useState(initialJob || '')
  const [source, setSource] = useState('官网投递')
  const [experience, setExperience] = useState('3-5年')
  const [school, setSchool] = useState('')
  const [company, setCompany] = useState('')
  const [fileName, setFileName] = useState('')
  const [step, setStep] = useState<'upload'|'manual'>('manual')
  const job = availableJobs.find(j => j.id === jobId)

  useEffect(() => {
    if (initialJob && availableJobs.some((item) => item.id === initialJob)) setJobId(initialJob)
    else if (initialJob && availableJobs.length) setJobId('')
  }, [initialJob, availableJobs])

  const submit = async () => {
    if (!name.trim()) { toast('请填写候选人姓名', 'info'); return }
    setSaving(true)
    const colors = ['#6675E8','#19A77C','#E27D62','#D58A28','#BF7BD5']
    const candidate: Candidate = {
      id: `pending-${Date.now()}`, name: name.trim(), phone: phone || '待补充', email: email || '待补充', jobId, jobTitle: job?.title || '', departmentId: job?.departmentId || '', stage: 'new', source, experience: experience.replace('年',''), education: '本科', school: school || '待补充', currentCompany: company || '待补充', currentTitle: job?.title || '待补充', tags: ['新简历'], rating: 3, appliedAt: new Date().toISOString().slice(0,10), lastActivity: '刚刚', owner: '邓文文', avatarColor: colors[Math.floor(Math.random()*colors.length)], summary: '候选人简历已录入，等待招聘团队完成初步筛选。', resumeName: fileName || `${name || '候选人'}_简历.pdf`, workHistory: company && job ? [{company, title: job.title, period: '最近经历'}] : [],
    }
    try {
      const created = await addCandidate(candidate)
      toast(`已添加候选人 ${created.name}`)
      onClose()
    } catch (error) {
      toast(error instanceof Error ? error.message : '候选人添加失败', 'info')
    } finally {
      setSaving(false)
    }
  }

  return <div className="modal-backdrop" onMouseDown={onClose}>
    <div className="modal add-candidate-modal" onMouseDown={e => e.stopPropagation()}>
      <div className="modal-header"><div><span className="modal-icon"><UserRound size={18}/></span><div><h3>添加候选人</h3><p>创建人才档案并加入招聘流程</p></div></div><button className="icon-button" onClick={onClose}><X size={18}/></button></div>
      <div className="add-tabs"><button className={step==='manual'?'active':''} onClick={()=>setStep('manual')}>手动录入</button><button className={step==='upload'?'active':''} onClick={()=>setStep('upload')}>上传简历</button></div>
      <div className="modal-body">
        {step==='upload' ? <label className="upload-zone"><input type="file" accept=".pdf,.doc,.docx" onChange={e=>setFileName(e.target.files?.[0]?.name||'')}/><span className="upload-icon"><Upload size={24}/></span><strong>{fileName || '点击或拖拽上传简历'}</strong><p>支持 PDF、Word 格式，单个文件不超过 20 MB</p><small>上传后可继续补充候选人信息</small></label> : <>
          <div className="form-grid"><label className="form-field"><span>候选人姓名 <em>*</em></span><input value={name} onChange={e=>setName(e.target.value)} placeholder="请输入姓名" autoFocus/></label><label className="form-field"><span>手机号</span><input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="请输入手机号"/></label></div>
          <label className="form-field"><span>邮箱</span><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="name@example.com"/></label>
          <div className="form-grid"><label className="form-field"><span>应聘职位</span><select value={jobId} onChange={e=>setJobId(e.target.value)}><option value="">待分配职位</option>{availableJobs.map(j=><option key={j.id} value={j.id}>{j.title} · {getDepartment(j.departmentId)?.name || j.departmentId}</option>)}</select></label><label className="form-field"><span>简历来源</span><select value={source} onChange={e=>setSource(e.target.value)}><option>官网投递</option><option>内部推荐</option><option>BOSS直聘</option><option>猎聘</option><option>脉脉</option><option>校园招聘</option></select></label></div>
          <div className="form-grid"><label className="form-field"><span>工作经验</span><select value={experience} onChange={e=>setExperience(e.target.value)}><option>应届生</option><option>1-3年</option><option>3-5年</option><option>5-10年</option><option>10年以上</option></select></label><label className="form-field"><span>当前公司</span><input value={company} onChange={e=>setCompany(e.target.value)} placeholder="请输入公司名称"/></label></div>
          <label className="form-field"><span>毕业院校</span><input value={school} onChange={e=>setSchool(e.target.value)} placeholder="请输入毕业院校"/></label>
        </>}
        <div className="form-notice"><UserRound size={15}/><span>候选人信息仅对招聘协作成员可见，请妥善保护个人隐私。</span></div>
      </div>
      <div className="modal-footer"><button className="button button-secondary" onClick={onClose}>取消</button><button className="button button-primary" onClick={submit} disabled={saving}>{saving ? '保存中…' : <><Plus size={16}/>添加候选人</>}</button></div>
    </div>
  </div>
}

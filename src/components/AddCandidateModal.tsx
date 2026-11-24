import { useEffect, useState } from 'react'
import { Plus, Upload, UserRound, X } from 'lucide-react'
import { useApp } from '../context'
import { useEffectiveSettings } from '../useEffectiveSettings'
import type { Candidate } from '../types'

type AddCandidateProps = { onClose: () => void; initialJob?: string }

export function AddCandidateModal({ onClose, initialJob }: AddCandidateProps) {
  const { addCandidate, toast, apiJobs: availableJobs } = useApp()
  const effective = useEffectiveSettings()
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [jobId, setJobId] = useState(initialJob || '')
  const [source, setSource] = useState('官网投递')
  const [experience, setExperience] = useState('3-5年')
  const [school, setSchool] = useState('')
  const [company, setCompany] = useState('')
  const [tags, setTags] = useState('')
  const [fileName, setFileName] = useState('')
  const [step, setStep] = useState<'upload'|'manual'>('manual')
  const job = availableJobs.find(j => j.id === jobId)
  // 表单必填标记来自管理后台字段配置（ATS-024）；固定必填（姓名）始终校验
  const requiredKeys = new Set(
    (effective?.fields.CANDIDATE ?? []).filter((field) => field.required).map((field) => field.key),
  )
  const channelOptions = effective?.dicts.CHANNEL ?? ['官网投递', '内部推荐', 'BOSS直聘', '猎聘', '脉脉', '校园招聘']
  const tagOptions = effective?.dicts.TAG ?? []
  const candidateValues: Record<string, string> = {
    name: name.trim(), phone: phone.trim(), email: email.trim(), currentCompany: company.trim(),
    experience, education: '本科', school: school.trim(), channel: source,
    currentTitle: job?.title || '待补充', summary: '', tags: tags.trim(),
  }
  const fieldLabel = (key: string) => effective?.fields.CANDIDATE.find((field) => field.key === key)?.label || key
  const requiredFields: { key: string; label: string }[] = [...requiredKeys]
    .filter((key) => key in candidateValues)
    .map((key) => ({ key, label: fieldLabel(key) }))

  useEffect(() => {
    if (initialJob && availableJobs.some((item) => item.id === initialJob)) setJobId(initialJob)
    else if (initialJob && availableJobs.length) setJobId('')
  }, [initialJob, availableJobs])

  const submit = async () => {
    if (!name.trim()) { toast('请填写候选人姓名', 'info'); return }
    const missing = requiredFields.find((field) => !candidateValues[field.key])
    if (missing) { toast(`请填写${missing.label}（必填）`, 'info'); return }
    setSaving(true)
    const colors = ['#6675E8','#19A77C','#E27D62','#D58A28','#BF7BD5']
    const candidate: Candidate = {
      id: `pending-${Date.now()}`, name: name.trim(), phone: phone || '待补充', email: email || '待补充', jobId, jobTitle: job?.title || '', departmentId: job?.departmentId || '', stage: 'new', source, experience: experience.replace('年',''), education: '本科', school: school || '待补充', currentCompany: company || '待补充', currentTitle: job?.title || '待补充', tags: tags.trim() ? tags.trim().split(/[,，\s]+/).filter(Boolean) : ['新简历'], rating: 3, appliedAt: new Date().toISOString().slice(0,10), lastActivity: '刚刚', owner: '邓文文', avatarColor: colors[Math.floor(Math.random()*colors.length)], summary: '候选人简历已录入，等待招聘团队完成初步筛选。', resumeName: fileName || `${name || '候选人'}_简历.pdf`, workHistory: company && job ? [{company, title: job.title, period: '最近经历'}] : [],
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

  const mark = (key: string) => (requiredKeys.has(key) ? <em>*</em> : null)

  return <div className="modal-backdrop" onMouseDown={onClose}>
    <div className="modal add-candidate-modal" onMouseDown={e => e.stopPropagation()}>
      <div className="modal-header"><div><span className="modal-icon"><UserRound size={18}/></span><div><h3>添加候选人</h3><p>创建人才档案并加入招聘流程</p></div></div><button className="icon-button" onClick={onClose}><X size={18}/></button></div>
      <div className="add-tabs"><button className={step==='manual'?'active':''} onClick={()=>setStep('manual')}>手动录入</button><button className={step==='upload'?'active':''} onClick={()=>setStep('upload')}>上传简历</button></div>
      <div className="modal-body">
        {step==='upload' ? <label className="upload-zone"><input type="file" accept=".pdf,.doc,.docx" onChange={e=>setFileName(e.target.files?.[0]?.name||'')}/><span className="upload-icon"><Upload size={24}/></span><strong>{fileName || '点击或拖拽上传简历'}</strong><p>支持 PDF、Word 格式，单个文件不超过 20 MB</p><small>上传后可继续补充候选人信息</small></label> : <>
          <div className="form-grid"><label className="form-field"><span>候选人姓名 {mark('name')}</span><input value={name} onChange={e=>setName(e.target.value)} placeholder="请输入姓名" autoFocus/></label><label className="form-field"><span>手机号 {mark('phone')}</span><input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="请输入手机号"/></label></div>
          <label className="form-field"><span>邮箱 {mark('email')}</span><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="name@example.com"/></label>
          <div className="form-grid"><label className="form-field"><span>应聘职位</span><select value={jobId} onChange={e=>setJobId(e.target.value)}><option value="">待分配职位</option>{availableJobs.map(j=><option key={j.id} value={j.id}>{j.title} · {j.departmentName || '部门待补充'}</option>)}</select></label><label className="form-field"><span>简历来源 {mark('channel')}</span><select value={source} onChange={e=>setSource(e.target.value)}>{channelOptions.map(option=><option key={option}>{option}</option>)}</select></label></div>
          <div className="form-grid"><label className="form-field"><span>工作经验 {mark('experience')}</span><select value={experience} onChange={e=>setExperience(e.target.value)}><option>应届生</option><option>1-3年</option><option>3-5年</option><option>5-10年</option><option>10年以上</option></select></label><label className="form-field"><span>当前公司 {mark('currentCompany')}</span><input value={company} onChange={e=>setCompany(e.target.value)} placeholder="请输入公司名称"/></label></div>
          <label className="form-field"><span>毕业院校 {mark('school')}</span><input value={school} onChange={e=>setSchool(e.target.value)} placeholder="请输入毕业院校"/></label>
          <label className="form-field"><span>标签 {mark('tags')}</span><input list="add-candidate-tag-options" value={tags} onChange={e=>setTags(e.target.value)} placeholder="多个标签用空格分隔"/>{tagOptions.length > 0 && <datalist id="add-candidate-tag-options">{tagOptions.map(option => <option key={option} value={option} />)}</datalist>}</label>
        </>}
        <div className="form-notice"><UserRound size={15}/><span>候选人信息仅对招聘协作成员可见，请妥善保护个人隐私。</span></div>
      </div>
      <div className="modal-footer"><button className="button button-secondary" onClick={onClose}>取消</button><button className="button button-primary" onClick={submit} disabled={saving}>{saving ? '保存中…' : <><Plus size={16}/>添加候选人</>}</button></div>
    </div>
  </div>
}

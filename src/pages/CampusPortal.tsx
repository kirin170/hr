import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, GraduationCap, Loader2, MapPin, Send } from 'lucide-react'
import { listCampusJobs, submitCampusApplication } from '../api'
import type { CampusApplyResult, CampusJob } from '../types'

const initialForm = {
  name: '',
  phone: '',
  email: '',
  jobId: '',
  desiredPositions: '',
  expectedCity: '',
  school: '',
  major: '',
  graduationYear: '',
  availableFrom: '',
  remark: '',
  referrerName: '',
  referralCode: '',
}

export function CampusPortal() {
  const [jobs, setJobs] = useState<CampusJob[]>([])
  const [loadingJobs, setLoadingJobs] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [form, setForm] = useState(initialForm)
  const [resume, setResume] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<CampusApplyResult | null>(null)

  useEffect(() => {
    listCampusJobs()
      .then((response) => {
        setJobs(response.items)
        const firstVirtual = response.items.find((job) => job.isVirtual)
        const first = firstVirtual ?? response.items[0]
        if (first) setForm((prev) => ({ ...prev, jobId: prev.jobId || first.id }))
      })
      .catch((jobsError) => setLoadError(jobsError instanceof Error ? jobsError.message : '职位加载失败'))
      .finally(() => setLoadingJobs(false))
  }, [])

  const selectedJob = useMemo(() => jobs.find((job) => job.id === form.jobId) ?? null, [jobs, form.jobId])

  const update = (key: keyof typeof form, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const submit = async () => {
    setError(null)
    if (!form.name.trim()) {
      setError('请填写姓名')
      return
    }
    if (!form.phone.trim() && !form.email.trim()) {
      setError('请至少填写手机号或邮箱，用于查重与联系')
      return
    }
    if (!form.jobId) {
      setError('请选择投递职位')
      return
    }
    setBusy(true)
    try {
      const created = await submitCampusApplication({
        name: form.name.trim(),
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
        jobId: form.jobId,
        desiredPositions: form.desiredPositions.trim() || undefined,
        expectedCity: form.expectedCity.trim() || undefined,
        school: form.school.trim() || undefined,
        major: form.major.trim() || undefined,
        graduationYear: form.graduationYear.trim() || undefined,
        availableFrom: form.availableFrom ? new Date(form.availableFrom).toISOString() : undefined,
        remark: form.remark.trim() || undefined,
        referrerName: form.referrerName.trim() || undefined,
        referralCode: form.referralCode.trim() || undefined,
      }, resume)
      setResult(created)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '投递失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  const reset = () => {
    setResult(null)
    setForm(initialForm)
    setResume(null)
  }

  return (
    <div className="campus-portal">
      <header className="campus-portal-header">
        <div className="campus-portal-brand">
          <div className="brand-mark"><span /><span /><span /></div>
          <span className="brand-word">TalentFlow</span>
        </div>
        <span className="campus-portal-tag">校园招聘投递</span>
      </header>

      <main className="campus-portal-main">
        <section className="campus-portal-hero">
          <div className="campus-portal-eyebrow"><GraduationCap size={15} />2027 校园招聘</div>
          <h1>投递你的第一份工作</h1>
          <p>选择校招统一入口或具体职位，填写个人意愿；人事会结合简历与意愿人工分配正式职位。</p>
          <div className="campus-portal-hints">
            <span><MapPin size={14} />支持远程面试</span>
            <span><CheckCircle2 size={14} />投递后由 HR 跟进</span>
          </div>
        </section>

        {result ? (
          <section className="panel campus-portal-result">
            <span className="campus-portal-result-icon"><CheckCircle2 size={26} /></span>
            <h2>{result.duplicate ? '投递已收到' : '投递成功'}</h2>
            <p>{result.message}</p>
            <small className="cell-sub">投递编号：{result.applicationId.slice(-8)}</small>
            <button className="button button-primary" onClick={reset}>再投一份</button>
          </section>
        ) : (
          <section className="panel campus-portal-form">
            <div className="panel-header">
              <div>
                <h3>个人信息与投递意愿</h3>
                <p>带 * 为必填；手机号与邮箱用于查重，请勿重复投递。</p>
              </div>
            </div>

            {loadingJobs && <div className="empty-inline">正在加载职位…</div>}
            {loadError && <div className="empty-inline">职位加载失败：{loadError}</div>}

            {!loadingJobs && !loadError && (
              <div className="campus-portal-grid">
                <label className="form-field">
                  <span>投递职位<em>*</em></span>
                  <select value={form.jobId} onChange={(event) => update('jobId', event.target.value)}>
                    <option value="">请选择职位</option>
                    {jobs.map((job) => (
                      <option key={job.id} value={job.id}>
                        {job.title}{job.isVirtual ? '（校招统一入口）' : `（${job.code}）`}{job.location ? ` · ${job.location}` : ''}
                      </option>
                    ))}
                  </select>
                  <small>
                    {selectedJob?.isVirtual
                      ? '投递后进入校招人才库，由人事按意愿分配正式职位'
                      : '带正式职位投递将直接进入该职位人才推荐'}
                  </small>
                </label>
                <label className="form-field">
                  <span>姓名<em>*</em></span>
                  <input value={form.name} onChange={(event) => update('name', event.target.value)} placeholder="请输入姓名" />
                </label>
                <label className="form-field">
                  <span>手机号</span>
                  <input value={form.phone} onChange={(event) => update('phone', event.target.value)} placeholder="用于查重与联系" />
                </label>
                <label className="form-field">
                  <span>邮箱</span>
                  <input value={form.email} onChange={(event) => update('email', event.target.value)} placeholder="name@example.com" />
                </label>
                <label className="form-field">
                  <span>意向岗位</span>
                  <input value={form.desiredPositions} onChange={(event) => update('desiredPositions', event.target.value)} placeholder="多个岗位用逗号分隔" />
                </label>
                <label className="form-field">
                  <span>意向城市</span>
                  <input value={form.expectedCity} onChange={(event) => update('expectedCity', event.target.value)} placeholder="如 杭州" />
                </label>
                <label className="form-field">
                  <span>学校</span>
                  <input value={form.school} onChange={(event) => update('school', event.target.value)} placeholder="毕业院校" />
                </label>
                <label className="form-field">
                  <span>专业</span>
                  <input value={form.major} onChange={(event) => update('major', event.target.value)} placeholder="所学专业" />
                </label>
                <label className="form-field">
                  <span>毕业年份</span>
                  <input value={form.graduationYear} onChange={(event) => update('graduationYear', event.target.value)} placeholder="如 2027" />
                </label>
                <label className="form-field">
                  <span>可到岗时间</span>
                  <input type="date" value={form.availableFrom} onChange={(event) => update('availableFrom', event.target.value)} />
                </label>
                <label className="form-field">
                  <span>推荐人</span>
                  <input value={form.referrerName} onChange={(event) => update('referrerName', event.target.value)} placeholder="选填，内推人姓名或员工标识" />
                </label>
                <label className="form-field">
                  <span>来源标识</span>
                  <input value={form.referralCode} onChange={(event) => update('referralCode', event.target.value)} placeholder="选填，内推码或渠道活动标识" />
                </label>
                <label className="form-field">
                  <span>简历附件</span>
                  <input
                    type="file"
                    accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp"
                    onChange={(event) => setResume(event.target.files?.[0] ?? null)}
                  />
                  <small>{resume ? resume.name : '选填，支持 PDF / Word / 图片'}</small>
                </label>
                <label className="form-field campus-portal-wide">
                  <span>备注</span>
                  <textarea
                    rows={3}
                    value={form.remark}
                    onChange={(event) => update('remark', event.target.value)}
                    placeholder="选填，可补充实习经历、作品链接等"
                  />
                </label>
              </div>
            )}

            {error && <div className="campus-portal-error">{error}</div>}

            <div className="campus-portal-actions">
              <button className="button button-primary" disabled={busy || loadingJobs} onClick={() => void submit()}>
                {busy ? <Loader2 size={16} className="campus-portal-spin" /> : <Send size={16} />}
                {busy ? '提交中…' : '提交投递'}
              </button>
              <small>提交即表示同意公司为招聘目的处理上述信息。</small>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}

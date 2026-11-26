import { useEffect, useState } from 'react'
import { request, updateCandidateStage } from '../api'
import type { Candidate } from '../types'

type Info = { onboardDate: string | null; reasons: { id: string; label: string }[]; probation: { converted: boolean; convertedAt: string | null } | null }
export function OnboardingPanel({ candidate, onChanged }: { candidate: Candidate; onChanged: (candidate: Candidate) => void }) {
  const base = `/candidates/${encodeURIComponent(candidate.id)}`
  const [info, setInfo] = useState<Info | null>(null)
  const [date, setDate] = useState('')
  const [convertedAt, setConvertedAt] = useState('')
  const [reasonId, setReasonId] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { let live = true; setInfo(null); setError(''); request<Info>(`${base}/onboarding`).then(v => { if (live) { setInfo(v); setDate(v.onboardDate?.slice(0,10) || '') } }).catch(e => { if (live) setError(e.message) }); return () => { live = false } }, [base, candidate.stage])
  const run = async (action: () => Promise<void>) => { setBusy(true); setError(''); try { await action() } catch (e) { setError(e instanceof Error ? e.message : '操作失败') } finally { setBusy(false) } }
  const disabled = busy || candidate.lockedState === 'INOPERABLE'
  return <section className="drawer-section"><div className="drawer-section-title"><h3>{candidate.stage === 'PENDING_ONBOARD' ? '待入职' : '试用期结论'}</h3></div>{error && <p className="form-error" role="alert">{error}</p>}{!info ? !error && <div className="empty-inline">正在加载…</div> : <>
    {candidate.stage === 'PENDING_ONBOARD' && <div className="candidate-screening-form">
      <label>入职日期<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
      <div className="button-row">
        <button className="button button-secondary button-sm" disabled={disabled || !date} onClick={() => void run(async () => { const result = await request<{onboardDate:string}>(`${base}/onboarding/date`, { method:'PATCH', body:JSON.stringify({onboardDate:date}) }); setInfo({ ...info, onboardDate: result.onboardDate }) })}>保存改期</button>
        <button className="button button-primary button-sm" disabled={disabled} onClick={() => void run(async () => onChanged(await updateCandidateStage(candidate.id, 'ONBOARDED')))}>确认入职</button>
      </div>
      <label>放弃入职原因<select value={reasonId} onChange={e => setReasonId(e.target.value)}><option value="">请选择</option>{info.reasons.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select></label>
      <label>原因说明<textarea value={reason} onChange={e => setReason(e.target.value)} /></label>
      <div className="button-row"><button className="button button-secondary button-sm" disabled={disabled || !reasonId} onClick={() => void run(async () => onChanged(await updateCandidateStage(candidate.id, 'ARCHIVED', reason || undefined, reasonId)))}>放弃入职并归档</button></div>
    </div>}
    {candidate.stage === 'PROBATION' && <div className="candidate-screening-form"><label>转正日期<input type="date" value={convertedAt} onChange={e => setConvertedAt(e.target.value)} /></label><div className="button-row"><button className="button button-primary button-sm" disabled={disabled || !convertedAt} onClick={() => void run(async () => onChanged(await request<Candidate>(`${base}/probation/complete`, {method:'POST',body:JSON.stringify({converted:true,convertedAt})})))}>记录已转正并结束</button><button className="button button-secondary button-sm" disabled={disabled} onClick={() => void run(async () => onChanged(await request<Candidate>(`${base}/probation/complete`, {method:'POST',body:JSON.stringify({converted:false})})))}>记录未转正并结束</button></div></div>}
    {candidate.stage === 'ENDED' && <div className="drawer-note">{info.probation ? (info.probation.converted ? `已转正：${info.probation.convertedAt?.slice(0,10) || '日期未记录'}` : '未转正') : '暂无试用期结论'}</div>}
  </>}</section>
}

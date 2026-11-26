import { useCallback, useEffect, useState } from 'react'
import { request, uploadOfferMaterial, submitOfferOa, refreshOfferOa } from '../api'
import { cn } from '../utils'

type Offer = { workflowStage: string | null; stageStatus: string | null; workflowVersion: number; oaApprovalId: string | null; oaInstanceId: string | null; oaInstanceStatus: string | null; oaInstanceResult: string | null; oaSource: string | null; oaSyncedAt: string | null; hireLevel: string | null; salaryReturned: boolean; offerSentAt: string | null; onboardDate: string | null; oralResult: string | null; writtenResult: string | null }
type Reason = { id: string; type: string; label: string }
type Material = { id: string; fileName: string; category: string; expiresAt: string }
const labels: Record<string,string> = { APPROVAL_MATERIALS:'录用审批资料', OA_APPROVAL:'OA 审批中', ORAL_OFFER:'口头 Offer', BACKGROUND_MATERIALS:'背调信息整理中', BACKGROUND_APPROVAL:'背调审批', WRITTEN_OFFER:'书面 Offer' }
const statuses: Record<string,string> = { PENDING:'待处理', ACCEPTED:'接受 / 通过', NOT_PASSED:'不通过' }
const oaStatuses: Record<string,string> = { SUBMITTING:'发起中', NEW:'待审批', RUNNING:'审批中', COMPLETED:'已完成', TERMINATED:'已终止' }
const oaResults: Record<string,string> = { agree:'同意', refuse:'拒绝' }
export function OfferPanel({ candidateId, onChanged }: { candidateId: string; onChanged: () => void }) {
  const base = `/v1/candidates/${encodeURIComponent(candidateId)}/offer`
  const [offer, setOffer] = useState<Offer | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reasons, setReasons] = useState<Reason[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [initiator, setInitiator] = useState('COMPANY')
  const [reasonId, setReasonId] = useState('')
  const [reasonText, setReasonText] = useState('')
  const [level, setLevel] = useState('')
  const [oa, setOa] = useState('')
  const [onboard, setOnboard] = useState('')
  const [category, setCategory] = useState('BACKGROUND_MATERIALS')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const loadOffer = useCallback(async (isActive?: () => boolean) => {
    const { offer: value } = await request<{ offer: Offer | null }>(base)
    if (isActive && !isActive()) return
    setOffer(value)
    if (value) {
      setLevel(value.hireLevel || ''); setOa(value.oaApprovalId || '')
      setOnboard(value.onboardDate ? value.onboardDate.slice(0,10) : '')
      const nextMaterials = await request<Material[]>(`${base}/materials`)
      if (isActive && !isActive()) return
      setMaterials(nextMaterials)
    } else {
      setLevel(''); setOa(''); setOnboard(''); setMaterials([])
    }
  }, [base])
  const refresh = useCallback(() => loadOffer(), [loadOffer])
  useEffect(() => {
    let active = true
    const isActive = () => active
    setLoading(true); setError(''); setPreview(null); setOffer(null); setMaterials([])
    loadOffer(isActive)
      .catch((e: unknown) => { if (active) setError(e instanceof Error ? e.message : '加载失败') })
      .finally(() => { if (active) setLoading(false) })
    request<Reason[]>('/v1/offer-reasons')
      .then((rows) => { if (active) setReasons(rows) })
      .catch(() => { if (active) setReasons([]) })
    return () => { active = false }
  }, [loadOffer])
  useEffect(() => { setInitiator('COMPANY'); setReasonId(''); setReasonText('') }, [offer?.workflowStage])
  const act = async (action: string, payload: Record<string,unknown> = {}) => {
    setBusy(true); setError('')
    try { await request(base, { method: action === 'CREATE' ? 'POST' : 'PATCH', body: action === 'CREATE' ? undefined : JSON.stringify({ action, version: offer?.workflowVersion, ...payload }) }); await refresh(); onChanged() }
    catch (e) { setError(e instanceof Error ? e.message : '操作失败') } finally { setBusy(false) }
  }
  const showPreview = async () => { try { setPreview(await request(`${base}/preview`)) } catch(e) { setError(e instanceof Error ? e.message : '预览失败') } }
  const submitOa = async () => {
    setBusy(true); setError('')
    try { await submitOfferOa(candidateId); await refresh(); onChanged() }
    catch (e) { setError(e instanceof Error ? e.message : '发起 OA 审批失败') }
    finally { setBusy(false) }
  }
  const refreshOa = async () => {
    setBusy(true); setError('')
    try { await refreshOfferOa(candidateId); await refresh() }
    catch (e) { setError(e instanceof Error ? e.message : '刷新 OA 状态失败') }
    finally { setBusy(false) }
  }
  const sendFile = async () => { if (!file) return; setBusy(true); try { await uploadOfferMaterial(candidateId, category, file); setFile(null); await refresh() } catch(e) { setError(e instanceof Error ? e.message : '上传失败') } finally { setBusy(false) } }
  const openFile = async (id: string) => { try { const signed = await request<{url:string}>(`${base}/materials/${encodeURIComponent(id)}/read-url`); window.open(signed.url, '_blank', 'noopener,noreferrer') } catch(e) { setError(e instanceof Error ? e.message : '读取失败') } }
  if (loading) return <section className="drawer-section"><div className="drawer-section-title"><h3>Offer 协同</h3></div><div className="empty-inline">正在加载 Offer…</div></section>
  if (!offer) return <section className="drawer-section"><div className="drawer-section-title"><h3>Offer 协同</h3></div>{error && <p className="form-error" role="alert">{error}</p>}<div className="button-row"><button className="button button-secondary button-sm" disabled={busy || !!error} onClick={() => void act('CREATE')}>开始 Offer</button></div></section>
  const stage = offer.workflowStage || ''
  const options = reasons.filter(r => r.type === (initiator === 'COMPANY' ? 'ARCHIVE' : 'OFFER_REJECT'))
  return <section className="drawer-section"><div className="drawer-section-title"><h3>Offer 协同</h3>{stage && <span className="status-chip status-on">{labels[stage] || stage} · {statuses[offer.stageStatus || ''] || offer.stageStatus}</span>}</div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {!stage ? <div className="offer-summary-box"><p>旧记录不能自动映射。核对后将从录用审批资料重新记录；原结果与发送、入职时间会保留在时间线。</p><div className="button-row"><button className="button button-secondary button-sm" disabled={busy} onClick={() => { if (window.confirm('确认已核对旧记录，并从录用审批资料重新开始？')) void act('RECONCILE', { confirmLegacy: true }) }}>核对旧记录并重新开始</button></div></div> : <div style={{ display: 'grid', gap: 12 }}>
      <div className="offer-summary-box">
        <p>口头结果：{offer.oralResult || '未记录'}；书面发送：{offer.offerSentAt ? new Date(offer.offerSentAt).toLocaleString() : '未发送'}；书面结果：{offer.writtenResult || '未记录'}</p>
        <p>OA 审批：{offer.oaInstanceId
          ? `系统发起 · ${oaStatuses[offer.oaInstanceStatus ?? ''] ?? offer.oaInstanceStatus}${offer.oaInstanceResult ? ` · 结论 ${oaResults[offer.oaInstanceResult] ?? offer.oaInstanceResult}` : ''}${offer.oaSyncedAt ? ` · 同步于 ${new Date(offer.oaSyncedAt).toLocaleString()}` : ''}`
          : offer.oaApprovalId ? '人工回填单号（无系统发起实例）' : '未发起'}</p>
      </div>
      <div className="form-grid"><label className="form-field"><span>录用职级</span><input value={level} onChange={e => setLevel(e.target.value)} /></label><label className="form-field"><span>OA 单号</span><input value={oa} onChange={e => setOa(e.target.value)} disabled={!!offer.oaInstanceId} />{offer.oaInstanceId && <small>系统发起后不可手改</small>}</label>{stage === 'WRITTEN_OFFER' && <label className="form-field"><span>入职日期</span><input type="date" value={onboard} onChange={e => setOnboard(e.target.value)} /></label>}</div>
      <div className="button-row"><button className="button button-primary button-sm" disabled={busy} onClick={() => void act('DETAILS', { ...(level.trim() && { hireLevel: level }), ...(oa.trim() && !offer.oaInstanceId && { oaApprovalId: oa }), ...(onboard && stage === 'WRITTEN_OFFER' && { onboardDate: onboard }) })}>保存资料</button><button className="button button-secondary button-sm" disabled={busy} onClick={() => void act('DETAILS', { salaryReturned: !offer.salaryReturned })}>薪资{offer.salaryReturned ? '已返回' : '未返回'}（切换）</button><button className="button button-secondary button-sm" onClick={() => void showPreview()}>预览 OA 材料</button>{['APPROVAL_MATERIALS','OA_APPROVAL'].includes(stage) && offer.stageStatus === 'PENDING' && !offer.oaInstanceId && <button className="button button-primary button-sm" disabled={busy || !offer.hireLevel?.trim()} title={!offer.hireLevel?.trim() ? '请先保存录用职级' : undefined} onClick={() => void submitOa()}>发起 OA 审批</button>}{offer.oaInstanceId && <button className="button button-secondary button-sm" disabled={busy} onClick={() => void refreshOa()}>刷新 OA 状态</button>}</div>
      {preview != null && <pre style={{whiteSpace:'pre-wrap', overflowWrap:'anywhere', padding: 10, borderRadius: 8, background: '#f8f9fc', fontSize: 11}}>{JSON.stringify(preview, null, 2)}</pre>}
      {stage === 'WRITTEN_OFFER' && !offer.offerSentAt && <div className="button-row"><button className="button button-secondary button-sm" disabled={busy} onClick={() => void act('DETAILS', { markSent: true })}>标记书面 Offer 已发送</button></div>}
      {offer.stageStatus === 'PENDING' && <div className="candidate-screening-form" style={{ marginTop: 4 }}><div className="form-grid"><label className="form-field"><span>不通过发起方</span><select value={initiator} onChange={e => { setInitiator(e.target.value); setReasonId('') }}><option value="COMPANY">企业</option>{['ORAL_OFFER','WRITTEN_OFFER'].includes(stage) && <option value="CANDIDATE">候选人拒绝</option>}</select></label><label className="form-field"><span>原因</span><select value={reasonId} onChange={e => setReasonId(e.target.value)}><option value="">请选择</option>{options.map(r => <option value={r.id} key={r.id}>{r.label}</option>)}</select></label></div><label className="form-field"><span>补充说明</span><input value={reasonText} onChange={e => setReasonText(e.target.value)} /></label><div className="button-row"><button className="button button-primary button-sm" disabled={busy} onClick={() => void act('ACCEPT')}>记录接受 / 通过</button><button className="button button-secondary button-sm" disabled={busy || !reasonId} onClick={() => void act('FAIL', { initiator, reasonId, reasonText })}>记录不通过并归档</button></div></div>}
      {offer.stageStatus === 'ACCEPTED' && <div className="button-row"><button className="button button-primary button-sm" disabled={busy} onClick={() => void act(stage === 'WRITTEN_OFFER' ? 'ONBOARD' : 'ADVANCE')}>{stage === 'WRITTEN_OFFER' ? '推进待入职' : '推进下一阶段'}</button></div>}
      {['BACKGROUND_MATERIALS','BACKGROUND_APPROVAL','WRITTEN_OFFER'].includes(stage) && <div className="offer-materials-box"><h4>背调材料</h4>{materials.map(m => <p key={m.id}><button className="text-button" onClick={() => void openFile(m.id)}>{m.fileName}</button> <span className="hint">· {m.category === 'BANK_STATEMENTS' ? '银行流水' : '背调材料'}</span></p>)}{stage !== 'WRITTEN_OFFER' && <div className="button-row"><select className="admin-select" value={category} onChange={e => setCategory(e.target.value)}><option value="BACKGROUND_MATERIALS">背调材料</option><option value="BANK_STATEMENTS">银行流水</option></select><label className="file-picker"><input type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp,.mp4" onChange={e => setFile(e.target.files?.[0] || null)} /><span className="file-picker-btn">选择文件</span><span className={cn('file-picker-name', !file && 'empty')}>{file ? file.name : '未选择文件'}</span></label><button className="button button-secondary button-sm" disabled={busy || !file} onClick={() => void sendFile()}>上传</button></div>}</div>}
    </div>}
  </section>
}

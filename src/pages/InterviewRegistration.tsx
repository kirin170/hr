import { useEffect, useState } from 'react'
import { request } from '../api'
type Field = { key: string; label: string; type: string; required: boolean; options: string[] }
export function InterviewRegistration() {
  const [token] = useState(() => window.location.hash.slice(1)); const [fields, setFields] = useState<Field[]>([]); const [values, setValues] = useState<Record<string,string>>({}); const [error, setError] = useState(''); const [done, setDone] = useState(false)
  useEffect(() => { window.history.replaceState({}, '', window.location.pathname); request<{fields: Field[]}>('/interview-registration/open', {method:'POST', body:JSON.stringify({token})}).then(r => setFields(r.fields)).catch(e => setError(e.message)) }, [token])
  const submit = async () => { try { await request('/interview-registration/submit', {method:'POST',body:JSON.stringify({token, values})}); setDone(true) } catch(e) { setError(e instanceof Error ? e.message : '提交失败') } }
  return <main style={{maxWidth:640,margin:'40px auto',padding:24}}><h2>面试登记表</h2>{error && <p role="alert">{error}</p>}{done ? <p>登记表已提交，谢谢。</p> : <>{fields.map(f => <label className="form-field" key={f.key}>{f.label}{f.required && ' *'}{f.type === 'select' ? <select value={values[f.key] || ''} onChange={e => setValues({...values,[f.key]:e.target.value})}><option value="">请选择</option>{f.options.map(o => <option key={o}>{o}</option>)}</select> : <input value={values[f.key] || ''} onChange={e => setValues({...values,[f.key]:e.target.value})} />}</label>)}{fields.length > 0 && <button className="button button-primary" onClick={submit}>提交</button>}</>}</main>
}

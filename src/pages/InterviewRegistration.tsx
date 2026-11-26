import { useEffect, useState } from 'react'
import { openInterviewRegistration, submitInterviewRegistration, type RegistrationField } from '../api'

export function InterviewRegistration() {
  const [token] = useState(() => window.location.hash.slice(1))
  const [fields, setFields] = useState<RegistrationField[]>([])
  const [values, setValues] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    window.history.replaceState({}, '', window.location.pathname)
    let active = true
    openInterviewRegistration(token)
      .then((r) => { if (active) setFields(r.fields) })
      .catch((e: unknown) => { if (active) setError(e instanceof Error ? e.message : '加载失败') })
    return () => { active = false }
  }, [token])

  const submit = async () => {
    if (submitting) return
    setSubmitting(true)
    setError('')
    try {
      await submitInterviewRegistration(token, values)
      setDone(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : '提交失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main style={{ maxWidth: 640, margin: '40px auto', padding: 24 }}>
      <h2>面试登记表</h2>
      {error && <p role="alert">{error}</p>}
      {done ? (
        <p>登记表已提交，谢谢。</p>
      ) : (
        <>
          {fields.map((f) => (
            <label className="form-field" key={f.key}>
              {f.label}
              {f.required && ' *'}
              {f.type === 'select' ? (
                <select
                  value={values[f.key] || ''}
                  onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                >
                  <option value="">请选择</option>
                  {f.options.map((o) => <option key={o}>{o}</option>)}
                </select>
              ) : (
                <input
                  value={values[f.key] || ''}
                  onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                />
              )}
            </label>
          ))}
          {fields.length > 0 && (
            <button className="button button-primary" disabled={submitting} onClick={() => void submit()}>
              {submitting ? '提交中…' : '提交'}
            </button>
          )}
        </>
      )}
    </main>
  )
}

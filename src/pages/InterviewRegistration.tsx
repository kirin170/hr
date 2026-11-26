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
      .then((r) => {
        if (active) setFields(r.fields)
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : '加载失败')
      })
    return () => {
      active = false
    }
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
    <main className="registration-portal">
      <section className="panel registration-card">
        <div className="panel-header">
          <div>
            <h3>面试登记表</h3>
            <p>带 * 为必填项，提交后将自动关联本场面试记录。</p>
          </div>
        </div>
        <div className="registration-body">
          {error && <p className="form-error" role="alert">{error}</p>}
          {done ? (
            <div className="empty-state">
              <h4>登记表已提交</h4>
              <p>感谢填写，面试官将同步收到您的信息。</p>
            </div>
          ) : (
            <>
              {fields.map((f) => (
                <label className="form-field" key={f.key}>
                  <span>{f.label}{f.required && <em>*</em>}</span>
                  {f.type === 'select' ? (
                    <select
                      value={values[f.key] || ''}
                      onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                    >
                      <option value="">请选择</option>
                      {f.options.map((o) => <option key={o}>{o}</option>)}
                    </select>
                  ) : f.type === 'textarea' ? (
                    <textarea
                      rows={3}
                      value={values[f.key] || ''}
                      onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                    />
                  ) : (
                    <input
                      value={values[f.key] || ''}
                      onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                    />
                  )}
                </label>
              ))}
              {fields.length > 0 && (
                <div className="button-row">
                  <button className="button button-primary" disabled={submitting} onClick={() => void submit()}>
                    {submitting ? '提交中…' : '提交登记表'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </main>
  )
}

import { useState, type FormEvent } from 'react'
import { ArrowRight, ShieldCheck } from 'lucide-react'
import { loginLocal, startDingTalkLogin } from './api'

type DingTalkLoginProps = {
  onAuthenticated: () => void
}

export function DingTalkLogin({ onAuthenticated }: DingTalkLoginProps) {
  const isLocalPreview = import.meta.env.DEV
  const [identifier, setIdentifier] = useState(isLocalPreview ? 'admin' : '')
  const [secret, setSecret] = useState(isLocalPreview ? 'admin' : '')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleLocalLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await loginLocal(identifier.trim(), secret)
      onAuthenticated()
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : '登录失败，请重试。')
    } finally {
      setSubmitting(false)
    }
  }

  return <main className="dingtalk-login">
    <section className="dingtalk-login-card">
      <div className="dingtalk-login-mark"><ShieldCheck size={24} /></div>
      <p className="dingtalk-login-eyebrow">TalentFlow</p>
      <p className="dingtalk-login-subtitle">招聘管理系统</p>
      <h1>{isLocalPreview ? '账号密码登录' : '使用钉钉登录'}</h1>
      {isLocalPreview ? <>
        <p className="dingtalk-login-copy">本机开发环境可使用预填的管理员账号登录，也可使用企业钉钉账号授权。</p>
        <form className="local-login-form" onSubmit={handleLocalLogin}>
          <label>
            账号
            <input
              autoComplete="username"
              autoFocus
              required
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
            />
          </label>
          <label>
            密码
            <input
              autoComplete="current-password"
              required
              type="password"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
            />
          </label>
          {error && <p className="local-login-error" role="alert">{error}</p>}
          <button className="button button-primary local-login-submit" disabled={submitting} type="submit">
            {submitting ? '正在登录…' : '登录预览系统'} <ArrowRight size={16} />
          </button>
        </form>
        <p className="dingtalk-login-divider"><span>企业账号</span></p>
      </> : <p className="dingtalk-login-copy">使用企业组织身份访问招聘工作台。登录后，系统按你当前的组织和角色确定数据范围。</p>}
      <button className={`button ${isLocalPreview ? 'button-secondary' : 'button-primary'} dingtalk-login-button`} onClick={startDingTalkLogin}>
        前往钉钉授权 <ArrowRight size={16} />
      </button>
      <p className="dingtalk-login-footnote">{isLocalPreview
        ? '本地管理员账号需要先初始化开发数据库；钉钉登录需配置企业应用凭据。'
        : '仅接受已同步并完成 ATS 身份映射的企业账号。'}</p>
    </section>
  </main>
}

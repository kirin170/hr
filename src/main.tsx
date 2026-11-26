import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { refreshAccessToken, getAccessToken, setAccessToken } from './api'
import { DingTalkLogin } from './DingTalkLogin'
import { InterviewRegistration } from './pages/InterviewRegistration'
import { CampusPortal } from './pages/CampusPortal'
import './styles.css'

function Root() {
  const [authenticated, setAuthenticated] = useState(Boolean(getAccessToken()))
  const [path] = useState(window.location.pathname)

  useEffect(() => {
    const requireLogin = () => setAuthenticated(false)
    window.addEventListener('talentflow-auth-required', requireLogin)
    return () => window.removeEventListener('talentflow-auth-required', requireLogin)
  }, [])

  if (path.replace(/\/+$/, '') === '/registration') return <InterviewRegistration />

  // 校招投递门户为公开页面，不要求登录
  if (path.replace(/\/+$/, '') === '/campus') {
    return <CampusPortal />
  }

  return authenticated ? <App /> : <DingTalkLogin onAuthenticated={() => setAuthenticated(true)} />
}

async function bootstrap() {
  const url = new URL(window.location.href)
  const cleanPath = url.pathname.replace(/\/+$/, '')
  const isPublicPage = cleanPath === '/registration' || cleanPath === '/campus'
  if (url.searchParams.get('dingtalk_login') === 'success') {
    url.searchParams.delete('dingtalk_login')
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
    setAccessToken(null)
    await refreshAccessToken()
  } else if (!isPublicPage && !getAccessToken()) {
    // 兼容钉钉 SSO 默认跳转 '/' 或已有 HttpOnly 刷新 Cookie 的会话恢复
    await refreshAccessToken()
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <Root />
    </React.StrictMode>,
  )
}

void bootstrap()

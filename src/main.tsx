import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { refreshAccessToken, getAccessToken, setAccessToken } from './api'
import { DingTalkLogin } from './DingTalkLogin'
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

  // 校招投递门户为公开页面，不要求登录
  if (path.replace(/\/+$/, '') === '/campus') {
    return <CampusPortal />
  }

  return authenticated ? <App /> : <DingTalkLogin onAuthenticated={() => setAuthenticated(true)} />
}

async function bootstrap() {
  const url = new URL(window.location.href)
  if (url.searchParams.get('dingtalk_login') === 'success') {
    url.searchParams.delete('dingtalk_login')
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
    setAccessToken(null)
    await refreshAccessToken()
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <Root />
    </React.StrictMode>,
  )
}

void bootstrap()

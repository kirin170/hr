import { useCallback, useEffect, useState } from 'react'
import { Activity, KeyRound, Mail, RefreshCw, Trash2 } from 'lucide-react'
import * as api from '../../api'
import { useApp } from '../../context'
import type { OperationsSnapshot } from '../../types'
import { cn } from '../../utils'
import { msg, statusLabel } from './shared'

type OpsTab = 'overview' | 'mail' | 'tokens' | 'retention'

export function AdminOpsPage() {
  const { toast } = useApp()
  const [tab, setTab] = useState<OpsTab>('overview')
  const [snapshot, setSnapshot] = useState<OperationsSnapshot | null>(null)
  const [policy, setPolicy] = useState<{ resumeDays: number; sensitiveDays: number; batchSize: number; note: string } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [revokeId, setRevokeId] = useState('')
  const [draft, setDraft] = useState({ address: '', provider: 'IMAP', host: '', port: '993', username: '', password: '' })

  const load = useCallback(async () => {
    const [nextSnapshot, nextPolicy] = await Promise.all([
      api.getOperationsSnapshot(),
      api.getRetentionPolicy().catch(() => null),
    ])
    setSnapshot(nextSnapshot)
    setPolicy(nextPolicy)
  }, [])

  useEffect(() => {
    let active = true
    void load().catch((err: unknown) => { if (active) setError(msg(err)) })
    return () => { active = false }
  }, [load])

  const run = async (key: string, action: () => Promise<unknown>, success: string): Promise<boolean> => {
    setBusy(key)
    setError('')
    try {
      await action()
      await load()
      toast(success)
      return true
    } catch (err) {
      const message = msg(err)
      setError(message)
      toast(message, 'info')
      return false
    } finally {
      setBusy('')
    }
  }

  const failedCount = snapshot
    ? snapshot.tasks.intakeFailures.length + snapshot.tasks.aiFailures.length + snapshot.tasks.browserImportFailures.length
    : 0
  const aiStatus = snapshot
    ? Object.entries(snapshot.tasks.aiByStatus).map(([status, count]) => `${status} ${count}`).join(' · ')
    : ''

  return (
    <div className="page-stack">
      <div className="page-title-row">
        <div>
          <div className="eyebrow">系统管理 <span className="eyebrow-separator">·</span> 接入、监控与数据保留</div>
          <h2>集成与运维</h2>
          <p>查看外部集成与服务运行健康度，配置招聘邮箱、管理插件导入令牌并执行数据保留清理。</p>
        </div>
        <div className="page-title-actions">
          <button className="button button-secondary" onClick={() => void run('reload', load, '运行状态已刷新')}>
            <RefreshCw size={15} />刷新状态
          </button>
        </div>
      </div>

      <div className="stage-tabs stage-tabs-scroll">
        <button className={cn('stage-tab', tab === 'overview' && 'active')} onClick={() => setTab('overview')}>
          <Activity size={14} />服务状态与失败任务 {failedCount > 0 && <span>{failedCount}</span>}
        </button>
        <button className={cn('stage-tab', tab === 'mail' && 'active')} onClick={() => setTab('mail')}>
          <Mail size={14} />招聘邮箱
        </button>
        <button className={cn('stage-tab', tab === 'tokens' && 'active')} onClick={() => setTab('tokens')}>
          <KeyRound size={14} />插件导入令牌
        </button>
        <button className={cn('stage-tab', tab === 'retention' && 'active')} onClick={() => setTab('retention')}>
          <Trash2 size={14} />数据保留与清理
        </button>
      </div>

      {error && <div className="admin-error" role="alert">{error}</div>}
      {!snapshot && !error && <div className="panel empty-state">正在加载运维数据…</div>}

      {snapshot && tab === 'overview' && (
        <div className="page-stack">
          <section className="panel admin-section">
            <div className="panel-header">
              <div>
                <h3>集成配置状态</h3>
                <p className="hint">凭据维护沿用各领域接口，本页不展示任何密钥或明文凭据。</p>
              </div>
            </div>
            <div className="admin-cards">
              {snapshot.integrations.map((item) => (
                <div className="admin-card" key={item.key}>
                  <div className="admin-card-head">
                    <strong>{item.name}</strong>
                    <span className={cn('status-chip', item.status === 'READY' ? 'status-on' : item.status === 'NOT_CONFIGURED' ? 'status-err' : 'status-warn')}>{statusLabel(item.status)}</span>
                  </div>
                  <p>{item.detail}</p>
                  {item.permission && <small>需要权限：{item.permission}</small>}
                </div>
              ))}
            </div>
          </section>

          <section className="panel admin-section">
            <div className="panel-header">
              <div>
                <h3>核心服务与任务队列</h3>
                <p className="hint">生成于 {snapshot.generatedAt.slice(0, 19).replace('T', ' ')}</p>
              </div>
            </div>
            <div className="admin-cards">
              {Object.values(snapshot.services).map((service) => (
                <div className="admin-card" key={service.name}>
                  <div className="admin-card-head">
                    <strong>{service.name}</strong>
                    <span className={cn('status-chip', service.status === 'UP' ? 'status-on' : service.status === 'DOWN' ? 'status-err' : 'status-warn')}>{statusLabel(service.status)}</span>
                  </div>
                  <p>{service.detail}</p>
                </div>
              ))}
              <div className="admin-card">
                <div className="admin-card-head"><strong>AI 任务</strong><span className="status-chip status-off">近 24h</span></div>
                <p>{aiStatus || '暂无任务'}</p>
              </div>
              <div className="admin-card">
                <div className="admin-card-head"><strong>通知通道</strong><span className={cn('status-chip', snapshot.notifications.integrated ? 'status-on' : 'status-warn')}>{snapshot.notifications.channel}</span></div>
                <p>已登记 {snapshot.notifications.events.length} 个通知事件</p>
              </div>
            </div>
          </section>

          <section className="panel admin-section">
            <div className="panel-header">
              <div>
                <h3>失败任务</h3>
                <p className="hint">只显示任务标识、错误码与脱敏错误信息。</p>
              </div>
            </div>
            <table className="admin-table">
              <thead><tr><th>类别</th><th>标识</th><th>错误信息</th><th>时间</th><th>操作</th></tr></thead>
              <tbody>
                {snapshot.tasks.intakeFailures.map((task) => (
                  <tr key={`intake-${task.id}`}>
                    <td>简历解析 · {task.source}</td>
                    <td><small className="mono-cell">{task.id}</small></td>
                    <td className="admin-note">{task.errorCode || '—'} {task.errorMessage || ''}</td>
                    <td>{task.createdAt ? task.createdAt.slice(0, 16).replace('T', ' ') : '—'}</td>
                    <td><button className="text-button" disabled={!task.retryable || busy === task.id} onClick={() => { void run(task.id, () => api.retryIntake(task.id), '已重新投递解析') }}>重试</button></td>
                  </tr>
                ))}
                {snapshot.tasks.aiFailures.map((aiRun) => (
                  <tr key={`ai-${aiRun.id}`}>
                    <td>AI · {aiRun.type}</td>
                    <td><small className="mono-cell">{aiRun.id}</small></td>
                    <td className="admin-note">{aiRun.errorCode || '—'} {aiRun.errorMessage || ''}</td>
                    <td>{aiRun.updatedAt ? aiRun.updatedAt.slice(0, 16).replace('T', ' ') : '—'}</td>
                    <td className="admin-note">需在简历入场重新解析</td>
                  </tr>
                ))}
                {snapshot.tasks.browserImportFailures.map((task) => (
                  <tr key={`browser-${task.taskId}`}>
                    <td>插件导入</td>
                    <td><small className="mono-cell">{task.taskId}</small></td>
                    <td className="admin-note">{task.errorStage || '—'} {task.errorCode || '—'} {task.errorMessage || ''}</td>
                    <td>{task.createdAt ? task.createdAt.slice(0, 16).replace('T', ' ') : '—'}</td>
                    <td className="admin-note">需插件侧重新导入</td>
                  </tr>
                ))}
                {failedCount === 0 && <tr><td colSpan={5} className="empty-inline">暂无失败任务</td></tr>}
              </tbody>
            </table>
          </section>
        </div>
      )}

      {snapshot && tab === 'mail' && (
        <section className="panel admin-section">
          <div className="panel-header">
            <div>
              <h3>招聘邮箱配置</h3>
              <p className="hint">监控视图中的邮箱地址已脱敏；新增后可用「测试连接」验证凭据。</p>
            </div>
          </div>
          <table className="admin-table">
            <thead><tr><th>邮箱</th><th>协议</th><th>状态</th><th>最近抓取</th><th>操作</th></tr></thead>
            <tbody>
              {snapshot.mail.mailboxes.map((mailbox) => (
                <tr key={mailbox.id}>
                  <td><strong>{mailbox.address}</strong>{mailbox.lastError && <small className="admin-danger">{mailbox.lastError}</small>}</td>
                  <td>{mailbox.provider}</td>
                  <td><span className={cn('status-chip', mailbox.active ? 'status-on' : 'status-off')}>{mailbox.active ? '启用' : '停用'}</span></td>
                  <td>{mailbox.lastPolledAt ? `${mailbox.lastPolledAt.slice(0, 16).replace('T', ' ')}（${mailbox.lastPollStatus || '未知'}）` : '尚未抓取'}</td>
                  <td>
                    <button className="text-button" disabled={busy === `test-${mailbox.id}`} onClick={() => { void run(`test-${mailbox.id}`, () => api.testMailboxConfig(mailbox.id), '连接测试已执行') }}>测试连接</button>
                    <button className="text-button" style={{ marginLeft: 10 }} disabled={busy === `poll-${mailbox.id}`} onClick={() => { void run(`poll-${mailbox.id}`, () => api.pollMailboxConfig(mailbox.id), '已触发抓取') }}>立即抓取</button>
                  </td>
                </tr>
              ))}
              {snapshot.mail.mailboxes.length === 0 && <tr><td colSpan={5} className="empty-inline">尚未配置招聘邮箱</td></tr>}
            </tbody>
          </table>
          <div className="admin-inline-form">
            <input className="admin-input" placeholder="邮箱地址" value={draft.address} onChange={(event) => setDraft({ ...draft, address: event.target.value })} />
            <select className="admin-select" value={draft.provider} onChange={(event) => setDraft({ ...draft, provider: event.target.value })}>
              <option value="IMAP">IMAP</option>
              <option value="MOCK">MOCK</option>
            </select>
            <input className="admin-input admin-input-sm" placeholder="主机" value={draft.host} onChange={(event) => setDraft({ ...draft, host: event.target.value })} />
            <input className="admin-input admin-input-sm" placeholder="端口" value={draft.port} onChange={(event) => setDraft({ ...draft, port: event.target.value })} />
            <input className="admin-input admin-input-sm" placeholder="账号" value={draft.username} onChange={(event) => setDraft({ ...draft, username: event.target.value })} />
            <input className="admin-input admin-input-sm" placeholder="授权码" type="password" value={draft.password} onChange={(event) => setDraft({ ...draft, password: event.target.value })} />
            <button className="button button-primary button-sm" disabled={!draft.address.trim() || busy === 'mailbox-create'} onClick={() => {
              const payload = {
                address: draft.address.trim(),
                provider: draft.provider,
                host: draft.host.trim() || undefined,
                port: draft.port.trim() ? Number(draft.port) : undefined,
                username: draft.username.trim() || undefined,
                password: draft.password || undefined,
              }
              void run('mailbox-create', () => api.createMailboxConfig(payload), '邮箱已新增')
                .then((ok) => { if (ok) setDraft((prev) => ({ ...prev, address: '', host: '', username: '', password: '' })) })
            }}>新增邮箱</button>
          </div>
        </section>
      )}

      {snapshot && tab === 'tokens' && (
        <section className="panel admin-section">
          <div className="panel-header">
            <div>
              <h3>浏览器插件导入令牌</h3>
              <p className="hint">当前有效令牌 {snapshot.tokens.active} 个；吊销后立即失效，仅本人或授权管理员可执行。</p>
            </div>
          </div>
          <div className="admin-inline-form">
            <input className="admin-input" placeholder="操作者用户 ID" value={revokeId} onChange={(event) => setRevokeId(event.target.value)} />
            <button className="button button-secondary button-sm" disabled={!revokeId.trim() || busy === 'revoke'} onClick={() => {
              const operatorId = revokeId.trim()
              void run('revoke', () => api.revokeBrowserImportTokens(operatorId), '该操作者的令牌已吊销')
                .then((ok) => { if (ok) setRevokeId('') })
            }}>吊销令牌</button>
          </div>
        </section>
      )}

      {snapshot && tab === 'retention' && (
        <div className="page-stack">
          <section className="panel admin-section">
            <div className="panel-header">
              <div>
                <h3>数据保留策略</h3>
                <p className="hint">{policy?.note || '保留期限由服务端环境变量配置'}</p>
              </div>
            </div>
            {policy && (
              <dl className="admin-kv">
                <div><dt>简历附件保留</dt><dd>{policy.resumeDays} 天</dd></div>
                <div><dt>敏感材料保留</dt><dd>{policy.sensitiveDays} 天</dd></div>
                <div><dt>单批清理上限</dt><dd>{policy.batchSize} 条</dd></div>
              </dl>
            )}
            <div className="admin-inline-form">
              <button className="button button-secondary button-sm" disabled={busy === 'purge-dry'} onClick={() => { void run('purge-dry', () => api.runRetentionPurge(true), '已试算到期数据') }}>试算到期数据</button>
              <button className="button button-primary button-sm" disabled={busy === 'purge'} onClick={() => {
                if (!window.confirm('确认执行到期清理？该操作会删除到期附件且不可恢复。')) return
                void run('purge', () => api.runRetentionPurge(false), '到期清理已执行')
              }}>执行清理</button>
            </div>
          </section>

          <section className="panel admin-section">
            <div className="panel-header">
              <div>
                <h3>保留清理历史记录</h3>
                <p className="hint">只显示计数与时间，不展示被清理的内容。</p>
              </div>
            </div>
            <table className="admin-table">
              <thead><tr><th>范围</th><th>截止</th><th>扫描 / 到期</th><th>删除文件 / 解绑</th><th>模式</th><th>执行时间</th></tr></thead>
              <tbody>
                {snapshot.tasks.retentionRuns.map((retentionRun) => (
                  <tr key={retentionRun.id}>
                    <td>{retentionRun.scope}</td>
                    <td>{retentionRun.cutoff ? retentionRun.cutoff.slice(0, 10) : '—'}</td>
                    <td>{retentionRun.scanned} / {retentionRun.expired}</td>
                    <td>{retentionRun.deletedFiles} / {retentionRun.detachedIntakes}{retentionRun.failedDeletes > 0 ? `（失败 ${retentionRun.failedDeletes}）` : ''}</td>
                    <td><span className={cn('status-chip', retentionRun.dryRun ? 'status-off' : 'status-on')}>{retentionRun.dryRun ? '试算' : '执行'}</span></td>
                    <td>{retentionRun.createdAt ? retentionRun.createdAt.slice(0, 16).replace('T', ' ') : '—'}</td>
                  </tr>
                ))}
                {snapshot.tasks.retentionRuns.length === 0 && <tr><td colSpan={6} className="empty-inline">暂无清理记录</td></tr>}
              </tbody>
            </table>
          </section>
        </div>
      )}
    </div>
  )
}

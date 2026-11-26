import { useCallback, useEffect, useRef, useState } from 'react'
import { Download } from 'lucide-react'
import * as api from '../../api'
import type { AuditLogRow } from '../../types'
import { cn } from '../../utils'
import { msg } from './shared'

export function AdminAuditPage() {
  const [filters, setFilters] = useState({ actorId: '', actionPrefix: '', resourceType: '', resourceId: '', from: '', to: '' })
  const [rows, setRows] = useState<AuditLogRow[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const reqIdRef = useRef(0)

  const buildQuery = useCallback((f: typeof filters) => ({
    actorId: f.actorId.trim() || undefined,
    actionPrefix: f.actionPrefix.trim() || undefined,
    resourceType: f.resourceType.trim() || undefined,
    resourceId: f.resourceId.trim() || undefined,
    from: f.from ? new Date(`${f.from}T00:00:00+08:00`).toISOString() : undefined,
    to: f.to ? new Date(`${f.to}T23:59:59.999+08:00`).toISOString() : undefined,
    limit: 200,
  }), [])

  const load = useCallback(async (f: typeof filters) => {
    const reqId = ++reqIdRef.current
    setLoading(true)
    try {
      const nextRows = await api.listAuditLogs(buildQuery(f))
      if (reqId !== reqIdRef.current) return
      setRows(nextRows)
      setError('')
    } catch (err) {
      if (reqId !== reqIdRef.current) return
      setError(msg(err))
    } finally {
      if (reqId === reqIdRef.current) setLoading(false)
    }
  }, [buildQuery])

  useEffect(() => {
    void load({ actorId: '', actionPrefix: '', resourceType: '', resourceId: '', from: '', to: '' })
    return () => { reqIdRef.current += 1 }
  }, [load])

  return (
    <div className="page-stack">
      <div className="page-title-row">
        <div>
          <div className="eyebrow">系统管理 <span className="eyebrow-separator">·</span> 安全审计与追溯</div>
          <h2>操作审计</h2>
          <p>按操作人、动作前缀、对象类型与北京时间日期检索操作记录；内容已脱敏，不含凭据与密钥。</p>
        </div>
        <div className="page-title-actions">
          <button
            className="button button-secondary"
            onClick={() => { void api.exportAuditLogs(buildQuery(filters)).catch((err: unknown) => setError(msg(err))) }}
          >
            <Download size={15} />导出 CSV
          </button>
        </div>
      </div>

      <section className="panel admin-section">
        <form className="admin-filters" style={{ marginTop: 0 }} onSubmit={(event) => { event.preventDefault(); void load(filters) }}>
          <input className="admin-input" placeholder="操作者 ID" value={filters.actorId} onChange={(event) => setFilters({ ...filters, actorId: event.target.value })} />
          <input className="admin-input" placeholder="动作前缀，如 settings." value={filters.actionPrefix} onChange={(event) => setFilters({ ...filters, actionPrefix: event.target.value })} />
          <input className="admin-input" placeholder="对象类型" value={filters.resourceType} onChange={(event) => setFilters({ ...filters, resourceType: event.target.value })} />
          <input className="admin-input" placeholder="对象 ID" value={filters.resourceId} onChange={(event) => setFilters({ ...filters, resourceId: event.target.value })} />
          <input className="admin-input" type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} />
          <input className="admin-input" type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} />
          <button type="submit" className="button button-primary button-sm" disabled={loading}>{loading ? '查询中…' : '查询'}</button>
        </form>

        {error && <p className="form-error">{error}</p>}

        <table className="admin-table">
          <thead><tr><th>时间</th><th>操作者</th><th>动作</th><th>对象</th><th>结果</th><th>来源 IP</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.createdAt.slice(0, 19).replace('T', ' ')}</td>
                <td>{row.actorName || row.actorId}</td>
                <td><small className="mono-cell">{row.action}</small></td>
                <td className="admin-note">{row.resourceType} · {row.resourceId}</td>
                <td><span className={cn('status-chip', row.outcome === 'FAILED' ? 'status-err' : 'status-on')}>{row.outcome || 'SUCCESS'}</span></td>
                <td><small>{row.ip || '—'}</small></td>
              </tr>
            ))}
            {rows.length === 0 && !loading && <tr><td colSpan={6} className="empty-inline">没有匹配的审计记录</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  )
}

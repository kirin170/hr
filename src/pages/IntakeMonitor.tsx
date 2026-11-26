import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Clock, Inbox, Mail, RefreshCw, Send, TriangleAlert, Users } from 'lucide-react'
import { getIntakeMonitor, retryIntake } from '../api'
import { useApp } from '../context'
import type { IntakeMonitor as MonitorData } from '../types'
import { cn } from '../utils'

const sourceLabel: Record<string, string> = {
  UPLOAD: '上传',
  JOB_BOARD: '招聘网站',
  CAMPUS: '校招',
  REFERRAL: '内推',
  EMAIL: '邮箱',
  MANUAL: '手工',
}

const entryModeLabel: Record<string, string> = {
  APPLICATION: '投递',
  EMAIL_AUTO: '邮箱自动',
  BATCH_UPLOAD: '批量上传',
  SINGLE_UPLOAD: '单个上传',
  MANUAL: '手工录入',
  BROWSER_EXTENSION: '插件导入',
  EXCEL_IMPORT: 'Excel 导入',
}

const statusLabel: Record<string, string> = {
  RECEIVED: '已接收',
  PARSING: '解析中',
  PARSED: '已解析',
  DUPLICATE: '查重',
  NEEDS_MANUAL: '待人工',
  FAILED: '失败',
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return '—'
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes < 60) return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分`
  const hours = Math.floor(minutes / 60)
  return `${hours} 小时 ${minutes % 60} 分`
}

const formatTime = (value: string | null) => {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', { hour12: false })
}

export function IntakeMonitor() {
  const { toast } = useApp()
  const [data, setData] = useState<MonitorData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState({ mailbox: '', source: '', entryMode: '', receivedFrom: '', receivedTo: '' })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await getIntakeMonitor({
        mailbox: filters.mailbox || undefined,
        source: filters.source || undefined,
        entryMode: filters.entryMode || undefined,
        receivedFrom: filters.receivedFrom || undefined,
        receivedTo: filters.receivedTo || undefined,
      })
      setData(result)
      setError(null)
    } catch (loadError) {
      setData(null)
      setError(loadError instanceof Error ? loadError.message : '监控数据加载失败')
    } finally {
      setLoading(false)
    }
  }, [filters])

  useEffect(() => {
    void load()
  }, [load])

  const retry = async (intakeId: string) => {
    try {
      await retryIntake(intakeId)
      toast('已重新提交解析')
      await load()
    } catch (retryError) {
      toast(retryError instanceof Error ? retryError.message : '重试失败', 'info')
    }
  }

  const totals = data?.totals
  const maxSource = Math.max(1, ...(data?.bySource.map((item) => item.count) ?? [0]))
  const maxEntry = Math.max(1, ...(data?.byEntryMode.map((item) => item.count) ?? [0]))

  return (
    <div className="page-stack">
      <div className="page-title-row">
        <div>
          <div className="eyebrow">简历入场 <span className="eyebrow-separator">·</span> 监控与失败归因</div>
          <h2>入场监控</h2>
          <p>按渠道、邮箱、接收时间观察进入/未进入、时延与去向；失败可重试，不重复建档。</p>
        </div>
        <div className="page-title-actions">
          <button className="button button-secondary" onClick={() => void load()}><RefreshCw size={16} />刷新</button>
        </div>
      </div>

      <div className="panel">
        <div className="filter-panel">
          <label className="form-field"><span>接收邮箱</span><input value={filters.mailbox} onChange={(event) => setFilters({ ...filters, mailbox: event.target.value })} placeholder="hr@example.com" /></label>
          <label className="form-field"><span>渠道</span>
            <select value={filters.source} onChange={(event) => setFilters({ ...filters, source: event.target.value })}>
              <option value="">全部渠道</option>
              {Object.entries(sourceLabel).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
          <label className="form-field"><span>进入方式</span>
            <select value={filters.entryMode} onChange={(event) => setFilters({ ...filters, entryMode: event.target.value })}>
              <option value="">全部方式</option>
              {Object.entries(entryModeLabel).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
          <label className="form-field"><span>接收起</span><input type="date" value={filters.receivedFrom} onChange={(event) => setFilters({ ...filters, receivedFrom: event.target.value })} /></label>
          <label className="form-field"><span>接收止</span><input type="date" value={filters.receivedTo} onChange={(event) => setFilters({ ...filters, receivedTo: event.target.value })} /></label>
        </div>

        {loading && <div className="empty-inline">正在加载监控数据…</div>}
        {error && <div className="empty-inline">加载失败：{error}</div>}

        {totals && (
          <div className="intake-monitor-metrics">
            <section className="metric-grid">
              <article className="metric-card metric-card-featured">
                <div className="metric-top"><span>入场记录</span><span className="metric-icon blue"><Inbox size={17} /></span></div>
                <div className="metric-value-row"><strong>{totals.total}</strong></div>
                <div className="metric-foot"><span>进入 {totals.entered} · 未进入 {totals.notEntered}</span></div>
              </article>
              <article className="metric-card">
                <div className="metric-top"><span>进入率</span><span className="metric-icon green"><Users size={17} /></span></div>
                <div className="metric-value-row"><strong>{(totals.enteredRate * 100).toFixed(1)}<span className="unit">%</span></strong></div>
                <div className="metric-foot"><span>按建档成功计算</span></div>
              </article>
              <article className="metric-card">
                <div className="metric-top"><span>待分配池</span><span className="metric-icon orange"><TriangleAlert size={17} /></span></div>
                <div className="metric-value-row"><strong>{totals.pool}</strong></div>
                <div className="metric-foot"><span>已分配 {totals.assigned}</span></div>
              </article>
              <article className="metric-card">
                <div className="metric-top"><span>平均接收时延</span><span className="metric-icon violet"><Clock size={17} /></span></div>
                <div className="metric-value-row"><strong>{formatDuration(totals.averageLatencySeconds)}</strong></div>
                <div className="metric-foot"><span>P90 {formatDuration(totals.p90LatencySeconds)} · 样本 {totals.latencySamples}</span></div>
              </article>
            </section>
          </div>
        )}
      </div>

      {data && (
        <div className="intake-monitor-grid">
          <div className="panel">
            <div className="panel-header"><div><h3><Mail size={15} />渠道与进入方式</h3><p>按来源与进入方式统计入场量。</p></div></div>
            <div className="intake-bars">
              {data.bySource.map((item) => (
                <div className="intake-bar-row" key={`source-${item.source}`}>
                  <span>{sourceLabel[item.source] ?? item.source}</span>
                  <div className="intake-bar-track"><div className="intake-bar-fill" style={{ width: `${(item.count / maxSource) * 100}%` }} /></div>
                  <strong>{item.count}</strong>
                </div>
              ))}
              {data.byEntryMode.map((item) => (
                <div className="intake-bar-row" key={`entry-${item.entryMode}`}>
                  <span>{entryModeLabel[item.entryMode] ?? item.entryMode}</span>
                  <div className="intake-bar-track"><div className={cn('intake-bar-fill', 'intake-bar-fill-alt')} style={{ width: `${(item.count / maxEntry) * 100}%` }} /></div>
                  <strong>{item.count}</strong>
                </div>
              ))}
              {data.bySource.length === 0 && data.byEntryMode.length === 0 && <div className="empty-inline">当前筛选条件下暂无数据</div>}
            </div>
          </div>

          <div className="panel">
            <div className="panel-header"><div><h3><Send size={15} />邮箱与去向</h3><p>邮箱渠道按接收邮箱统计，去向区分已分配与待分配。</p></div></div>
            <div className="intake-table-wrap">
              <table className="intake-table">
                <thead><tr><th>接收邮箱</th><th>入场数</th><th>最近接收</th></tr></thead>
                <tbody>
                  {data.byMailbox.map((item) => (
                    <tr key={item.mailbox}>
                      <td>{item.mailbox}</td>
                      <td>{item.count}</td>
                      <td>{formatTime(item.lastReceivedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.byMailbox.length === 0 && <div className="empty-inline">暂无邮箱渠道数据</div>}
            </div>
          </div>

          <div className="panel">
            <div className="panel-header"><div><h3><AlertTriangle size={15} />失败归因</h3><p>按错误码聚合，失败可重试或转人工。</p></div></div>
            <div className="intake-table-wrap">
              <table className="intake-table">
                <thead><tr><th>错误码</th><th>数量</th></tr></thead>
                <tbody>
                  {data.failureReasons.map((item) => (
                    <tr key={item.errorCode}><td>{item.errorCode}</td><td>{item.count}</td></tr>
                  ))}
                </tbody>
              </table>
              {data.failureReasons.length === 0 && <div className="empty-inline">暂无失败记录</div>}
            </div>
          </div>

          <div className="panel">
            <div className="panel-header"><div><h3><Clock size={15} />最近失败</h3><p>最近 10 条失败或待人工处理记录。</p></div></div>
            <div className="intake-table-wrap">
              <table className="intake-table">
                <thead><tr><th>记录</th><th>渠道</th><th>状态</th><th>时间</th><th /></tr></thead>
                <tbody>
                  {data.recentFailures.map((item) => (
                    <tr key={item.id}>
                      <td><span className="mono-cell">{item.id.slice(-8)}</span><small className="cell-sub">{item.errorCode ?? '—'}</small></td>
                      <td>{sourceLabel[item.source] ?? item.source}</td>
                      <td><span className="status-chip status-err">{statusLabel[item.status] ?? item.status}</span></td>
                      <td>{formatTime(item.createdAt)}</td>
                      <td><button className="text-button" onClick={() => void retry(item.id)}><RefreshCw size={14} />重试</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.recentFailures.length === 0 && <div className="empty-inline">暂无失败记录</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

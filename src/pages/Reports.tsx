import { useCallback, useEffect, useMemo, useState } from 'react'
import { BarChart3, ChevronDown, RefreshCw, X } from 'lucide-react'
import {
  getReportChannels,
  getReportCycles,
  getReportFilterOptions,
  getReportFunnel,
  getReportProbation,
  getReportReasons,
  type ReportChannels,
  type ReportCycles,
  type ReportFilterOptions,
  type ReportFilters,
  type ReportFunnel,
  type ReportProbation,
  type ReportReasons,
} from '../api'
import { cn } from '../utils'

type ReasonKey = 'ARCHIVE' | 'OFFER_REJECT' | 'ONBOARD_ABANDON'

const REASON_TABS: { key: ReasonKey; label: string }[] = [
  { key: 'ARCHIVE', label: '初筛/归档原因' },
  { key: 'OFFER_REJECT', label: 'Offer 拒绝原因' },
  { key: 'ONBOARD_ABANDON', label: '放弃入职原因' },
]

type Drill = { title: string; columns: string[]; rows: (string | number | null)[][] } | null

export function Reports() {
  const [filters, setFilters] = useState<ReportFilters>({})
  const [options, setOptions] = useState<ReportFilterOptions | null>(null)
  const [dimensions, setDimensions] = useState<string[]>(['department'])
  const [reasonType, setReasonType] = useState<ReasonKey>('ARCHIVE')
  const [funnel, setFunnel] = useState<ReportFunnel | null>(null)
  const [channels, setChannels] = useState<ReportChannels | null>(null)
  const [reasons, setReasons] = useState<ReportReasons | null>(null)
  const [probation, setProbation] = useState<ReportProbation | null>(null)
  const [cycles, setCycles] = useState<ReportCycles | null>(null)
  const [drill, setDrill] = useState<Drill>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    Promise.all([
      getReportFunnel(filters).catch(() => null),
      getReportChannels(filters).catch(() => null),
      getReportReasons(reasonType, filters).catch(() => null),
      getReportProbation(filters).catch(() => null),
      getReportCycles(filters, dimensions).catch(() => null),
    ])
      .then(([nextFunnel, nextChannels, nextReasons, nextProbation, nextCycles]) => {
        setFunnel(nextFunnel)
        setChannels(nextChannels)
        setReasons(nextReasons)
        setProbation(nextProbation)
        setCycles(nextCycles)
        if (!nextFunnel && !nextChannels && !nextCycles) setError('当前角色没有查看这些报表的权限，或后端未连接')
      })
      .finally(() => setLoading(false))
  }, [filters, dimensions, reasonType])

  useEffect(() => {
    getReportFilterOptions().then(setOptions).catch(() => setOptions(null))
  }, [])

  useEffect(load, [load])

  const maxFunnel = funnel?.stages[0]?.reached ?? 0
  const metrics = useMemo(
    () => [
      { label: '候选人总量', value: `${channels?.total ?? 0}` },
      { label: '进入面试', value: `${funnel?.stages.find((stage) => stage.key === 'INTERVIEWING')?.reached ?? 0}` },
      { label: '发出 Offer', value: `${funnel?.stages.find((stage) => stage.key === 'OFFERING')?.reached ?? 0}` },
      {
        label: '平均招聘周期',
        value: cycles?.eligible.average != null ? `${cycles.eligible.average} 天` : '—',
      },
      { label: '转正率', value: probation?.rate != null ? `${probation.rate}%` : '—' },
    ],
    [channels, funnel, cycles, probation],
  )

  const openFunnelDrill = (stage: string, label: string) => {
    getReportFunnel(filters, stage).then((result) => {
      setDrill({
        title: `漏斗下钻 · ${label}`,
        columns: ['候选人', '职位', '部门', '渠道', '阶段'],
        rows: (result.drill?.items ?? []).map((item) => [item.name, item.jobTitle, item.departmentName, item.channel, item.stage]),
      })
    })
  }

  const openChannelDrill = (key: string, label: string) => {
    getReportChannels(filters, key).then((result) => {
      setDrill({
        title: `渠道下钻 · ${label}`,
        columns: ['候选人', '职位', '部门', '渠道', '阶段'],
        rows: (result.drill?.items ?? []).map((item) => [item.name, item.jobTitle, item.departmentName, item.channel, item.stage]),
      })
    })
  }

  const openReasonDrill = (key: string, label: string) => {
    getReportReasons(reasonType, filters, key).then((result) => {
      setDrill({
        title: `${result.label} · ${label}`,
        columns: ['候选人', '职位', '时间', '说明'],
        rows: (result.drill?.items ?? []).map((item) => [item.name, item.jobTitle, item.at?.slice(0, 10) ?? null, item.detail]),
      })
    })
  }

  const openProbationDrill = (key: string, label: string) => {
    getReportProbation(filters, key).then((result) => {
      setDrill({
        title: `转正下钻 · ${label}`,
        columns: ['候选人', '职位', '是否转正', '转正时间'],
        rows: (result.drill?.items ?? []).map((item) => [item.name, item.jobTitle, item.converted ? '已转正' : '未通过', item.at?.slice(0, 10) ?? null]),
      })
    })
  }

  const openCycleDrill = (key: string, labels: string[]) => {
    getReportCycles(filters, dimensions, key).then((result) => {
      setDrill({
        title: `周期下钻 · ${labels.join(' / ')}`,
        columns: ['需求', '部门', '招聘负责人', '需求类型', '开始招聘', '关闭', '周期（天）'],
        rows: (result.drill?.items ?? []).map((item) => [item.title, item.departmentName, item.recruiterName, item.requisitionType, item.recruitmentStartDate, item.closedAt, item.cycleDays]),
      })
    })
  }

  return (
    <div className="page-stack reports-page">
      <div className="page-title-row">
        <div>
          <div className="eyebrow">数据中心 <span className="eyebrow-separator">·</span> 真实权限内数据</div>
          <h2>招聘数据</h2>
          <p>所有数量均为权限范围内实时统计，不做放大或预估。</p>
        </div>
        <div className="page-title-actions">
          <button className="button button-secondary" onClick={load} disabled={loading}><RefreshCw size={16} />刷新</button>
        </div>
      </div>

      <section className="panel">
        <div className="panel-header"><div><h3>筛选条件</h3><p>部门 / 招聘负责人 / 时间段 / 需求类型可自由组合，作用于全部报表</p></div></div>
        <div className="reports-filter-grid">
          <label className="date-range">
            <select
              value={filters.departmentId ?? ''}
              onChange={(event) => setFilters({ ...filters, departmentId: event.target.value || undefined })}
            >
              <option value="">全部部门</option>
              {(options?.departments ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <ChevronDown size={14} />
          </label>
          <label className="date-range">
            <select
              value={filters.recruiterId ?? ''}
              onChange={(event) => setFilters({ ...filters, recruiterId: event.target.value || undefined })}
            >
              <option value="">全部招聘负责人</option>
              {(options?.recruiters ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <ChevronDown size={14} />
          </label>
          <label className="date-range">
            <select
              value={filters.requisitionType ?? ''}
              onChange={(event) => setFilters({ ...filters, requisitionType: event.target.value === '__unfilled__' ? '__unfilled__' : event.target.value || undefined })}
            >
              <option value="">全部需求类型</option>
              {(options?.requisitionTypes ?? []).map((item) => (
                <option key={item} value={item === '未填写' ? '__unfilled__' : item}>{item}</option>
              ))}
            </select>
            <ChevronDown size={14} />
          </label>
          <label className="date-range">
            <input type="date" value={filters.from ?? ''} onChange={(event) => setFilters({ ...filters, from: event.target.value || undefined })} />
            <span style={{ padding: '0 6px' }}>至</span>
            <input type="date" value={filters.to ?? ''} onChange={(event) => setFilters({ ...filters, to: event.target.value || undefined })} />
          </label>
        </div>
        {error && <div className="empty-hint" style={{ paddingTop: 12 }}>{error}</div>}
      </section>

      <div className="report-metrics">
        {metrics.map((metric) => (
          <div className="report-metric" key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            <small className="positive">口径见各报表分母说明</small>
          </div>
        ))}
      </div>

      <div className="reports-grid">
        <section className="panel funnel-panel">
          <div className="panel-header">
            <div><h3>招聘漏斗</h3><p>{funnel?.denominator ?? '正在加载'}</p></div>
            {funnel && <span className="count-pill">共 {funnel.total} 人</span>}
          </div>
          <div className="funnel-chart">
            <div className="funnel-labels">
              {(funnel?.stages ?? []).map((stage) => (
                <div key={stage.key} className="funnel-label"><span>{stage.label}</span><strong>{stage.reached}</strong></div>
              ))}
            </div>
            <div className="funnel-bars">
              {(funnel?.stages ?? []).map((stage, index) => {
                const tones = ['funnel-new', 'funnel-screening', 'funnel-interview', 'funnel-offer', 'funnel-hired']
                return (
                  <div className="funnel-bar-row" key={stage.key}>
                    <button
                      className={cn('funnel-bar', tones[index % tones.length])}
                      style={{ width: `${maxFunnel ? Math.max((stage.reached / maxFunnel) * 82, 14) : 14}%` }}
                      onClick={() => openFunnelDrill(stage.key, stage.label)}
                      title={`${stage.label}：${stage.reached} 人，当前环节 ${stage.inStage} 人`}
                    >
                      {stage.conversionFromPrevious != null && <span className="funnel-conversion">{stage.conversionFromPrevious}%</span>}
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
          <div className="panel-footer-link">
            <span>
              已排除归档 {funnel?.excluded.archived ?? 0} 人、待分配池 {funnel?.excluded.pool ?? 0} 人
            </span>
          </div>
        </section>

        <section className="panel source-panel">
          <div className="panel-header"><div><h3>渠道分布</h3><p>{channels?.denominator ?? '正在加载'}</p></div></div>
          <div className="reports-section-body">
            {(channels?.rows ?? []).map((row) => (
              <button
                key={row.key}
                className="today-item"
                style={{ justifyContent: 'space-between' }}
                onClick={() => openChannelDrill(row.key, row.label)}
              >
                <span className="today-item-copy">
                  <strong>{row.label}</strong>
                  <span>面试 {row.interviewed} · Offer {row.offered} · 入职 {row.onboarded} · 归档 {row.archived}</span>
                </span>
                <strong>{row.total}{row.share != null ? `（${row.share}%）` : ''}</strong>
              </button>
            ))}
            {!channels?.rows.length && <div className="empty-hint">暂无渠道数据</div>}
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-header">
          <div><h3>三类原因</h3><p>{reasons?.denominator ?? '正在加载'}；“未填写”单列统计</p></div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {REASON_TABS.map((tab) => (
              <button
                key={tab.key}
                className={cn('button button-sm', reasonType === tab.key ? 'button-primary' : 'button-secondary')}
                onClick={() => setReasonType(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        <div className="reports-section-body">
          {(reasons?.rows ?? []).map((row) => (
            <button key={row.key} className="today-item" onClick={() => openReasonDrill(row.key, row.label)}>
              <span className="today-item-copy">
                <strong>{row.label}{row.unfilled ? '（未填写）' : ''}</strong>
                <span>占比 {row.share ?? 0}%</span>
              </span>
              <strong>{row.count}</strong>
            </button>
          ))}
          {!reasons?.rows.length && <div className="empty-hint">该口径下暂无原因记录</div>}
        </div>
      </section>

      <div className="reports-grid second">
        <section className="panel dept-efficiency">
          <div className="panel-header"><div><h3>转正率</h3><p>{probation?.denominator ?? '正在加载'}</p></div></div>
          <div className="efficiency-head"><span>部门</span><span>人数</span><span>已转正</span><span>转正率</span><span>下钻</span></div>
          {(probation?.rows ?? []).map((row) => (
            <div className="efficiency-row" key={row.key}>
              <span>{row.label}</span>
              <span>{row.total}</span>
              <span>{row.converted}</span>
              <span><span className="eff-bar"><i style={{ width: `${row.rate ?? 0}%`, background: '#18A77A' }} /></span><small>{row.rate ?? 0}%</small></span>
              <button className="text-button" onClick={() => openProbationDrill(row.key, row.label)}>查看</button>
            </div>
          ))}
          {!probation?.rows.length && <div className="empty-hint">暂无试用期结论记录</div>}
          <div className="report-metric" style={{ margin: '12px 15px 15px' }}>
            <span>整体转正率</span>
            <strong>{probation?.rate != null ? `${probation.rate}%` : '—'}</strong>
            <small>已转正 {probation?.converted ?? 0} / 已记录结论 {probation?.total ?? 0}</small>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div><h3>招聘周期</h3><p>{cycles?.accessible ? cycles.denominator : cycles?.note ?? '正在加载'}</p></div>
            {cycles?.accessible && <span className="count-pill">符合口径 {cycles.eligible.count} 条</span>}
          </div>
          <div className="reports-dimensions">
            {(options?.dimensions ?? []).map((dimension) => {
              const active = dimensions.includes(dimension.key)
              return (
                <button
                  key={dimension.key}
                  className={cn('button button-sm', active ? 'button-primary' : 'button-secondary')}
                  onClick={() =>
                    setDimensions((current) =>
                      current.includes(dimension.key)
                        ? current.filter((item) => item !== dimension.key)
                        : [...current, dimension.key],
                    )
                  }
                >
                  {dimension.label}
                </button>
              )
            })}
          </div>
          {cycles?.accessible ? (
            <>
              <div className="cycle-efficiency-head">
                <span>维度组合</span><span>需求数</span><span>均值</span><span>中位数</span><span>最长/最短</span><span>下钻</span>
              </div>
              {cycles.rows.map((row) => (
                <div className="cycle-efficiency-row" key={row.key}>
                  <span>{row.labels.join(' / ')}</span>
                  <span>{row.summary.count}</span>
                  <span>{row.summary.average ?? '—'}</span>
                  <span>{row.summary.median ?? '—'}</span>
                  <span>{row.summary.max ?? '—'} / {row.summary.min ?? '—'}</span>
                  <button className="text-button" onClick={() => openCycleDrill(row.key, row.labels)}>查看</button>
                </div>
              ))}
              {!cycles.rows.length && <div className="empty-hint">该口径下暂无已关闭需求</div>}
              <div className="cycle-efficiency-row" style={{ marginTop: 8 }}>
                <span>全部符合口径</span>
                <span>{cycles.eligible.count}</span>
                <span>{cycles.eligible.average ?? '—'}</span>
                <span>{cycles.eligible.median ?? '—'}</span>
                <span>{cycles.eligible.max ?? '—'} / {cycles.eligible.min ?? '—'}</span>
                <span />
              </div>
              <div className="reports-note" style={{ margin: '10px 15px 14px' }}>
                计算口径：{cycles.formula}；排除进行中 {cycles.excluded?.active ?? 0} 条、本期不补录存量 {cycles.excluded?.ineligible ?? 0} 条、缺日期 {cycles.excluded?.missingDate ?? 0} 条、关闭早于开始 {cycles.excluded?.closedBeforeStart ?? 0} 条、时间段外 {cycles.excluded?.outOfPeriod ?? 0} 条
              </div>
            </>
          ) : (
            <div className="empty-hint">{cycles?.note ?? '当前角色没有招聘需求查看权限'}</div>
          )}
        </section>
      </div>

      <div className="reports-note">
        <BarChart3 size={15} />
        <span>分母与时间口径随各报表返回；周期按需求级自然日差计算，同日计 1 天；报表不展示“1w+”等放大文案。</span>
      </div>

      {drill && (
        <section className="panel">
          <div className="panel-header">
            <div><h3>{drill.title}</h3><p>最多展示 500 条明细</p></div>
            <button className="icon-button" onClick={() => setDrill(null)}><X size={16} /></button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>{drill.columns.map((column) => <th key={column} style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #E5E8F0' }}>{column}</th>)}</tr>
              </thead>
              <tbody>
                {drill.rows.map((row, index) => (
                  <tr key={index}>
                    {row.map((cell, cellIndex) => <td key={cellIndex} style={{ padding: '6px 8px', borderBottom: '1px solid #F0F2F7' }}>{cell ?? '—'}</td>)}
                  </tr>
                ))}
                {!drill.rows.length && <tr><td colSpan={drill.columns.length} style={{ padding: 12 }}>暂无明细</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}

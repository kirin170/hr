import { useEffect, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, ClipboardCheck } from 'lucide-react'
import { listCandidatePage } from '../api'
import type { Candidate } from '../types'
import { cn } from '../utils'

export function Probation({ onOpenCandidate, refreshKey }: { onOpenCandidate: (id: string) => void; refreshKey: string | null }) {
  const [stage, setStage] = useState<'PROBATION' | 'ENDED'>('PROBATION')
  const [page, setPage] = useState(1)
  const [items, setItems] = useState<Candidate[]>([])
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    setError('')
    listCandidatePage({ stage, page, pageSize: 20 })
      .then((result) => {
        if (live) {
          setItems(result.items)
          setTotal(result.total)
        }
      })
      .catch((e) => {
        if (live) {
          setItems([])
          setError(e.message)
        }
      })
    return () => {
      live = false
    }
  }, [stage, page, refreshKey])

  const pages = Math.max(1, Math.ceil(total / 20))

  return (
    <div className="page-stack">
      <div className="page-title-row">
        <div>
          <div className="eyebrow">入职与转正 <span className="eyebrow-separator">·</span> 试用期结论</div>
          <h2>试用期管理</h2>
          <p>记录是否转正及转正时间。</p>
        </div>
      </div>

      <section className="panel probation-panel">
        <div className="candidate-toolbar">
          <label className="filter-select">
            <span>阶段</span>
            <select value={stage} onChange={(e) => { setStage(e.target.value as 'PROBATION' | 'ENDED'); setPage(1) }}>
              <option value="PROBATION">试用期</option>
              <option value="ENDED">已结束</option>
            </select>
            <ChevronDown size={13} />
          </label>
          <span className="result-count">共 {total} 人</span>
        </div>

        {error && <p className="form-error" role="alert" style={{ padding: '0 16px' }}>{error}</p>}

        <div className="probation-table-wrap">
          <table className="probation-table">
            <thead>
              <tr>
                <th>候选人</th>
                <th>职位</th>
                <th>阶段</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id}>
                  <td><strong>{c.name}</strong></td>
                  <td>{c.jobTitle || '—'}</td>
                  <td>
                    <span className={cn('status-chip', c.stage === 'PROBATION' ? 'status-warn' : 'status-on')}>
                      {c.stage === 'PROBATION' ? '试用期' : '已结束'}
                    </span>
                  </td>
                  <td>
                    <button className="text-button" onClick={() => onOpenCandidate(c.id)}>查看并记录</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!error && items.length === 0 && (
            <div className="empty-state">
              <span><ClipboardCheck size={22} /></span>
              <h4>{stage === 'PROBATION' ? '暂无试用期员工' : '暂无已结束记录'}</h4>
              <p>候选人进入试用期后可在此查看并记录转正结论。</p>
            </div>
          )}
        </div>

        <div className="table-footer">
          <span>共 {total} 人</span>
          <div className="pagination">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="上一页"><ChevronLeft size={15} /></button>
            <span className="cell-sub">第 {page} / {pages} 页</span>
            <button disabled={page * 20 >= total} onClick={() => setPage(page + 1)} aria-label="下一页"><ChevronRight size={15} /></button>
          </div>
        </div>
      </section>
    </div>
  )
}

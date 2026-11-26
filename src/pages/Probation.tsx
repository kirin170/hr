import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, ClipboardCheck } from 'lucide-react'
import { listCandidatePage } from '../api'
import type { Candidate } from '../types'
import { cn } from '../utils'

type OnboardTab = 'PENDING_ONBOARD' | 'PROBATION' | 'ENDED'

const TABS: { key: OnboardTab; label: string; badgeClass: string; badgeText: string; emptyTitle: string }[] = [
  { key: 'PENDING_ONBOARD', label: '待入职', badgeClass: 'status-warn', badgeText: '待入职', emptyTitle: '暂无待入职候选人' },
  { key: 'PROBATION', label: '试用期', badgeClass: 'status-warn', badgeText: '试用期', emptyTitle: '暂无试用期员工' },
  { key: 'ENDED', label: '已结束', badgeClass: 'status-on', badgeText: '已结束', emptyTitle: '暂无已结束记录' },
]

export function Probation({ onOpenCandidate, refreshKey }: { onOpenCandidate: (id: string) => void; refreshKey: string | null }) {
  const [stage, setStage] = useState<OnboardTab>('PROBATION')
  const [page, setPage] = useState(1)
  const [items, setItems] = useState<Candidate[]>([])
  const [total, setTotal] = useState(0)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    setError('')
    listCandidatePage({ stage, page, pageSize: 20 })
      .then((result) => {
        if (live) {
          setItems(result.items)
          setTotal(result.total)
          setCounts(result.counts)
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
  const currentMeta = TABS.find((t) => t.key === stage) ?? TABS[1]

  return (
    <div className="page-stack">
      <div className="page-title-row">
        <div>
          <div className="eyebrow">招聘执行 <span className="eyebrow-separator">·</span> 待入职、转正与归档闭环</div>
          <h2>入职与试用期</h2>
          <p>跟踪待入职日程与放弃原因，确认到岗并记录试用期转正结论。</p>
        </div>
      </div>

      <div className="stage-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            className={cn('stage-tab', stage === tab.key && 'active')}
            onClick={() => { setStage(tab.key); setPage(1) }}
          >
            {tab.label}
            {counts[tab.key] !== undefined && <span>{counts[tab.key]}</span>}
          </button>
        ))}
      </div>

      <section className="panel probation-panel">
        {error && <p className="form-error" role="alert" style={{ padding: '12px 16px' }}>{error}</p>}

        <div className="probation-table-wrap">
          <table className="probation-table">
            <thead>
              <tr>
                <th>候选人</th>
                <th>职位</th>
                <th>所属部门</th>
                <th>当前阶段</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id}>
                  <td><strong>{c.name}</strong></td>
                  <td>{c.jobTitle || '—'}</td>
                  <td>{c.departmentName || '—'}</td>
                  <td>
                    <span className={cn('status-chip', currentMeta.badgeClass)}>
                      {currentMeta.badgeText}
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
              <h4>{currentMeta.emptyTitle}</h4>
              <p>候选人流转至对应阶段后会出现在这里，点击可进入详情操作。</p>
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

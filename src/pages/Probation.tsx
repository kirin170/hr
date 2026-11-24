import { useEffect, useState } from 'react'
import { listCandidatePage } from '../api'
import type { Candidate } from '../types'

export function Probation({ onOpenCandidate, refreshKey }: { onOpenCandidate: (id: string) => void; refreshKey: string | null }) {
  const [stage, setStage] = useState<'PROBATION' | 'ENDED'>('PROBATION')
  const [page, setPage] = useState(1)
  const [items, setItems] = useState<Candidate[]>([])
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')
  useEffect(() => { let live = true; setError(''); listCandidatePage({ stage, page, pageSize: 20 }).then(result => { if (live) { setItems(result.items); setTotal(result.total) } }).catch(e => { if (live) { setItems([]); setError(e.message) } }); return () => { live = false } }, [stage, page, refreshKey])
  return <div className="page-stack"><div className="page-title-row"><div><h2>试用期管理</h2><p>记录是否转正及转正时间。</p></div></div><section className="panel"><div className="panel-header"><label>阶段 <select value={stage} onChange={e => { setStage(e.target.value as 'PROBATION' | 'ENDED'); setPage(1) }}><option value="PROBATION">试用期</option><option value="ENDED">已结束</option></select></label><span>{total} 人</span></div>{error && <p role="alert">{error}</p>}<div className="probation-table-wrap"><table className="probation-table"><thead><tr><th>候选人</th><th>职位</th><th>阶段</th><th /></tr></thead><tbody>{items.map(c => <tr key={c.id}><td>{c.name}</td><td>{c.jobTitle}</td><td>{c.stage === 'PROBATION' ? '试用期' : '已结束'}</td><td><button onClick={() => onOpenCandidate(c.id)}>查看并记录</button></td></tr>)}</tbody></table></div><div className="panel-header"><button disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</button><span>第 {page} 页</span><button disabled={page * 20 >= total} onClick={() => setPage(page + 1)}>下一页</button></div></section></div>
}

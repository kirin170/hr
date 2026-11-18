import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, PencilLine, RefreshCw, Search, Tags } from 'lucide-react'
import { listSourceRecords, updateSourceRecord } from '../api'
import { useApp } from '../context'
import type { ApiSourceRecord, SourceRecordList } from '../types'

const sourceOptions = [
  { value: 'UPLOAD', label: '上传' },
  { value: 'JOB_BOARD', label: '招聘网站' },
  { value: 'CAMPUS', label: '校招' },
  { value: 'REFERRAL', label: '内推' },
  { value: 'EMAIL', label: '邮箱' },
  { value: 'MANUAL', label: '手工' },
]

const sourceLabel = (value: string | null) =>
  sourceOptions.find((option) => option.value === value)?.label ?? value ?? '—'

const formatTime = (value: string | null) => {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', { hour12: false })
}

const emptyEdit = { referrerName: '', referrerContact: '', referralCode: '', sourceNote: '' }

export function SourceRecords() {
  const { toast } = useApp()
  const [data, setData] = useState<SourceRecordList | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [source, setSource] = useState('')
  const [referrer, setReferrer] = useState('')
  const [createdFrom, setCreatedFrom] = useState('')
  const [createdTo, setCreatedTo] = useState('')
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<ApiSourceRecord | null>(null)
  const [editForm, setEditForm] = useState(emptyEdit)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData(await listSourceRecords({
        source: source || undefined,
        referrer: referrer.trim() || undefined,
        createdFrom: createdFrom || undefined,
        createdTo: createdTo || undefined,
        page,
        pageSize: 10,
      }))
      setError(null)
    } catch (loadError) {
      setData(null)
      setError(loadError instanceof Error ? loadError.message : '来源记录加载失败')
    } finally {
      setLoading(false)
    }
  }, [source, referrer, createdFrom, createdTo, page])

  useEffect(() => {
    void load()
  }, [load])

  const startEdit = (record: ApiSourceRecord) => {
    setEditing(record)
    setEditForm({
      referrerName: record.referrerName ?? '',
      referrerContact: record.referrerContact ?? '',
      referralCode: record.referralCode ?? '',
      sourceNote: record.note ?? '',
    })
  }

  const saveEdit = async () => {
    if (!editing) return
    setBusy(true)
    try {
      await updateSourceRecord(editing.id, {
        referrerName: editForm.referrerName,
        referrerContact: editForm.referrerContact,
        referralCode: editForm.referralCode,
        sourceNote: editForm.sourceNote,
      })
      toast('来源信息已更新')
      setEditing(null)
      await load()
    } catch (saveError) {
      toast(saveError instanceof Error ? saveError.message : '保存失败', 'info')
    } finally {
      setBusy(false)
    }
  }

  const items = data?.items ?? []
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <div className="page-stack">
      <div className="panel">
        <div className="panel-header">
          <div>
            <h3><Tags size={15} />来源记录</h3>
            <p>每次入场保留一条来源记录；查重合并时保留全部来源。不判定有效推荐、不自动结算。</p>
          </div>
        </div>
        <div className="candidate-toolbar">
          <label className="form-field form-field-inline">
            <span>来源</span>
            <select value={source} onChange={(event) => { setSource(event.target.value); setPage(1) }}>
              <option value="">全部来源</option>
              {sourceOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="table-search">
            <Search size={16} />
            <input
              value={referrer}
              onChange={(event) => { setReferrer(event.target.value); setPage(1) }}
              placeholder="搜索推荐人、联系方式或来源标识"
            />
          </label>
          <label className="form-field form-field-inline">
            <span>起始</span>
            <input type="date" value={createdFrom} onChange={(event) => { setCreatedFrom(event.target.value); setPage(1) }} />
          </label>
          <label className="form-field form-field-inline">
            <span>截止</span>
            <input type="date" value={createdTo} onChange={(event) => { setCreatedTo(event.target.value); setPage(1) }} />
          </label>
          <span className="result-count">{data?.total ?? 0} 条来源</span>
          <div className="toolbar-spacer" />
          <button className="button button-secondary button-sm" onClick={() => void load()}>
            <RefreshCw size={14} />刷新
          </button>
        </div>

        {loading && <div className="empty-inline">正在加载来源记录…</div>}
        {error && <div className="empty-inline">加载失败：{error}</div>}

        {editing && (
          <div className="intake-form-grid">
            <label className="form-field">
              <span>推荐人</span>
              <input value={editForm.referrerName} onChange={(event) => setEditForm({ ...editForm, referrerName: event.target.value })} />
            </label>
            <label className="form-field">
              <span>推荐人联系方式</span>
              <input value={editForm.referrerContact} onChange={(event) => setEditForm({ ...editForm, referrerContact: event.target.value })} />
            </label>
            <label className="form-field">
              <span>来源标识</span>
              <input value={editForm.referralCode} onChange={(event) => setEditForm({ ...editForm, referralCode: event.target.value })} />
            </label>
            <label className="form-field">
              <span>来源备注</span>
              <input value={editForm.sourceNote} onChange={(event) => setEditForm({ ...editForm, sourceNote: event.target.value })} />
            </label>
            <div className="intake-form-actions">
              <button className="button button-primary" disabled={busy} onClick={() => void saveEdit()}>
                {busy ? '保存中…' : `保存（${editing.candidate?.name ?? '候选人'}）`}
              </button>
              <button className="button button-secondary" disabled={busy} onClick={() => setEditing(null)}>取消</button>
            </div>
          </div>
        )}

        <div className="intake-table-wrap">
          <table className="intake-table">
            <thead>
              <tr>
                <th>候选人</th><th>来源</th><th>推荐人</th><th>来源标识</th><th>职位</th><th>记录时间</th><th />
              </tr>
            </thead>
            <tbody>
              {items.map((record) => (
                <tr key={record.id}>
                  <td>
                    <strong>{record.candidate?.name ?? '—'}</strong>
                    <small className="cell-sub">
                      {record.candidate?.phone ?? '无手机号'} · {record.candidate?.email ?? '无邮箱'}
                    </small>
                  </td>
                  <td>
                    {sourceLabel(record.source)}
                    {record.mergedFromCandidateId && <small className="cell-sub">查重合并保留</small>}
                  </td>
                  <td>
                    {record.referrerName ?? '—'}
                    {record.referrerContact && <small className="cell-sub">{record.referrerContact}</small>}
                  </td>
                  <td>{record.referralCode ?? '—'}</td>
                  <td>{record.job ? `${record.job.code} · ${record.job.title}` : '—'}</td>
                  <td>{formatTime(record.createdAt)}</td>
                  <td>
                    <div className="row-actions">
                      <button className="text-button" onClick={() => startEdit(record)}>
                        <PencilLine size={14} />编辑来源
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && !error && items.length === 0 && (
            <div className="empty-state">
              <span><Tags size={22} /></span>
              <h4>暂无来源记录</h4>
              <p>上传、手工、Excel 或校招投递后，来源与推荐人会记录在这里。</p>
            </div>
          )}
        </div>

        <div className="table-footer">
          <span>共 {data?.total ?? 0} 条</span>
          <div className="pagination">
            <button disabled={page === 1} onClick={() => setPage(page - 1)}><ChevronLeft size={15} /></button>
            <span className="cell-sub">第 {page} / {pages} 页</span>
            <button disabled={page >= pages} onClick={() => setPage(page + 1)}><ChevronRight size={15} /></button>
          </div>
        </div>
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Activity, Download, GraduationCap, Inbox, Tags, Upload } from 'lucide-react'
import { downloadExcelTemplate } from '../api'
import { useApp } from '../context'
import { cn } from '../utils'
import { Campus } from './Campus'
import { Intake } from './Intake'
import { IntakeMonitor } from './IntakeMonitor'
import { IntakePool } from './IntakePool'

export type IntakeHubTab = 'ingest' | 'pool' | 'campus' | 'monitor' | 'records'

const HUB_TABS: { key: IntakeHubTab; label: string; icon: typeof Upload }[] = [
  { key: 'ingest', label: '导入与录入', icon: Upload },
  { key: 'pool', label: '待分配与查重', icon: Inbox },
  { key: 'campus', label: '校招投递', icon: GraduationCap },
  { key: 'monitor', label: '入场监控', icon: Activity },
  { key: 'records', label: '记录与来源', icon: Tags },
]

export function IntakeHub({ initialTab = 'ingest' }: { initialTab?: IntakeHubTab }) {
  const { toast } = useApp()
  const [tab, setTab] = useState<IntakeHubTab>(initialTab)

  useEffect(() => {
    setTab(initialTab)
  }, [initialTab])

  return (
    <div className="page-stack">
      <div className="page-title-row">
        <div>
          <div className="eyebrow">简历入场中心 <span className="eyebrow-separator">·</span> 多渠道入口、待分配池与监控</div>
          <h2>简历入场</h2>
          <p>统一承接上传、手工、邮箱、Excel、校招投递与查重待分配，并实时追踪入场时延与失败重试。</p>
        </div>
        <div className="page-title-actions">
          <a className="button button-secondary" href="/campus" target="_blank" rel="noreferrer">
            <GraduationCap size={16} />打开校招门户
          </a>
          <button
            className="button button-secondary"
            onClick={() => void downloadExcelTemplate().catch((error) => toast(error.message, 'info'))}
          >
            <Download size={16} />下载 Excel 模板
          </button>
        </div>
      </div>

      <div className="stage-tabs stage-tabs-scroll">
        {HUB_TABS.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.key}
              className={cn('stage-tab', tab === item.key && 'active')}
              onClick={() => setTab(item.key)}
            >
              <Icon size={14} />{item.label}
            </button>
          )
        })}
      </div>

      {tab === 'ingest' && <Intake embedded initialTab="upload" tabGroup="ingest" />}
      {tab === 'pool' && <IntakePool embedded />}
      {tab === 'campus' && <Campus embedded />}
      {tab === 'monitor' && <IntakeMonitor embedded />}
      {tab === 'records' && <Intake embedded initialTab="records" tabGroup="records" />}
    </div>
  )
}

import { useState } from 'react'
import { ArrowDownRight, ArrowUpRight, BarChart3, ChevronDown, Download, TrendingUp, Users } from 'lucide-react'
import { departments } from '../data'
import { useApp } from '../context'
import { cn } from '../utils'

export function Reports() {
  const { data } = useApp()
  const [range, setRange] = useState('近 30 天')
  const sourceData = [{name:'BOSS直聘', value:38, color:'#6675E8'},{name:'内部推荐', value:24, color:'#18A77A'},{name:'猎聘', value:18, color:'#E49A3F'},{name:'官网投递', value:12, color:'#9A72DE'},{name:'其他', value:8, color:'#A5ADBC'}]
  const monthly = [54, 68, 61, 82, 76, 94, 88, 112, 104, 120, 116, 134]
  const max = Math.max(...monthly)
  return <div className="page-stack reports-page">
    <div className="page-title-row"><div><div className="eyebrow">数据中心 <span className="eyebrow-separator">·</span> 实时更新</div><h2>招聘数据</h2><p>用数据洞察招聘效率，辅助团队做出更好的决策。</p></div><div className="page-title-actions"><label className="date-range"><select value={range} onChange={e=>setRange(e.target.value)}><option>近 7 天</option><option>近 30 天</option><option>本季度</option><option>今年</option></select><ChevronDown size={14}/></label><button className="button button-secondary"><Download size={16}/>导出报告</button></div></div>
    <div className="report-metrics">
      <ReportMetric label="新增候选人" value="134" change="+18.6%" positive />
      <ReportMetric label="完成面试" value="86" change="+12.4%" positive />
      <ReportMetric label="发出 Offer" value="18" change="+5.8%" positive />
      <ReportMetric label="平均招聘周期" value="18.6天" change="-2.3天" positive />
      <ReportMetric label="Offer 接受率" value="83.3%" change="-1.2%" />
    </div>
    <div className="reports-grid">
      <section className="panel trend-panel">
        <div className="panel-header"><div><h3>招聘趋势</h3><p>候选人、面试与 Offer 数量变化</p></div><div className="chart-legend"><span><i className="blue"/>候选人</span><span><i className="green"/>面试</span><span><i className="orange"/>Offer</span></div></div>
        <div className="trend-chart">
          <div className="chart-y-labels"><span>140</span><span>105</span><span>70</span><span>35</span><span>0</span></div>
          <div className="chart-plot"><div className="chart-gridlines"><i/><i/><i/><i/><i/></div><svg viewBox="0 0 600 200" preserveAspectRatio="none" className="trend-svg"><defs><linearGradient id="areaBlue" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#6675E8" stopOpacity=".16"/><stop offset="1" stopColor="#6675E8" stopOpacity="0"/></linearGradient></defs><path d="M0,157 L55,148 L110,135 L165,126 L220,132 L275,104 L330,115 L385,76 L440,88 L495,53 L550,66 L600,38 L600,200 L0,200 Z" fill="url(#areaBlue)"/><polyline points="0,157 55,148 110,135 165,126 220,132 275,104 330,115 385,76 440,88 495,53 550,66 600,38" fill="none" stroke="#6675E8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/><polyline points="0,181 55,173 110,166 165,151 220,158 275,142 330,149 385,125 440,131 495,112 550,122 600,101" fill="none" stroke="#18A77A" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/><polyline points="0,194 55,190 110,187 165,181 220,185 275,177 330,180 385,168 440,172 495,161 550,165 600,154" fill="none" stroke="#E49A3F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg><div className="chart-x-labels">{['12/01','12/06','12/12','12/18','12/24','12/30'].map(x=><span key={x}>{x}</span>)}</div></div>
        </div>
      </section>
      <section className="panel source-panel"><div className="panel-header"><div><h3>候选人来源</h3><p>渠道质量与贡献占比</p></div></div><div className="source-donut-wrap"><div className="source-donut"><div><strong>{data.candidates.length + 120}</strong><span>候选人</span></div></div><div className="source-legend">{sourceData.map(item=><div key={item.name}><span><i style={{background:item.color}}/>{item.name}</span><strong>{item.value}%</strong></div>)}</div></div><div className="source-insight"><TrendingUp size={15}/><span>内部推荐渠道转化率最高，建议加大推荐激励。</span></div></section>
    </div>
    <div className="reports-grid second">
      <section className="panel dept-efficiency"><div className="panel-header"><div><h3>部门招聘效率</h3><p>各团队招聘进展对比</p></div><button className="text-button">查看详情</button></div><div className="efficiency-head"><span>部门</span><span>在招职位</span><span>候选人</span><span>平均周期</span><span>完成率</span></div>{departments.map((department, i)=>{const count=data.candidates.filter(c=>c.departmentId===department.id).length;const rate=[86,72,68,91,60][i];return <div className="efficiency-row" key={department.id}><span className="department-name"><span className="department-badge" style={{background:`${department.color}18`,color:department.color}}>{department.short}</span>{department.name}</span><span>{[6,3,4,2,1][i]}</span><span>{count+[18,12,15,8,6][i]}</span><span>{[16,19,21,14,23][i]}天</span><span><span className="eff-bar"><i style={{width:`${rate}%`,background:department.color}}/></span><small>{rate}%</small></span></div>})}</section>
      <section className="panel conversion-funnel-panel"><div className="panel-header"><div><h3>阶段转化分析</h3><p>各招聘阶段转化效率</p></div></div>{[{label:'简历 → 初筛',value:72,color:'#6675E8'},{label:'初筛 → 面试',value:46,color:'#8C74E5'},{label:'面试 → Offer',value:28,color:'#E49A3F'},{label:'Offer → 入职',value:83,color:'#18A77A'}].map(item=><div className="conversion-stat" key={item.label}><div><span>{item.label}</span><strong>{item.value}%</strong></div><span className="conversion-track"><i style={{width:`${item.value}%`,background:item.color}}/></span></div>)}</section>
    </div>
    <div className="reports-note"><BarChart3 size={15}/><span>数据统计截至今天 21:00，每日 00:00 自动更新。</span></div>
  </div>
}

function ReportMetric({label,value,change,positive}:{label:string;value:string;change:string;positive?:boolean}) {
  return <div className="report-metric"><span>{label}</span><strong>{value}</strong><small className={cn(positive?'positive':'negative')}>{positive?<ArrowUpRight size={13}/>:<ArrowDownRight size={13}/>} {change}<em>较上期</em></small></div>
}

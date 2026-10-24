import { useState } from 'react';

const systems = ['发动机', '传动系统', '液压系统', '电气系统', '行走系统'];
const records = Array.from({ length: 24 }, (_, i) => ({ id: `SIM-${String(i + 1).padStart(3, '0')}`, system: systems[i % 5], model: ['东方红 LX904', '雷沃 M904', '东风 DF904', '约翰迪尔 5E'][i % 4], count: 24 + (i * 31) % 117, score: 76 + i % 23, status: i % 4 ? '已完成' : '待复核' }));
const trend = [28, 42, 34, 59, 48, 71, 63, 85, 74, 103, 96, 122];

export default function KnowledgeSimulationDashboard({ lang, seconds, running }: { lang: string; seconds: number; running: boolean }) {
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(0);
  const zh = lang === 'zh';
  const t = (a: string, b: string) => zh ? a : b;
  const rows = records.filter(row => filter === 'all' || row.status === filter);
  const phase = Math.floor(seconds / 4) % 12;
  return <section className="simulation-dashboard" aria-label={t('模拟数据分析看板', 'Simulated analytics dashboard')}>
    <header className="simulation-heading"><div><h3>{t('知识运行观测', 'Knowledge observatory')}</h3><p>{t('以下图表与表格均为模拟数据，仅用于展示交互与可视化，不代表真实业务统计。', 'All charts and rows below use simulated data for visualization, not actual business metrics.')}</p></div><span>SIMULATION · {running ? 'LIVE' : 'PAUSED'}</span></header>
    <div className="simulation-kpis">{[[10877, '模拟索引量', 'Mock index'], [3287, '模拟访问量', 'Mock visits'], [96.8, '模拟完成率 %', 'Mock completion %'], [24, '模拟任务数', 'Mock tasks']].map(([n, label, en]) => <article key={label}><small>{t(String(label), String(en))}</small><strong>{Number(n).toLocaleString()}</strong><span>{t('模拟快照', 'Simulated snapshot')}</span></article>)}</div>
    <div className="simulation-charts">
      <article><h4>{t('01 / 索引趋势 · 折线面积图', '01 / Index trend · Area chart')}</h4><svg viewBox="0 0 360 160" role="img" aria-label={t('模拟十二日索引趋势', 'Simulated twelve-day index trend')}><path d={`M15,140 ${trend.map((v, i) => `L${15 + i * 30},${140 - v}`).join(' ')} L345,140 Z`} fill="#e99a8925"/><polyline points={trend.map((v, i) => `${15 + i * 30},${140 - v}`).join(' ')} fill="none" stroke="#e99a89" strokeWidth="2"/>{trend.map((v, i) => <circle key={i} cx={15 + i * 30} cy={140 - v} r={phase === i ? 5 : 2} fill={phase === i ? '#edca73' : '#e99a89'} />)}<text x="15" y="157">DAY 01</text><text x="290" y="157">DAY 12</text></svg></article>
      <article><h4>{t('02 / 系统分布 · 环形图', '02 / System distribution · Donut')}</h4><div className="simulation-donut-wrap"><div className="simulation-donut"><b>1,280<small>SIM ENTRIES</small></b></div><ul>{systems.map((name, i) => <li key={name}><i style={{ background: ['#e99a89', '#edca73', '#a3b69b', '#87a9b9', '#b0a0c5'][i] }}/>{zh ? name : `System ${i + 1}`} <b>{[32, 26, 20, 14, 8][i]}%</b></li>)}</ul></div></article>
      <article><h4>{t('03 / 系统任务 · 横向柱状图', '03 / System tasks · Bars')}</h4><div className="simulation-bars">{systems.map((name, i) => <div key={name}><span>{zh ? name : `System ${i + 1}`}</span><i><em style={{ width: `${[86, 72, 64, 48, 35][i]}%` }}/></i><b>{[86, 72, 64, 48, 35][i]}</b></div>)}</div></article>
      <article><h4>{t('04 / 检索活跃度 · 热力图', '04 / Retrieval activity · Heatmap')}</h4><div className="simulation-heatmap" role="img" aria-label={t('模拟七周检索活跃度，颜色越深表示次数越多', 'Simulated seven-week activity; brighter cells mean more retrievals')}>{Array.from({ length: 49 }, (_, i) => <i key={i} title={`SIM · ${i + 1}: ${(i * 13) % 100}`} style={{ opacity: .15 + ((i * 13) % 10) / 12, outline: phase === i % 12 ? '1px solid #edca73' : undefined }}/>)}</div><p className="simulation-note">{t('低 ← 检索次数 → 高 · 模拟 7 周', 'Low ← Retrievals → High · 7 simulated weeks')}</p></article>
    </div>
    <div className="simulation-table-heading"><h4>{t('05 / 任务明细 · 模拟数据', '05 / Task details · Simulated data')}</h4><select aria-label={t('筛选模拟任务状态', 'Filter simulated task status')} value={filter} onChange={event => { setFilter(event.target.value); setPage(0); }}><option value="all">{t('全部状态', 'All statuses')}</option><option value="已完成">{t('已完成', 'Complete')}</option><option value="待复核">{t('待复核', 'Review')}</option></select></div>
    <div className="simulation-table-scroll"><table><thead><tr>{(zh ? ['模拟编号', '机型', '系统', '索引数量', '质量分', '状态'] : ['Mock ID', 'Model', 'System', 'Indexed', 'Score', 'Status']).map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{rows.slice(page * 6, page * 6 + 6).map(row => <tr key={row.id}><td>{row.id}</td><td>{row.model}</td><td>{zh ? row.system : `System ${systems.indexOf(row.system) + 1}`}</td><td>{row.count}</td><td><meter min="0" max="100" value={row.score}/>{row.score}</td><td><span>{zh ? row.status : row.status === '已完成' ? 'Complete' : 'Review'}</span></td></tr>)}</tbody></table></div>
    <footer className="simulation-pagination"><span>{rows.length} {t('条模拟记录', 'simulated records')} · {page + 1}/{Math.ceil(rows.length / 6)}</span><button disabled={!page} onClick={() => setPage(page - 1)}>{t('上一页', 'Previous')}</button><button disabled={(page + 1) * 6 >= rows.length} onClick={() => setPage(page + 1)}>{t('下一页', 'Next')}</button></footer>
  </section>;
}

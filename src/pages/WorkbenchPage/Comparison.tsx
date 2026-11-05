import React, { useEffect, useRef, useState } from 'react';
import type { TelemetryChannel } from '../../../shared/telemetry';
import { comparisonShares, fraction, timelineBounds } from '../../features/workbench/analytics';
import { observationStats, type Observation } from '../../features/workbench/data';

export type ComparisonRow = { id: string; label: string; unit: string; points: readonly Observation[]; channel?: TelemetryChannel };
export type ComparisonView = 'overlay' | 'compare-bars' | 'ratios' | 'numbers';
const colors = ['#2870e8', '#158b86', '#a076ca', '#c17d32'];
const format = (n: number) => n.toLocaleString(undefined, {maximumFractionDigits: 2});
function RollingNumber({value}: {value: number}) {
  const [shown, setShown] = useState(value), current = useRef(value);
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { current.current = value; setShown(value); return; }
    const from = current.current, start = performance.now(); let frame = 0;
    const tick = (at: number) => { const t = Math.min(1, (at - start) / 450); current.current = from * (1 - t) + value * t; setShown(current.current); if (t < 1) frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame);
  }, [value]);
  return <span aria-label={format(value)}>{format(shown)}</span>;
}
export function Comparison({rows,view,lang,sampleMs}: {rows: readonly ComparisonRow[];view:ComparisonView;lang:'zh'|'en';sampleMs?:number}) {
  const t = (zh:string,en:string) => lang==='zh'?zh:en;
  const numeric = rows.filter(r => r.points.length && r.channel?.kind !== 'state');
  const [normalized, setNormalized] = useState(false);
  const [position, setPosition] = useState(1);
  const mixed = new Set(numeric.map(r=>r.unit)).size > 1;
  const relative = normalized || mixed;
  const values = numeric.map(r => ({...r, value:r.points.at(-1)!.value, stats:observationStats(r.points)!}));
  const range = (r: typeof values[number]) => r.channel?.range ?? {min:r.stats.min,max:r.stats.max};
  const ratio = (r: typeof values[number], v=r.value) => fraction(v,range(r).min,range(r).max);
  const bounds = timelineBounds(numeric);
  const allValues = numeric.flatMap(r=>r.points.map(p=>p.value));
  const low = Math.min(0,...allValues), high = Math.max(0,...allValues);
  const shares = comparisonShares(values);
  const at = bounds ? bounds.from + (bounds.to-bounds.from)*position : 0;
  const selected = numeric.map(r=>{const p=r.points.reduce((best,p)=>Math.abs(p.at-at)<Math.abs(best.at-at)?p:best,r.points[0]);return {r,p:sampleMs && Math.abs(p.at-at)>sampleMs*3 ? null : p};});
  const names = {overlay:t('多路趋势对比','Combined trends'),'compare-bars':t('实时柱状对比','Live bar comparison'),ratios:t('比例与环图','Ratios & rings'),numbers:t('动态数字看板','Live number board')};
  return <section className="wb-panel wb-comparison"><div className="wb-panel-heading"><h2>{names[view]}</h2><span className="wb-tag">{values.length} {t('路数值','numeric channels')}</span></div>
    <p className="wb-source">{t('随当前数据更新；冻结和回放同步作用于本视图。','Follows the visible data, including freeze and replay.')}</p>
    {numeric.length < 2 && <p className="wb-notice">{t('选择两路以上数值可对比。可使用“温度监测”或“四轮轮毂温度”预设。','Choose at least two numeric channels; try the temperature presets.')}</p>}
    {rows.some(r=>r.channel?.kind==='state')&&<p className="wb-muted">{t('状态通道保留在原始明细中，不参与数值比例。','State channels remain in the raw table and are excluded from numeric ratios.')}</p>}
    {(view==='overlay'||view==='compare-bars')&&<><label className="wb-compare-scale">{t('比较尺度','Scale')}<select value={relative?'relative':'raw'} onChange={e=>setNormalized(e.target.value==='relative')}><option value="raw" disabled={mixed}>{t('原始数值（同单位）','Raw values (same unit)')}</option><option value="relative">{t('各自量程位置 0–100%','Position in own range 0–100%')}</option></select></label><p className="wb-muted">{relative?t('每路按自己的仿真量程归一化；导入数据使用观测范围。仅比较位置变化，不是健康度或贡献比例。','Normalized to each demo range (observed range for imports). This compares positions, not health or contributions.'):t('同单位按共同尺度比较；保留各路原始值。','Same-unit readings share one scale with raw values.')}</p></>}
    {view==='overlay'&&bounds&&<><svg className="wb-overlay" viewBox="0 0 920 280" role="img" aria-label={names.overlay}>
      {[0,.25,.5,.75,1].map(v=><g key={v}><line x1="60" x2="900" y1={230-v*200} y2={230-v*200}/><text x="50" y={235-v*200} textAnchor="end">{relative?`${v*100}%`:format(low*(1-v)+high*v)}</text></g>)}
      {values.map((r,i)=>{const stride=Math.max(1,Math.ceil(r.points.length/700));let path='';let gap=true; r.points.forEach((p,j)=>{if(j&&sampleMs&&p.at-r.points[j-1].at>sampleMs*3)gap=true;if(j%stride&&j!==r.points.length-1)return;const x=60+(bounds.to===bounds.from ? .5 :(p.at-bounds.from)/(bounds.to-bounds.from))*840;const y=230-(relative?ratio(r,p.value):fraction(p.value,low,high))*200;path+=`${gap?'M':'L'}${x},${y} `;gap=false;});return <path key={r.id} d={path} fill="none" stroke={colors[i]} strokeWidth="2.5"/>;})}
      <line x1={60+position*840} x2={60+position*840} y1="30" y2="230" className="wb-compare-cursor"/>
      <text x="60" y="265">{new Date(bounds.from).toLocaleTimeString()}</text><text x="900" y="265" textAnchor="end">{new Date(bounds.to).toLocaleTimeString()}</text>
    </svg><label>{t('共同时间游标','Shared time cursor')}<input aria-label={t('共同时间游标','Shared time cursor')} type="range" min="0" max="1" step="0.001" value={position} onChange={e=>setPosition(Number(e.target.value))}/></label><div className="wb-compare-legend">{selected.map(({r,p},i)=><span key={r.id} style={{borderColor:colors[i]}}>{r.label} <strong>{p?`${format(p.value)} ${r.unit}`:t('无样本','No sample')}</strong></span>)}</div></>}
    {view==='compare-bars'&&<div className="wb-compare-bars">{values.map((r,i)=>{const zero=relative?0:fraction(0,low,high), end=relative?ratio(r):fraction(r.value,low,high);return <div key={r.id}><div className="wb-compare-bar-heading"><span>{r.label}</span><strong>{format(r.value)} {r.unit}{relative?` · ${(ratio(r)*100).toFixed(1)}%`:''}</strong></div><div className="wb-compare-track"><span style={{left:`${Math.min(zero,end)*100}%`,width:`${Math.abs(end-zero)*100}%`,background:colors[i]}}/><i style={{left:`${zero*100}%`}}/></div></div>;})}</div>}
    {view==='numbers'&&<div className="wb-live-numbers">{values.map((r,i)=>{const prev=r.points.at(-2)?.value??r.value,delta=r.value-prev;return <article key={r.id} style={{borderColor:colors[i]}}><span>{r.label}</span><strong><RollingNumber value={r.value}/><small>{r.unit}</small></strong><p>{delta>=0?'↑':'↓'} {format(Math.abs(delta))} {t('较上一样本','vs prior sample')}</p><small>{new Date(r.points.at(-1)!.at).toLocaleTimeString()} · {r.points.length} {t('样本','samples')}</small><div className="wb-compare-track"><span style={{width:`${ratio(r)*100}%`,background:colors[i]}}/></div><small>{t('各自量程位置','Position in own range')} {(ratio(r)*100).toFixed(1)}%</small></article>;})}</div>}
    {view==='ratios'&&<><div className="wb-ratio-grid">{values.map((r,i)=><article key={r.id}><svg viewBox="0 0 120 120" role="img" aria-label={`${r.label}: ${(ratio(r)*100).toFixed(1)}%`}><circle cx="60" cy="60" r="48" className="wb-ring-track"/><circle cx="60" cy="60" r="48" pathLength="100" className="wb-ring-fill" stroke={colors[i]} strokeDasharray={`${ratio(r)*100} 100`}/><text x="60" y="64" textAnchor="middle">{(ratio(r)*100).toFixed(1)}%</text></svg><strong>{r.label}</strong><p>{format(r.value)} {r.unit}</p><small>{format(range(r).min)} – {format(range(r).max)} {r.unit}</small></article>)}</div><p className="wb-muted">{t('上方环图表示各自量程位置，不表示数据间份额或设备健康。','Rings show position in individual ranges, not shares or health.')}</p>
    {shares&& !['°C','%'].includes(values[0]?.unit)?<div className="wb-share"><svg viewBox="0 0 160 160" role="img" aria-label={t('所选读数总和占比','Share of selected reading sum')}>{shares.map((share,i)=><circle key={values[i].id} cx="80" cy="80" r="55" fill="none" stroke={colors[i]} strokeWidth="28" pathLength="100" strokeDasharray={`${share*100} ${100-share*100}`} strokeDashoffset={-shares.slice(0,i).reduce((a,b)=>a+b,0)*100} transform="rotate(-90 80 80)"/>)}</svg><div><h3>{t('所选读数占比','Selected reading shares')}</h3><p className="wb-muted">{t('仅同单位、非负数值；表示所选读数总和的份额，不代表设备整体构成。','Nonnegative, same-unit readings only. Shares of the selected sum, not physical composition.')}</p>{values.map((r,i)=><p key={r.id}><span style={{color:colors[i]}}>●</span> {r.label} <strong>{(shares[i]*100).toFixed(1)}%</strong></p>)}</div></div>:<p className="wb-notice">{t('混合单位、温度、百分比或负值不相加成饼图；上方独立比例环仍可实时对比。','Mixed units, temperatures, percentages or negative values are not combined into a pie. Individual range rings still update live.')}</p>}</>}
  </section>;
}

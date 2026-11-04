import { useId, useState } from 'react';
import { useLang } from '@/hooks/useLang';
import { observationStats, type Observation } from '@/features/workbench/data';

/** Time-scaled plotting; gaps in sampled telemetry remain gaps rather than interpolated observations. */
export function TrendChart({ points, unit, label, sampleMs }: { points: readonly Observation[]; unit: string; label: string; sampleMs?: number }) {
  const lang = useLang(), id = useId();
  const [cursor, setCursor] = useState<number | null>(null);
  const stats = observationStats(points);
  if (!stats) return <div className="wb-empty"><strong>{lang === 'zh' ? '等待数据' : 'Waiting for data'}</strong><p>{lang === 'zh' ? '选择通道或导入数据后显示曲线。' : 'Select a channel or import observations.'}</p></div>;
  const first = points[0].at, last = points.at(-1)!.at;
  const scale = Math.max(Math.abs(stats.min), Math.abs(stats.max), 1);
  const low = stats.min / scale, span = stats.max / scale - low || .1;
  const x = (at: number) => 58 + (last === first ? .5 : (at - first) / (last - first)) * 840;
  const y = (v: number) => stats.min === stats.max ? 124 : 200 - (v / scale - low) / span * 152;
  // Keep at most 1200 displayed samples; raw observations remain in stats, table and export.
  const stride = Math.max(1, Math.ceil(points.length / 1200));
  const displayed = points.filter((_, i) => i % stride === 0 || i === points.length - 1);
  let path = '';
  displayed.forEach((p, i) => { const gap = sampleMs && i > 0 && points.slice(Math.max(0, (i - 1) * stride), i * stride + 1).some((a, j, arr) => j > 0 && a.at - arr[j - 1].at > sampleMs * 3); path += `${i === 0 || gap ? 'M' : 'L'}${x(p.at)},${y(p.value)} `; });
  const index = cursor === null ? points.length - 1 : Math.min(cursor, points.length - 1), selected = points[index];
  const number = (n: number) => n.toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', { maximumFractionDigits: 3 });
  const time = (at: number) => new Date(at).toLocaleTimeString(lang === 'zh' ? 'zh-CN' : 'en-US', { hour12: false });
  return <div className="wb-trend">
    <div className="wb-chart-caption"><span>{label} <small>{unit}</small></span><strong>{number(selected.value)} {unit}<small> · {new Date(selected.at).toLocaleString()}</small></strong></div>
    <svg viewBox="0 0 960 248" role="img" aria-labelledby={id} onPointerMove={event => { const rect = event.currentTarget.getBoundingClientRect(); const ratio = Math.max(0, Math.min(1, ((event.clientX - rect.left) / rect.width * 960 - 58) / 840)); const at = first + ratio * (last - first); let best = 0; points.forEach((p, i) => { if (Math.abs(p.at - at) < Math.abs(points[best].at - at)) best = i; }); setCursor(best); }} onPointerLeave={() => setCursor(null)}>
      <title id={id}>{label} · {points.length} samples · {unit}</title>
      {[0, .25, .5, .75, 1].map(v => <g key={v}><line x1="58" x2="898" y1={200 - v * 152} y2={200 - v * 152} className="wb-gridline" /><text x="48" y={204 - v * 152} textAnchor="end">{number(stats.min === stats.max ? stats.min : Math.max(-1, Math.min(1, low + span * v)) * scale)}</text></g>)}
      <path d={path} fill="none" className="wb-chart-line" vectorEffect="non-scaling-stroke" />
      <line x1={x(selected.at)} x2={x(selected.at)} y1="32" y2="200" className="wb-cursor" />
      <circle cx={x(selected.at)} cy={y(selected.value)} r="4" className="wb-chart-dot" />
      <text x="58" y="230">{time(first)}</text><text x="898" y="230" textAnchor="end">{time(last)}</text>
    </svg>
    <label className="wb-seek">{lang === 'zh' ? '定位样本' : 'Inspect a sample'}<input type="range" min="0" max={points.length - 1} value={index} onChange={e => setCursor(Number(e.target.value))} aria-label={lang === 'zh' ? '定位曲线样本' : 'Inspect chart sample'} /><output>{index + 1} / {points.length}</output></label>
    <div className="wb-chart-stats">{[[lang === 'zh' ? '最小值' : 'Minimum', number(stats.min)], [lang === 'zh' ? '平均值' : 'Mean', number(stats.mean)], [lang === 'zh' ? '最大值' : 'Maximum', number(stats.max)], [lang === 'zh' ? '当前范围样本' : 'Samples in range', stats.count]].map(([title, value]) => <div key={title}><span>{title}</span><strong>{value}</strong></div>)}</div>
  </div>;
}

import { useState } from 'react';
import { shifts } from './snapshot';

type Copy = (zh: string, en: string) => string;
type Point = { x: number; y: number };

function smoothLine(points: Point[]) {
  return points.reduce((path, point, i) => {
    if (!i) return `M ${point.x} ${point.y}`;
    const prev = points[i - 1],
      mid = (prev.x + point.x) / 2;
    return `${path} C ${mid} ${prev.y}, ${mid} ${point.y}, ${point.x} ${point.y}`;
  }, '');
}

export function Sparkline({ values }: { values: number[] }) {
  const low = Math.min(...values),
    high = Math.max(...values);
  const path = smoothLine(
    values.map((value, i) => ({
      x: 1 + i * 11,
      y: 25 - ((value - low) / (high - low || 1)) * 20,
    })),
  );
  return (
    <svg className="fo-spark" viewBox="0 0 68 30" aria-hidden="true">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
    </svg>
  );
}

export default function Trend({ t }: { t: Copy }) {
  const [period, setPeriod] = useState<'day' | 'week'>('day');
  const [active, setActive] = useState<number | null>(null);
  const { labels, values } = shifts[period];
  const top = period === 'day' ? 80 : 400;
  const points = values.map((value, i) => ({
    x: 5 + (i * 590) / (values.length - 1),
    y: 10 + (1 - value / top) * 112,
  }));
  const line = smoothLine(points);
  return (
    <section className="fo-card fo-trend card-spotlight">
      <div className="fo-panel-head">
        <h2>{t('作业面积趋势', 'Field area trend')}</h2>
        <div className="fo-segment">
          {(['day', 'week'] as const).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={period === key}
              onClick={() => {
                setPeriod(key);
                setActive(null);
              }}
            >
              {key === 'day' ? t('当日', 'Day') : t('近七日', 'Week')}
            </button>
          ))}
        </div>
      </div>
      <p className="fo-legend">
        <i />
        {period === 'day' ? t('各时段作业面积', 'Area per interval') : t('每日作业面积', 'Area per day')}
        <span> / {t('亩', 'mu')}</span>
      </p>
      <div className="fo-chart">
        <div className="fo-yticks">
          {[top, top * 0.75, top * 0.5, top * 0.25, 0].map((value) => (
            <span key={value}>{value}</span>
          ))}
        </div>
        <div className="fo-plot" onPointerLeave={() => setActive(null)}>
          <svg viewBox="0 0 600 132" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id="fo-area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#4b9bf9" stopOpacity=".31" />
                <stop offset="100%" stopColor="#4b9bf9" stopOpacity=".02" />
              </linearGradient>
            </defs>
            {[10, 38, 66, 94, 122].map((y) => (
              <path
                key={y}
                d={`M0 ${y}H600`}
                stroke="#e2eaf3"
                strokeDasharray="4 5"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <path d={`${line} L595 122 H5Z`} fill="url(#fo-area)" />
            <path d={line} fill="none" stroke="#3286ed" strokeWidth="2.8" vectorEffect="non-scaling-stroke" />
            {active !== null && (
              <path d={`M${points[active].x} 8 V122`} stroke="#7faee7" strokeDasharray="4 3" />
            )}
          </svg>
          {points.map((p, i) => (
            <button
              key={labels[i]}
              type="button"
              className="fo-point"
              style={{ left: `${p.x / 6}%`, top: `${(p.y / 132) * 100}%` }}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              onPointerEnter={() => setActive(i)}
              onClick={() => setActive(i)}
              aria-label={`${labels[i]} · ${values[i]} ${t('亩', 'mu')}`}
            >
              {active === i && (
                <span className={i === 0 ? 'align-start' : i === points.length - 1 ? 'align-end' : ''}>
                  {labels[i]} · {values[i]} {t('亩', 'mu')}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="fo-xticks">
          {labels.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
      </div>
    </section>
  );
}

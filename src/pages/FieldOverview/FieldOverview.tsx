import { useState } from 'react';
import { useLang } from '@/hooks/useLang';
import { FleetStatus, FleetTable } from './Fleet';
import Trend from './Trend';
import { totals, type Status } from './snapshot';
import './field-overview.css';

function useCopy() { const lang = useLang(); return (...labels: string[]) => labels[lang === 'zh' ? 0 : 1]; }
function DemoSource() { const t = useCopy(); return <p className="wb-notice">{t('固定演示快照 · 2026-11-06 · 未连接真实农场或农机', 'Fixed demo snapshot · 2026-11-06 · no live farm or machinery connection')}</p>; }

/** Fleet details live with machine objects, under the shared site navigation. */
export function FieldFleet() {
  const t = useCopy();
  const [filter, setFilter] = useState<Status | 'all'>('all');
  return <section className="fo-integrated" aria-label={t('演示农机台账', 'Demo fleet register')}>
    <DemoSource />
    <FleetStatus t={t} inspect={setFilter} />
    <FleetTable t={t} filter={filter} setFilter={setFilter} />
  </section>;
}

/** Work totals and trend are a dataset in the data center, not a separate home. */
export function FieldAnalytics() {
  const t = useCopy();
  return <section className="fo-integrated" aria-label={t('作业演示统计', 'Demo work statistics')}>
    <DemoSource />
    <div className="wb-metrics wb-three">{[
      [t('作业面积', 'Worked area'), totals.area, t('亩', 'mu')],
      [t('作业时长', 'Operating time'), totals.hours, t('小时', 'hours')],
      [t('燃油消耗', 'Fuel consumed'), totals.fuel, t('升', 'litres')],
    ].map(([label, value, unit]) => <div className="wb-metric" key={String(label)}><span>{label}</span><strong>{value}</strong><small>{unit}</small></div>)}</div>
    <Trend t={t} />
  </section>;
}

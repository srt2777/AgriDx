import { lazy, memo, useEffect, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import {
  BookOpen,
  Boxes,
  ChevronRight,
  Cpu,
  Gauge,
  LayoutGrid,
  Loader2,
  Radar,
  Sprout,
  Tractor,
  Wheat,
} from 'lucide-react';
import DeferredScene from '@/components/DeferredScene';
import { useKnowledgeCatalog } from '@/hooks/useKnowledgeCatalog';
import { useLang } from '@/hooks/useLang';
import { preloadPage } from '@/lib/page-loaders';
import {
  HALL_EXAMPLE_DEVICES,
  HALL_EXAMPLE_LABEL,
  HALL_EXAMPLE_TOTAL,
  HALL_STATUS_EXAMPLE,
  HALL_ZONES,
  type HallDeviceStatus,
  type HallZoneId,
} from './hall-example-data';
import './hall.css';

const HallScene = lazy(() => import('./HallScene'));

const HallStage = memo(function HallStage({
  selected,
  hovered,
  reducedMotion,
  onSelect,
  onHover,
}: {
  selected: HallZoneId;
  hovered: HallZoneId | null;
  reducedMotion: boolean;
  onSelect: (id: HallZoneId) => void;
  onHover: (id: HallZoneId | null) => void;
}) {
  return (
    <DeferredScene priority fallback={<HallSceneLoading />}>
      <HallScene selected={selected} hovered={hovered} reducedMotion={reducedMotion} onSelect={onSelect} onHover={onHover} />
    </DeferredScene>
  );
});

function HallSceneLoading() {
  const lang = useLang();
  return (
    <div className="hall-fallback" role="status">
      <Loader2 size={20} className="motion-safe:animate-spin" />
      <p>{lang === 'zh' ? '正在打开展示大厅…' : 'Opening the hall…'}</p>
    </div>
  );
}
const ZONE_ICONS = { A: Gauge, B: Wheat, C: Sprout, D: Radar };

function shanghaiStamp(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')} ${pick('hour')}:${pick('minute')}:${pick('second')}`;
}

function useShanghaiClock(): string {
  const [stamp, setStamp] = useState(() => shanghaiStamp(new Date()));
  useEffect(() => {
    const timer = window.setInterval(() => setStamp(shanghaiStamp(new Date())), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return stamp;
}

const STATUS_TARGETS = HALL_STATUS_EXAMPLE.map((item) => item.count);

function useCountUps(targets: readonly number[], reduced: boolean): number[] {
  const [values, setValues] = useState<number[]>(() => (reduced ? [...targets] : targets.map(() => 0)));
  useEffect(() => {
    if (reduced) {
      setValues([...targets]);
      return;
    }
    const origin = targets.map(() => 0);
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 900);
      const eased = 1 - (1 - t) ** 3;
      setValues(targets.map((goal, index) => origin[index] + (goal - origin[index]) * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [reduced, targets]);
  return values;
}

function StatusRing({ label, reducedMotion }: { label: string; reducedMotion: boolean }) {
  const lang = useLang();
  const counts = useCountUps(STATUS_TARGETS, reducedMotion);
  const shown = counts.map((value) => Math.round(value));
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const gap = 0.03 * circumference;
  let cursor = 0;
  const summary = HALL_STATUS_EXAMPLE.map((item, index) => `${lang === 'zh' ? item.zh : item.en} ${shown[index]}`).join('，');
  return (
    <figure className="hall-ring" aria-label={`${label}，${summary}`}>
      <svg viewBox="0 0 120 120" role="img">
        <title>{`${label} ${HALL_EXAMPLE_TOTAL}`}</title>
        <circle className="hall-ring-track" cx="60" cy="60" r={radius} />
        <circle className="hall-ring-sweep" cx="60" cy="60" r="52" />
        {HALL_STATUS_EXAMPLE.map((item, index) => {
          const length = Math.max((counts[index] / HALL_EXAMPLE_TOTAL) * circumference - gap, 0);
          const dash = `${length} ${circumference - length}`;
          const offset = -cursor;
          cursor += length + gap;
          return (
            <circle
              key={item.id}
              className={`hall-ring-arc is-${item.id}`}
              cx="60"
              cy="60"
              r={radius}
              strokeDasharray={dash}
              strokeDashoffset={offset}
            />
          );
        })}
        <text x="60" y="58" textAnchor="middle" className="hall-ring-total">{shown.reduce((sum, value) => sum + value, 0)}</text>
        <text x="60" y="74" textAnchor="middle" className="hall-ring-unit">{lang === 'zh' ? '台' : 'units'}</text>
      </svg>
      <figcaption>
        {HALL_STATUS_EXAMPLE.map((item, index) => (
          <span key={item.id} className={`hall-legend is-${item.id}`}>
            <i />
            {lang === 'zh' ? item.zh : item.en}
            <strong>{shown[index]}</strong>
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

export default function HallPage() {
  const lang = useLang();
  const t = (zh: string, en: string) => (lang === 'zh' ? zh : en);
  const stamp = useShanghaiClock();
  const { catalog, loading, failed } = useKnowledgeCatalog();
  const [selected, setSelected] = useState<HallZoneId>('A');
  const [hovered, setHovered] = useState<HallZoneId | null>(null);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReducedMotion(media.matches);
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);
  const zone = HALL_ZONES.find((item) => item.id === selected)!;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      const index = HALL_ZONES.findIndex((item) => item.id === selected);
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      event.preventDefault();
      const next = event.key === 'ArrowRight' ? (index + 1) % HALL_ZONES.length : (index + HALL_ZONES.length - 1) % HALL_ZONES.length;
      setSelected(HALL_ZONES[next].id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);
  const number = (value: number | undefined) => (loading || failed || value === undefined ? '—' : value.toLocaleString());
  const statusLabel = (status: HallDeviceStatus) => {
    const item = HALL_STATUS_EXAMPLE.find((entry) => entry.id === status)!;
    return lang === 'zh' ? item.zh : item.en;
  };

  return (
    <div className="hall-page">
      <section className="hall-board" aria-labelledby="hall-title">
        <header className="hall-top">
          <p>{t('结构示意 · 非实车监测', 'SCHEMATIC · NOT LIVE TELEMETRY')}</p>
          <h1 id="hall-title">{t('农机装备数字孪生展示大厅', 'Agricultural equipment digital-twin hall')}</h1>
          <time dateTime={stamp}>{stamp}</time>
        </header>
        <div className="hall-body">
          <nav className="hall-zones" aria-label={t('展区导航', 'Zone navigation')}>
            {HALL_ZONES.map((item) => {
              const Icon = ZONE_ICONS[item.id];
              const active = selected === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`hall-zone${active ? ' is-on' : ''}${hovered === item.id ? ' is-hover' : ''}`}
                  aria-pressed={active}
                  style={{ '--zone-color': item.color } as CSSProperties}
                  onClick={() => setSelected(item.id)}
                  onPointerEnter={() => setHovered(item.id)}
                  onPointerLeave={() => setHovered(null)}
                >
                  <span className="hall-zone-mark"><Icon size={16} strokeWidth={1.6} /></span>
                  <span>
                    <small>{item.id} {t('展区', 'ZONE')}</small>
                    <strong>{t(item.zh, item.en)}</strong>
                  </span>
                  <ChevronRight size={16} />
                </button>
              );
            })}
            <p className="hall-zone-note">{t(zone.blurbZh, zone.blurbEn)}</p>
          </nav>
          <div className="hall-stage">
            <div className="hall-stage-caption">
              <span>{selected} {t('展区', 'ZONE')} · {t('左右方向键切换', 'Arrow keys switch zones')}</span>
              <strong>{t(zone.zh, zone.en)}</strong>
            </div>
            <HallStage
              selected={selected}
              hovered={hovered}
              reducedMotion={reducedMotion}
              onSelect={setSelected}
              onHover={setHovered}
            />
            <div className="hall-scan" aria-hidden="true" />
          </div>
          <aside className="hall-side">
            <section className="hall-panel" aria-labelledby="hall-status-title">
              <header>
                <h2 id="hall-status-title">{t('运行状态概览', 'Status overview')}</h2>
                <span className="hall-example-tag">{HALL_EXAMPLE_LABEL}</span>
              </header>
              <StatusRing label={t('示例运行状态', 'Example operating status')} reducedMotion={reducedMotion} />
            </section>
            <section className="hall-panel hall-devices" aria-labelledby="hall-device-title">
              <header>
                <h2 id="hall-device-title">{t('设备列表', 'Equipment list')}</h2>
                <span className="hall-example-tag">{HALL_EXAMPLE_LABEL}</span>
              </header>
              <div className="hall-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{t('设备名称', 'Name')}</th>
                      <th>{t('管理人', 'Owner')}</th>
                      <th>{t('状态', 'Status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {HALL_EXAMPLE_DEVICES.map((device) => (
                      <tr
                        key={device.id}
                        className={device.zone === selected ? 'is-current' : ''}
                        data-zone={device.zone}
                        tabIndex={0}
                        role="button"
                        aria-pressed={device.zone === selected}
                        onClick={() => setSelected(device.zone)}
                        onPointerEnter={() => setHovered(device.zone)}
                        onPointerLeave={() => setHovered(null)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setSelected(device.zone);
                          }
                        }}
                      >
                        <td>
                          <strong>{device.name}</strong>
                          <small>{device.zone} {t('展区', 'zone')}</small>
                        </td>
                        <td>{device.manager}</td>
                        <td><span className={`hall-badge is-${device.status}`}>{statusLabel(device.status)}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </aside>
        </div>
        <div className="hall-cards">
          <article className="hall-card is-lead">
            <LayoutGrid size={18} />
            <div>
              <h2>{t('展厅概况', 'Hall overview')}</h2>
              <p>
                {t(
                  `资料目录 ${number(catalog?.totals.entries)} 条 · ${number(catalog?.totals.brands)} 个品牌 · ${number(catalog?.totals.models)} 个型号或系列。运行环中的 12 台是示例，不是在线机队。`,
                  `${number(catalog?.totals.entries)} catalog entries · ${number(catalog?.totals.brands)} brands · ${number(catalog?.totals.models)} models or series. The ring’s 12 units are an example, not a live fleet.`,
                )}
              </p>
            </div>
          </article>
          <Link className="hall-card" to="/knowledge" onPointerEnter={() => preloadPage('/knowledge')} onFocus={() => preloadPage('/knowledge')}>
            <BookOpen size={18} />
            <div><h2>{t('四大展区', 'Four zones')}</h2><p>{t('按动力、耕作、收获与智慧农业浏览示意分区。', 'Browse power, tillage, harvest and smart-agriculture stands.')}</p></div>
          </Link>
          <Link className="hall-card" to="/knowledge" onPointerEnter={() => preloadPage('/knowledge')} onFocus={() => preloadPage('/knowledge')}>
            <Tractor size={18} />
            <div><h2>{t('在展机具', 'Catalogued machines')}</h2><p>{t(`${number(catalog?.totals.models)} 个型号或系列可从知识目录打开。`, `${number(catalog?.totals.models)} models or series open from the catalog.`)}</p></div>
          </Link>
          <Link className="hall-card" to="/models" onPointerEnter={() => preloadPage('/models')} onFocus={() => preloadPage('/models')}>
            <Boxes size={18} />
            <div><h2>{t('结构示意', 'Structure')}</h2><p>{t('模型工坊查看部件，不等同于实测外形。', 'Open the studio for components. It is not a measured body.')}</p></div>
          </Link>
          <Link className="hall-card" to="/chat" onPointerEnter={() => preloadPage('/chat')} onFocus={() => preloadPage('/chat')}>
            <Cpu size={18} />
            <div><h2>{t('智能诊断', 'Diagnosis')}</h2><p>{t('带着机型与现象进入诊断工作台。', 'Take a model and symptoms to the diagnosis desk.')}</p></div>
          </Link>
          <Link className="hall-card" to="/knowledge" onPointerEnter={() => preloadPage('/knowledge')} onFocus={() => preloadPage('/knowledge')}>
            <BookOpen size={18} />
            <div><h2>{t('资料目录', 'Evidence')}</h2><p>{t(`${number(catalog?.totals.sources)} 个来源，适用范围仍需核对。`, `${number(catalog?.totals.sources)} sources. Applicability still needs a check.`)}</p></div>
          </Link>
          <article className="hall-card">
            <Gauge size={18} />
            <div><h2>{t('监测边界', 'Monitoring limit')}</h2><p>{t('未接入传感器、告警或实车孪生数据。', 'No sensors, alarms or physical-twin feed are connected.')}</p></div>
          </article>
        </div>
      </section>
    </div>
  );
}

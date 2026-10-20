import { lazy, memo, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  BookOpen,
  Boxes,
  ChevronRight,
  Cpu,
  Gauge,
  LayoutGrid,
  Radar,
  Sprout,
  Tractor,
  Wheat,
  X,
} from 'lucide-react';
import DeferredScene from '@/components/DeferredScene';
import DemoNote from '@/components/DemoNote';
import SceneFallback from '@/components/SceneFallback';
import { useKnowledgeCatalog } from '@/hooks/useKnowledgeCatalog';
import { useLang } from '@/hooks/useLang';
import { preloadPage } from '@/lib/page-loaders';
import { beginSharedTransition, sharedTransitionName } from '@/lib/shared-transition';
import { StatTicker } from '@/components/StatTicker';
import { RING_DRAW_MS, zoneSweep } from '@/lib/delight';
import { easeOutCubic, MOTION } from '@/lib/motion-tokens';
import { probeWebGL, type GraphicsReason } from '@/lib/webgl';
import {
  HALL_EXAMPLE_DEVICES,
  adjacentHallZone,
  devicesInZone,
  exampleDataLabel,
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
  focus,
  hovered,
  reducedMotion,
  idle,
  onSelect,
  onHover,
  onLive,
  onLost,
}: {
  selected: HallZoneId;
  focus: HallZoneId | null;
  hovered: HallZoneId | null;
  reducedMotion: boolean;
  idle: boolean;
  onSelect: (id: HallZoneId) => void;
  onHover: (id: HallZoneId | null) => void;
  onLive: () => void;
  onLost: () => void;
}) {
  return (
    <DeferredScene priority fallback={null}>
      <HallScene selected={selected} focus={focus} hovered={hovered} reducedMotion={reducedMotion} idle={idle} onSelect={onSelect} onHover={onHover} onLive={onLive} onLost={onLost} />
    </DeferredScene>
  );
});
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

function useCountUps(targets: readonly number[], reduced: boolean, duration: number = MOTION.ms.count): number[] {
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
      const t = Math.min(1, (now - start) / duration);
      const eased = easeOutCubic(t);
      setValues(targets.map((goal, index) => origin[index] + (goal - origin[index]) * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [reduced, targets, duration]);
  return values;
}

function StatusRing({ label, reducedMotion }: { label: string; reducedMotion: boolean }) {
  const lang = useLang();
  const counts = useCountUps(STATUS_TARGETS, reducedMotion, RING_DRAW_MS);
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

function HallStageLight() {
  const node = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const light = node.current;
    const stage = light?.parentElement;
    if (!light || !stage) return;
    let frame = 0;
    let point: PointerEvent | null = null;
    const paint = () => {
      frame = 0;
      const event = point;
      if (!event) return;
      const rect = stage.getBoundingClientRect();
      light.style.setProperty('--hall-x', `${event.clientX - rect.left}px`);
      light.style.setProperty('--hall-y', `${event.clientY - rect.top}px`);
      light.style.opacity = '0.55';
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      point = event;
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const leave = () => {
      point = null;
      cancelAnimationFrame(frame);
      frame = 0;
      light.style.opacity = '0';
    };
    stage.addEventListener('pointermove', move);
    stage.addEventListener('pointerleave', leave);
    return () => {
      stage.removeEventListener('pointermove', move);
      stage.removeEventListener('pointerleave', leave);
      cancelAnimationFrame(frame);
    };
  }, []);
  return <div ref={node} className="hall-stage-light" aria-hidden="true" />;
}

export default function HallPage() {
  const lang = useLang();
  const navigate = useNavigate();
  const t = (zh: string, en: string) => (lang === 'zh' ? zh : en);
  const stamp = useShanghaiClock();
  const { catalog, loading, failed } = useKnowledgeCatalog();
  const [selected, setSelected] = useState<HallZoneId>('A');
  const [focus, setFocus] = useState<HallZoneId | null>(null);
  const [detail, setDetail] = useState(false);
  const [scan, setScan] = useState(0);
  const zoneRef = useRef(selected);
  const choose = useCallback((id: HallZoneId) => {
    if (zoneSweep(zoneRef.current, id)) setScan((value) => value + 1);
    zoneRef.current = id;
    setSelected(id);
    setFocus(id);
    setDetail(true);
  }, []);
  const [hovered, setHovered] = useState<HallZoneId | null>(null);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [idle, setIdle] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [graphics, setGraphics] = useState<GraphicsReason | 'live'>(() => (probeWebGL() ? 'loading' : 'unsupported'));
  const onLive = useCallback(() => setGraphics('live'), []);
  const onLost = useCallback(() => setGraphics((current) => (current === 'unsupported' ? current : 'lost')), []);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => {
      setReducedMotion(media.matches);
      if (media.matches) setIdle(false);
    };
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);
  const zone = HALL_ZONES.find((item) => item.id === selected)!;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      if (event.key === 'Escape') {
        setDetail(false);
        return;
      }
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      event.preventDefault();
      choose(adjacentHallZone(selected, event.key === 'ArrowRight' ? 1 : -1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, choose]);
  const stat = (value: number | undefined) => (loading || failed ? undefined : value);
  const statusLabel = (status: HallDeviceStatus) => {
    const item = HALL_STATUS_EXAMPLE.find((entry) => entry.id === status)!;
    return lang === 'zh' ? item.zh : item.en;
  };

  return (
    <div className="hall-page">
      <section className="hall-board nv-corners" aria-labelledby="hall-title">
        <header className="hall-top">
          <div className="hall-kicker">
            <p>{t('结构示意 · 不是实车监测', 'Schematic · not live monitoring')}</p>
            <button
              type="button"
              className="hall-idle-toggle"
              aria-pressed={idle}
              disabled={reducedMotion}
              onClick={() => setIdle((value) => !value)}
            >
              {idle ? t('暂停动态', 'Pause motion') : t('机具动态', 'Machine motion')}
            </button>
            <DemoNote />
          </div>
          <div className="hall-title-plate">
            <h1 id="hall-title" data-shared-target="hall">{t('农机装备数字孪生展示大厅', 'Agricultural equipment digital-twin hall')}</h1>
          </div>
          <span className="wheat-line" aria-hidden="true" />
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
                  className={`hall-zone nv-corners${active ? ' is-on' : ''}${hovered === item.id ? ' is-hover' : ''}`}
                  aria-pressed={active}
                  style={{ '--zone-color': item.color } as CSSProperties}
                  onClick={() => choose(item.id)}
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
          <div className={`hall-stage${graphics === 'live' ? ' is-live' : ''}${detail ? ' is-detail' : ''}`}>
            <SceneFallback kind="hall" reason={graphics === 'live' ? 'loading' : graphics} hidden={graphics === 'live'} />
            <div className="hall-stage-caption">
              <span>{selected} {t('展区', 'ZONE')} · {t('点按机具或方向键切换', 'Tap a machine or use arrow keys')}</span>
              <strong>{t(zone.zh, zone.en)}</strong>
              <ul className="hall-stage-devices">
                {devicesInZone(selected).map((device) => (
                  <li key={device.id}><strong>{device.name}</strong><span>{statusLabel(device.status)}</span></li>
                ))}
              </ul>
            </div>
            {scan > 0 && !reducedMotion && <div key={scan} className="hall-scan" aria-hidden="true" />}
            {!reducedMotion && <HallStageLight />}
            {(graphics === 'loading' || graphics === 'live') && (
              <div className="hall-stage-view">
                <HallStage
                  selected={selected}
                  focus={focus}
                  hovered={hovered}
                  reducedMotion={reducedMotion}
                  idle={idle}
                  onSelect={choose}
                  onHover={setHovered}
                  onLive={onLive}
                  onLost={onLost}
                />
              </div>
            )}
            {detail && (
              <aside className="hall-drawer nv-corners" key={selected} aria-labelledby="hall-drawer-title">
                <header>
                  <div>
                    <span>{selected} {t('展区', 'ZONE')}</span>
                    <h2 id="hall-drawer-title">{t(zone.zh, zone.en)}</h2>
                  </div>
                  <button type="button" className="hall-drawer-close" onClick={() => setDetail(false)} aria-label={t('关闭展区详情', 'Close zone detail')}>
                    <X size={16} />
                  </button>
                </header>
                <p>{t(zone.blurbZh, zone.blurbEn)}</p>
                <span className="nv-example">{exampleDataLabel(lang)}</span>
                <ul>
                  {devicesInZone(selected).map((device) => (
                    <li key={device.id}>
                      <strong>{device.name}</strong>
                      <em className={`is-${device.status}`}>{statusLabel(device.status)}</em>
                      <small>{lang === 'zh' ? device.specZh : device.specEn}</small>
                    </li>
                  ))}
                </ul>
                <p className="hall-drawer-note">{t('规格是示例数据，不是铭牌或实测。', 'Specs are example data, not a plate or a measurement.')}</p>
                <Link to="/knowledge" onPointerEnter={() => preloadPage('/knowledge')} onFocus={() => preloadPage('/knowledge')} onClick={(event) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
                  event.preventDefault();
                  beginSharedTransition(sharedTransitionName('hall', selected), () => navigate('/knowledge'), document.getElementById('hall-drawer-title'));
                }}>
                  {t('查看该展区资料', 'Open this zone’s evidence')}
                </Link>
              </aside>
            )}
          </div>
          <aside className="hall-side">
            <section className="hall-panel nv-corners" aria-labelledby="hall-status-title">
              <header>
                <h2 id="hall-status-title">{t('运行状态概览', 'Status overview')}</h2>
                <span className="nv-example">{exampleDataLabel(lang)}</span>
              </header>
              <StatusRing label={t('示例运行状态', 'Example operating status')} reducedMotion={reducedMotion} />
            </section>
            <section className="hall-panel hall-devices nv-corners" aria-labelledby="hall-device-title">
              <header>
                <h2 id="hall-device-title">{t('设备列表', 'Equipment list')}</h2>
                <span className="nv-example">{exampleDataLabel(lang)}</span>
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
                        onClick={() => choose(device.zone)}
                        onPointerEnter={() => setHovered(device.zone)}
                        onPointerLeave={() => setHovered(null)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            choose(device.zone);
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
            <span className="hall-card-icon"><LayoutGrid size={16} /></span>
            <div>
              <h2>{t('展厅概况', 'Hall overview')}</h2>
              <p>
                {lang === 'zh' ? (
                  <>目录 <span className="hall-stat"><StatTicker value={stat(catalog?.totals.entries)} reduced={reducedMotion} /></span> 条 · <span className="hall-stat"><StatTicker value={stat(catalog?.totals.brands)} reduced={reducedMotion} /></span> 个品牌 · <span className="hall-stat"><StatTicker value={stat(catalog?.totals.models)} reduced={reducedMotion} /></span> 个型号或系列。环上的 12 台是示例，不是在线机队。</>
                ) : (
                  <><span className="hall-stat"><StatTicker value={stat(catalog?.totals.entries)} reduced={reducedMotion} /></span> catalog entries · <span className="hall-stat"><StatTicker value={stat(catalog?.totals.brands)} reduced={reducedMotion} /></span> brands · <span className="hall-stat"><StatTicker value={stat(catalog?.totals.models)} reduced={reducedMotion} /></span> models or series. The ring’s 12 units are an example, not a live fleet.</>
                )}
              </p>
            </div>
          </article>
          <Link className="hall-card" to="/knowledge" onPointerEnter={() => preloadPage('/knowledge')} onFocus={() => preloadPage('/knowledge')}>
            <span className="hall-card-icon"><Wheat size={16} /></span>
            <div><h2>{t('四大展区', 'Four zones')}</h2><p>{t('动力、耕作、收获、智慧农业。', 'Power, tillage, harvest, and smart agriculture.')}</p></div>
          </Link>
          <Link className="hall-card" to="/knowledge" onPointerEnter={() => preloadPage('/knowledge')} onFocus={() => preloadPage('/knowledge')}>
            <span className="hall-card-icon"><Tractor size={16} /></span>
            <div><h2>{t('在展机具', 'Machines on show')}</h2><p>{lang === 'zh' ? <><StatTicker value={stat(catalog?.totals.models)} reduced={reducedMotion} /> 个型号或系列，可从知识目录打开。</> : <><StatTicker value={stat(catalog?.totals.models)} reduced={reducedMotion} /> models or series open from the catalog.</>}</p></div>
          </Link>
          <Link className="hall-card" to="/models" onPointerEnter={() => preloadPage('/models')} onFocus={() => preloadPage('/models')}>
            <span className="hall-card-icon"><Boxes size={16} /></span>
            <div><h2>{t('结构示意', 'Schematic')}</h2><p>{t('到模型工坊看部件。这不是实测外形。', 'Open the studio for parts. This is not a measured body.')}</p></div>
          </Link>
          <Link className="hall-card" to="/chat" onPointerEnter={() => preloadPage('/chat')} onFocus={() => preloadPage('/chat')}>
            <span className="hall-card-icon"><Cpu size={16} /></span>
            <div><h2>{t('智能诊断', 'Diagnosis')}</h2><p>{t('带上机型和现象，进入诊断。', 'Bring a model and a symptom to diagnosis.')}</p></div>
          </Link>
          <Link className="hall-card" to="/knowledge" onPointerEnter={() => preloadPage('/knowledge')} onFocus={() => preloadPage('/knowledge')}>
            <span className="hall-card-icon"><BookOpen size={16} /></span>
            <div><h2>{t('资料目录', 'Evidence')}</h2><p>{lang === 'zh' ? <><StatTicker value={stat(catalog?.totals.sources)} reduced={reducedMotion} /> 个来源。适用范围仍需核对。</> : <><StatTicker value={stat(catalog?.totals.sources)} reduced={reducedMotion} /> sources. Scope still needs a check.</>}</p></div>
          </Link>
          <article className="hall-card">
            <span className="hall-card-icon"><Radar size={16} /></span>
            <div><h2>{t('监测边界', 'Monitoring limit')}</h2><p>{t('未接传感器，也没有实车数据。', 'No sensors, and no data from a physical machine.')}</p></div>
          </article>
        </div>
      </section>
    </div>
  );
}

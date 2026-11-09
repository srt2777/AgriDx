import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  ChartNoAxesCombined,
  ChevronRight,
  Clock3,
  Database,
  Fuel,
  Globe2,
  Layers3,
  LayoutDashboard,
  MapPin,
  Menu,
  MessagesSquare,
  ScanLine,
  Sun,
  Tractor,
  Wheat,
  X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { setLang, useLang } from '@/hooks/useLang';
import { publicAsset } from '@/lib/public-asset';
import { history, machines, totals, type Status } from './snapshot';
import { FleetStatus, FleetTable } from './Fleet';
import Trend, { Sparkline } from './Trend';
import './field-overview.css';

const metrics = [
  {
    key: 'area',
    zh: '作业面积',
    en: 'Worked area',
    icon: ScanLine,
    color: '#247bdc',
    tint: '#e5f1ff',
    unit: ['亩', 'mu'],
  },
  {
    key: 'online',
    zh: '在线农机',
    en: 'Online machines',
    icon: Tractor,
    color: '#21836b',
    tint: '#dff4eb',
    unit: ['台', 'units'],
  },
  {
    key: 'hours',
    zh: '作业时长',
    en: 'Operating time',
    icon: Clock3,
    color: '#9d6a08',
    tint: '#fff0d1',
    unit: ['小时', 'h'],
  },
  {
    key: 'fuel',
    zh: '燃油消耗',
    en: 'Fuel consumed',
    icon: Fuel,
    color: '#8060bf',
    tint: '#ede8fa',
    unit: ['升', 'L'],
  },
] as const;
const navGroups = [
  {
    label: ['农机工作台', 'Workspace'],
    items: [
      { path: 'top', label: ['作业总览', 'Field overview'], icon: LayoutDashboard },
      { path: 'fleet', label: ['农机台账', 'Fleet register'], icon: Tractor },
      { path: '/workspace/data', label: ['数据采集', 'Data collection'], icon: Database },
      { path: '/workspace/analytics', label: ['数据分析', 'Data analytics'], icon: ChartNoAxesCombined },
    ],
  },
  {
    label: ['知识与诊断', 'Knowledge & diagnosis'],
    items: [
      { path: '/chat', label: ['司稼智能诊断', 'Sijia diagnosis'], icon: MessagesSquare },
      { path: '/knowledge', label: ['农机知识', 'Knowledge'], icon: BookOpen },
      { path: '/models', label: ['模型工坊', 'Model studio'], icon: Layers3 },
    ],
  },
] as const;

export default function FieldOverview() {
  const lang = useLang();
  const t = (...labels: string[]) => labels[lang === 'zh' ? 0 : 1];
  const [filter, setFilter] = useState<Status | 'all'>('all');
  const [atFleet, setAtFleet] = useState(false);
  const mobileNav = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    const fleet = document.getElementById('fo-fleet');
    if (!fleet) return;
    const observer = new IntersectionObserver(([entry]) => setAtFleet(entry.isIntersecting), {
      rootMargin: '0px 0px -55% 0px',
    });
    observer.observe(fleet);
    return () => observer.disconnect();
  }, [lang]);
  useEffect(() => {
    window.scrollTo(0, 0);
    const large = window.matchMedia('(min-width: 901px)');
    const close = () => {
      if (large.matches) mobileNav.current?.close();
    };
    large.addEventListener('change', close);
    return () => large.removeEventListener('change', close);
  }, []);
  const go = (target: 'top' | 'fleet') => {
    mobileNav.current?.close();
    const element = document.getElementById(target === 'fleet' ? 'fo-fleet' : 'fo-main');
    element?.focus({ preventScroll: true });
    element?.scrollIntoView({
      block: 'start',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
  };
  const sidebar = (mobile = false) => (
    <>
      <div className="fo-brand">
        <span className="fo-emblem">
          <Wheat size={23} strokeWidth={1.85} />
        </span>
        <div>
          <strong>
            Agri<span>Dx</span>
          </strong>
          <small>{t('司稼', 'Field workspace')}</small>
        </div>
        {mobile && (
          <button
            type="button"
            onClick={() => mobileNav.current?.close()}
            aria-label={t('关闭导航', 'Close navigation')}
          >
            <X size={19} />
          </button>
        )}
      </div>
      <nav aria-label={t('平台导航', 'Platform navigation')}>
        {navGroups.map((group) => (
          <div className="fo-nav-group" key={group.label[0]}>
            <h2>{t(...group.label)}</h2>
            {group.items.map(({ path, label, icon: Icon }) => {
              const contents = (
                <>
                  <Icon size={17} strokeWidth={1.7} />
                  <span>{t(...label)}</span>
                </>
              );
              if (path === 'top' || path === 'fleet') {
                const active = path === (atFleet ? 'fleet' : 'top');
                return (
                  <button
                    key={path}
                    type="button"
                    className={active ? 'active' : ''}
                    aria-current={active ? 'location' : undefined}
                    onClick={() => go(path)}
                  >
                    {contents}
                  </button>
                );
              }
              return (
                <Link to={path} key={path} onClick={() => mobileNav.current?.close()}>
                  {contents}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="fo-side-bottom">
        <div
          className="fo-farm"
          style={{
            backgroundImage: `linear-gradient(0deg,rgba(20,45,42,.78),transparent 95%),url("${publicAsset('images/agri-fields.webp')}")`,
          }}
        >
          <MapPin size={15} />
          <strong>{t('南京示范农场', 'Nanjing demo farm')}</strong>
        </div>
        <Link to="/">
          <ArrowLeft size={15} />
          {t('返回平台首页', 'Platform home')}
        </Link>
      </div>
    </>
  );
  return (
    <div className="fo-shell" lang={lang === 'zh' ? 'zh-CN' : 'en'}>
      <a
        className="fo-skip"
        href="#fo-main"
        onClick={(e) => {
          e.preventDefault();
          go('top');
        }}
      >
        {t('跳至主要内容', 'Skip to content')}
      </a>
      <aside className="fo-sidebar">{sidebar()}</aside>
      <dialog
        className="fo-drawer"
        ref={mobileNav}
        aria-label={t('平台导航', 'Platform navigation')}
        onClick={(e) => {
          if (e.target === e.currentTarget) mobileNav.current?.close();
        }}
      >
        <div>{sidebar(true)}</div>
      </dialog>
      <main className="fo-main" id="fo-main" tabIndex={-1}>
        <header className="fo-header">
          <div className="fo-crumb">
            <button
              type="button"
              className="fo-mobile-menu"
              onClick={() => mobileNav.current?.showModal()}
              aria-label={t('打开导航', 'Open navigation')}
            >
              <Menu size={19} />
            </button>
            <span>{t('工作空间', 'Workspace')}</span>
            <ChevronRight size={13} />
            <strong>{t('作业总览', 'Field overview')}</strong>
          </div>
          <div className="fo-tools">
            <span className="fo-source">
              <i />
              {t('演示数据', 'Demo data')}
            </span>
            <time dateTime="2026-11-06">
              <CalendarDays size={15} />
              2026.11.06
            </time>
            <button
              className="fo-lang"
              type="button"
              aria-label={t('Switch to English', '切换到中文')}
              onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
            >
              <Globe2 size={17} />
            </button>
          </div>
        </header>
        <div className="fo-content">
          <section
            className="fo-hero"
            style={{ backgroundImage: `url("${publicAsset('images/field-tractor.webp')}")` }}
          >
            <div className="fo-hero-copy">
              <div className="fo-eyebrow">
                <i /> FIELD OPERATIONS
              </div>
              <h1>{t('农机作业总览', 'Field operations')}</h1>
              <p>
                {t('南京示范农场', 'Nanjing demo farm')}
                <b /> {t('秋季耕整作业', 'Autumn tillage')}
              </p>
              <button
                type="button"
                onClick={() => {
                  setFilter('all');
                  go('fleet');
                }}
              >
                {t('查看农机台账', 'Explore the fleet')}
                <ArrowRight size={16} />
              </button>
            </div>
            <div className="fo-weather">
              <Sun size={24} strokeWidth={1.65} />
              <div>
                <strong>
                  18°<small>C</small>
                </strong>
                <span>{t('晴 · 微风', 'Sunny · Light breeze')}</span>
              </div>
            </div>
          </section>
          <div className="fo-metrics">
            {metrics.map(({ key, zh, en, color, tint, icon: Icon, unit }) => {
              const values = history[key],
                previous = values[values.length - 2];
              const change = (totals[key] / previous - 1) * 100;
              return (
                <article
                  className="fo-card fo-metric card-spotlight"
                  key={key}
                  style={{ '--metric-color': color, '--metric-tint': tint } as CSSProperties}
                >
                  <div className="fo-metric-label">
                    <i>
                      <Icon size={18} />
                    </i>
                    <h2>{t(zh, en)}</h2>
                  </div>
                  <div className="fo-value">
                    <strong>{key === 'online' ? totals[key] : totals[key].toFixed(1)}</strong>
                    <span>{key === 'online' ? `/ ${machines.length} ${t(...unit)}` : t(...unit)}</span>
                  </div>
                  <div className="fo-metric-foot">
                    <small>
                      <ArrowUpRight size={12} /> {change.toFixed(1)}%
                    </small>
                    <span>{t('较昨日', 'vs prior day')}</span>
                  </div>
                  <Sparkline values={values} />
                </article>
              );
            })}
          </div>
          <div className="fo-analysis">
            <Trend t={t} />
            <FleetStatus
              t={t}
              inspect={(status) => {
                setFilter(status);
                go('fleet');
              }}
            />
          </div>
          <FleetTable t={t} filter={filter} setFilter={setFilter} />
        </div>
      </main>
    </div>
  );
}

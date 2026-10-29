import { useEffect, useState } from 'react';
import { preloadPage } from '@/lib/page-loaders';
import { Globe, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useLang, setLang } from '@/hooks/useLang';
import { CommandButton } from '@/components/CommandPalette';
import { SiteStatusBar } from '@/components/SiteStatusBar';
import DemoNote from '@/components/DemoNote';
import VersionSwitch from '@/components/VersionSwitch';
import { beginSharedTransition } from '@/lib/shared-transition';
import { PREMIUM_MOTION_ENABLED } from '@/components/motion/flag';
import { MODERN_DESTINATIONS, modernLocation } from '@/lib/modern-navigation';
import './new-version-shell.css';

/** The blue exhibition chrome used by every page while the new UI is selected. */
export function NewVersionShell() {
  const [navigationCollapsed, setNavigationCollapsed] = useState(() => {
    try { return localStorage.getItem('agridx-modern-navigation-collapsed') === 'true'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('agridx-modern-navigation-collapsed', String(navigationCollapsed)); } catch { /* The toggle also works without storage. */ }
  }, [navigationCollapsed]);
  const lang = useLang();
  const location = useLocation();
  const navigate = useNavigate();
  const place = modernLocation(location.pathname);
  const t = (zh: string, en: string) => lang === 'zh' ? zh : en;

  return (
    <div className="new-version-shell" data-ui-version="new" data-route={location.pathname}>
      <a className="new-version-skip-link" href="#main-content" onClick={event => { event.preventDefault(); const main = document.getElementById('main-content'); main?.focus(); main?.scrollIntoView({ block: 'start' }); }}>{t('跳到主要内容', 'Skip to content')}</a>
      <header className="new-version-header"><div className="new-version-header-glass"><div className="new-version-header-content">
        <div className="new-version-brand">
          <Link to="/" className="new-version-wordmark" aria-label={t('耕知·耘诊大厅', 'Gengzhi · Yunzhen hub')}>
            <strong>耕知 · 耘诊</strong>
          </Link>
        </div>

        <div className="new-version-tools">
          <CommandButton className={PREMIUM_MOTION_ENABLED ? 'glass-press' : undefined} />
          <VersionSwitch exhibition onChange={() => navigate('/')} />
          <DemoNote />
          <button type="button" className="new-version-language" onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')} aria-label={t('切换语言', 'Switch language')}>
            <Globe size={16} />
            <span>{lang === 'zh' ? 'EN' : '中'}</span>
          </button>
        </div>
      </div></div></header>
      <button type="button" className="new-version-nav-toggle" data-collapsed={navigationCollapsed} aria-expanded={!navigationCollapsed} aria-controls="modern-primary-navigation" aria-label={navigationCollapsed ? t('展开导航', 'Show navigation') : t('收起导航', 'Hide navigation')} title={navigationCollapsed ? t('展开导航', 'Show navigation') : t('收起导航', 'Hide navigation')} onClick={() => setNavigationCollapsed(value => !value)}>
        {navigationCollapsed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}
      </button>
      <div className={`new-version-workspace${navigationCollapsed ? ' is-nav-collapsed' : ''}`}>
        <aside id="modern-primary-navigation" className="new-version-navigation-rail" hidden={navigationCollapsed}>
          <nav className="new-version-navigation" aria-label={t('主要功能', 'Main navigation')}>
            {MODERN_DESTINATIONS.map(item => {
              const active = place.sectionPath === item.path;
              return <Link key={item.path} to={item.path}
                aria-current={active ? location.pathname === item.path ? 'page' : 'location' : undefined}
                onPointerEnter={() => preloadPage(item.path, 'new')}
                onFocus={() => preloadPage(item.path, 'new')}
                onClick={event => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0 || location.pathname === item.path) return;
                  event.preventDefault();
                  beginSharedTransition(null, () => navigate(item.path));
                }}
                className={`new-version-nav-item${active ? ' is-active' : ''}`}>
                <span className="new-version-nav-label">{t(item.zh, item.en)}</span>
              </Link>;
            })}
          </nav>
        </aside>
        <div className="new-version-content">
          <nav className="new-version-breadcrumb" aria-label={t('当前位置', 'Breadcrumb')}><ol>{place.breadcrumbs.map((crumb, index) => <li key={crumb.path}>{index === place.breadcrumbs.length - 1 ? <span aria-current="page">{t(crumb.zh, crumb.en)}</span> : <Link to={crumb.path}>{t(crumb.zh, crumb.en)}</Link>}</li>)}</ol></nav>
          <main id="main-content" className="new-version-main" tabIndex={-1}><Outlet /></main>
          <SiteStatusBar />
        </div>
      </div>
    </div>
  );
}

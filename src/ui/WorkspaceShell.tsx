import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { BookOpen, Boxes, ChevronRight, FlaskConical, History, Home, MessageSquare, PanelLeftClose, PanelLeftOpen, Search, X, Globe } from 'lucide-react';
import { useLang, setLang } from '@/hooks/useLang';
import { publicAsset } from '@/lib/public-asset';
import { preloadPage } from '@/lib/page-loaders';
import { openCommandPalette } from '@/lib/command-routes';
import { useTheme } from '@/hooks/useTheme';
import ThemeSwitch from '@/components/ThemeSwitch';
import VersionSwitch from '@/components/VersionSwitch';
import CommandPalette from '@/components/CommandPalette';
import { useUiCopy } from './useUiCopy';
import { MotionConfig } from 'framer-motion';
import { SiteStatusBar } from '@/components/SiteStatusBar';

const destinations = [
  { path: '/', zh: '首页', en: 'Home', icon: Home },
  { path: '/chat', zh: '智能诊断', en: 'Diagnosis', icon: MessageSquare },
  { path: '/knowledge', zh: '农机知识', en: 'Knowledge', icon: BookOpen },
  { path: '/models', zh: '模型工坊', en: 'Model studio', icon: Boxes },
];

/** Sidebar frame for the classic interface only. Modern chrome stays unchanged. */
export function WorkspaceShell() {
  const lang = useLang();
  const theme = useTheme();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const dialog = useRef<HTMLDialogElement>(null);
  const mobileTrigger = useRef<HTMLButtonElement>(null);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('agridx-classic-sidebar-collapsed') === 'true'; } catch { return false; }
  });
  const { t } = useUiCopy();
  const title = destinations.find(item => item.path === pathname);

  useEffect(() => {
    try { localStorage.setItem('agridx-classic-sidebar-collapsed', String(collapsed)); } catch { /* Browsing still works without storage. */ }
  }, [collapsed]);
  useEffect(() => { dialog.current?.close(); }, [pathname]);
  useEffect(() => {
    const original = document.title;
    document.title = '耕知耘诊 农机诊断平台';
    return () => { document.title = original; };
  }, []);
  useEffect(() => {
    const query = window.matchMedia('(min-width: 900px)');
    const closeOnDesktop = () => { if (query.matches) dialog.current?.close(); };
    query.addEventListener('change', closeOnDesktop);
    return () => query.removeEventListener('change', closeOnDesktop);
  }, []);

  const sidebar = (mobile = false) => <>
    <div className="fluid-brand">
      <a href="https://coe.njau.edu.cn/" target="_blank" rel="noopener noreferrer" aria-label={t('南京农业大学工学院官网', 'College of Engineering, NAU website')}>
        <img src={publicAsset('images/njau-engineering-mark.jpg')} alt={t('工学院院徽', 'College emblem')} style={{ objectPosition: theme === 'dark' ? 'right' : 'left' }} />
      </a>
      <Link to="/" onClick={() => dialog.current?.close()}><strong>耕知耘诊</strong></Link>
      <button type="button" className="fluid-icon" onClick={() => mobile ? dialog.current?.close() : setCollapsed(true)} aria-label={mobile ? t('关闭导航', 'Close navigation') : t('收起侧边栏', 'Collapse sidebar')}>
        {mobile ? <X size={17} /> : <PanelLeftClose size={17} />}
      </button>
    </div>
    <button type="button" className="fluid-search" onClick={() => { dialog.current?.close(); openCommandPalette(); }}><Search size={16} /><span>{t('搜索', 'Search')}</span><kbd>⌘ K</kbd></button>
    <nav className="fluid-nav" aria-label={t('主要导航', 'Main navigation')}>
      <details open className="fluid-group"><summary>{t('工作空间', 'Workspace')}<ChevronRight size={14} /></summary>
        {destinations.map(({ path, zh, en, icon: Icon }) => <NavLink key={path} to={path} end={path === '/'} onClick={() => dialog.current?.close()} onPointerEnter={() => preloadPage(path, 'old')} onFocus={() => preloadPage(path, 'old')} className={({ isActive }) => `fluid-row${isActive ? ' is-active' : ''}`}><Icon size={17} strokeWidth={1.6} /><span>{t(zh, en)}</span></NavLink>)}
      </details>
      <details open className="fluid-group"><summary>{t('项目', 'Project')}<ChevronRight size={14} /></summary>
        <button type="button" className="fluid-row" onClick={() => { dialog.current?.close(); navigate('/', { state: { scrollTo: 'research' } }); if (pathname === '/') document.getElementById('research')?.scrollIntoView({ behavior: 'instant', block: 'start' }); }}><FlaskConical size={17} strokeWidth={1.6} /><span>{t('研究依据', 'Research')}</span></button>
        <NavLink to="/version-history" onClick={() => dialog.current?.close()} className={({ isActive }) => `fluid-row${isActive ? ' is-active' : ''}`}><History size={17} strokeWidth={1.6} /><span>{t('更新记录', 'Version history')}</span></NavLink>
      </details>
    </nav>
    <div className="fluid-sidebar-bottom"><div><VersionSwitch onChange={() => navigate('/')} /></div></div>
  </>;

  return <MotionConfig reducedMotion="always"><div className={`classic-version-shell fluid-workspace${collapsed ? ' is-collapsed' : ''}`} data-ui-version="old" data-route={pathname}>
    <a className="fluid-skip-link" href="#main-content" onClick={(event) => { event.preventDefault(); document.getElementById('main-content')?.focus(); }}>{t('跳到主要内容', 'Skip to content')}</a>
    <aside className="fluid-sidebar" aria-label={t('工作空间侧边栏', 'Workspace sidebar')}>{sidebar()}</aside>
    <dialog ref={dialog} className="fluid-drawer" aria-label={t('导航菜单', 'Navigation menu')} onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }} onClose={() => mobileTrigger.current?.focus()}>{sidebar(true)}</dialog>
    <div className="fluid-body">
      <header className="fluid-topbar">
        <button type="button" className="fluid-icon fluid-desktop-toggle" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? t('展开侧边栏', 'Expand sidebar') : t('收起侧边栏', 'Collapse sidebar')} aria-expanded={!collapsed}><PanelLeftOpen size={18} /></button>
        <button ref={mobileTrigger} type="button" className="fluid-icon fluid-mobile-toggle" onClick={() => dialog.current?.showModal()} aria-label={t('打开导航', 'Open navigation')} aria-haspopup="dialog"><PanelLeftOpen size={18} /></button>
        <span className="fluid-breadcrumb"><strong>{title ? t(title.zh, title.en) : t('更新记录', 'Version history')}</strong></span>
        <div className="fluid-tools"><ThemeSwitch /><button type="button" className="fluid-icon fluid-language" onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')} aria-label={t('切换语言', 'Switch language')}><Globe size={16} /><span>{lang === 'zh' ? 'EN' : '中'}</span></button></div>
      </header>
      <main id="main-content" className="fluid-main" tabIndex={-1}><Outlet /></main>
      <SiteStatusBar />
      <CommandPalette />
    </div>
  </div></MotionConfig>;
}

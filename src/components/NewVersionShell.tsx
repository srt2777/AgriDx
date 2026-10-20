import { LiquidGlass } from '@/components/ui/liquid-glass';
import { LiquidSelection } from '@/components/ui/liquid-selection';
import { preloadPage } from '@/lib/page-loaders';
import { publicAsset } from '@/lib/public-asset';
import { Globe } from 'lucide-react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useLang, setLang } from '@/hooks/useLang';
import { useReducedMotion } from 'framer-motion';
import DemoNote from '@/components/DemoNote';
import { CommandButton } from '@/components/CommandPalette';
import { SiteStatusBar } from '@/components/SiteStatusBar';
import VersionSwitch from '@/components/VersionSwitch';
import MagneticPointer from '@/components/MagneticPointer';
import ThemeSwitch from '@/components/ThemeSwitch';
import { beginSharedTransition } from '@/lib/shared-transition';
import './new-version-shell.css';

const NAV_ZH = [
  { path: '/', label: '大厅' },
  { path: '/hall', label: '数字展厅' },
  { path: '/knowledge', label: '农机知识' },
  { path: '/models', label: '模型工坊' },
  { path: '/chat', label: '智能诊断' },
];
const NAV_EN = [
  { path: '/', label: 'Hub' },
  { path: '/hall', label: 'Digital hall' },
  { path: '/knowledge', label: 'Knowledge' },
  { path: '/models', label: 'Model studio' },
  { path: '/chat', label: 'Diagnosis' },
];

/** The blue exhibition chrome used by every page while the new UI is selected. */
export function NewVersionShell() {
  const lang = useLang();
  const location = useLocation();
  const navigate = useNavigate();
  const reducedMotion = !!useReducedMotion();
  const navItems = lang === 'zh' ? NAV_ZH : NAV_EN;
  const t = (zh: string, en: string) => lang === 'zh' ? zh : en;

  return (
    <div className="new-version-shell" data-ui-version="new" data-route={location.pathname}>
      <MagneticPointer active={!reducedMotion} />
      <a className="new-version-skip-link" href="#main-content">{t('跳到主要内容', 'Skip to content')}</a>
      <header className="new-version-header"><LiquidGlass lens className="new-version-header-glass" contentClassName="new-version-header-content">
        <div className="new-version-brand">
          <a href="https://coe.njau.edu.cn/" target="_blank" rel="noopener noreferrer" className="new-version-college-mark" aria-label={t('南京农业大学工学院官网首页', 'College of Engineering, NAU official homepage')}>
            <img src={publicAsset('images/njau-engineering-mark.jpg')} alt={t('南京农业大学工学院院徽', 'College of Engineering, NAU emblem')} width="857" height="411" />
          </a>
          <Link to="/" className="new-version-wordmark" aria-label={t('耕知·耘诊大厅', 'Gengzhi · Yunzhen hub')}>
            <strong>耕知 · 耘诊</strong>
            <small>AGRIDX · DIGITAL HUB</small>
          </Link>
        </div>

        <nav className="new-version-navigation" aria-label={t('新版功能导航', 'New interface navigation')}>
          {navItems.map(item => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              onPointerEnter={() => preloadPage(item.path, 'new')}
              onFocus={() => preloadPage(item.path, 'new')}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
                if (event.currentTarget.getAttribute('aria-current') === 'page') return;
                event.preventDefault();
                beginSharedTransition(null, () => navigate(item.path));
              }}
              className={({ isActive }) => `new-version-nav-item magnetic${isActive ? ' is-active' : ''}`}
            >
              {({ isActive }) => <>{isActive && <LiquidSelection className="new-version-nav-indicator" layoutId="new-shell-navigation" />}<span className="new-version-nav-label">{item.label}</span></>}
            </NavLink>
          ))}
        </nav>

        <div className="new-version-tools">
          <CommandButton />
          <DemoNote />
          <VersionSwitch exhibition onChange={() => navigate('/')} />
          <ThemeSwitch />
          <button type="button" className="new-version-language" onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')} aria-label={t('切换语言', 'Switch language')}>
            <Globe size={16} />
            <span>{lang === 'zh' ? 'EN' : '中'}</span>
          </button>
        </div>
      </LiquidGlass></header>
      <div className="new-version-subheader">
        <span><i aria-hidden="true" />{t('探索装备 · 连接知识 · 辅助诊断', 'EXPLORE EQUIPMENT · CONNECT KNOWLEDGE · GUIDE DIAGNOSIS')}</span>
        <span className="new-version-route-label">{location.pathname === '/knowledge' ? t('知识目录', 'CATALOG') : location.pathname === '/models' ? t('模型工坊', 'MODEL STUDIO') : location.pathname === '/hall' ? t('数字展厅', 'DIGITAL HALL') : t('智能诊断', 'DIAGNOSIS')}</span>
      </div>
      <main id="main-content" className="new-version-main" tabIndex={-1}>
        <Outlet />
      </main>
      <SiteStatusBar />
    </div>
  );
}

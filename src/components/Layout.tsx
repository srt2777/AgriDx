import { publicAsset } from '@/lib/public-asset';
import { useState, useEffect } from 'react';
import { Outlet, useLocation, useNavigate, NavLink } from 'react-router-dom';
import { Menu, X, MessageSquare, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LiquidGlass } from '@/components/ui/liquid-glass';
import { LiquidSelection } from '@/components/ui/liquid-selection';
import FloatingPanel from '@/components/FloatingPanel';
import { AnimatePresence, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useLang, setLang } from '@/hooks/useLang';
import { setUiVersion, useUiVersion } from '@/hooks/useUiVersion';
import VersionSwitch from '@/components/VersionSwitch';
import { preloadPage } from '@/lib/page-loaders';
import { NewVersionShell } from '@/components/NewVersionShell';
import { useTheme } from '@/hooks/useTheme';
import ThemeSwitch from '@/components/ThemeSwitch';
import { SiteStatusBar } from '@/components/SiteStatusBar';

const NAV_ZH = [
  { label: '首页', path: '/' },
  { label: '农机知识', path: '/knowledge' },
  { label: '模型工坊', path: '/models' },
  { label: '研究依据', hash: 'research' },
];
const NAV_EN = [
  { label: 'Home', path: '/' },
  { label: 'Knowledge', path: '/knowledge' },
  { label: 'Model studio', path: '/models' },
  { label: 'Research', hash: 'research' },
];

export function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const theme = useTheme();
  const lang = useLang();
  const uiVersion = useUiVersion();
  const location = useLocation();
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    setMobileOpen(false);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [location.pathname]);

  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  }, [lang]);

  const NAV_ITEMS = lang === 'zh' ? NAV_ZH : NAV_EN;
  const chatLabel = lang === 'zh' ? '诊断工作台' : 'Diagnosis';

  const handleHashNav = (hash: string) => {
    setMobileOpen(false);
    if (hash === 'research') setUiVersion('old');
    if (location.pathname === '/') {
      document.getElementById(hash)?.scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth', block: 'start' });
    } else {
      // 非首页：先回首页，再由 HomePage 按 state.scrollTo 滚动到对应区块。
      // 不用 `/#${hash}` 锚点写法，避免与 HashRouter 的路由 hash 冲突。
      navigate('/', { state: { scrollTo: hash } });
    }
  };

  // The exhibition home owns its complete chrome. Secondary routes keep the
  // same blue version through a shared shell instead of falling back to the
  // classic green navigation.
  if (uiVersion === 'new' && location.pathname !== '/') return <NewVersionShell />;
  if (location.pathname === '/' && uiVersion === 'new') return <Outlet />;

  return (
    <div
      className="flex min-h-screen flex-col bg-background text-foreground"
      data-ui-version={uiVersion}
      data-route={location.pathname}
    >
      <a className="skip-link" href="#main-content">{lang === 'zh' ? '跳到主要内容' : 'Skip to content'}</a>
      {/* 顶部导航栏 */}
      <header className="site-header sticky top-0 z-50 w-full">
        <LiquidGlass
          variant="regular"
          lens
          displacementScale={28}
          className="site-nav-glass"
          contentClassName="site-nav-content flex min-h-16 w-full items-center justify-between gap-2 px-3 md:px-5"
        >
          {/* Logo */}
          <div className="brand-lockup flex items-center gap-3">
            <a href="https://coe.njau.edu.cn/" target="_blank" rel="noopener noreferrer" className={cn('college-mark', theme === 'dark' && 'college-mark-dark')} aria-label={lang === 'zh' ? '南京农业大学工学院官网首页' : 'College of Engineering, NAU official homepage'}>
              <img src={publicAsset('images/njau-engineering-mark.jpg')} alt={lang === 'zh' ? '南京农业大学工学院院徽' : 'College of Engineering, NAU emblem'} width="857" height="411" />
            </a>
            <NavLink to="/" onPointerEnter={() => preloadPage('/', uiVersion)} onFocus={() => preloadPage('/', uiVersion)} className="brand-wordmark" aria-label={lang === 'zh' ? '耕知·耘诊首页' : 'Gengzhi · Yunzhen home'}><strong>耕知·耘诊</strong><span>{lang === 'zh' ? '农机诊断工作台' : 'Machinery diagnosis'}</span></NavLink>
          </div>

          {/* 桌面端导航 */}
          <nav className="site-navigation hidden items-center gap-1 lg:flex" aria-label={lang === 'zh' ? '主导航' : 'Main navigation'}>
            {NAV_ITEMS.map((item) =>
              item.hash ? (
                <button
                  type="button"
                  key={item.hash}
                  onClick={() => handleHashNav(item.hash!)}
                  className="site-nav-item press-control text-muted-foreground"
                >
                  <span className="site-nav-label">{item.label}</span>
                </button>
              ) : (
                <NavLink
                  key={item.path}
                  to={item.path!}
                  onPointerEnter={() => preloadPage(item.path!, uiVersion)}
                  onFocus={() => preloadPage(item.path!, uiVersion)}
                  end={item.path === '/'}
                  className={({ isActive }) =>
                    cn(
                      'site-nav-item press-control',
                      isActive ? 'is-active text-primary font-semibold' : 'text-muted-foreground',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && <LiquidSelection className="site-nav-indicator" layoutId="desktop-nav-selection" />}
                      <span className="site-nav-label">{item.label}</span>
                    </>
                  )}
                </NavLink>
              ),
            )}
            <Button asChild size="sm" className="site-diagnosis-button press-control ml-2 gap-1.5">
              <NavLink to="/chat" onPointerEnter={() => preloadPage('/chat')} onFocus={() => preloadPage('/chat')}>
                <MessageSquare className="h-4 w-4" />
                {chatLabel}
              </NavLink>
            </Button>
          </nav>

          {/* 右侧工具按钮（主题 + 语言 + 移动端菜单） */}
          <div className="site-tools flex items-center gap-2">
            <VersionSwitch onChange={() => navigate('/')} />
            <ThemeSwitch className="site-tool-button lg-nav-btn" />
            <button
              type="button"
              onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
              className="site-tool-button lg-nav-btn press-control flex h-9 items-center gap-1 rounded-full border border-border px-3 text-xs font-medium text-muted-foreground"
              aria-label={lang === 'zh' ? '切换语言' : 'Switch language'}
            >
              <Globe className="h-4 w-4" />
              {lang === 'zh' ? 'EN' : '中'}
            </button>
            <button
              type="button"
              className="site-tool-button lg-nav-btn press-control flex h-9 w-9 items-center justify-center rounded-full border border-border lg:hidden"
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label={lang === 'zh' ? '菜单' : 'Menu'}
              aria-expanded={mobileOpen}
              aria-controls="mobile-navigation"
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </LiquidGlass>

        {/* 小屏独立版本胶囊，保持主导航的单行轮廓。 */}
        <div className="site-version-mobile">
          <LiquidGlass lens className="site-version-mobile-glass">
            <VersionSwitch onChange={() => navigate('/')} />
          </LiquidGlass>
        </div>

        {/* 移动端导航抽屉（非玻璃，避免玻璃嵌套失效） */}
        <AnimatePresence initial={false}>{mobileOpen && (
          <FloatingPanel key="mobile-menu" id="mobile-navigation" className="site-mobile-menu mt-2 rounded-2xl border border-border/60 bg-card shadow-lg lg:hidden">
            <nav className="mx-auto flex max-w-6xl flex-col gap-1 px-3 py-3" aria-label={lang === 'zh' ? '移动端主导航' : 'Mobile navigation'}>
              {NAV_ITEMS.map((item) =>
                item.hash ? (
                  <button
                    type="button"
                    key={item.hash}
                    onClick={() => handleHashNav(item.hash!)}
                    className="site-mobile-item press-control rounded-xl px-3 py-3 text-left text-sm text-muted-foreground hover:bg-accent hover:text-primary"
                  >
                    {item.label}
                  </button>
                ) : (
                  <NavLink
                    key={item.path}
                    to={item.path!}
                    onPointerEnter={() => preloadPage(item.path!, uiVersion)}
                    onFocus={() => preloadPage(item.path!, uiVersion)}
                    end={item.path === '/'}
                    onClick={() => setMobileOpen(false)}
                    className={({ isActive }) =>
                      cn(
                        'site-mobile-item press-control rounded-xl px-3 py-3 text-sm transition-colors',
                        isActive ? 'text-primary font-semibold' : 'text-muted-foreground hover:bg-accent hover:text-primary',
                      )
                    }
                  >
                    {({ isActive }) => <>{isActive && <LiquidSelection className="site-mobile-indicator" layoutId="mobile-nav-selection" />}<span className="site-nav-label">{item.label}</span></>}
                  </NavLink>
                ),
              )}
              <Button asChild size="sm" className="press-control mt-2 gap-1.5">
                <NavLink to="/chat" onClick={() => setMobileOpen(false)} onPointerEnter={() => preloadPage('/chat')} onFocus={() => preloadPage('/chat')}>
                  <MessageSquare className="h-4 w-4" />
                  {chatLabel}
                </NavLink>
              </Button>
            </nav>
          </FloatingPanel>
        )}</AnimatePresence>
      </header>

      {/* 主内容区 */}
      <main id="main-content" tabIndex={-1} className="flex-1 w-full">
        <Outlet />
      </main>
      {location.pathname !== '/' && <SiteStatusBar />}
    </div>
  );
}

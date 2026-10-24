import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useLang } from '@/hooks/useLang';
import { useUiVersion } from '@/hooks/useUiVersion';
import { NewVersionShell } from '@/components/NewVersionShell';
import { WorkspaceShell } from '@/ui/WorkspaceShell';

export function Layout() {
  const lang = useLang();
  const uiVersion = useUiVersion();
  const location = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [location.pathname]);

  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  }, [lang]);

  // The modern campus keeps its own chrome; modern feature routes keep the
  // existing exhibition shell. This redesign belongs to the classic UI only.
  if (uiVersion === 'new' && location.pathname !== '/') return <NewVersionShell />;
  if (uiVersion === 'new') return <Outlet />;
  return <WorkspaceShell />;
}

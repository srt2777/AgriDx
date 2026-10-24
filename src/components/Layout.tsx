import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
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

  // Keep modern navigation mounted while moving between the hall and features.
  if (uiVersion === 'new') return <NewVersionShell />;
  return <WorkspaceShell />;
}

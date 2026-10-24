import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { version } from '../../../../package.json';
import { useLang } from '../../hooks/useLang';
import { startReleaseUpdater } from './release-updater';
import { canAutoReloadUrl, subscribeUpdateSafety } from './update-safety';
import './auto-update.css';

export default function AutoUpdateStatus() {
  const { pathname } = useLocation();
  const lang = useLang();
  const [pending, setPending] = useState<string | null>(null);
  const preview = typeof __AGRIDX_DEV_PREVIEW__ !== 'undefined' && __AGRIDX_DEV_PREVIEW__;
  useEffect(() => {
    if (!import.meta.env.PROD || typeof __AGRIDX_BUILD_COMMIT__ === 'undefined') return;
    const updater = startReleaseUpdater({
      currentCommit: __AGRIDX_BUILD_COMMIT__, currentVersion: version,
      manifestUrl: `${import.meta.env.BASE_URL}${preview ? 'dev-preview.json' : 'deployment.json'}`,
      canReload: () => canAutoReloadUrl(window.location.href), onPending: setPending,
    });
    const unsubscribe = subscribeUpdateSafety(() => { void updater.retryPending(); });
    return () => { unsubscribe(); updater.stop(); };
  }, [pathname, preview]);
  if (!pending) return null;
  return <aside role="status" className={`auto-update-status${preview ? ' is-preview' : ''}`}>
    {lang === 'zh' ? '检测到新版，安全时将自动更新；当前输入和操作优先保留。' : 'Update detected. It will load automatically when your current work is safe.'}
  </aside>;
}

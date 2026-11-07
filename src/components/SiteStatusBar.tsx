import { useUiVersion } from '@/hooks/useUiVersion';
import { version } from '../../package.json';
import { UI_RELEASES } from '@/lib/ui-versions';
import { useLang } from '@/hooks/useLang';
import { statusPlace } from '@/lib/command-routes';
import { Link, useLocation } from 'react-router-dom';
import './site-status.css';

/** Same identity and place line on the campus, the shell, and the new 404. */
export function SiteStatusBar() {
  const lang = useLang();
  const uiVersion = useUiVersion();
  const { pathname } = useLocation();
  const place = statusPlace(pathname, lang);
  const uiLabel = UI_RELEASES[uiVersion].replace(/^(NV|OV)/, 'UI');
  if (uiVersion === 'old') return <footer className="site-status-bar"><span>司稼</span><Link to="/version-history">{lang === 'zh' ? '界面' : 'UI'} {uiLabel} · {lang === 'zh' ? '项目' : 'Project'} v{version}</Link></footer>;
  return (
    <footer className="site-status-bar">
      <span>
        司稼 <i aria-hidden="true" />
        {lang === 'zh' ? '南京农业大学工学院 · 农机知识与诊断' : 'COLLEGE OF ENGINEERING, NAU · KNOWLEDGE & DIAGNOSIS'}
      </span>
      <span>
        <Link to="/version-history" className="hover:underline">{lang === 'zh' ? '版本历史记录' : 'Version history'} · {uiLabel} · v{version}</Link>
        <span className="sr-only">{place}</span>
      </span>
    </footer>
  );
}

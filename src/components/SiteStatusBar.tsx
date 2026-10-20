import { version } from '../../package.json';
import { useLang } from '@/hooks/useLang';
import { statusPlace } from '@/lib/command-routes';
import { useLocation } from 'react-router-dom';
import './site-status.css';

/** Same identity and place line on the campus, the shell, and the new 404. */
export function SiteStatusBar() {
  const lang = useLang();
  const { pathname } = useLocation();
  const place = statusPlace(pathname, lang);
  return (
    <footer className="site-status-bar">
      <span>
        AGRIDX <i aria-hidden="true" />
        {lang === 'zh' ? '南京农业大学工学院 · 农机知识与诊断' : 'COLLEGE OF ENGINEERING, NAU · KNOWLEDGE & DIAGNOSIS'}
      </span>
      <span>
        v{version} <i aria-hidden="true" />
        {place}
      </span>
    </footer>
  );
}

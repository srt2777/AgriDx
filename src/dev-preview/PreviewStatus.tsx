import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useUiVersion } from '../hooks/useUiVersion';
import { Link, useLocation } from 'react-router-dom';
import { useLang } from '../hooks/useLang';
import { version } from '../../package.json';
import { recordVisit } from './telemetry';
import './preview.css';

export default function PreviewStatus() {
  const lang = useLang();
  const classic = useUiVersion() === 'old';
  const { pathname } = useLocation();
  const lastVisit = useRef('');
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [container, setContainer] = useState<Element | null>(null);
  useEffect(() => {
    setContainer(classic ? document.querySelector('.classic-version-shell .fluid-body') : null);
  }, [classic, pathname]);
  useEffect(() => {
    if (lastVisit.current === pathname) return;
    lastVisit.current = pathname;
    recordVisit(pathname);
  }, [pathname]);
  if (pathname === '/developer') return null;
  const status = <aside className="dev-preview-status" aria-label={lang === 'zh' ? '开发预览状态' : 'Development preview status'}>
    <span>{classic ? (lang === 'zh' ? '开发版' : 'Development') : <>{lang === 'zh' ? '开发预览 · 知识与诊断' : 'Dev preview · knowledge & diagnosis'} · {version}</>}</span>
    <Link to="/developer">{lang === 'zh' ? '开发控制台' : 'Developer console'}</Link>
    <button type="button" className="preview-privacy-toggle" aria-expanded={showPrivacy} onClick={() => setShowPrivacy(v => !v)} aria-label={lang === 'zh' ? '使用记录说明' : 'Usage records'}>ⓘ</button>
    {showPrivacy && <p className="preview-privacy">{lang === 'zh' ? '开发站记录匿名访问、提问及诊断结果，保存30天，仅仓库管理员可查看。启用“请勿跟踪”时不采集。AI 辅助开启时，本次问题及筛选后的参考资料会发送至管理员选择的模型服务商；仅本地模式不调用 AI。' : 'Anonymous visits, questions and diagnosis outcomes are stored for 30 days and visible only to repository administrators. Do Not Track is respected. With AI assistance enabled, the current question and selected reference context are sent to the configured model provider. Local-only mode makes no AI calls.'}</p>}
  </aside>;
  return classic && container ? createPortal(status, container) : status;
}

import { useUiCopy } from '@/ui/useUiCopy';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowLeft, ChevronDown, ExternalLink, History } from 'lucide-react';
import history from 'virtual:agridx-version-history';
import { version } from '../../../../package.json';
import { useLang } from '@/hooks/useLang';
import './version-history.css';

const labels: Record<string, [string, string]> = {
  knowledge: ['知识更新', 'Knowledge'], fix: ['问题修复', 'Fix'],
  maintenance: ['架构与维护', 'Maintenance'], feature: ['新增功能', 'Feature'],
  breaking: ['不兼容更新', 'Breaking'],
};
function Markdown({ children }: { children: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    a: ({ href, children }) => {
      const resolved = href && !/^[a-z]+:|^\/\/|^#/i.test(href)
        ? 'https://github.com/' + history.repository + '/blob/' + (typeof __AGRIDX_BUILD_COMMIT__ !== 'undefined' && __AGRIDX_BUILD_COMMIT__ || 'main') + '/' + href
        : href;
      return <a href={resolved} target="_blank" rel="noopener noreferrer">{children}</a>;
    },
  }}>{children}</ReactMarkdown>;
}

export default function VersionHistoryPage() {
  const lang = useLang();
  const [includeLegacy, setIncludeLegacy] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const { t, format, separator } = useUiCopy(lang);
  const missing = t('未记录', 'Not recorded');
  const commit = typeof __AGRIDX_BUILD_COMMIT__ !== 'undefined' ? __AGRIDX_BUILD_COMMIT__ : '';
  const releases = history.releases.filter(item => !item.draft && (includeLegacy || !item.legacy));
  const drafts = history.releases.filter(item => item.draft);
  return <section className="version-history-page" aria-labelledby="history-title">
    <Link className="history-back" to="/"><ArrowLeft size={18} />{t('返回首页', 'Back to home')}</Link>
    <header className="history-heading">
      <span className="history-eyebrow"><History size={16} />{format('AGRIDX · CHANGELOG')}</span>
      <h1 id="history-title">{t('版本历史记录', 'Version history')}</h1>
      <p>{t('每次更新的内容、资料变化与验证记录，按版本完整保留。', 'Changes, knowledge updates and recorded verification for each version.')}</p>
    </header>
    <div className="history-build" aria-label={t('当前构建', 'Current build')}>
      <div><span>{t('当前构建版本', 'Build version')}</span><strong>v{version}</strong></div>
      <div><span>{t('构建提交', 'Build commit')}</span>{commit
        ? <a href={'https://github.com/' + history.repository + '/commit/' + commit} target="_blank" rel="noopener noreferrer"><code>{commit}</code><ExternalLink size={14} /></a>
        : <strong>{missing}</strong>}</div>
      <p>{t('日期为日志记录日期（上海时区），不等同于实际上线时间。部署文字仅为当时记录；当前构建不证明正式站已更新。', 'Dates follow the recorded Shanghai date, not a verified go-live time. Deployment notes are historical evidence; this build does not prove production is updated.')}</p>
    </div>
    <div className="history-toolbar">
      <span>{t('版本从新到旧', 'Newest first')}{separator}{releases.length}</span>
      <label><input type="checkbox" checked={includeLegacy} onChange={event => setIncludeLegacy(event.target.checked)} />{t('包含 v2 历史', 'Include v2 history')}</label>
    </div>
    <div className="history-list">{releases.map(item => <article className="history-entry" key={item.id}>
      <div className="history-entry-heading">
        <h2>{item.version}</h2>
        <div>{item.version === version && <span className="history-current">{t('当前构建', 'Current build')}</span>}<span className="history-kind">{item.kind ? labels[item.kind]?.[lang === 'zh' ? 0 : 1] || item.kind : t('类型未记录', 'Type not recorded')}</span></div>
        {item.date ? <time dateTime={item.date}>{item.date}</time> : <span className="history-date">{t('日期未记录', 'Date not recorded')}</span>}
      </div>
      <p className="history-summary">{item.summary || missing}</p>
      <details className="history-details" onToggle={event => {
        const open = event.currentTarget.open;
        setExpanded(previous => { const next = new Set(previous); if (open) next.add(item.id); else next.delete(item.id); return next; });
      }}>
        <summary>{t('查看详细系统记录', 'View detailed record')}<ChevronDown size={18} /></summary>
        {expanded.has(item.id) && <div className="history-detail-body">
          <div className="history-markdown"><h3>{t('详细改动（日志原文）', 'Detailed changes (original log)')}</h3><Markdown>{item.details}</Markdown></div>
          {([
            ['knowledge', t('知识库变化', 'Knowledge changes')],
            ['compatibility', t('兼容性', 'Compatibility')],
            ['verification', t('验证结果', 'Verification')],
            ['deployment', t('部署记录（当时记录）', 'Deployment (historical record)')],
          ] as const).map(([field, label]) => <div className="history-markdown history-evidence" key={field}><h3>{label}</h3>{item[field] ? <Markdown>{item[field]}</Markdown> : <p>{missing}</p>}</div>)}
          <div className="history-prs"><h3>{t('关联 PR（日志中明确链接）', 'PR links recorded in the log')}</h3>{item.prs.length ? item.prs.map(url => <a key={url} href={url} target="_blank" rel="noopener noreferrer">{url.replace('https://github.com/', '')}<ExternalLink size={14} /></a>) : <p>{missing}</p>}</div>
        </div>}
      </details>
    </article>)}</div>
    <details className="history-archive">
      <summary>{t('历史编号说明与草稿', 'Historical numbering and drafts')}</summary>
      <p>{t('v2 是保留的前代项目记录。草稿分支不计入正式版本列表；版本协调及改号说明以 CHANGELOG 原文为准。', 'v2 records belong to the preceding project. Draft branches are excluded from the release list. See the original changelog for historical renumbering.')}</p>
      <a href={'https://github.com/' + history.repository + '/blob/' + (commit || 'main') + '/CHANGELOG.md'} target="_blank" rel="noopener noreferrer">{t('查看完整 CHANGELOG', 'Read full CHANGELOG')} <ExternalLink size={14} /></a>
      {drafts.map(item => <details key={item.id}><summary>{t('历史草稿', 'Historical draft')} {item.version}{separator}{item.date || missing}</summary><div className="history-markdown"><Markdown>{item.details}</Markdown></div></details>)}
    </details>
  </section>;
}


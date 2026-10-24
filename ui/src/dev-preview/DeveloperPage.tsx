import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Activity, ArrowLeft, ArrowUpRight, ChevronLeft, ChevronRight, Download, Github, LayoutDashboard, LogOut, MessageSquare, RefreshCw, Search, Server, ShieldCheck, Users } from 'lucide-react';
import { useLang } from '../hooks/useLang';
import ThemeSwitch from '../components/ThemeSwitch';
import { version } from '../../../package.json';
import './developer.css';

interface User { login: string; id: number; expiresAt: number }
interface Summary {
  days: number; views: number; visitors: number; questions: number; answered: number | null;
  grounded: number | null; latencyMs: number | null; firstSeen: number | null; observedAt: number;
  trend: { date: string; views: number; visitors: number }[];
  pages: { path: string; views: number }[];
  models: { model: string; questions: number }[];
}
interface Visitor { id: string; firstSeen: number; lastSeen: number; browser: string; os: string; device: string; country: string; views: number; questions: number }
interface Question { id: string; visitorId: string; occurredAt: number; question: string; machineType: string; brand: string; model: string; outcome: string; knowledgeChunks: number; latencyMs: number; release: string }
interface Records { rows: (Visitor | Question)[]; page: number; pageSize: number; total: number; observedAt: number }
interface Release { version: string; commit: string; branch: string; builtAt: string }
interface GithubStatus {
  observedAt: number;
  main: { sha: string; message: string; date: string; url: string };
  runs: { id: number; name: string; status: string; conclusion: string | null; sha: string; updatedAt: string; url: string }[];
}
interface SystemStatus {
  observedAt: number; repository: string; artifact: Release | null; artifactError: string | null;
  github: GithubStatus | { error: string; stale: GithubStatus | null };
  gateway: { runtime: string; storage: string; version?: string; sourceCommit?: string; builtAt?: string };
  servers: { name: string; url: string; status: string; detail: string }[];
}
class ConsoleError extends Error { constructor(public status: number, message: string) { super(message); } }
async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  // These endpoints use the real development server, independently of the browser-local RAG adapter.
  const response = await fetch(`/api/dev-admin/${path}`, { credentials: 'same-origin', cache: 'no-store', ...options });
  const data = await response.json();
  if (!response.ok) throw new ConsoleError(response.status, typeof data.error === 'string' ? data.error : '数据暂不可用。');
  return data as T;
}
function useResource<T>(path: string | null, expired: () => void) {
  const [state, setState] = useState<{ path: string | null; data: T | null; error: string; loading: boolean }>({ path: null, data: null, error: '', loading: false });
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(v => v + 1), []);
  useEffect(() => {
    if (!path) { setState({ path: null, data: null, error: '', loading: false }); return; }
    const controller = new AbortController();
    let pending = false;
    const read = async () => {
      if (pending || document.hidden) return;
      pending = true;
      setState(v => ({ path, data: v.path === path ? v.data : null, error: '', loading: true }));
      try {
        const data = await api<T>(path, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
        if (!controller.signal.aborted) setState({ path, data, error: '', loading: false });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof ConsoleError && error.status === 401) expired();
        setState(v => ({ ...v, error: error instanceof Error ? error.message : '数据暂不可用。', loading: false }));
      } finally { pending = false; }
    };
    void read();
    const timer = window.setInterval(() => { void read(); }, 30_000);
    const visible = () => { if (!document.hidden) void read(); };
    document.addEventListener('visibilitychange', visible);
    return () => { controller.abort(); window.clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [path, revision, expired]);
  return { ...state, data: state.path === path ? state.data : null, refresh };
}
function formatTime(value: number | string | null | undefined, locale: string) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(locale, { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}
const short = (value: string | undefined) => value ? value.slice(0, 8) : '—';
function githubUrl(value: string) {
  try { const u = new URL(value); return u.protocol === 'https:' && u.hostname === 'github.com' ? u.href : '#'; } catch { return '#'; }
}
function Panel({ title, description, children, className = '' }: { title: string; description?: string; children: ReactNode; className?: string }) {
  return <section className={`console-panel ${className}`}><div className="console-panel-heading"><h2>{title}</h2>{description && <p>{description}</p>}</div>{children}</section>;
}
function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warning' }) {
  return <span className={`console-badge console-badge-${tone}`}>{children}</span>;
}

export default function DeveloperPage() {
  const lang = useLang();
  const t = (zh: string, en: string) => lang === 'zh' ? zh : en;
  const locale = lang === 'zh' ? 'zh-CN' : 'en-GB';
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [configured, setConfigured] = useState(true);
  const [tokenInput, setTokenInput] = useState('');
  const [rememberDevice, setRememberDevice] = useState(true);
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [tab, setTab] = useState<'overview' | 'visitors' | 'questions' | 'system'>('overview');
  const [days, setDays] = useState(7);
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const expired = useCallback(() => { setUser(null); }, []);
  const summary = useResource<Summary>(user ? `summary?days=${days}` : null, expired);
  const recordsPath = `${tab}?${new URLSearchParams({ days: String(days), page: String(page), q: query })}`;
  const records = useResource<Records>(user && (tab === 'visitors' || tab === 'questions') ? recordsPath : null, expired);
  const system = useResource<SystemStatus>(user && tab === 'system' ? 'system' : null, expired);
  const [authRevision, setAuthRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api<{ user: User | null; configured: boolean }>('session', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) })
      .then(data => { if (!controller.signal.aborted) { setUser(data.user); setConfigured(data.configured); setLoginError(''); } })
      .catch(error => { if (!controller.signal.aborted) { setUser(null); setLoginError(error instanceof Error ? error.message : '无法检查登录状态。'); } });
    return () => controller.abort();
  }, [authRevision]);
  async function login(event: FormEvent) {
    event.preventDefault(); setLoggingIn(true); setLoginError('');
    try {
      const data = await api<{ user: User }>('login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: tokenInput.trim(), remember: rememberDevice }), signal: AbortSignal.timeout(20_000) });
      setUser(data.user); setTokenInput('');
    } catch (error) { setLoginError(error instanceof Error ? error.message : '登录失败。'); }
    finally { setLoggingIn(false); }
  }
  async function logout() {
    try { await api('logout', { method: 'POST' }); setUser(null); setTokenInput(''); }
    catch (error) { setLoginError(error instanceof Error ? error.message : '退出失败。'); }
  }
  function changeTab(next: typeof tab) { setTab(next); setPage(1); setQuery(''); setDraft(''); }
  function search(event: FormEvent) { event.preventDefault(); setPage(1); setQuery(draft.trim()); }
  const pageName = (path: string) => ({ '/': t('网站首页', 'Home'), '/knowledge': t('农机知识', 'Knowledge'), '/chat': t('智能诊断', 'Diagnosis'), '/models': t('模型工坊', 'Models') })[path] || path;
  const tabs = [{ id: 'overview' as const, title: t('总览', 'Overview'), icon: LayoutDashboard }, { id: 'visitors' as const, title: t('访问用户', 'Visitors'), icon: Users }, { id: 'questions' as const, title: t('用户提问', 'Questions'), icon: MessageSquare }, { id: 'system' as const, title: t('版本与服务', 'Versions & services'), icon: Server }];
  const isRefreshing = summary.loading || ((tab === 'visitors' || tab === 'questions') && records.loading) || (tab === 'system' && system.loading);
  const activeError = summary.error || ((tab === 'visitors' || tab === 'questions') ? records.error : '') || (tab === 'system' ? system.error : '') || (user ? loginError : '');
  const stats = summary.data;
  const maxViews = Math.max(1, ...stats?.trend.map(v => v.views) || []);
  const git = system.data && ('error' in system.data.github ? system.data.github.stale : system.data.github);

  return <div className="dev-console">
    <header className="console-header">
      <Link to="/" className="console-back"><ArrowLeft size={18} /><span>{t('返回开发站', 'Back to website')}</span></Link>
      <div className="console-header-actions"><ThemeSwitch /><Badge>DEV · {version}</Badge><a href="https://github.com/srt2777/AgriDx-v3" target="_blank" rel="noreferrer"><Github size={17} /><span>AgriDx-v3</span><ArrowUpRight size={14} /></a></div>
    </header>
    <main className="console-main">
      <div className="console-title"><div><p className="console-eyebrow">AGRIDX / DEVELOPMENT</p><h1>{t('开发控制台', 'Developer console')}</h1><p>{t('看清访问、提问和当前运行版本。', 'Visits, questions and the versions running now.')}</p></div>{user && <div className="console-account"><ShieldCheck size={18} /><span>{user.login}</span><button type="button" onClick={() => { void logout(); }} aria-label={t('退出登录', 'Sign out')}><LogOut size={17} /></button></div>}</div>
      {user === undefined ? <div className="console-empty" role="status">{t('正在检查管理员身份…', 'Checking administrator session…')}</div> : !user ?
        <section className="console-login">
          <div className="console-login-icon"><Github size={30} /></div><Badge>{t('内部数据 · 管理员可见', 'Internal data · administrators only')}</Badge>
          <h2>{t('用 GitHub 账号验证身份', 'Verify your GitHub account')}</h2>
          <p>{t('仅 AgriDx-v3 仓库管理员或维护者可以查看访问和问答记录。公开网站仍可直接访问。', 'Access is limited to AgriDx-v3 repository administrators and maintainers. The website remains public.')}</p>
          <form onSubmit={event => { void login(event); }}>
            <label htmlFor="github-token">{t('GitHub 令牌', 'GitHub token')}</label>
            <input id="github-token" type="password" autoComplete="off" spellCheck={false} minLength={20} maxLength={255} value={tokenInput} onChange={event => setTokenInput(event.target.value)} required aria-describedby="console-login-help" placeholder="github_pat_… / ghp_…" />
            <label className="console-remember"><input type="checkbox" checked={rememberDevice} onChange={event => setRememberDevice(event.target.checked)} disabled={loggingIn} /><span>{t('记住这台设备（30天）', 'Remember this device (30 days)')}</span></label>
            <button type="submit" className="console-primary" disabled={loggingIn || !configured}><ShieldCheck size={17} />{loggingIn ? t('验证中…', 'Verifying…') : t('验证并进入', 'Verify and enter')}</button>
          </form>
          <p id="console-login-help" className="console-help">{t('勾选后，同一浏览器30天内自动恢复登录；取消勾选则保留1小时。GitHub令牌仅用于验证身份和仓库管理权限，不保存。退出登录或清除网站数据后需重新验证。', 'The same browser restores your session for 30 days when selected, or one hour otherwise. Your GitHub token only verifies identity and repository management access and is not saved. Signing out or clearing site data requires verification again.')}</p>
          <a className="console-text-link" href="https://github.com/settings/tokens" target="_blank" rel="noreferrer">{t('管理或创建 GitHub 令牌', 'Manage or create a GitHub token')}<ArrowUpRight size={14} /></a>
          {!configured && <p className="console-error" role="alert">{t('开发站数据库尚未连接，记录和管理员登录暂不可用。', 'The development database is not connected yet.')}</p>}
          {loginError && <p className="console-error" role="alert">{loginError}</p>}
          <button type="button" className="console-text-link" onClick={() => setAuthRevision(v => v + 1)}><RefreshCw size={14} />{t('重新检查连接', 'Check connection again')}</button>
          <p className="console-login-note">{t('从本功能上线后开始采集开发站数据。访客以匿名浏览器标识区分，未接入腾讯云正式站记录。', 'Collection starts when this feature goes live. Visitors use anonymous browser identifiers; production records are not connected.')}</p>
        </section> : <>
          <div className="console-toolbar"><nav aria-label={t('管理页面', 'Console pages')}>{tabs.map(item => <button type="button" key={item.id} aria-current={tab === item.id ? 'page' : undefined} className={tab === item.id ? 'active' : ''} onClick={() => changeTab(item.id)}><item.icon size={17} />{item.title}</button>)}</nav><div className="console-toolbar-right"><select aria-label={t('统计时间范围', 'Time range')} value={days} onChange={event => { setDays(Number(event.target.value)); setPage(1); }}>{[1, 7, 30].map(n => <option key={n} value={n}>{n === 1 ? t('今天', 'Today') : t(`最近${n}天`, `Last ${n} days`)}</option>)}</select><button type="button" className="console-refresh" disabled={isRefreshing} onClick={() => { summary.refresh(); records.refresh(); system.refresh(); }}><RefreshCw size={16} className={isRefreshing ? 'console-spinning' : ''} />{t('刷新', 'Refresh')}</button></div></div>
          <div className="console-freshness"><span className="console-live-dot" /><span>{isRefreshing ? t('正在更新…', 'Updating…') : t('每30秒更新', 'Updates every 30 seconds')}</span><span>{t('上次读取', 'Last read')} {formatTime((tab === 'system' ? system.data?.observedAt : tab === 'overview' ? stats?.observedAt : records.data?.observedAt), locale)} · {t('上海时间', 'Shanghai time')}</span></div>
          {activeError && <div className="console-error" role="alert">{activeError} {t('已有内容保留为上次读取结果。', 'Previously loaded data is retained.')}</div>}
          {tab === 'overview' && <>
            <div className="console-metrics">
              {[{ label: t('匿名访客', 'Anonymous visitors'), value: stats?.visitors, icon: Users, detail: t('按浏览器标识去重', 'Unique browser identifiers') }, { label: t('页面访问', 'Page views'), value: stats?.views, icon: Activity, detail: t('首页及三个功能页面', 'Home and three feature pages') }, { label: t('用户提问', 'Questions'), value: stats?.questions, icon: MessageSquare, detail: stats ? t(`${stats.answered || 0}次完成回复`, `${stats.answered || 0} completed replies`) : '—' }, { label: t('有来源的回复', 'Replies with evidence'), value: stats ? stats.grounded || 0 : undefined, icon: ShieldCheck, detail: stats?.latencyMs != null ? t(`本地诊断平均${stats.latencyMs}毫秒`, `Local diagnosis average: ${stats.latencyMs} ms`) : t('尚无诊断耗时记录', 'No diagnosis timing yet') }].map(item => <div className="console-metric" key={item.label}><div><span>{item.label}</span><item.icon size={19} /></div><strong>{item.value === undefined ? '—' : item.value.toLocaleString(locale)}</strong><p>{item.detail}</p></div>)}
            </div>
            <Panel title={t('访问趋势', 'Visit trend')} description={t('每天的页面访问与匿名访客。', 'Daily page views and anonymous visitors.')}><div className="console-chart-legend"><span><i />{t('页面访问', 'Page views')}</span><span><i />{t('匿名访客', 'Visitors')}</span></div>{stats ? <div className="console-chart" role="img" aria-label={t('每日访问趋势，详细数值可聚焦查看', 'Daily visits; focus a column for its values')}>{stats.trend.map((entry, i) => <div className="console-chart-day" key={entry.date} tabIndex={0} aria-label={`${entry.date}: ${entry.views} PV / ${entry.visitors} UV`} title={`${entry.date}: ${entry.views} PV / ${entry.visitors} UV`}><div className="console-chart-bars"><div style={{ height: `${entry.views ? Math.max(3, entry.views / maxViews * 100) : 0}%` }} /><div style={{ height: `${entry.visitors ? Math.max(3, entry.visitors / maxViews * 100) : 0}%` }} /></div><span>{i % Math.ceil(days / 7) === 0 ? entry.date.slice(5) : ''}</span></div>)}</div> : <div className="console-empty">{summary.error ? t('读取失败', 'Read failed') : t('正在读取访问记录…', 'Loading visits…')}</div>}{stats?.views === 0 && <p className="console-help">{t('所选时间段尚无页面访问记录。', 'No page visits in this period.')}</p>}</Panel>
            <div className="console-columns"><Panel title={t('访问页面', 'Visited pages')}>{stats?.pages.length ? stats.pages.map(item => <div className="console-rank" key={item.path}><span>{pageName(item.path)}<small>{item.path}</small></span><strong>{item.views}</strong></div>) : <p className="console-empty">{stats ? t('尚无访问记录', 'No visits yet') : summary.error ? t('暂无法读取访问记录', 'Visits unavailable') : t('正在读取…', 'Loading…')}</p>}</Panel><Panel title={t('提问涉及的型号', 'Models in questions')}>{stats?.models.length ? stats.models.map(item => <div className="console-rank" key={item.model}><span>{item.model}</span><strong>{item.questions}</strong></div>) : <p className="console-empty">{stats ? t('尚无提问记录', 'No questions yet') : summary.error ? t('暂无法读取提问记录', 'Questions unavailable') : t('正在读取…', 'Loading…')}</p>}</Panel></div>
          </>}
          {(tab === 'visitors' || tab === 'questions') && <Panel title={tab === 'visitors' ? t('访问用户', 'Visitors') : t('用户提问', 'Questions')} description={tab === 'visitors' ? t('同一匿名浏览器归为一位访客，不代表实名身份。', 'Each anonymous browser is one visitor; this is not a real-name identity.') : t('保留当前问题、所选农机、结果和资料命中，不重复保存整段对话。', 'Current questions, selected machines, outcomes and evidence counts; full conversations are not duplicated.')}>
            <div className="console-record-controls"><form onSubmit={search}><Search size={17} /><input aria-label={t('搜索记录', 'Search records')} placeholder={tab === 'questions' ? t('搜索问题、型号或访客编号', 'Question, model or visitor ID') : t('搜索访客编号、浏览器或系统', 'Visitor ID, browser or OS')} value={draft} onChange={event => setDraft(event.target.value)} maxLength={100} /><button type="submit">{t('搜索', 'Search')}</button></form><a className="console-export" href={`/api/dev-admin/export?${new URLSearchParams({ kind: tab, days: String(days), q: query })}`}><Download size={16} />CSV</a></div>
            <div className="console-table-scroll"><table><thead><tr>{(tab === 'visitors' ? [t('访客', 'Visitor'), t('浏览器 / 系统', 'Browser / OS'), t('设备', 'Device'), t('国家代码', 'Country'), t('首次访问', 'First seen'), t('最近活动', 'Last activity')] : [t('时间 / 访客', 'Time / visitor'), t('用户问题', 'Question'), t('农机范围', 'Machine scope'), t('结果', 'Outcome'), t('资料命中 / 耗时', 'Evidence / latency')]).map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{records.data?.rows.map(row => 'question' in row ? <tr key={row.id}><td>{formatTime(row.occurredAt, locale)}<small>{short(row.visitorId)}</small></td><td className="console-question-cell"><details><summary>{row.question.slice(0, 90)}{row.question.length > 90 ? '…' : ''}</summary><p>{row.question}</p><small>{t('页面构建', 'Page build')}: {short(row.release)}</small></details></td><td>{[row.brand, row.model].filter(Boolean).join(' ') || t('未指定', 'Not selected')}<small>{row.machineType || '—'}</small></td><td><Badge tone={row.outcome === 'success' ? 'good' : 'warning'}>{row.outcome === 'success' ? t('已回复', 'Replied') : row.outcome === 'cancelled' ? t('已取消', 'Cancelled') : t('失败', 'Failed')}</Badge></td><td>{row.knowledgeChunks} {t('片段', 'chunks')}<small>{row.latencyMs} ms</small></td></tr> : <tr key={row.id}><td title={row.id}><button type="button" className="console-visitor-link" onClick={() => { changeTab('questions'); setQuery(row.id); setDraft(row.id); }}>{t('访客', 'Visitor')} {short(row.id)}</button><small>{row.views} PV · {row.questions} {t('提问', 'questions')}</small></td><td>{row.browser}<small>{row.os}</small></td><td>{row.device === 'mobile' ? t('手机', 'Mobile') : row.device === 'tablet' ? t('平板', 'Tablet') : t('桌面', 'Desktop')}</td><td>{row.country}</td><td>{formatTime(row.firstSeen, locale)}</td><td>{formatTime(row.lastSeen, locale)}</td></tr>)}</tbody></table></div>
            {(!records.data || records.data.rows.length === 0) && <div className="console-empty">{records.loading ? t('正在读取记录…', 'Loading records…') : records.error ? t('未能读取记录，请重试。', 'Could not read records; retry.') : t('没有符合条件的记录。', 'No matching records.')}</div>}
            <div className="console-pagination"><span>{t('共', 'Total')} {records.data?.total ?? '—'} {t('条', 'records')} · {t('每页25条', '25 per page')}</span><div><button type="button" aria-label={t('上一页', 'Previous page')} disabled={page === 1 || records.loading} onClick={() => setPage(v => v - 1)}><ChevronLeft size={18} /></button><span>{page} / {Math.max(1, Math.ceil((records.data?.total || 0) / 25))}</span><button type="button" aria-label={t('下一页', 'Next page')} disabled={!records.data || page * 25 >= records.data.total || records.loading} onClick={() => setPage(v => v + 1)}><ChevronRight size={18} /></button></div></div><p className="console-help">{t('CSV 导出当前筛选下最多5000条记录。', 'CSV exports up to 5,000 records matching the current filters.')}</p>
          </Panel>}
          {tab === 'system' && <>
            <div className="console-columns"><Panel title={t('GitHub 主干', 'GitHub main')} description="srt2777/AgriDx-v3 · main"><div className="console-service-heading"><Github size={25} /><Badge tone={git && !('error' in system.data!.github) ? 'good' : 'warning'}>{git && !('error' in system.data!.github) ? t('已读取', 'Read') : t('待读取 / 暂不可用', 'Pending / unavailable')}</Badge></div>{git && <><a className="console-commit" href={githubUrl(git.main.url)} target="_blank" rel="noreferrer">{short(git.main.sha)}<ArrowUpRight size={14} /></a><p className="console-commit-message">{git.main.message}</p><dl className="console-properties"><div><dt>{t('提交时间', 'Commit time')}</dt><dd>{formatTime(git.main.date, locale)}</dd></div><div><dt>{t('状态读取', 'Fetched')}</dt><dd>{formatTime(git.observedAt, locale)}</dd></div></dl></>}{system.data && 'error' in system.data.github && <p className="console-error">{system.data.github.error}{git && t(' 显示上次读取的状态。', ' Showing previously fetched status.')}</p>}<p className="console-help">{t('GitHub 状态最多缓存5分钟，避免接口限额。', 'GitHub status is cached for up to five minutes to respect API limits.')}</p></Panel>
            <Panel title={t('已发布的开发页面', 'Published development build')}><div className="console-service-heading"><Activity size={25} /><Badge tone={system.data?.artifact ? 'good' : 'warning'}>{system.data?.artifact ? t('版本记录可读', 'Manifest available') : t('待读取', 'Pending')}</Badge></div>{system.data?.artifact && <><strong className="console-service-version">v{system.data.artifact.version}</strong><dl className="console-properties"><div><dt>{t('提交', 'Commit')}</dt><dd>{short(system.data.artifact.commit)}</dd></div><div><dt>{t('构建时间', 'Built')}</dt><dd>{formatTime(system.data.artifact.builtAt, locale)}</dd></div><div><dt>{t('与主干对照', 'Compared with main')}</dt><dd>{git ? (git.main.sha === system.data.artifact.commit ? t('一致', 'In sync') : t('提交不同，请核对读取时间', 'Commits differ; check fetch times')) : t('主干状态未知', 'Main status unknown')}</dd></div><div><dt>{t('当前浏览器页面', 'This browser build')}</dt><dd>{__AGRIDX_PREVIEW_RELEASE__.version} · {short(__AGRIDX_PREVIEW_RELEASE__.commit)}</dd></div></dl>{system.data.artifact.commit !== __AGRIDX_PREVIEW_RELEASE__.commit && <button type="button" className="console-primary" onClick={() => window.location.reload()}>{t('刷新到已发布版本', 'Reload published version')}</button>}</>}{system.data?.artifactError && <p className="console-error">{system.data.artifactError}</p>}</Panel></div>
            <div className="console-columns"><Panel title={t('开发服务与存储', 'Development service & storage')}><div className="console-service-heading"><Server size={25} /><Badge tone={system.data ? 'good' : 'neutral'}>{system.data ? t('已连接', 'Connected') : t('读取中', 'Loading')}</Badge></div><dl className="console-properties"><div><dt>{t('运行环境', 'Runtime')}</dt><dd>{system.data?.gateway.runtime || '—'}</dd></div><div><dt>{t('集中数据存储', 'Shared storage')}</dt><dd>{system.data?.gateway.storage || '—'}</dd></div><div><dt>{t('服务代码版本', 'Service code version')}</dt><dd>{system.data?.gateway.version || '—'}</dd></div><div><dt>{t('服务源码提交', 'Service source commit')}</dt><dd>{short(system.data?.gateway.sourceCommit)}</dd></div><div><dt>{t('外部模型', 'External models')}</dt><dd>{t('开发版使用本地知识引擎', 'Local knowledge engine in development')}</dd></div></dl></Panel><Panel title={t('其他服务器', 'Other servers')}>{(system.data?.servers || []).map(server => <div key={server.url}><div className="console-service-heading"><Server size={25} /><Badge>{t('未接入', 'Not connected')}</Badge></div><h3>{server.name}</h3><p className="console-help">{server.url}</p><p className="console-help">{server.detail}</p></div>)}{!system.data && <p className="console-empty">{t('正在读取服务配置…', 'Loading service configuration…')}</p>}</Panel></div>
            <Panel title={t('最近的 GitHub 主干构建', 'Recent GitHub main builds')}><div className="console-table-scroll"><table><thead><tr>{[t('工作流', 'Workflow'), t('状态', 'Status'), t('提交', 'Commit'), t('更新时间', 'Updated')].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{git?.runs.map(run => <tr key={run.id}><td><a href={githubUrl(run.url)} target="_blank" rel="noreferrer">{run.name}<ArrowUpRight size={13} /></a></td><td><Badge tone={run.conclusion === 'success' ? 'good' : run.conclusion === 'failure' ? 'warning' : 'neutral'}>{run.conclusion === 'success' ? t('通过', 'Passed') : run.conclusion === 'failure' ? t('失败', 'Failed') : run.conclusion === 'cancelled' ? t('已取消', 'Cancelled') : run.status === 'in_progress' ? t('运行中', 'Running') : run.status === 'queued' ? t('排队中', 'Queued') : run.conclusion || run.status}</Badge></td><td><code>{short(run.sha)}</code></td><td>{formatTime(run.updatedAt, locale)}</td></tr>)}</tbody></table></div>{!git && <p className="console-empty">{t('GitHub 构建状态尚未读取。', 'GitHub build status has not been read.')}</p>}</Panel>
          </>}
          <footer className="console-footer"><ShieldCheck size={15} /><span>{t('内部数据仅管理员可见 · 保存最近30天 · 匿名浏览器标识不代表实名用户', 'Administrators only · 30-day retention · anonymous browser IDs are not real-name users')}{stats?.firstSeen && <> · {t('最早现存记录', 'Earliest retained record')} {formatTime(stats.firstSeen, locale)}</>}</span></footer>
        </>}
    </main>
  </div>;
}

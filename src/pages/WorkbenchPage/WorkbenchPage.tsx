import { fleetSummary } from '../../../shared/fleet-simulation';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Activity, ArrowRight, Check, ChevronRight, Database, Download, FileText, Info, RefreshCw, Search, ShieldCheck, Tractor, Trash2, Workflow } from 'lucide-react';
import { useLang } from '@/hooks/useLang';
import { useTelemetry } from '@/hooks/useTelemetry';
import { useWorkbench } from '@/features/workbench/WorkbenchContext';
import { workbenchRoutes } from '@/features/workbench/navigation';
import { datasetCsv, downloadFile, type Activity as ActivityRecord } from '@/features/workbench/data';
import { TelemetryScenarioControls } from '@/components/parts-tractor/TelemetryScenarioControls';
import { useUpdateBlocker } from '@/features/updates/useUpdateBlocker';
import { Analytics } from './Analytics';
import { FieldFleet, FieldAnalytics } from '@/pages/FieldOverview/FieldOverview';
import { DataImport } from './DataImport';
import { TrendChart } from './TrendChart';
import { ScrollCount } from '@/components/ScrollCount';
import { useKnowledgeSummary } from '@/hooks/useKnowledgeSummary';

function useCopy() { const lang = useLang(); return { lang, t: (zh: string, en: string) => lang === 'zh' ? zh : en }; }
function Panel({ title, eyebrow, children, action }: { title: string; eyebrow?: string; children: ReactNode; action?: ReactNode }) { return <section className="wb-panel"><div className="wb-panel-heading"><div>{eyebrow && <p className="wb-eyebrow">{eyebrow}</p>}<h2>{title}</h2></div>{action}</div>{children}</section>; }
function Empty({ children }: { children: ReactNode }) { return <div className="wb-empty"><Database size={28} /><p>{children}</p></div>; }

function inViewport(node: HTMLElement) {
  const rect = node.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight * 0.96;
}

function useWorkbenchReveal(pathname: string) {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('.wb-page');
    if (!root) return undefined;
    const nodes = [...root.querySelectorAll<HTMLElement>('.wb-page-heading, .wb-metric, .wb-panel')];
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      nodes.forEach(node => node.classList.add('is-revealed'));
      return undefined;
    }
    nodes.forEach(node => node.classList.add('chapter-line'));
    root.setAttribute('data-chapter-motion', 'on');
    let frame = 0;
    let observer: IntersectionObserver | undefined;
    const reveal = (list: HTMLElement[]) => {
      list.forEach((node, index) => {
        node.style.setProperty('--chapter-i', String(index));
        node.classList.add('is-revealed');
      });
    };
    const arm = () => {
      reveal(nodes.filter(inViewport));
      observer = new IntersectionObserver(entries => {
        const fresh = entries.filter(entry => entry.isIntersecting).map(entry => entry.target as HTMLElement);
        reveal(fresh);
        fresh.forEach(node => observer?.unobserve(node));
      }, { threshold: 0.15, rootMargin: '0px 0px -4% 0px' });
      nodes.filter(node => !node.classList.contains('is-revealed')).forEach(node => observer?.observe(node));
    };
    // Wait until a frame has painted the hidden state, then start the rise.
    frame = requestAnimationFrame(() => { frame = requestAnimationFrame(arm); });
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      root.removeAttribute('data-chapter-motion');
    };
  }, [pathname]);
}

export default function WorkbenchPage() {
  const { pathname } = useLocation(), { lang, t } = useCopy(), work = useWorkbench();
  useWorkbenchReveal(pathname);
  const route = workbenchRoutes.find(r => r.path === pathname) ?? workbenchRoutes[0];
  const subtitles: Record<string, [string, string]> = {
    '/': ['从农机对象出发，让数据、知识与检查形成完整工作流。', 'Connect machine context, observations, knowledge and inspection.'],
    '/workspace/assets': ['按品牌、型号和部件组织资料，明确每一次查询的适用范围。', 'Organize evidence by brand, model and component.'],
    '/workspace/data': ['在同一处接入数据、导入文件并查看趋势与统计。', 'Connect sources, import files and explore trends in one place.'],
    '/workspace/commands': ['选择对象、配置任务、读取响应，再进入下一步。', 'Select an object, configure a task and inspect its response.'],
    '/workspace/records': ['保留本浏览器的操作轨迹与人工检查记录。', 'Keep local activity and user-reported inspection notes.'],
  };
  const sub = subtitles[pathname] ?? subtitles['/'];
  return <div className="wb-page"><header className="wb-page-heading"><div><p className="wb-eyebrow">SIJIA / FIELD WORKSPACE</p><h1>{route[lang]}</h1><p>{sub[lang === 'zh' ? 0 : 1]}</p></div><div className="wb-actions"><Link className="wb-button" to="/knowledge"><Search size={16} />{t('查阅知识库', 'Browse knowledge base')}</Link><Link className="wb-button wb-primary" to="/chat" state={{ machineType: '拖拉机', brand: work.brand?.name ?? '', model: work.model?.name ?? '', engineModel: '', faultCodes: [] }}>{t('开始诊断', 'Start diagnosis')}<ArrowRight size={16} /></Link></div></header>
    {work.storageError && <p className="wb-notice" role="alert">{t('浏览器未能保存更改：当前数据仅在内存中，请先导出，避免刷新丢失。', 'Browser storage failed. Changes are in memory only; export before refreshing.')}</p>}
    {!work.ready && <p className="wb-notice" role="status">{t('正在读取本地数据，读取完成前暂不能保存。', 'Loading local data; saving is paused until it finishes.')}</p>}
    {work.migrationCorruptRaw !== null && <p className="wb-notice" role="alert">{t('旧的本地数据损坏，未被覆盖；可先导出恢复材料，再重试迁移。', 'Saved local data is damaged and was not overwritten. Export the recovery copy, then retry migration.')} <button type="button" onClick={work.exportLegacyRecovery}>{t('导出恢复材料', 'Export recovery copy')}</button> <button type="button" onClick={() => void work.retryMigration()}>{t('重试迁移', 'Retry migration')}</button></p>}
    {work.legacyWriteDetected && <p className="wb-notice" role="alert">{t('检测到旧版标签页仍在修改旧存储，请刷新本页并使用新版标签页操作；旧数据已保留，可导出。', 'An older tab is still editing the old storage. Refresh this page and use an updated tab; the old data is kept and can be exported.')} <button type="button" onClick={() => window.location.reload()}>{t('刷新本页', 'Refresh')}</button> <button type="button" onClick={work.exportLegacyRecovery}>{t('导出旧数据', 'Export old data')}</button></p>}
    {work.catalogStatus === 'error' && <p className="wb-notice" role="status">{t('知识目录读取失败；已有数据显示为缓存，不能据此判断最新覆盖。', 'Catalog unavailable; retained values may be cached.')} <button type="button" onClick={work.refresh}>{t('重试目录', 'Retry catalog')}</button></p>}
    {pathname === '/workspace/assets' ? <Assets /> : pathname === '/workspace/data' ? <DataPage /> : pathname === '/workspace/commands' ? <Commands /> : pathname === '/workspace/records' ? <Records /> : <Overview />}
  </div>;
}

function Overview() {
  const { lang, t } = useCopy(), work = useWorkbench(), telemetry = useTelemetry({ modelId: 'diesel', partId: 'engine', window: '5m' });
  const totals = work.catalog?.totals;
  const summary = useKnowledgeSummary(totals?.entries);
  const steps = [{ path: '/workspace/assets', zh: '选择农机', en: 'Select machine', text: t('品牌 · 型号 · 部件', 'Brand · model · part') }, { path: '/workspace/data', zh: '整理与分析', en: 'Prepare & analyze', text: t('接入 · 导入 · 趋势', 'Connect · import · trends') }, { path: '/chat', zh: '检索与诊断', en: 'Find evidence', text: t('现象 · 来源 · 建议', 'Symptoms · sources · advice') }, { path: '/workspace/records', zh: '记录与复核', en: 'Record & review', text: t('人工检查 · 导出', 'User checks · export') }];
  return <>
    <div className="wb-metrics">{[{ label: t('知识库', 'Knowledge base'), value: summary.total, note: t('归档、通识与研究摘录（不含书目）', 'Archive, learning and research notes; excludes bibliography'), icon: FileText }, { label: t('维修资料型号', 'Repair catalog models'), value: totals?.models, note: t('已有资料的型号或系列 · 非全机覆盖', 'Models or series with repair references; not full coverage'), icon: Tractor }, { label: t('仿真监测点', 'Simulated monitoring points'), value: fleetSummary.points, note: t(`${fleetSummary.devices} 台模拟设备 / ${fleetSummary.signalTypes} 种信号 · 未连接实车`, `${fleetSummary.devices} simulated devices / ${fleetSummary.signalTypes} signal types · no vehicle connected`), icon: Activity }, { label: t('本地数据集', 'Local datasets'), value: work.data.datasets.length, note: t('仅保存在本浏览器', 'Stored in this browser'), icon: Database }].map(({ label, value, note, icon: Icon }) => <div className="wb-metric" key={label}><div><span>{label}</span><Icon size={19} /></div><strong>{typeof value === 'number' ? <ScrollCount value={value} /> : '—'}</strong><small>{note}</small></div>)}</div>
    <p className="wb-muted">{t('归档与学习', 'Archive and learning')} {totals?.entries.toLocaleString() ?? '—'} · {t('正文研究知识', 'Research notes')} {summary.researchCount.toLocaleString()} · {t('文献元数据（未核验全文）', 'Literature metadata (full text unverified)')} {summary.literatureCount?.toLocaleString() ?? '—'}。<Link to="/knowledge">{t('查看知识库', 'Open knowledge base')}</Link></p>
    <p className="wb-muted">{t(`维修资料目录覆盖 ${totals?.models ?? '—'} 个型号或系列，仅统计已有资料的型号。`, `Repair catalog: ${totals?.models ?? '—'} models or series, based on available references.`)} <Link to="/workspace/assets">{t('检索型号档案', 'Browse model archive')}</Link> · <Link to="/workspace/data?source=fleet">{t('查看机群仿真', 'Explore fleet simulation')}</Link></p>
    {summary.failed && <p className="wb-notice" role="status">{t('文献统计读取失败，归档与学习统计仍可查看。', 'Literature count unavailable; archive and learning counts remain available.')} <button type="button" onClick={summary.retry}>{t('重试统计', 'Retry counts')}</button></p>}
    <Panel title={t('一条清楚的工作路径', 'A connected workflow')} eyebrow="WORKFLOW" action={<span className="wb-tag">{t('4 个环节', '4 stages')}</span>}><div className="wb-workflow">{steps.map((s, i) => <Link to={s.path} key={s.path}><span className="wb-step-number">0{i + 1}</span><strong>{s[lang]}</strong><small>{s.text}</small><ChevronRight size={17} /></Link>)}</div></Panel>
    <div className="wb-grid-two"><Panel title={t('采集趋势速览', 'Collection trend')} eyebrow="OBSERVATIONS" action={<Link to="/workspace/data">{t('查看全部', 'Explore all')} <ArrowRight size={15} /></Link>}><SourceNotice state={telemetry.connectionState} />{telemetry.series[0] ? <TrendChart points={telemetry.series[0].windowPoints} unit={telemetry.series[0].channel.unit} label={telemetry.series[0].channel.name[lang]} sampleMs={telemetry.catalog?.sampleMs} /> : <Empty>{t('正在等待演示采集源；没有样本时不填充虚构读数。', 'Waiting for the simulation source. No values are invented.')}</Empty>}</Panel>
      <Panel title={t('对象与资料覆盖', 'Objects & evidence coverage')} eyebrow="MACHINE CONTEXT" action={<Link to="/workspace/assets">{t('管理选择', 'Select object')}<ArrowRight size={15} /></Link>}><ObjectPicker /><div className="wb-context-card"><Tractor size={34} /><div><strong>{work.model?.name ?? t('尚未选择型号', 'No model selected')}</strong><p>{work.brand?.name ?? t('先建立明确的查询上下文', 'Start with a clear machine context')}</p></div></div><dl className="wb-definition"><div><dt>{t('归档证据', 'Archived entries')}</dt><dd>{work.model?.entryCount ?? '—'}</dd></div><div><dt>{t('来源数量', 'Sources')}</dt><dd>{work.model?.sourceCount ?? '—'}</dd></div><div><dt>{t('结构部件', 'Components')}</dt><dd>{work.model?.components.length ?? '—'}</dd></div></dl><p className="wb-muted">{t('这里选择资料适用对象，不会将仿真通道绑定为该型号的真实读数。', 'This selects evidence scope, not a physical connection to simulated channels.')}</p></Panel></div>
    <div className="wb-grid-two"><Panel title={t('快捷工作区', 'Quick workspaces')} eyebrow="TOOLS"><div className="wb-shortcuts">{workbenchRoutes.filter(r => ['/workspace/commands', '/fault-detection', '/models', '/knowledge'].includes(r.path)).map(r => <Link to={r.path} key={r.path}><r.icon size={22} /><strong>{r[lang]}</strong><ArrowRight size={16} /></Link>)}</div></Panel><Panel title={t('最近活动', 'Recent activity')} eyebrow="ACTIVITY" action={<Link to="/workspace/records">{t('全部记录', 'All records')}</Link>}><ActivityList activities={work.data.activities.slice(0, 4)} /></Panel></div>
  </>;
}
function ObjectPicker() {
  const work = useWorkbench(), { t } = useCopy();
  return <div className="wb-form-grid wb-two-fields"><label>{t('品牌', 'Brand')}<select value={work.brandId} onChange={e => work.chooseBrand(e.target.value)} disabled={!work.catalog}><option value="">{t('选择品牌', 'Choose brand')}</option>{work.catalog?.brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label><label>{t('型号 / 系列', 'Model / series')}<select value={work.modelId} onChange={e => work.chooseModel(e.target.value)} disabled={!work.brand}><option value="">{t('选择型号', 'Choose model')}</option>{work.brand?.models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label></div>;
}
function Assets() {
  const work = useWorkbench(), { lang, t } = useCopy(), [query, setQuery] = useState('');
  const [component, setComponent] = useState('');
  useEffect(() => setComponent(''), [work.modelId, work.brandId]);
  const selected = work.model?.components.find(c => c.id === component);
  const params = new URLSearchParams({ brand: work.brand?.id ?? '', model: work.model?.id ?? '', ...(selected ? { component: selected.id } : {}) });
  return <><Panel title={t('当前农机对象', 'Current machine object')} action={<button type="button" onClick={work.refresh}><RefreshCw size={15} />{t('刷新目录', 'Refresh catalog')}</button>}><ObjectPicker /></Panel><div className="wb-object-layout"><Panel title={t('结构目录', 'Structure tree')} eyebrow="OBJECT TREE"><label className="wb-search"><Search size={16} /><input aria-label={t('搜索部件', 'Search components')} placeholder={t('搜索部件…', 'Search components…')} value={query} onChange={e => setQuery(e.target.value)} /></label>{work.model ? <div className="wb-tree"><strong><Tractor size={18} />{work.model.name}</strong>{work.model.components.filter(c => c.name.toLowerCase().includes(query.toLowerCase())).map(c => <button type="button" key={c.id} aria-pressed={component === c.id} onClick={() => setComponent(c.id)}><ChevronRight size={15} /><span>{c.name}</span><small>{c.entryCount}</small></button>)}</div> : <Empty>{t('选择品牌和型号后展开结构目录。', 'Choose a brand and model to browse components.')}</Empty>}</Panel>
    <Panel title={selected?.name ?? work.model?.name ?? t('对象工作区', 'Object workspace')} eyebrow="EVIDENCE SCOPE" action={work.model && <span className="wb-tag">{work.model.scope === 'exact' ? t('具体型号', 'Exact model') : work.model.scope === 'series' ? t('系列范围', 'Series scope') : t('范围待核实', 'Scope pending')}</span>}>
      {work.model ? <><div className="wb-metrics wb-three">{[[t('资料条目', 'Entries'), selected?.entryCount ?? work.model.entryCount], [t('故障条目', 'Fault entries'), selected?.faultCount ?? work.model.faultCount], [t('来源', 'Sources'), selected?.sourceCount ?? work.model.sourceCount]].map(([label, value]) => <div className="wb-metric" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div><div className="wb-table-wrap"><table><thead><tr><th>{t('零件 / 部件', 'Part / component')}</th><th>{t('条目', 'Entries')}</th><th>{t('来源', 'Sources')}</th></tr></thead><tbody>{(selected?.parts ?? work.model.components).map(part => <tr key={part.id}><td>{part.name}</td><td>{part.entryCount}</td><td>{part.sourceCount}</td></tr>)}</tbody></table></div><p className="wb-muted">{t('资料目录反映已有证据，不等于已建立实体设备或验证整机能力。维修参数以对应来源与适用范围为准。', 'The catalog reflects evidence, not a registered physical machine or whole-machine validation. Check each source and applicability.')}</p><div className="wb-actions"><Link className="wb-button wb-primary" to={`/knowledge?${params}`}>{t('打开对应资料', 'Open scoped evidence')}<ArrowRight size={16} /></Link><Link className="wb-button" to="/chat" state={{ machineType: '拖拉机', brand: work.brand?.name ?? '', model: work.model.name, engineModel: '', faultCodes: [], question: `${lang === 'zh' ? '请帮我查阅' : 'Help me review'} ${work.brand?.name} ${work.model.name} ${selected?.name ?? ''}` }}>{t('带对象进入诊断', 'Diagnose with this context')}</Link></div></> : <Empty>{t('选择对象后查看资料统计、适用范围和部件。', 'Choose an object to inspect evidence counts, applicability and parts.')}</Empty>}
    </Panel></div><FieldFleet /></>;
}
function SourceNotice({ state }: { state: string }) {
  const { t } = useCopy();
  return <div className="wb-source"><span className={`wb-dot ${state === 'simulated' ? '' : 'is-waiting'}`} /><strong>{t('仿真数据 · 未连接实车', 'Simulated data · no live vehicle')}</strong><span>{state === 'simulated' ? t('正在接收样本', 'Receiving samples') : state === 'delayed' ? t('样本延迟，显示历史值', 'Delayed · historical values') : t('源未连接，显示历史值', 'Disconnected · historical values')}</span></div>;
}
function DataPage() {
  const { t } = useCopy();
  const { search } = useLocation();
  return <><details key={search} open={new URLSearchParams(search).has('manage')} className="wb-panel wb-data-management"><summary>{t('接入与管理：导入文件、管理数据集', 'Connect & manage: import files and manage datasets')}</summary><DataImport /><DatasetList /></details>
    <Analytics />
    <details className="wb-panel wb-data-management"><summary>{t('作业演示统计', 'Demo work statistics')}</summary><FieldAnalytics /></details>
  </>;
}
function DatasetList() {
  const { t } = useCopy(), work = useWorkbench();
  return <Panel title={t('本地数据集', 'Local datasets')} eyebrow="DATASETS">{work.data.datasets.length ? <div className="wb-table-wrap"><table><thead><tr><th>{t('名称与来源', 'Name & provenance')}</th><th>{t('对象', 'Object')}</th><th>{t('样本 / 单位', 'Samples / unit')}</th><th>{t('操作', 'Actions')}</th></tr></thead><tbody>{work.data.datasets.map(d => <tr key={d.id}><td><strong>{d.name}</strong><small>{t('用户导入 · 未核验', 'User import · unverified')}</small></td><td>{d.object}</td><td>{d.points.length} / {d.unit}</td><td><div className="wb-actions"><Link to={`/workspace/data?dataset=${encodeURIComponent(d.id)}`}>{t('查看', 'View')}</Link><button type="button" onClick={() => { downloadFile(datasetCsv(d), `${d.name.replace(/\.csv$/i, '')}-export.csv`); work.log('export', d.name, d.object).catch(() => undefined); }} aria-label={`${t('导出', 'Export')} ${d.name}`}><Download size={15} /></button><button type="button" disabled={!work.ready || work.busy} onClick={() => { if (window.confirm(t(`删除本地数据集“${d.name}”？`, `Delete local dataset “${d.name}”?`))) { void work.deleteDataset(d.id).then(() => work.log('delete', d.name, d.object)).catch(() => undefined); } }} aria-label={`${t('删除', 'Delete')} ${d.name}`}><Trash2 size={15} /></button></div></td></tr>)}</tbody></table></div> : <Empty>{t('还没有导入数据集。文件映射完成后会显示在这里。', 'No imported datasets yet. Map a CSV file to get started.')}</Empty>}</Panel>;
}
function Commands() {
  const { lang, t } = useCopy(), work = useWorkbench(), navigate = useNavigate(), telemetry = useTelemetry({ modelId: 'diesel', partId: 'engine', window: '5m' });
  const [question, setQuestion] = useState(''), [intent, setIntent] = useState('check');
  useUpdateBlocker('workbench-command', !!question.trim());
  const object = [work.brand?.name, work.model?.name].filter(Boolean).join(' ');
  function handoff() {
    const prefix = intent === 'check' ? t('请基于资料给出检查步骤：', 'Please provide evidence-based inspection steps: ') : intent === 'explain' ? t('请解释以下现象，并说明证据与不确定性：', 'Explain this observation with evidence and uncertainty: ') : t('请帮我复核以下人工检查记录：', 'Review these user-reported inspection notes: ');
    work.log('handoff', t('已创建诊断草稿，待人工发送', 'Diagnosis draft created; awaiting manual send'), object).catch(() => undefined);
    navigate('/chat', { state: { machineType: '拖拉机', brand: work.brand?.name ?? '', model: work.model?.name ?? '', engineModel: '', faultCodes: [], question: prefix + question.trim() } });
  }
  return <><ol className="wb-steps"><li className={work.model ? 'is-done' : 'is-current'}>01 {t('选择对象', 'Choose object')}</li><li className={question.trim() ? 'is-done' : 'is-current'}>02 {t('配置任务', 'Configure task')}</li><li>03 {t('发送与响应', 'Send & response')}</li><li>04 {t('记录复核', 'Review records')}</li></ol><div className="wb-grid-two"><Panel title={t('诊断任务配置', 'Diagnosis task')} eyebrow="TASK BUILDER"><ObjectPicker /><div className="wb-form-grid wb-one"><label>{t('任务指令', 'Task instruction')}<select value={intent} onChange={e => setIntent(e.target.value)}><option value="check">{t('生成检查建议', 'Suggest inspection steps')}</option><option value="explain">{t('解释观察现象', 'Explain observations')}</option><option value="review">{t('复核人工记录', 'Review user notes')}</option></select></label><label>{t('现象、条件或检查结果', 'Symptoms, conditions or inspection results')}<textarea rows={5} maxLength={1600} placeholder={t('例如：冷机启动困难，已检查电池接线；请结合型号资料给出下一步。', 'Describe symptoms, conditions and checks already performed.')} value={question} onChange={e => setQuestion(e.target.value)} /></label></div><div className="wb-actions"><button type="button" className="wb-primary" disabled={!question.trim()} onClick={handoff}>{t('生成草稿并进入诊断', 'Prepare draft & open diagnosis')}<ArrowRight size={16} /></button><small>{question.length} / 1600</small></div></Panel>
    <Panel title={t('执行路径与响应', 'Execution & response')} eyebrow="RESPONSE"><div className="wb-checklist"><p><Check size={17} />{t('对象上下文随任务传入诊断', 'Machine context travels with the task')}</p><p><Check size={17} />{t('先预览草稿，再由你发送', 'Preview the draft before sending')}</p><p><ShieldCheck size={17} />{t('沿用现有来源、适用范围和诊断边界', 'Existing evidence and applicability checks apply')}</p><p><Info size={17} />{t('不会执行实车控制指令', 'No commands are sent to physical equipment')}</p></div><p className="wb-muted">{t('诊断页展示实际服务响应、引用与降级状态，并可停止请求；在此创建草稿不表示已完成诊断。', 'The diagnosis page shows actual replies, citations and fallback state, and supports cancellation. Creating a draft does not complete a diagnosis.')}</p><div className="wb-context-card"><Workflow size={28} /><div><strong>{object || t('未限定具体型号', 'No exact model selected')}</strong><p>{t('仿真和导入数据不会自动作为维修证据发送。', 'Simulation and imported data are not automatically sent as repair evidence.')}</p></div></div></Panel></div>
    <Panel title={t('演示采集指令', 'Simulation collection controls')} eyebrow="SCENARIO CONTROL"><SourceNotice state={telemetry.connectionState} /><TelemetryScenarioControls data={telemetry} lang={lang} /></Panel>
  </>;
}
function ActivityList({ activities }: { activities: ActivityRecord[] }) {
  const { t } = useCopy();
  const labels = { import: t('导入', 'Import'), export: t('导出', 'Export'), handoff: t('诊断草稿', 'Diagnosis draft'), note: t('人工记录', 'User note'), delete: t('删除', 'Delete') };
  return activities.length ? <ol className="wb-activity-list">{activities.map(a => <li key={a.id}><span className="wb-activity-dot" /><div><strong>{labels[a.kind]}</strong><p>{a.text}</p><small>{a.object} · {new Date(a.at).toLocaleString()}</small></div></li>)}</ol> : <Empty>{t('暂无记录。导入、导出或创建诊断草稿后会显示在这里。', 'No activity yet. Imports, exports and diagnosis drafts appear here.')}</Empty>;
}
function Records() {
  const { t } = useCopy(), work = useWorkbench(); const [note, setNote] = useState(''), [object, setObject] = useState([work.brand?.name, work.model?.name].filter(Boolean).join(' ')), [filter, setFilter] = useState('');
  useUpdateBlocker('workbench-note', !!note.trim());
  return <><Panel title={t('添加人工检查记录', 'Add a user-reported check')} eyebrow="INSPECTION NOTES"><form onSubmit={e => { e.preventDefault(); if (!note.trim() || !object.trim()) return; const text = note.trim(), obj = object.trim(); work.log('note', text, obj).then(() => setNote('')).catch(() => undefined); }}><div className="wb-form-grid wb-one"><label>{t('检查对象', 'Inspection object')}<input required maxLength={150} value={object} onChange={e => setObject(e.target.value)} /></label><label>{t('记录内容（用户报告，未独立核验）', 'Note (user reported, not independently verified)')}<textarea required maxLength={1000} rows={3} value={note} onChange={e => setNote(e.target.value)} /></label></div><button className="wb-primary" type="submit" disabled={!note.trim() || !object.trim() || !work.ready || work.busy}><Check size={16} />{work.busy ? t('保存中…', 'Saving…') : t('保存记录', 'Save note')}</button></form></Panel><Panel title={t('本浏览器操作记录', 'Activity in this browser')} eyebrow="ACTIVITY LOG" action={<div className="wb-actions"><button type="button" disabled={!work.data.activities.length} onClick={() => downloadFile(JSON.stringify({ source: 'browser-local-user-records', exportedAt: new Date().toISOString(), activities: work.data.activities }, null, 2), 'sijia-activity.json', 'application/json')}><Download size={16} />{t('导出记录', 'Export log')}</button><button type="button" disabled={!work.data.activities.length || !work.ready || work.busy} onClick={() => { if (window.confirm(t('清空本浏览器工作台记录？不会删除诊断历史或导入数据集。', 'Clear this workbench log? Diagnosis history and datasets are kept.'))) void work.clearActivities().catch(() => undefined); }}><Trash2 size={16} />{t('清空', 'Clear')}</button></div>}><p className="wb-muted">{t('保留最近 100 条。这里的记录不代替诊断会话历史，也不表示实车操作已执行。', 'Latest 100 records. This log is separate from diagnosis history and does not imply physical actions were performed.')}</p><label className="wb-search"><Search size={16} /><input value={filter} onChange={e => setFilter(e.target.value)} aria-label={t('搜索记录', 'Search records')} placeholder={t('搜索内容或对象…', 'Search notes or objects…')} /></label><ActivityList activities={work.data.activities.filter(a => `${a.text} ${a.object}`.toLowerCase().includes(filter.toLowerCase()))} /></Panel></>;
}

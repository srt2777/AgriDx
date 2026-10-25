import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useReducedMotion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Pause, Play, RotateCcw, TriangleAlert } from 'lucide-react';
import { useLang } from '@/hooks/useLang';
import { useKnowledgeCatalog } from '@/hooks/useKnowledgeCatalog';
import { useUpdateBlocker } from '@/features/updates/useUpdateBlocker';
import { catalogParts, partTitle, resolveSelection, selectionForPart } from '@/components/parts-tractor/parts-catalog';
import DeferredMarkdown from '@/components/DeferredMarkdown';
import { CHECKS, DEMO_RECORD_KEY, EVIDENCE_QUERY, SCENARIOS,
  demoEvidence, diagnosisDraft, parseRecords, type DemoRecord, type Scenario } from './demo';
import { useTelemetry } from '@/hooks/useTelemetry';
import { buildReplayTimeline, cursorAt, pointsThrough, resetForRun, type ReplayCursor } from './telemetry-replay';
import './fault-detection.css';

const FaultModel = lazy(() => import('./FaultModel'));
type Metric = 'temperature' | 'rpm' | 'pressure';
const METRIC_HINTS: Record<Metric, string[]> = {
  temperature: ['冷却液温度', 'coolant'], rpm: ['发动机转速', 'engine speed', 'rpm'], pressure: ['机油压力', 'oil pressure'],
};

export default function FaultDetectionPage() {
  const zh = useLang() === 'zh';
  const t = (cn: string, en: string) => zh ? cn : en;
  const reduced = !!useReducedMotion();
  const [scenario, setScenario] = useState<Scenario>('quiet');
  const [playing, setPlaying] = useState(false);
  const [metric, setMetric] = useState<Metric>('temperature');
  const [selection, setSelection] = useState<string | null>(null);
  const [isolate, setIsolate] = useState(false);
  const [modelOpen, setModelOpen] = useState(() => window.matchMedia('(min-width: 1000px)').matches);
  const [checksOpen, setChecksOpen] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [checkId, setCheckId] = useState<DemoRecord['checkId']>('scope');
  const [note, setNote] = useState('');
  const [records, setRecords] = useState<DemoRecord[]>(() => {
    try { return parseRecords(sessionStorage.getItem(DEMO_RECORD_KEY)); } catch { return []; }
  });
  const [storageMessage, setStorageMessage] = useState('');
  const checksRef = useRef<HTMLDetailsElement>(null);
  const { catalog, loading, failed, retry } = useKnowledgeCatalog(EVIDENCE_QUERY);
  const telemetry = useTelemetry({ modelId: 'diesel', partId: 'engine', window: '1h' });
  const evidence = failed ? null : demoEvidence(catalog);
  const [cursor, setCursor] = useState<ReplayCursor>(resetForRun);
  const runId = telemetry.runId;
  const metricRows = telemetry.series.filter(row => row.channel.kind === 'measurement');
  const rowFor = (id: Metric) => metricRows.find(row => METRIC_HINTS[id].some(hint => `${row.channel.name.zh} ${row.channel.name.en} ${row.channel.id}`.toLowerCase().includes(hint.toLowerCase())));
  const activeRow = rowFor(metric);
  const timeline = buildReplayTimeline(activeRow?.points ?? [], activeRow?.channel.id ?? '');
  const replayPoints = pointsThrough(timeline, cursor);
  const selectedPoint = replayPoints.at(-1)?.point ?? activeRow?.latest;
  const elapsedSeconds = selectedPoint ? Math.floor(selectedPoint.elapsedMs / 1000) : 0;
  const time = elapsedSeconds;
  const sample = { sampleAt: elapsedSeconds, offline: telemetry.connectionState === 'offline', alert: telemetry.alerts.length > 0 };
  const displayRows = metricRows.map(row => ({ row, id: (Object.keys(METRIC_HINTS) as Metric[]).find(id => METRIC_HINTS[id].some(hint => `${row.channel.name.zh} ${row.channel.name.en} ${row.channel.id}`.toLowerCase().includes(hint.toLowerCase()))) })).filter(item => item.id);
  const timelineEndMs = timeline.points.at(-1)?.point.elapsedMs ?? 1000;
  const maxSeconds = Math.max(1, Math.ceil(timelineEndMs / 1000));
  const selectedPart = resolveSelection(selection);
  const currentRecords = records.filter(row => row.scenario === scenario);
  const activeMetric = activeRow?.channel;
  const values = replayPoints.map(item => item.point.value);
  const low = activeMetric?.range.min ?? Math.min(...values, 0);
  const high = activeMetric?.range.max ?? Math.max(...values, 1);
  const range = Math.max(high - low, 1);
  const path = replayPoints.map((item, index) => `${index ? 'L' : 'M'}${40 + (item.point.elapsedMs / timelineEndMs) * 600},${170 - ((item.point.value - low) / range) * 140}`).join(' ');
  const x = selectedPoint ? 40 + (selectedPoint.elapsedMs / timelineEndMs) * 600 : 40;
  useUpdateBlocker('/fault-detection', playing || note.trim().length > 0 || storageMessage.length > 0);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      setCursor(value => value.index + 1 < timeline.points.length
        ? { index: value.index + 1, elapsedMs: timeline.points[value.index + 1].point.elapsedMs, mode: 'received-history' }
        : value);
    }, 250);
    const pause = () => { if (document.hidden) setPlaying(false); };
    document.addEventListener('visibilitychange', pause);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', pause); };
  }, [playing, timeline.points]);
  useEffect(() => { setCursor(resetForRun()); setPlaying(false); }, [runId]);
  useEffect(() => { if (playing && cursor.index >= timeline.points.length - 1) setPlaying(false); }, [cursor.index, playing, timeline.points.length]);

  function persist(next: DemoRecord[]) {
    setRecords(next);
    try { sessionStorage.setItem(DEMO_RECORD_KEY, JSON.stringify(next)); setStorageMessage(''); }
    catch { setStorageMessage(t('浏览器存储不可用，记录仅保留在当前页面。', 'Storage unavailable. Records remain on this page only.')); }
  }
  function changeScenario(next: Scenario) {
    if (note.trim() && !window.confirm(t('切换场景将丢弃未保存的演示备注，继续？', 'Discard the unsaved demo note and change scenario?'))) return;
    setScenario(next); setCursor(resetForRun()); setPlaying(false); setSelection(null); setMetric('temperature');
    setIsolate(false); setChecksOpen(false); setEvidenceOpen(false); setNote(''); setCheckId('scope');
  }
  function selectAlert() {
    setPlaying(false); setMetric('temperature'); setCursor(cursorAt(timeline, 45000));
    setSelection(selectionForPart('radiator')); setIsolate(true); setChecksOpen(true); setEvidenceOpen(true);
    setModelOpen(true);
    window.setTimeout(() => checksRef.current?.focus({ preventScroll: true }), 0);
  }
  function saveCheck(event: FormEvent) {
    event.preventDefault();
    if (!note.trim()) return;
    persist([...records, { scenario, at: Math.floor(time), checkId, note: note.trim().slice(0, 1000) }].slice(-100));
    setNote('');
  }

  return <main className="fault-page page-container">
    <Link className="fault-back" to="/"><ArrowLeft size={16} />{t('返回园区', 'Back to campus')}</Link>
    <header className="fault-heading"><div><p>AGRIDX / DIAGNOSTIC LAB</p><h1>{t('故障检测演示工作台', 'Fault detection demo workbench')}</h1>
      <p>{t('观察异常，核对依据，逐步记录检查。', 'Observe anomalies, review evidence and record checks.')}</p></div>
      <Link to="/chat">{t('打开聊天诊断', 'Open diagnostic chat')}<ArrowRight size={16} /></Link></header>
    <div className="fault-simulation" role="note"><TriangleAlert size={18} /><strong>{t('模拟演示，未连接实车', 'SIMULATION · NO LIVE MACHINE')}</strong>
      <span>{t('数值与告警为预设教学场景，不是通用维修阈值。', 'Values and alerts are scripted examples, not universal service thresholds.')}</span></div>
    <section className="fault-controls" aria-label={t('模拟场景与播放', 'Scenario and playback')}>
      <label>{t('场景', 'Scenario')}<select aria-label={t('场景', 'Scenario')} value={scenario} onChange={e => changeScenario(e.target.value as Scenario)}>{SCENARIOS.map(item => <option key={item.id} value={item.id}>{zh ? item.zh : item.en}</option>)}</select></label>
      <button type="button" onClick={() => { if (cursor.index >= timeline.points.length - 1) setCursor(resetForRun()); setPlaying(v => !v); }}>{playing ? <Pause size={16} /> : <Play size={16} />}{playing ? t('暂停回放', 'Pause replay') : t('播放回放', 'Play replay')}</button>
      <button type="button" onClick={() => { setCursor(resetForRun()); setPlaying(false); setSelection(null); setIsolate(false); setChecksOpen(false); setEvidenceOpen(false); }}><RotateCcw size={16} />{t('重新开始回放', 'Restart replay')}</button>
      <label className="fault-seek">{t('已收到历史定位', 'Received-history cursor')}<input aria-label={t('定位已收到历史', 'Seek received history')} type="range" min={0} max={maxSeconds} step={1} value={Math.min(time, maxSeconds)} onChange={e => { setPlaying(false); setCursor(cursorAt(timeline, Number(e.target.value) * 1000)); }} /><output>{Math.floor(time)} / {maxSeconds}s</output></label>
    </section>
    <dl className="fault-data-status"><div><dt>{t('数据来源', 'Source')}</dt><dd>{t('后端仿真SSE已收到样本', 'Received from backend simulation SSE')}</dd></div>
      <div><dt>{t('连接状态', 'Connection')}</dt><dd>{sample.offline ? t('模拟数据中断 · 无法判断当前状态', 'SIMULATED INTERRUPTION · CURRENT STATE UNKNOWN') : t('本地演示源 · 无实车连接', 'Local simulation · no live machine')}</dd></div>
      <div><dt>{t('最后采集时间', 'Last sample')}</dt><dd>{t('场景相对时间', 'Scenario-relative time')} +{sample.sampleAt}s{sample.offline && ` · ${t('历史值', 'historical value')}`}</dd></div></dl>
    <div className="fault-workbench">
      <section className="fault-alert-panel fault-panel" aria-labelledby="fault-alert-title"><p className="fault-eyebrow">01 / ALERTS</p><h2 id="fault-alert-title">{t('当前异常', 'Current alerts')}</h2>
        <div aria-live="polite">{sample.offline ? <p className="fault-warning">{t('数据已中断，无法判断当前状态。最后收到的数据不代表当前状态。', 'Data interrupted. Current state is unknown; the last sample is historical.')}</p>
          : sample.alert ? <button type="button" className="fault-alert" onClick={selectAlert}><TriangleAlert size={22} /><span><strong>{t('仿真告警', 'Simulated alert')}</strong><small>{t('告警来自已收到的后端仿真帧；点击查看历史定位', 'Alert comes from a received backend simulation frame; select a history position')}</small></span><ArrowRight size={17} /></button>
          : <p>{t('当前已收到历史没有仿真告警；不表示实车正常。', 'No simulated alert is present in received history; this says nothing about a real machine.')}</p>}</div>
        <div className="fault-metrics">{displayRows.map(({ id, row }) => <button key={row.channel.id} type="button" aria-pressed={metric === id} onClick={() => setMetric(id!)}><span>{row.channel.name[zh ? 'zh' : 'en']}</span><strong>{id === metric ? selectedPoint?.value ?? '—' : row.latest?.value ?? '—'} <small>{row.channel.unit}</small></strong><small>{sample.offline ? t('最后历史样本', 'Last historical sample') : t('已收到仿真样本', 'Received simulated sample')}</small></button>)}</div>
      </section>
      <details className="fault-model-panel fault-panel" open={modelOpen} onToggle={event => setModelOpen(event.currentTarget.open)}>
        <summary><span>02 / {t('柴油拖拉机结构示意', 'DIESEL STRUCTURE SCHEMATIC')}</span><span>{modelOpen ? '−' : '+'}</span></summary>
        {modelOpen && <><p>{t('通用柴油结构模型，不是久保田 LX2620 的精确模型；高亮仅表示关联部件，不表示已确认损坏。', 'Generic diesel schematic, not an exact Kubota LX2620 model. Highlighting indicates association, not confirmed damage.')}</p>
          <div className="fault-model-tools"><label>{t('选择部件', 'Select part')}<select aria-label={t('选择部件', 'Select part')} value={selection ?? ''} onChange={e => setSelection(e.target.value || null)}><option value="">{t('整机', 'Whole machine')}</option>{catalogParts('diesel').map(part => <option key={part.name} value={selectionForPart(part.partId)}>{partTitle(part, zh ? 'zh' : 'en')}</option>)}{selection && selectedPart && !catalogParts('diesel').some(part => selectionForPart(part.partId) === selection) && <option value={selection}>{partTitle(selectedPart.node, zh ? 'zh' : 'en')}</option>}</select></label>
            <button type="button" aria-pressed={isolate} onClick={() => setIsolate(v => !v)}>{t('隔离选中部件', 'Isolate selection')}</button></div>
          <Suspense fallback={<p role="status">{t('加载模型组件…', 'Loading model component…')}</p>}><FaultModel selection={selection} onSelect={setSelection} reduced={reduced} zh={zh} isolate={isolate} /></Suspense>
          <p className="fault-model-selection">{t('当前选择', 'Selection')}: {selectedPart ? partTitle(selectedPart.node, zh ? 'zh' : 'en') : t('整机', 'Whole machine')} · <Link to="/models">{t('打开完整模型工坊', 'Open model studio')}</Link></p></>}
      </details>
      <section className="fault-chart-panel fault-panel"><p className="fault-eyebrow">03 / TELEMETRY</p><h2>{t('参数趋势', 'Parameter trend')} · {activeMetric?.name[zh ? 'zh' : 'en'] ?? t('暂无已收到通道', 'No received channel')}</h2>
        <p>{t('横轴为已收到仿真样本的相对时间，纵轴量程来自目录；回放只显示已收到点。', 'X: received simulated sample time; Y: catalog range. Replay shows received points only.')}</p>
        <svg className="fault-chart" viewBox="0 0 680 210" role="img" aria-label={`${activeMetric?.name[zh ? 'zh' : 'en'] ?? 'Telemetry'}: ${selectedPoint?.value ?? '—'} ${activeMetric?.unit ?? ''}; +${sample.sampleAt}s`}>
          <title>{t('模拟参数趋势，不是实车测量', 'Simulated trend, not real measurements')}</title>
          {[0, 1, 2].map(i => <g key={i}><line x1="40" x2="640" y1={30 + i * 70} y2={30 + i * 70} className="fault-grid" /><text x="2" y={34 + i * 70}>{(high - i * range / 2).toFixed(activeMetric?.precision ?? 0)}</text></g>)}
          {[0, .25, .5, .75, 1].map(fraction => <text key={fraction} x={40 + fraction * 600} y="196">{Math.round(maxSeconds * fraction)}s</text>)}
          <path d={path} className="fault-trend" /><line x1={x} x2={x} y1="20" y2="175" className="fault-cursor" />
          {sample.offline && <text x="355" y="90">{t('连接离线；仅保留最后已收到历史', 'Offline; only last received history is retained')}</text>}
        </svg><p>{t('当前历史定位', 'History cursor')} +{Math.floor(time)}s · {selectedPoint?.value ?? '—'} {activeMetric?.unit ?? ''} · {sample.offline ? t('历史值，当前未知', 'Historical; current unknown') : t('已收到仿真值', 'Received simulated value')}</p>
      </section>
      <section className="fault-check-panel fault-panel"><p className="fault-eyebrow">04 / EVIDENCE & CHECKS</p><h2>{t('检查步骤与依据', 'Checks and evidence')}</h2>
        <details ref={checksRef} tabIndex={-1} open={checksOpen} onToggle={e => setChecksOpen(e.currentTarget.open)}><summary>{t('展开检查清单', 'Expand checklist')}</summary>
          <ol className="fault-checklist">{CHECKS.map(check => <li key={check.id}><strong>{zh ? check.zh : check.en}</strong><small>{currentRecords.some(row => row.checkId === check.id) ? t('已有用户演示记录，未自动确认通过', 'User demo note recorded; not automatically verified') : t('待记录', 'Not recorded')}</small></li>)}</ol>
          <form onSubmit={saveCheck}><label>{t('记录到检查项目', 'Check item')}<select aria-label={t('记录到检查项目', 'Check item')} value={checkId} onChange={e => setCheckId(e.target.value as DemoRecord['checkId'])}>{CHECKS.map(check => <option key={check.id} value={check.id}>{zh ? check.zh : check.en}</option>)}</select></label>
            <label>{t('模拟检查结果', 'Simulated check note')}<textarea value={note} onChange={e => setNote(e.target.value)} maxLength={1000} rows={3} placeholder={t('记录观察和待检查项，不自动判定已修复。', 'Record observations and remaining checks; no automatic repair verdict.')} /></label>
            <button type="submit" disabled={!note.trim()}>{t('保存演示记录', 'Save demo note')}</button></form>
        </details>
        <div className="fault-evidence"><h3>{t('温度场景资料示例', 'Temperature scenario evidence example')}</h3>
          <p>{t('久保田 LX2620 / LX2620SU，美国版手册；市场、配置和序列号仍需核对。不作为通用柴油模型或其他场景的维修结论。', 'Kubota LX2620 / LX2620SU US manual; market, configuration and serial range need checking. Not a service conclusion for the generic model or other scenarios.')}</p>
          {loading ? <p role="status">{t('读取适用资料…', 'Loading evidence…')}</p> : !evidence ? <div role="status"><p>{t('暂无适用资料，不能生成维修建议。', 'No applicable evidence; no service advice generated.')}</p><button type="button" onClick={retry}>{t('重新读取资料', 'Retry evidence')}</button></div>
            : <><strong>{evidence.entryId} · {evidence.title}</strong><dl><dt>{t('来源', 'Source')}</dt><dd>{evidence.sourceTitle || evidence.sourceId}</dd><dt>{t('版次与定位', 'Version and locator')}</dt><dd>{evidence.version || t('未记录', 'Not recorded')} · {evidence.locator}</dd><dt>{t('适用范围与核验状态', 'Scope and review status')}</dt><dd>{evidence.scopeBoundary} · {evidence.status}</dd></dl>
              {evidence.sourceUrl && <a href={evidence.sourceUrl} target="_blank" rel="noreferrer">{t('查看原始来源', 'Open original source')} ↗</a>}
              <details open={evidenceOpen} onToggle={e => setEvidenceOpen(e.currentTarget.open)}><summary>{t('阅读原条目与安全限制', 'Read original entry and safety limits')}</summary>{evidenceOpen && <div className="prose prose-sm dark:prose-invert"><DeferredMarkdown>{evidence.content}</DeferredMarkdown></div>}</details></>}
        </div>
        <Link className="fault-chat-link" to="/chat" state={diagnosisDraft(scenario, time, records, zh)}>{t('带演示记录进入聊天诊断', 'Draft a chat with demo notes')}<ArrowRight size={16} /></Link>
        <p>{t('只预填，确认后发送。演示笔记独立保存在本标签页会话，不写入真实设备档案。', 'Draft only; review before sending. Demo notes use separate tab-session storage, never real device profiles.')}</p>
        {storageMessage && <p role="alert">{storageMessage}</p>}
      </section>
      <section className="fault-events-panel fault-panel"><div className="fault-events-title"><div><p className="fault-eyebrow">05 / EVENT LOG</p><h2>{t('模拟事件记录', 'Simulated event log')}</h2></div><button type="button" onClick={() => {
        if (window.confirm(t('清除所有场景的演示记录和当前备注？真实设备档案不受影响。', 'Clear all demo notes and the current draft? Real device profiles are unaffected.'))) { persist([]); setNote(''); }
      }}>{t('清除演示记录', 'Clear demo notes')}</button></div>
        <ul><li><time>+0s</time>{t('场景视图开始；数据来自后端仿真已收到历史。', 'View starts; data comes from received backend simulation history.')}</li>
          {sample.alert && <li><time>已收到</time>{t('后端仿真帧带告警；未确认任何零件损坏。', 'A received backend simulation frame carries an alert; no component damage confirmed.')}</li>}
          {sample.offline && <li><time>离线</time>{t('连接离线；历史视图不代表当前状态。', 'Connection offline; history view does not represent current state.')}</li>}
          {currentRecords.map((row, index) => <li key={index}><time>+{row.at}s</time><span>{t('用户演示记录', 'User demo note')} · {CHECKS.find(check => check.id === row.checkId)![zh ? 'zh' : 'en']}：{row.note}{row.at > time && ` (${t('记录时间在当前定位之后', 'recorded after cursor time')})`}</span></li>)}</ul>
      </section>
    </div>
  </main>;
}

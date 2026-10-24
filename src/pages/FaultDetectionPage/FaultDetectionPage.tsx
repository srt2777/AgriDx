import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useReducedMotion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Pause, Play, RotateCcw, TriangleAlert } from 'lucide-react';
import { useLang } from '@/hooks/useLang';
import { useKnowledgeCatalog } from '@/hooks/useKnowledgeCatalog';
import { useUpdateBlocker } from '@/features/updates/useUpdateBlocker';
import { catalogParts, partTitle, resolveSelection, selectionForPart } from '@/components/parts-tractor/parts-catalog';
import DeferredMarkdown from '@/components/DeferredMarkdown';
import { ALARM_AT, CHECKS, DEMO_RECORD_KEY, DURATION, EVIDENCE_QUERY, OUTAGE_AT, SCENARIOS,
  clampTime, demoEvidence, diagnosisDraft, frame, parseRecords, type DemoRecord, type Scenario } from './demo';
import './fault-detection.css';

const FaultModel = lazy(() => import('./FaultModel'));
type Metric = 'temperature' | 'rpm' | 'pressure';
const METRICS: { id: Metric; zh: string; en: string; unit: string; min: number; max: number }[] = [
  { id: 'temperature', zh: '冷却液温度', en: 'Coolant temperature', unit: '°C', min: 60, max: 120 },
  { id: 'rpm', zh: '发动机转速', en: 'Engine speed', unit: 'rpm', min: 1000, max: 2000 },
  { id: 'pressure', zh: '机油压力', en: 'Oil pressure', unit: 'kPa', min: 200, max: 400 },
];

export default function FaultDetectionPage() {
  const zh = useLang() === 'zh';
  const t = (cn: string, en: string) => zh ? cn : en;
  const reduced = !!useReducedMotion();
  const [scenario, setScenario] = useState<Scenario>('quiet');
  const [time, setTime] = useState(0);
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
  const evidence = failed ? null : demoEvidence(catalog);
  const sample = frame(scenario, time);
  const selectedPart = resolveSelection(selection);
  const currentRecords = records.filter(row => row.scenario === scenario);
  const activeMetric = METRICS.find(item => item.id === metric)!;
  const end = sample.sampleAt;
  const path = Array.from({ length: end + 1 }, (_, at) => {
    const value = frame(scenario, at)[metric];
    return `${at ? 'L' : 'M'}${40 + at / DURATION * 600},${170 - (value - activeMetric.min) / (activeMetric.max - activeMetric.min) * 140}`;
  }).join(' ');
  const x = 40 + time / DURATION * 600;
  useUpdateBlocker('/fault-detection', playing || note.trim().length > 0 || storageMessage.length > 0);

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const delta = Math.min((now - last) / 1000, 1);
      last = now;
      setTime(value => clampTime(value + delta));
    }, 250);
    const pause = () => { if (document.hidden) setPlaying(false); };
    document.addEventListener('visibilitychange', pause);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', pause); };
  }, [playing]);
  useEffect(() => { if (time >= DURATION) setPlaying(false); }, [time]);

  function persist(next: DemoRecord[]) {
    setRecords(next);
    try { sessionStorage.setItem(DEMO_RECORD_KEY, JSON.stringify(next)); setStorageMessage(''); }
    catch { setStorageMessage(t('浏览器存储不可用，记录仅保留在当前页面。', 'Storage unavailable. Records remain on this page only.')); }
  }
  function changeScenario(next: Scenario) {
    if (note.trim() && !window.confirm(t('切换场景将丢弃未保存的演示备注，继续？', 'Discard the unsaved demo note and change scenario?'))) return;
    setScenario(next); setTime(0); setPlaying(false); setSelection(null); setMetric('temperature');
    setIsolate(false); setChecksOpen(false); setEvidenceOpen(false); setNote(''); setCheckId('scope');
  }
  function selectAlert() {
    setPlaying(false); setTime(ALARM_AT); setMetric('temperature');
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
      <button type="button" onClick={() => { if (time >= DURATION) setTime(0); setPlaying(v => !v); }}>{playing ? <Pause size={16} /> : <Play size={16} />}{playing ? t('暂停', 'Pause') : t('播放', 'Play')}</button>
      <button type="button" onClick={() => { setTime(0); setPlaying(false); setSelection(null); setIsolate(false); setChecksOpen(false); setEvidenceOpen(false); }}><RotateCcw size={16} />{t('重新开始', 'Restart')}</button>
      <label className="fault-seek">{t('演示时间', 'Demo time')}<input aria-label={t('定位演示时间', 'Seek demo time')} type="range" min={0} max={DURATION} step={1} value={Math.floor(time)} onChange={e => { setPlaying(false); setTime(Number(e.target.value)); }} /><output>{Math.floor(time)} / {DURATION}s</output></label>
    </section>
    <dl className="fault-data-status"><div><dt>{t('数据来源', 'Source')}</dt><dd>{t('内置确定性模拟序列', 'Built-in deterministic simulation')}</dd></div>
      <div><dt>{t('连接状态', 'Connection')}</dt><dd>{sample.offline ? t('模拟数据中断 · 无法判断当前状态', 'SIMULATED INTERRUPTION · CURRENT STATE UNKNOWN') : t('本地演示源 · 无实车连接', 'Local simulation · no live machine')}</dd></div>
      <div><dt>{t('最后采集时间', 'Last sample')}</dt><dd>{t('场景相对时间', 'Scenario-relative time')} +{sample.sampleAt}s{sample.offline && ` · ${t('历史值', 'historical value')}`}</dd></div></dl>
    <div className="fault-workbench">
      <section className="fault-alert-panel fault-panel" aria-labelledby="fault-alert-title"><p className="fault-eyebrow">01 / ALERTS</p><h2 id="fault-alert-title">{t('当前异常', 'Current alerts')}</h2>
        <div aria-live="polite">{sample.offline ? <p className="fault-warning">{t('数据已中断，无法判断当前状态。最后收到的数据不代表当前状态。', 'Data interrupted. Current state is unknown; the last sample is historical.')}</p>
          : sample.alert ? <button type="button" className="fault-alert" onClick={selectAlert}><TriangleAlert size={22} /><span><strong>{t('预设温度告警', 'Scripted temperature alert')}</strong><small>+{ALARM_AT}s · {t('点击联动模型、曲线和检查步骤', 'Select to link model, chart and checks')}</small></span><ArrowRight size={17} /></button>
          : <p>{t('截至当前演示时间，本场景无预设告警；不表示实车正常。', 'No scripted alert at this demo time. This says nothing about a real machine.')}</p>}</div>
        <div className="fault-metrics">{METRICS.map(item => <button key={item.id} type="button" aria-pressed={metric === item.id} onClick={() => setMetric(item.id)}><span>{zh ? item.zh : item.en}</span><strong>{sample[item.id]} <small>{item.unit}</small></strong><small>{sample.offline ? t('最后历史样本', 'Last historical sample') : t('模拟采样', 'Simulated sample')}</small></button>)}</div>
      </section>
      <details className="fault-model-panel fault-panel" open={modelOpen} onToggle={event => setModelOpen(event.currentTarget.open)}>
        <summary><span>02 / {t('柴油拖拉机结构示意', 'DIESEL STRUCTURE SCHEMATIC')}</span><span>{modelOpen ? '−' : '+'}</span></summary>
        {modelOpen && <><p>{t('通用柴油结构模型，不是久保田 LX2620 的精确模型；高亮仅表示关联部件，不表示已确认损坏。', 'Generic diesel schematic, not an exact Kubota LX2620 model. Highlighting indicates association, not confirmed damage.')}</p>
          <div className="fault-model-tools"><label>{t('选择部件', 'Select part')}<select aria-label={t('选择部件', 'Select part')} value={selection ?? ''} onChange={e => setSelection(e.target.value || null)}><option value="">{t('整机', 'Whole machine')}</option>{catalogParts('diesel').map(part => <option key={part.name} value={selectionForPart(part.partId)}>{partTitle(part, zh ? 'zh' : 'en')}</option>)}{selection && selectedPart && !catalogParts('diesel').some(part => selectionForPart(part.partId) === selection) && <option value={selection}>{partTitle(selectedPart.node, zh ? 'zh' : 'en')}</option>}</select></label>
            <button type="button" aria-pressed={isolate} onClick={() => setIsolate(v => !v)}>{t('隔离选中部件', 'Isolate selection')}</button></div>
          <Suspense fallback={<p role="status">{t('加载模型组件…', 'Loading model component…')}</p>}><FaultModel selection={selection} onSelect={setSelection} reduced={reduced} zh={zh} isolate={isolate} /></Suspense>
          <p className="fault-model-selection">{t('当前选择', 'Selection')}: {selectedPart ? partTitle(selectedPart.node, zh ? 'zh' : 'en') : t('整机', 'Whole machine')} · <Link to="/models">{t('打开完整模型工坊', 'Open model studio')}</Link></p></>}
      </details>
      <section className="fault-chart-panel fault-panel"><p className="fault-eyebrow">03 / TELEMETRY</p><h2>{t('参数趋势', 'Parameter trend')} · {zh ? activeMetric.zh : activeMetric.en}</h2>
        <p>{t('横轴为场景秒数，纵轴为参数值；只绘制已收到的模拟样本。拖动上方时间轴查看。', 'X: scenario seconds; Y: parameter value. Only received simulated samples are drawn. Use the time slider above.')}</p>
        <svg className="fault-chart" viewBox="0 0 680 210" role="img" aria-label={`${zh ? activeMetric.zh : activeMetric.en}: ${sample[metric]} ${activeMetric.unit}; +${sample.sampleAt}s`}>
          <title>{t('模拟参数趋势，不是实车测量', 'Simulated trend, not real measurements')}</title>
          {[0, 1, 2].map(i => <g key={i}><line x1="40" x2="640" y1={30 + i * 70} y2={30 + i * 70} className="fault-grid" /><text x="2" y={34 + i * 70}>{activeMetric.max - i * (activeMetric.max - activeMetric.min) / 2}</text></g>)}
          {[0, 30, 60, 90, 120].map(at => <text key={at} x={40 + at / DURATION * 600} y="196">{at}s</text>)}
          <path d={path} className="fault-trend" /><line x1={x} x2={x} y1="20" y2="175" className="fault-cursor" />
          {scenario === 'temperature' && sample.alert && <g><line x1="265" x2="265" y1="20" y2="175" className="fault-alert-line" /><text x="270" y="16">{t('预设告警 +45s', 'Scripted alert +45s')}</text></g>}
          {sample.offline && <text x="355" y="90">{t('数据中断，无新增样本', 'Interrupted · no new samples')}</text>}
        </svg><p>{t('当前定位', 'Cursor')} +{Math.floor(time)}s · {sample[metric]} {activeMetric.unit} · {sample.offline ? t('历史值，当前未知', 'Historical; current unknown') : t('模拟值', 'Simulated value')}</p>
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
        <ul><li><time>+0s</time>{t('场景开始；数据来自内置模拟序列。', 'Scenario starts; data comes from the built-in simulator.')}</li>
          {sample.alert && <li><time>+{ALARM_AT}s</time>{t('触发预设温度告警；未确认任何零件损坏。', 'Scripted temperature alert; no component damage confirmed.')}</li>}
          {sample.offline && <li><time>+{OUTAGE_AT}s</time>{t('模拟数据中断，当前状态未知。', 'Simulated data interruption; current state unknown.')}</li>}
          {currentRecords.map((row, index) => <li key={index}><time>+{row.at}s</time><span>{t('用户演示记录', 'User demo note')} · {CHECKS.find(check => check.id === row.checkId)![zh ? 'zh' : 'en']}：{row.note}{row.at > time && ` (${t('记录时间在当前定位之后', 'recorded after cursor time')})`}</span></li>)}</ul>
      </section>
    </div>
  </main>;
}

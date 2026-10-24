import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { useUiCopy } from '@/ui/useUiCopy';
import type { KnowledgeCatalog } from '@shared/knowledge-catalog';
import type { TaxonomyNode } from './knowledge-taxonomy-data';
import { createGraphFlowLoop } from './graph-flow-loop';
import { cameraMoving, createGraphCamera, fitGraph, stepGraphCamera, zoomGraph } from './graph-interaction';
import { catalogNetwork, referenceNetwork, referenceFrame, REFERENCE_DURATION, REFERENCE_URL, PAGE_NAMES, type EngineMode } from './knowledge-engine-model';
import { KnowledgeEngineRenderer } from './knowledge-engine-renderer';
import './knowledge-engine.css';

const pad = (n: number) => String(n).padStart(2, '0');
const levelLabels = { brand: '品牌', model: '机型 / 系列', component: '系统 / 组件', part: '零部件' };

export default function KnowledgeEngine({ nodes, selectedId, onSelect, catalog, lang, onRelations }: {
  nodes: TaxonomyNode[]; selectedId: string; onSelect: (id: string) => void; catalog: KnowledgeCatalog; lang: string; onRelations: () => void;
}) {
  const { t } = useUiCopy(lang);
  const reduced = !!useReducedMotion();
  const [mode, setMode] = useState<EngineMode>('reference');
  const [running, setRunning] = useState(!reduced);
  const [seconds, setSeconds] = useState(0);
  const [manualActive, setManualActive] = useState<number | null>(null);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [azimuth, setAzimuth] = useState(-7);
  const root = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), tooltip = useRef<HTMLElement>(null);
  const camera = useRef(createGraphCamera()), clock = useRef(0), wake = useRef(() => {});
  const renderer = useRef<KnowledgeEngineRenderer | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ startX: 0, startY: 0, x: 0, y: 0, moved: false, pinched: false, distance: 0, pan: false });
  const [cinematic, setCinematic] = useState(true);
  const network = useMemo(() => mode === 'reference' ? referenceNetwork() : catalogNetwork(nodes), [mode, nodes]);
  const frame = referenceFrame(seconds);
  const active = manualActive ?? (mode === 'reference' ? frame.active : network.nodes.findIndex(node => node.id === selectedId));
  const activeNode = network.nodes[active];
  const activeTaxonomy = mode === 'catalog' ? nodes.find(node => node.id === activeNode?.id) : undefined;
  const latest = useRef({ running, cinematic, active, reduced });
  useLayoutEffect(() => { latest.current = { running, cinematic, active, reduced }; wake.current(); }, [running, cinematic, active, reduced]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && document.fullscreenElement === root.current?.parentElement) void document.exitFullscreen();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, []);
  const seek = (value: number) => { clock.current = Math.max(0, Math.min(REFERENCE_DURATION, value)); setSeconds(clock.current); setManualActive(null); wake.current(); };
  const zoom = (factor: number) => { zoomGraph(camera.current, factor); setZoomPercent(Math.round(camera.current.targetZoom * 100)); setCinematic(false); wake.current(); };
  const reset = () => { fitGraph(camera.current); setZoomPercent(100); setCinematic(true); wake.current(); };
  const selectIndex = (index: number) => {
    setManualActive(index);
    const id = network.nodes[index]?.taxonomyId;
    if (id) onSelect(id);
  };
  const changeMode = (value: EngineMode) => { setMode(value); setManualActive(null); clock.current = 0; setSeconds(0); reset(); };
  useEffect(() => { if (selectedId) { setMode('catalog'); setManualActive(null); } }, [selectedId]);
  useEffect(() => {
    const element = canvas.current; if (!element?.getContext('2d')) return;
    const engine = new KnowledgeEngineRenderer(element, network); renderer.current = engine;
    let visible = true, dirty = true, lastReport = 0;
    const render = (delta = 0) => {
      const state = latest.current;
      if (state.running && !state.reduced && !pointers.current.size) clock.current = mode === 'reference' ? Math.min(REFERENCE_DURATION, clock.current + delta) : clock.current + delta;
      stepGraphCamera(camera.current, Math.max(delta, 1 / 60), state.reduced);
      const current = referenceFrame(clock.current);
      engine.draw({ time: clock.current, reference: mode === 'reference', active: state.active, animate: !state.reduced, cinematic: state.cinematic, conflict: current.conflict, camera: camera.current, tooltip: tooltip.current });
      dirty = false;
      if (performance.now() - lastReport > 100) { setSeconds(clock.current); setZoomPercent(Math.round(camera.current.zoom * 100)); setAzimuth(Math.round((camera.current.yaw + clock.current * .017) * 180 / Math.PI)); lastReport = performance.now(); }
    };
    const loop = createGraphFlowLoop({ active: () => visible && !document.hidden && (dirty || cameraMoving(camera.current) || latest.current.running && !latest.current.reduced && (mode === 'catalog' || clock.current < REFERENCE_DURATION)), render, request: requestAnimationFrame, cancel: cancelAnimationFrame });
    wake.current = () => { dirty = true; render(); loop.start(); };
    const resize = new ResizeObserver(() => wake.current()); resize.observe(element);
    const intersection = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? false; if (visible) wake.current(); else loop.stop(); }); intersection.observe(element);
    const visibility = () => { if (document.hidden) loop.stop(); else wake.current(); };
    document.addEventListener('visibilitychange', visibility);
    const wheel = (event: WheelEvent) => {
      event.preventDefault(); const rect = element.getBoundingClientRect();
      zoomGraph(camera.current, Math.exp(-Math.max(-180, Math.min(180, event.deltaY * (event.deltaMode === 1 ? 16 : 1))) * .0025), { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 });
      setCinematic(false); wake.current();
    };
    element.addEventListener('wheel', wheel, { passive: false }); wake.current();
    return () => { resize.disconnect(); intersection.disconnect(); loop.stop(); document.removeEventListener('visibilitychange', visibility); element.removeEventListener('wheel', wheel); wake.current = () => {}; renderer.current = null; };
  // Selection is read from latest so changing a card does not rebuild the 3k-node network.
  }, [network, mode]);
  const pointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const g = gesture.current;
    if (pointers.current.size === 1) Object.assign(g, { startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, moved: false, pinched: false, pan: event.shiftKey || event.button === 2 });
    else { const [a, b] = [...pointers.current.values()]; g.distance = Math.hypot(a.x - b.x, a.y - b.y); g.pinched = true; }
  };
  const pointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!pointers.current.has(event.pointerId)) { const rect = event.currentTarget.getBoundingClientRect(); const hit = renderer.current?.pick(event.clientX - rect.left, event.clientY - rect.top); event.currentTarget.style.cursor = hit ? 'pointer' : 'grab'; return; }
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const g = gesture.current; setCinematic(false);
    if (pointers.current.size > 1) {
      const [a, b] = [...pointers.current.values()], distance = Math.hypot(a.x - b.x, a.y - b.y), rect = event.currentTarget.getBoundingClientRect();
      if (g.distance > 0) zoomGraph(camera.current, distance / g.distance, { x: (a.x + b.x) / 2 - rect.left - rect.width / 2, y: (a.y + b.y) / 2 - rect.top - rect.height / 2 });
      g.distance = distance; g.pinched = true; wake.current(); return;
    }
    if (g.pinched) return;
    const dx = event.clientX - g.x, dy = event.clientY - g.y;
    if (Math.hypot(event.clientX - g.startX, event.clientY - g.startY) > 4) g.moved = true;
    if (g.pan) { camera.current.targetPanX += dx; camera.current.targetPanY += dy; }
    else { camera.current.targetYaw += dx * .005; camera.current.targetPitch = Math.max(-1.2, Math.min(1.2, camera.current.targetPitch + dy * .005)); }
    g.x = event.clientX; g.y = event.clientY; wake.current();
  };
  const pointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    pointers.current.delete(event.pointerId);
    if (gesture.current.moved || gesture.current.pinched) return;
    const rect = event.currentTarget.getBoundingClientRect(); const hit = renderer.current?.pick(event.clientX - rect.left, event.clientY - rect.top);
    if (hit) selectIndex(hit.index);
  };
  const reference = mode === 'reference';
  const visibleNodes = network.nodes.filter(node => !reference || node.born <= seconds).length;
  const visibleEdges = network.edges.filter(edge => !reference || edge.born <= seconds).length;
  const source = reference ? 'raw/source-042.pdf' : activeTaxonomy ? Object.values(activeTaxonomy.query).join(' / ') : 'AgriDx / api/knowledge/catalog';
  const sourceTitle = reference ? activeNode?.id ?? 'raw/source-042.pdf' : activeNode?.label ?? t('选择节点查看目录', 'Select a catalog node');
  const claim = reference ? frame.conflict && active === 4 ? 'DAILY ≠ WEEKLY' : activeNode?.claim ?? 'READ ONLY · NO MUTATIONS' : activeNode?.claim ?? t('品牌 → 机型 → 系统 → 零件', 'Brand → Model → System → Part');
  const queue = reference ? PAGE_NAMES.map((name, index) => ({ id: `wiki/${name}.md`, label: `wiki/${name}.md`, progress: Math.min(1, Math.max(0, (seconds - 3 - index * .54) / .5)), index })) : nodes.filter(node => node.parent === selectedId || !selectedId && node.level === 'brand').slice(0, 12).map((node, index) => ({ id: node.id, label: node.label, progress: node.count ? 1 : 0, index }));
  const command = reference ? frame.command : activeTaxonomy ? `> catalog select ${Object.values(activeTaxonomy.query).join(' / ')}` : '> catalog browse --source archived-index --read-only';
  const fullScreen = async () => { if (document.fullscreenElement) await document.exitFullscreen(); else await root.current?.parentElement?.requestFullscreen?.(); };
  const brandNodes = nodes.filter(node => node.level === 'brand');
  const archiveCount = brandNodes.reduce((sum, node) => sum + node.count, 0);
  const entries = reference ? frame.documents : archiveCount;
  return <div className="knowledge-engine-shell">
    <div className="engine-controls" aria-label={t('图谱控制', 'Graph controls')}>
      <div role="group" aria-label={t('图谱数据模式', 'Graph data mode')}><button aria-pressed={reference} onClick={() => changeMode('reference')}>{t('参考演示', 'Reference demo')}</button><button aria-pressed={!reference} onClick={() => changeMode('catalog')}>{t('真实知识库', 'Knowledge catalog')}</button></div>
      <button aria-pressed={running && !reduced} disabled={reduced} onClick={() => setRunning(value => !value)}>{reduced ? t('减少动态', 'Reduced motion') : running ? t('暂停', 'Pause') : t('播放', 'Play')}</button>
      <button onClick={() => { seek(0); setRunning(!reduced); reset(); }}>{t('重播', 'Replay')}</button>
      <button onClick={() => zoom(1.4)} aria-label={t('放大图谱', 'Zoom in')}>＋</button><output aria-label={t('当前缩放比例', 'Current zoom')}>{zoomPercent}%</output><button onClick={() => zoom(1 / 1.4)} aria-label={t('缩小图谱', 'Zoom out')}>−</button>
      <button onClick={reset}>{t('复位', 'Reset')}</button><button onClick={() => { void fullScreen().catch(() => {}); }}>{t('全屏', 'Fullscreen')}</button>
      <button onClick={() => { changeMode('catalog'); onRelations(); }}>{t('关系聚焦', 'Focus relations')}</button>
    </div>
    <div className="knowledge-engine" ref={root} data-mode={mode} data-phase={reference ? frame.phase : 'CATALOG'}>
      <header className="engine-masthead"><div><h3>{reference ? 'GROK BOT / KNOWLEDGE ENGINE' : 'AGRIDX / KNOWLEDGE ENGINE'}</h3><p>{reference ? 'SRC 042' : `KB ${catalog.kbVersion ?? 'ARCHIVE'}`} / {entries.toLocaleString('en-US')} {reference ? 'DOCS' : 'ENTRIES'} / {visibleNodes} NODES / {visibleEdges} LINKS</p></div><div className="engine-clock"><span>{reference ? 'SIMULATION' : 'CATALOG / READ ONLY'} <i /></span><strong>00:{pad(Math.floor(seconds))}:{pad(Math.floor(seconds % 1 * 60))} <small>30FPS</small></strong></div></header>
      <div className="engine-agents">{['READER', 'LIBRARIAN', 'CHECKER'].map((name, index) => <div key={name} data-agent={index} data-active={reference && (frame.phase === name || name === 'CHECKER' && frame.phase === 'REVIEW')}><b>● {name}</b><span>{!reference ? ['INDEX / LOADED', 'READ ONLY', 'SOURCE SCOPE'][index] : [seconds < 3 ? 'RAW / LOCKED' : '128 PAGES LINKED', `${pad(frame.writes)}/12 COMMITTED`, seconds < 14 ? 'QUEUED 02:00' : `SCAN ${String(frame.scan).padStart(3, '0')}`][index]}</span><i style={{ width: `${reference ? [100, frame.writes / 12 * 100, frame.scan / 129 * 100][index] : 100}%` }} /></div>)}<code>{command}</code></div>
      <div className="engine-stage"><div className="engine-stage-heading"><span>GRAPH / {visibleNodes.toLocaleString('en-US')} RECORDS · {visibleEdges.toLocaleString('en-US')} LINKS</span><span>AZ {azimuth}° Z {zoomPercent}</span></div>
        <canvas ref={canvas} tabIndex={0} role="img" aria-label={t('三维知识网络：拖动旋转，Shift拖动平移，滚轮或双指缩放，点击节点查看详情。', '3D knowledge network: drag to rotate, Shift-drag to pan, wheel or pinch to zoom; select a node for details.')} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={event => { pointers.current.delete(event.pointerId); gesture.current.moved = true; }} onContextMenu={event => event.preventDefault()} onDoubleClick={event => { const box = event.currentTarget.getBoundingClientRect(); zoomGraph(camera.current, 1.8, { x: event.clientX - box.left - box.width / 2, y: event.clientY - box.top - box.height / 2 }); setCinematic(false); wake.current(); }} onKeyDown={event => {
          if (['+','=','-','Home','Escape','ArrowLeft','ArrowRight','ArrowUp','ArrowDown',' '].includes(event.key)) event.preventDefault();
          if (event.key === '+' || event.key === '=') zoom(1.4); else if (event.key === '-') zoom(1 / 1.4); else if (event.key === 'Home') reset(); else if (event.key === ' ') setRunning(value => !value); else if (event.key === 'Escape') { setManualActive(null); onSelect(''); } else if (event.key.startsWith('Arrow')) { setCinematic(false); camera.current.targetYaw += event.key === 'ArrowLeft' ? -.12 : event.key === 'ArrowRight' ? .12 : 0; camera.current.targetPitch = Math.max(-1.2, Math.min(1.2, camera.current.targetPitch + (event.key === 'ArrowUp' ? -.12 : event.key === 'ArrowDown' ? .12 : 0))); wake.current(); }
        }} />
        <aside ref={tooltip} className="engine-node-card" style={{ display: activeNode ? undefined : 'none' }} aria-label={t('节点详情', 'Node details')}><strong>{sourceTitle}</strong><small>CLAIM</small><p>{claim}</p><small>SOURCE</small><p>{source}</p><div><small>{reference ? 'LAST CONFIRMED' : 'SCOPE'}</small><span>{reference ? '2026-10-18' : activeTaxonomy?.scope ?? 'CATALOG'}</span></div><i style={{ width: `${reference ? 12 + seconds / 24 * 88 : 100}%` }} /></aside>
        <div className="engine-stage-log">{seconds.toFixed(2)} {reference ? frame.phase.toLowerCase() : 'catalog'} :: {reference ? `${sourceTitle} · ${frame.conflict ? 'contradiction flagged' : 'source-linked'}` : t('连线仅表示目录归属', 'Edges show catalog membership only')}</div>
      </div>
      <div className="engine-command"><code>{command}</code><b>{reference ? frame.phase : 'CATALOG'}</b></div>
      <div className="engine-dashboard">
        <Panel title="01 SHARED CHAT" status={reference ? '3 BOT' : 'READ ONLY'} footer={reference ? `${frame.phase.toLowerCase()} · ${sourceTitle}` : 'CATALOG / ORIGINAL PRESERVED'}><div className="engine-chat">{(reference ? [
          ['READER', '18 pages / 684 tokens indexed'], ['READER', '12 linked wiki pages → @librarian'], ...(seconds >= 3 ? [['LIBRARIAN', `${frame.writes}/12 saved · ${PAGE_NAMES[Math.max(0, frame.writes - 1)]}.md`]] : []), ...(seconds >= 9.5 ? [['YOU', 'When should the review run?'], ['LIBRARIAN', 'Daily at 02:00. [source-042:p05]']] : []), ...(seconds >= 14 ? [['CHECKER', `02:00 · nightly routine started`], ['CHECKER', `scan ${pad(frame.scan)} · source age`]] : []), ...(frame.conflict ? [['CHECKER', 'Daily ≠ weekly · review required']] : []),
        ] : [['INDEX', `${archiveCount} linked archive entries`], ['SOURCE', 'Archived catalog snapshot'], ['CATALOG', `${nodes.length} directory nodes`], ['SELECT', activeNode?.label ?? 'Choose a node in the graph'], ['SCOPE', 'Edges show catalog membership']]).slice(-5).map(([role, text], i) => <div key={`${role}-${i}`}><small>{pad(i + 1)}</small><p><b data-role={role}>{role}</b><br />{text}</p></div>)}</div></Panel>
        <Panel title={reference ? '02 WRITE QUEUE' : '02 DIRECTORY'} status={reference ? '12 DOC' : 'BROWSE'} footer={reference ? `${pad(frame.writes)}/12 ATOMIC WRITES  NO RAW EDITS` : 'ORIGINAL ORDER / SELECT TO EXPLORE'}><div className="engine-queue">{queue.map(item => <button key={item.id} onClick={() => reference ? selectIndex(item.index) : onSelect(item.id)}><small>{pad(item.index + 1)}</small><span>{item.label}</span><i><em style={{ width: `${item.progress * 100}%` }} /></i><b>{reference ? item.progress === 1 ? 'OK' : item.progress ? 'GO' : '—' : item.progress ? '●' : '?'}</b></button>)}</div></Panel>
        <Panel title="03 PAGE INSPECTOR" status="TRACE" footer={reference ? '2026-10-18  SOURCE LINK RETAINED' : 'CATALOG MEMBERSHIP / NOT CAUSALITY'}><div className="engine-inspector"><h4>{sourceTitle}</h4><small>CLAIM</small><p>{claim}</p><small>SOURCE / TRACE · {reference ? `SCAN ${pad(frame.scan)}` : 'ARCHIVED INDEX'}</small><p>{source}</p><small>{reference ? 'LAST CONFIRMED' : 'LEVEL'}</small><p>{reference ? '2026-10-18' : activeTaxonomy ? levelLabels[activeTaxonomy.level] : '—'}</p></div></Panel>
        <Panel title="04 GRAPH INDEX" status={running && !reduced ? 'LIVE' : 'PAUSED'} footer={reference ? `SELECT ${pad(Math.min(12, frame.writes))} / 12` : `${visibleNodes} NODES / ${visibleEdges} PARENT EDGES`}><div className="engine-index"><svg viewBox="0 0 160 120" aria-label={t('图谱缩略图', 'Graph overview')}><g stroke="#73796b" strokeWidth=".55">{network.edges.filter(edge => reference ? network.nodes[edge.from].hub && network.nodes[edge.to].hub : network.nodes[edge.from].hub).slice(0, 70).map(({ from, to }) => <line key={`${from}-${to}`} x1={80 + network.nodes[from].x * 26} y1={60 - network.nodes[from].y * 22} x2={80 + network.nodes[to].x * 26} y2={60 - network.nodes[to].y * 22} />)}</g>{network.hubs.slice(0, 14).map((i, j) => <g key={i}><circle cx={80 + network.nodes[i].x * 26} cy={60 - network.nodes[i].y * 22} r={i === active ? 3 : 1.6} fill={i === active ? '#ebc568' : '#e99a89'} /><text x={84 + network.nodes[i].x * 26} y={61 - network.nodes[i].y * 22}>{pad(j + 1)}</text></g>)}</svg><dl><dt>{reference ? 'PAGES' : 'ENTRIES'}</dt><dd>{entries}</dd><dt>LINKS</dt><dd>{visibleEdges}</dd></dl></div></Panel>
        <Panel title="05 RAW / IMMUTABLE" status="LOCK" footer={reference ? 'APPEND ONLY / ORIGINAL PRESERVED' : 'READ ONLY / NO KNOWLEDGE WRITES'}><div className="engine-raw">{(reference ? ['source-042.pdf', 'extract-042.txt', 'source-042.meta'] : ['catalog / archived index', `kb-version / ${catalog.kbVersion ?? 'unknown'}`, 'parent / membership only']).map((name, i) => <div key={name}><span>{name}</span><b>RO</b><small>{reference ? ['SHA256 7b14e9c2…e9c2', 'SHA256 3c58d75b…2905', 'SHA256 0b607d32…3a2e'][i] : 'FROM EXISTING KNOWLEDGE SNAPSHOT'}</small></div>)}<p>0 MUTATIONS <b>{reference ? 'VERIFY 000' : 'READ ONLY'}</b></p></div></Panel>
        <Panel title="06 DOCUMENT DIFF" status={reference ? 'PATCH' : 'SCOPE'} footer={reference ? seconds < 3 ? '+0 / −0  WAITING' : '+4 / −1  COMMITTED' : 'NO DOCUMENT MODIFICATION'}><div className="engine-diff"><b>{sourceTitle}</b><small>@@ 018,6 + 018,9 @@</small>{(reference ? ['## source-backed knowledge', `status: ${frame.conflict ? 'needs review' : seconds >= 3 ? 'confirmed' : 'unverified'}`, claim, 'source: raw/source-042.pdf', 'confirmed: 2026-10-18', 'backlinks: rebuilt'] : ['## catalog node', activeNode?.label ?? 'select a node', 'membership only', 'model scope must be checked', 'original evidence stays linked', 'no inferred fault causality']).map((line, i) => <div key={i} data-change={reference && i > 0 && i < 4}><small>{18 + i}</small><span>{i > 0 && i < 4 && reference ? '+' : ' '} {line}</span></div>)}</div></Panel>
        <Panel title={reference ? '07 CITATION MATRIX' : '07 DIRECTORY COVERAGE'} status={reference ? '12×7' : 'INDEX'} footer={reference ? '12 PAGES ← 1 RAW SOURCE ■ CITED □ NO CLAIM' : '■ HAS ENTRIES □ EVIDENCE GAP'}><div className="engine-matrix"><div className="engine-matrix-head"><span>DOC</span>{Array.from({ length: 12 }, (_, i) => <small key={i}>{pad(i + 1)}</small>)}</div>{Array.from({ length: 7 }, (_, row) => <div key={row}><span>{reference ? `p.${pad(row + 2)}` : pad(row + 1)}</span>{Array.from({ length: 12 }, (_, col) => <i key={col} data-filled={reference ? seconds >= 3 && col < frame.writes && (row * 7 + col * 3) % 5 < 2 : !!nodes[row * 12 + col]?.count} data-current={reference && col === Math.max(0, frame.writes - 1)} />)}</div>)}</div></Panel>
        <Panel title={reference ? '08 NIGHTLY CHECKER' : '08 CATALOG PROFILE'} status={reference ? frame.conflict ? 'FLAG' : seconds >= 14 ? 'SCAN' : 'WAIT' : 'SNAPSHOT'} footer={reference ? `${frame.scan} CHECKS · ${frame.conflict ? '1 FLAG' : '0 FLAGS'}` : 'NO DIAGNOSIS INFERRED'}><div className="engine-checker"><small>{reference ? seconds >= 14 ? 'NIGHTLY / RUNNING' : 'NIGHTLY / 02:00' : 'ARCHIVE / CURRENT SNAPSHOT'}</small><strong>{reference ? `SCANNED ${String(frame.scan).padStart(3, '0')} / 129` : `${brandNodes.length} BRANDS / ${nodes.filter(node => node.level === 'model').length} MODELS`}</strong><div className="engine-histogram">{Array.from({ length: 42 }, (_, i) => <i key={i} data-hot={reference ? i > 17 && seconds >= 3 : i % 3 === 0} data-flag={reference && frame.conflict && i > 35} style={{ height: `${reference ? 10 + ((i * 17 + 11) % 43) * (seconds >= 3 ? 1 : .4) : 8 + ((nodes[i]?.count ?? 0) % 42)}%` }} />)}</div><div className="engine-histogram-label"><span>{reference ? 'WRITE' : 'BRANDS'}</span><span>{reference ? 'CHECK' : 'ENTRY COUNTS'}</span></div><p>{reference ? frame.conflict ? 'CONTRADICTION / REVIEW REQUIRED' : seconds >= 14 ? 'INDEX / CONSISTENCY SCAN' : 'WAIT / SOURCE COMMITTED' : `${archiveCount} LINKED ENTRIES`}</p></div></Panel>
      </div>
    </div>
    {reference && <div className="engine-timeline"><label htmlFor="engine-playhead">{t('演示进度', 'Demo position')}</label><input id="engine-playhead" type="range" min="0" max={REFERENCE_DURATION} step=".05" value={Math.min(24, seconds)} aria-valuetext={`${seconds.toFixed(2)} / 24 s`} onChange={event => { setRunning(false); seek(Number(event.target.value)); }} /><output>{seconds.toFixed(1)} / 24s</output></div>}
    <p className="engine-caption">{reference ? t('参考视频视觉演示，节点、队列和检查状态均为模拟。切换“真实知识库”查看实际目录。', 'Visual reference simulation. Nodes, writes and checks are simulated. Switch to Knowledge catalog for real records.') : t('实际目录快照；节点与连线来自已有知识库。连线表示目录归属，不能解释为故障因果。', 'Real catalog snapshot. Nodes and parent edges come from the existing knowledge base; edges do not imply fault causality.')} <a href={REFERENCE_URL} target="_blank" rel="noreferrer">Argona ↗</a></p>
  </div>;
}
function Panel({ title, status, footer, children }: { title: string; status: string; footer: string; children: React.ReactNode }) {
  return <section className="engine-panel"><header><h4>{title}</h4><span>{status}</span></header><div className="engine-panel-body">{children}</div><footer>{footer}</footer></section>;
}

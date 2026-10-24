import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { useUiCopy } from '@/ui/useUiCopy';
import type { KnowledgeCatalog } from '@shared/knowledge-catalog';
import type { TaxonomyNode } from './knowledge-taxonomy-data';
import { createGraphFlowLoop } from './graph-flow-loop';
import { cameraMoving, createGraphCamera, fitGraph, stepGraphCamera, zoomGraph } from './graph-interaction';
import { catalogNetwork } from './knowledge-engine-model';
import { KnowledgeEngineRenderer } from './knowledge-engine-renderer';
import './knowledge-engine.css';
import KnowledgeSimulationDashboard from './KnowledgeSimulationDashboard';

const pad = (n: number) => String(n).padStart(2, '0');
const levelLabels = { brand: '品牌', model: '机型 / 系列', component: '系统 / 组件', part: '零部件' };

export default function KnowledgeEngine({ nodes, selectedId, onSelect, catalog, lang, onRelations }: {
  nodes: TaxonomyNode[]; selectedId: string; onSelect: (id: string) => void; catalog: KnowledgeCatalog; lang: string; onRelations: () => void;
}) {
  const { t } = useUiCopy(lang);
  const reduced = !!useReducedMotion();
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
  const network = useMemo(() => catalogNetwork(nodes), [nodes]);
  const active = manualActive ?? network.nodes.findIndex(node => node.id === selectedId);
  const activeNode = network.nodes[active];
  const activeTaxonomy = nodes.find(node => node.id === activeNode?.id);
  const latest = useRef({ running, cinematic, active, reduced });
  useLayoutEffect(() => { latest.current = { running, cinematic, active, reduced }; wake.current(); }, [running, cinematic, active, reduced]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && document.fullscreenElement === root.current?.parentElement) void document.exitFullscreen();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, []);
  const seek = (value: number) => { clock.current = Math.max(0, value); setSeconds(clock.current); setManualActive(null); wake.current(); };
  const zoom = (factor: number) => { zoomGraph(camera.current, factor); setZoomPercent(Math.round(camera.current.targetZoom * 100)); setCinematic(false); wake.current(); };
  const reset = () => { fitGraph(camera.current); setZoomPercent(100); setCinematic(true); wake.current(); };
  const selectIndex = (index: number) => {
    setManualActive(index);
    const id = network.nodes[index]?.taxonomyId;
    if (id) onSelect(id);
  };

  useEffect(() => { if (selectedId) { setManualActive(null); } }, [selectedId]);
  useEffect(() => {
    const element = canvas.current; if (!element?.getContext('2d')) return;
    const engine = new KnowledgeEngineRenderer(element, network); renderer.current = engine;
    let visible = true, dirty = true, lastReport = 0;
    const render = (delta = 0) => {
      const state = latest.current;
      if (state.running && !state.reduced && !pointers.current.size) clock.current = clock.current + delta;
      stepGraphCamera(camera.current, Math.max(delta, 1 / 60), state.reduced);
      engine.draw({ time: clock.current, reference: false, active: state.active, animate: !state.reduced, cinematic: state.cinematic, conflict: false, camera: camera.current, tooltip: tooltip.current });
      dirty = false;
      if (performance.now() - lastReport > 100) { setSeconds(clock.current); setZoomPercent(Math.round(camera.current.zoom * 100)); setAzimuth(Math.round((camera.current.yaw + clock.current * .017) * 180 / Math.PI)); lastReport = performance.now(); }
    };
    const loop = createGraphFlowLoop({ active: () => visible && !document.hidden && (dirty || cameraMoving(camera.current) || latest.current.running && !latest.current.reduced), render, request: requestAnimationFrame, cancel: cancelAnimationFrame });
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
  }, [network]);
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
  const visibleNodes = network.nodes.length;
  const visibleEdges = network.edges.length;
  const fullScreen = async () => { if (document.fullscreenElement) await document.exitFullscreen(); else await root.current?.parentElement?.requestFullscreen?.(); };
  return <div className="knowledge-engine-shell">
    <div className="engine-controls" aria-label={t('图谱控制', 'Graph controls')}>
      <strong>{t('真实知识库 · 三维关系网络', 'Knowledge catalog · 3D network')}</strong>
      <button aria-pressed={running && !reduced} disabled={reduced} onClick={() => setRunning(value => !value)}>{reduced ? t('减少动态', 'Reduced motion') : running ? t('暂停', 'Pause') : t('播放', 'Play')}</button>
      <button onClick={() => { seek(0); setRunning(!reduced); reset(); }}>{t('重播', 'Replay')}</button>
      <button onClick={() => zoom(1.4)} aria-label={t('放大图谱', 'Zoom in')}>＋</button><output aria-label={t('当前缩放比例', 'Current zoom')}>{zoomPercent}%</output><button onClick={() => zoom(1 / 1.4)} aria-label={t('缩小图谱', 'Zoom out')}>−</button>
      <button onClick={reset}>{t('复位', 'Reset')}</button><button onClick={() => { void fullScreen().catch(() => {}); }}>{t('全屏', 'Fullscreen')}</button>
      <button onClick={() => { onRelations(); }}>{t('关系聚焦', 'Focus relations')}</button>
    </div>
    <div className="knowledge-engine" ref={root} data-mode="catalog" data-phase="CATALOG">
      <header className="engine-masthead"><div><h3>AGRIDX / KNOWLEDGE ENGINE</h3><p>KB {catalog.kbVersion ?? 'ARCHIVE'} / {visibleNodes} NODES / {visibleEdges} LINKS</p></div><div className="engine-clock"><span>CATALOG / READ ONLY <i /></span><strong>{pad(Math.floor(seconds / 60))}:{pad(Math.floor(seconds % 60))} <small>3D</small></strong></div></header>
      <div className="engine-stage"><div className="engine-stage-heading"><span>GRAPH / {visibleNodes.toLocaleString('en-US')} RECORDS · {visibleEdges.toLocaleString('en-US')} LINKS</span><span>AZ {azimuth}° Z {zoomPercent}</span></div>
        <canvas ref={canvas} tabIndex={0} role="img" aria-label={t('三维知识网络：拖动旋转，Shift拖动平移，滚轮或双指缩放，点击节点查看详情。', '3D knowledge network: drag to rotate, Shift-drag to pan, wheel or pinch to zoom; select a node for details.')} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={event => { pointers.current.delete(event.pointerId); gesture.current.moved = true; }} onContextMenu={event => event.preventDefault()} onDoubleClick={event => { const box = event.currentTarget.getBoundingClientRect(); zoomGraph(camera.current, 1.8, { x: event.clientX - box.left - box.width / 2, y: event.clientY - box.top - box.height / 2 }); setCinematic(false); wake.current(); }} onKeyDown={event => {
          if (['+','=','-','Home','Escape','ArrowLeft','ArrowRight','ArrowUp','ArrowDown',' '].includes(event.key)) event.preventDefault();
          if (event.key === '+' || event.key === '=') zoom(1.4); else if (event.key === '-') zoom(1 / 1.4); else if (event.key === 'Home') reset(); else if (event.key === ' ') setRunning(value => !value); else if (event.key === 'Escape') { setManualActive(null); onSelect(''); } else if (event.key.startsWith('Arrow')) { setCinematic(false); camera.current.targetYaw += event.key === 'ArrowLeft' ? -.12 : event.key === 'ArrowRight' ? .12 : 0; camera.current.targetPitch = Math.max(-1.2, Math.min(1.2, camera.current.targetPitch + (event.key === 'ArrowUp' ? -.12 : event.key === 'ArrowDown' ? .12 : 0))); wake.current(); }
        }} />
        <aside ref={tooltip} className="engine-node-card" style={{ display: activeNode ? undefined : 'none' }} aria-label={t('节点详情', 'Node details')}><strong>{activeNode?.label}</strong><small>CATALOG</small><p>{activeNode?.claim}</p><small>SOURCE</small><p>{activeTaxonomy ? Object.values(activeTaxonomy.query).join(' / ') : 'AgriDx / api/knowledge/catalog'}</p><div><small>LEVEL</small><span>{activeTaxonomy ? levelLabels[activeTaxonomy.level] : '—'}</span></div></aside>
        <div className="engine-stage-log">{t('真实目录 · 连线仅表示目录归属 · 拖动旋转 / 滚轮缩放', 'Real catalog · Membership edges · Drag to rotate / scroll to zoom')}</div>
      </div>
      <KnowledgeSimulationDashboard lang={lang} seconds={seconds} running={running && !reduced} />
    </div>
    <p className="engine-caption">{t('节点与连线来自真实知识库，连线表示目录归属，不能解释为故障因果。下方看板为独立模拟数据。', 'Real catalog nodes and membership links do not imply fault causality. The analytics below use separate simulated data.')}</p>
  </div>;
}

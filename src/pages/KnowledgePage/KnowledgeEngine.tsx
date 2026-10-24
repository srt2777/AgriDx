import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { useUiCopy } from '@/ui/useUiCopy';
import type { KnowledgeCatalog } from '@shared/knowledge-catalog';
import type { TaxonomyNode } from './knowledge-taxonomy-data';
import { createGraphFlowLoop } from './graph-flow-loop';
import { cameraMoving, createGraphCamera, fitGraph, stepGraphCamera, zoomGraph } from './graph-interaction';
import { indexEngineCatalog, selectEngineCatalog } from './knowledge-engine-catalog';
import { catalogNetwork } from './knowledge-engine-model';
import { KnowledgeEngineRenderer } from './knowledge-engine-renderer';
import './knowledge-engine.css';
const levelLabels = { brand: ['品牌', 'Brand'], model: ['机型 / 系列', 'Model / series'], component: ['系统 / 组件', 'System / component'], part: ['零部件', 'Part'] } as const;
export default function KnowledgeEngine({ nodes, selectedId, onSelect, lang, onRelations }: {
    nodes: TaxonomyNode[];
    selectedId: string;
    onSelect: (id: string) => void;
    catalog: KnowledgeCatalog;
    lang: string;
    onRelations: () => void;
}) {
    const { t } = useUiCopy(lang);
    const reduced = !!useReducedMotion();
    const [running, setRunning] = useState(!reduced);
    const [zoomPercent, setZoomPercent] = useState(100);
    const root = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), tooltip = useRef<HTMLElement>(null);
    const camera = useRef(createGraphCamera()), clock = useRef(0), wake = useRef(() => { });
    const renderer = useRef<KnowledgeEngineRenderer | null>(null);
    const directory = useRef<HTMLDivElement>(null);
    const pointers = useRef(new Map<number, {
        x: number;
        y: number;
    }>());
    const gesture = useRef({ startX: 0, startY: 0, x: 0, y: 0, moved: false, pinched: false, distance: 0, pan: false });
    const network = useMemo(() => catalogNetwork(nodes), [nodes]);
    const active = useMemo(() => network.nodes.findIndex(node => node.id === selectedId), [network, selectedId]);
    const activeNode = network.nodes[active];
    const index = useMemo(() => indexEngineCatalog(nodes), [nodes]);
    const view = useMemo(() => selectEngineCatalog(index, selectedId), [index, selectedId]);
    const activeTaxonomy = view.selected;
    const scopeLabel = activeTaxonomy?.scope === 'exact' ? t('具体型号', 'Specific model') : activeTaxonomy?.scope === 'series' ? t('系列范围', 'Series scope') : activeTaxonomy?.scope === 'pending' ? t('待核实', 'Unconfirmed') : t('目录分类', 'Catalog');
    const latest = useRef({ running, active, reduced });
    useLayoutEffect(() => { latest.current = { running, active, reduced }; wake.current(); }, [running, active, reduced]);
    useEffect(() => {
        const escape = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && document.fullscreenElement === root.current?.parentElement)
                void document.exitFullscreen();
        };
        document.addEventListener('keydown', escape);
        return () => document.removeEventListener('keydown', escape);
    }, []);
    const zoom = (factor: number) => { zoomGraph(camera.current, factor); setZoomPercent(Math.round(camera.current.targetZoom * 100)); wake.current(); };
    const reset = () => { fitGraph(camera.current); setZoomPercent(100); wake.current(); };
    const selectIndex = (index: number) => {
        const id = network.nodes[index]?.taxonomyId;
        if (id)
            onSelect(id);
    };
    useEffect(() => {
        const element = canvas.current;
        if (!element?.getContext('2d'))
            return;
        const engine = new KnowledgeEngineRenderer(element, network);
        renderer.current = engine;
        let visible = true, dirty = true, lastReport = 0;
        const render = (delta = 0) => {
            const state = latest.current;
            if (state.running && !state.reduced && !pointers.current.size)
                clock.current = clock.current + delta;
            stepGraphCamera(camera.current, Math.max(delta, 1 / 60), state.reduced);
            engine.draw({ time: clock.current, active: state.active, animate: !state.reduced, camera: camera.current, tooltip: tooltip.current });
            dirty = false;
            if (performance.now() - lastReport > 250) {
                setZoomPercent(Math.round(camera.current.zoom * 100));
                lastReport = performance.now();
            }
        };
        const loop = createGraphFlowLoop({ active: () => visible && !document.hidden && (dirty || cameraMoving(camera.current) || latest.current.running && !latest.current.reduced), render, request: requestAnimationFrame, cancel: cancelAnimationFrame });
        wake.current = () => { dirty = true; render(); loop.start(); };
        const resize = new ResizeObserver(() => wake.current());
        resize.observe(element);
        const intersection = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? false; if (visible)
            wake.current();
        else
            loop.stop(); });
        intersection.observe(element);
        const visibility = () => { if (document.hidden)
            loop.stop();
        else
            wake.current(); };
        document.addEventListener('visibilitychange', visibility);
        const wheel = (event: WheelEvent) => {
            event.preventDefault();
            const rect = element.getBoundingClientRect();
            zoomGraph(camera.current, Math.exp(-Math.max(-180, Math.min(180, event.deltaY * (event.deltaMode === 1 ? 16 : 1))) * .0025), { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 });
                wake.current();
        };
        element.addEventListener('wheel', wheel, { passive: false });
        wake.current();
        return () => { resize.disconnect(); intersection.disconnect(); loop.stop(); document.removeEventListener('visibilitychange', visibility); element.removeEventListener('wheel', wheel); wake.current = () => { }; renderer.current = null; };
        // Selection is read from latest so changing a card does not rebuild the 3k-node network.
    }, [network]);
    const pointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const g = gesture.current;
        if (pointers.current.size === 1)
            Object.assign(g, { startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, moved: false, pinched: false, pan: event.shiftKey || event.button === 2 });
        else {
            const [a, b] = [...pointers.current.values()];
            g.distance = Math.hypot(a.x - b.x, a.y - b.y);
            g.pinched = true;
        }
    };
    const pointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
        if (!pointers.current.has(event.pointerId)) {
            const rect = event.currentTarget.getBoundingClientRect();
            const hit = renderer.current?.pick(event.clientX - rect.left, event.clientY - rect.top);
            event.currentTarget.style.cursor = hit ? 'pointer' : 'grab';
            return;
        }
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const g = gesture.current;
        if (pointers.current.size > 1) {
            const [a, b] = [...pointers.current.values()], distance = Math.hypot(a.x - b.x, a.y - b.y), rect = event.currentTarget.getBoundingClientRect();
            if (g.distance > 0)
                zoomGraph(camera.current, distance / g.distance, { x: (a.x + b.x) / 2 - rect.left - rect.width / 2, y: (a.y + b.y) / 2 - rect.top - rect.height / 2 });
            g.distance = distance;
            g.pinched = true;
            wake.current();
            return;
        }
        if (g.pinched)
            return;
        const dx = event.clientX - g.x, dy = event.clientY - g.y;
        if (Math.hypot(event.clientX - g.startX, event.clientY - g.startY) > 4)
            g.moved = true;
        if (g.pan) {
            camera.current.targetPanX += dx;
            camera.current.targetPanY += dy;
        }
        else {
            camera.current.targetYaw += dx * .005;
            camera.current.targetPitch = Math.max(-1.2, Math.min(1.2, camera.current.targetPitch + dy * .005));
        }
        g.x = event.clientX;
        g.y = event.clientY;
        wake.current();
    };
    const pointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
        pointers.current.delete(event.pointerId);
        if (gesture.current.moved || gesture.current.pinched)
            return;
        const rect = event.currentTarget.getBoundingClientRect();
        const hit = renderer.current?.pick(event.clientX - rect.left, event.clientY - rect.top);
        if (hit)
            selectIndex(hit.index);
    };
    const selectDirectory = (id: string, keyboard: boolean) => {
        onSelect(id);
        if (keyboard) requestAnimationFrame(() => directory.current?.focus());
    };
    const sourceTitle = activeNode?.label ?? t('选择一个节点', 'Select a node');
    const fullScreen = async () => { if (document.fullscreenElement)
        await document.exitFullscreen();
    else
        await root.current?.parentElement?.requestFullscreen?.(); };
    return <div className="knowledge-engine-shell">
    <div className="engine-controls" aria-label={t('图谱控制', 'Graph controls')}>
      <button aria-pressed={running && !reduced} disabled={reduced} onClick={() => setRunning(value => !value)}>{reduced ? t('减少动态', 'Reduced motion') : running ? t('暂停', 'Pause') : t('播放', 'Play')}</button>
      <button onClick={() => zoom(1.4)} aria-label={t('放大图谱', 'Zoom in')}>＋</button><output aria-label={t('当前缩放比例', 'Current zoom')}>{zoomPercent}%</output><button onClick={() => zoom(1 / 1.4)} aria-label={t('缩小图谱', 'Zoom out')}>−</button>
      <button onClick={reset}>{t('复位', 'Reset')}</button><button onClick={() => { void fullScreen().catch(() => { }); }}>{t('全屏', 'Fullscreen')}</button>
      <button onClick={onRelations}>{t('关系聚焦', 'Focus relations')}</button>
    </div>
    <div className="knowledge-engine" ref={root} data-mode="catalog" data-phase={'CATALOG'}>
      <div className="engine-stage">
        <canvas ref={canvas} tabIndex={0} role="img" aria-label={t('三维知识网络：拖动旋转，Shift拖动平移，滚轮或双指缩放，点击节点查看详情。', '3D knowledge network: drag to rotate, Shift-drag to pan, wheel or pinch to zoom; select a node for details.')} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={event => { pointers.current.delete(event.pointerId); gesture.current.moved = true; }} onContextMenu={event => event.preventDefault()} onDoubleClick={event => { const box = event.currentTarget.getBoundingClientRect(); zoomGraph(camera.current, 1.8, { x: event.clientX - box.left - box.width / 2, y: event.clientY - box.top - box.height / 2 }); wake.current(); }} onKeyDown={event => {
            if (['+', '=', '-', 'Home', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(event.key))
                event.preventDefault();
            if (event.key === '+' || event.key === '=')
                zoom(1.4);
            else if (event.key === '-')
                zoom(1 / 1.4);
            else if (event.key === 'Home')
                reset();
            else if (event.key === ' ')
                setRunning(value => !value);
            else if (event.key === 'Escape') {
                onSelect('');
            }
            else if (event.key.startsWith('Arrow')) {
                        camera.current.targetYaw += event.key === 'ArrowLeft' ? -.12 : event.key === 'ArrowRight' ? .12 : 0;
                camera.current.targetPitch = Math.max(-1.2, Math.min(1.2, camera.current.targetPitch + (event.key === 'ArrowUp' ? -.12 : event.key === 'ArrowDown' ? .12 : 0)));
                wake.current();
            }
        }}/>
        <aside ref={tooltip} className="engine-node-card" style={{ display: activeNode ? undefined : 'none' }} aria-label={t('节点详情', 'Node details')}><strong>{sourceTitle}</strong><p>{activeTaxonomy && t(`${activeTaxonomy.count} 条关联资料`, `${activeTaxonomy.count} linked entries`)}</p></aside>
      </div>
      <div className="engine-dashboard">
        <Panel title={t('目录', 'Directory')} count={view.children.length}>
          <div className="engine-directory-nav" ref={directory} tabIndex={-1} role="group" aria-label={t('当前下级目录', 'Current directory')}><button onClick={event => selectDirectory(activeTaxonomy?.parent ?? '', event.detail === 0)} disabled={!activeTaxonomy}>{t('返回上级', 'Parent')}</button><span>{activeTaxonomy?.label ?? t('全部品牌', 'All brands')}</span></div>
          <div className="engine-queue">{view.children.map(node => <button key={node.id} onClick={event => selectDirectory(node.id, event.detail === 0)}><span>{node.label}</span><b>{node.count ? node.count.toLocaleString() : t('待补资料', 'No entries')}</b></button>)}</div>
          {!view.children.length && <p className="engine-empty">{t('已到末级目录，请查看节点资料。', 'End of this branch. Review the node details.')}</p>}
        </Panel>
        <Panel title={t('节点资料', 'Node details')}>
          {activeTaxonomy ? <div className="engine-inspector"><h4>{sourceTitle}</h4><p className="engine-node-path">{view.path.map(node => node.label).join(' / ')}</p><dl><dt>{t('关联资料', 'Linked entries')}</dt><dd>{activeTaxonomy.count.toLocaleString()}</dd><dt>{t('层级', 'Level')}</dt><dd>{t(levelLabels[activeTaxonomy.level][0], levelLabels[activeTaxonomy.level][1])}</dd><dt>{t('适用范围', 'Scope')}</dt><dd>{scopeLabel}</dd></dl>{activeTaxonomy.scope === 'series' && <p>{t('系列资料需核对具体型号与配置。', 'Check the specific model and configuration for series evidence.')}</p>}{!activeTaxonomy.count && <p>{t('此目录暂未关联资料。', 'No evidence linked to this node yet.')}</p>}<button className="engine-evidence-action" onClick={onRelations}>{t('查看原文与关系', 'View evidence and relations')}</button></div> : <p className="engine-empty">{t('选择图谱节点或目录，查看关联资料。', 'Select a graph node or directory to review evidence.')}</p>}
        </Panel>
      </div>
    </div>

  </div>;
}
function Panel({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
    return <section className="engine-panel"><header><h4>{title}</h4>{count !== undefined && <span>{count}</span>}</header><div className="engine-panel-body">{children}</div></section>;
}

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
const pad = (n: number) => String(n).padStart(2, '0');
const levelLabels = { brand: ['品牌', 'Brand'], model: ['机型 / 系列', 'Model / series'], component: ['系统 / 组件', 'System / component'], part: ['零部件', 'Part'] } as const;
export default function KnowledgeEngine({ nodes, selectedId, onSelect, catalog, lang, onRelations }: {
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
    const [seconds, setSeconds] = useState(0);
    const [zoomPercent, setZoomPercent] = useState(100);
    const [azimuth, setAzimuth] = useState(-7);
    const root = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), tooltip = useRef<HTMLElement>(null);
    const camera = useRef(createGraphCamera()), clock = useRef(0), wake = useRef(() => { });
    const renderer = useRef<KnowledgeEngineRenderer | null>(null);
    const directory = useRef<HTMLDivElement>(null);
    const pointers = useRef(new Map<number, {
        x: number;
        y: number;
    }>());
    const gesture = useRef({ startX: 0, startY: 0, x: 0, y: 0, moved: false, pinched: false, distance: 0, pan: false });
    const [cinematic, setCinematic] = useState(true);
    const network = useMemo(() => catalogNetwork(nodes), [nodes]);
    const overviewEdges = useMemo(() => network.edges.filter(edge => network.nodes[edge.from].hub).slice(0, 70), [network]);
    const active = useMemo(() => network.nodes.findIndex(node => node.id === selectedId), [network, selectedId]);
    const activeNode = network.nodes[active];
    const index = useMemo(() => indexEngineCatalog(nodes), [nodes]);
    const view = useMemo(() => selectEngineCatalog(index, selectedId), [index, selectedId]);
    const activeTaxonomy = view.selected;
    const scopeLabel = activeTaxonomy?.scope === 'exact' ? t('具体型号', 'Specific model') : activeTaxonomy?.scope === 'series' ? t('系列范围', 'Series scope') : activeTaxonomy?.scope === 'pending' ? t('待核实', 'Unconfirmed') : t('目录分类', 'Catalog');
    const latest = useRef({ running, cinematic, active, reduced });
    useLayoutEffect(() => { latest.current = { running, cinematic, active, reduced }; wake.current(); }, [running, cinematic, active, reduced]);
    useEffect(() => {
        const escape = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && document.fullscreenElement === root.current?.parentElement)
                void document.exitFullscreen();
        };
        document.addEventListener('keydown', escape);
        return () => document.removeEventListener('keydown', escape);
    }, []);
    const zoom = (factor: number) => { zoomGraph(camera.current, factor); setZoomPercent(Math.round(camera.current.targetZoom * 100)); setCinematic(false); wake.current(); };
    const reset = () => { fitGraph(camera.current); setZoomPercent(100); setCinematic(true); wake.current(); };
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
            engine.draw({ time: clock.current, reference: false, active: state.active, animate: !state.reduced, cinematic: state.cinematic, conflict: false, camera: camera.current, tooltip: tooltip.current });
            dirty = false;
            if (performance.now() - lastReport > 250) {
                setSeconds(Math.floor(clock.current));
                setZoomPercent(Math.round(camera.current.zoom * 100));
                setAzimuth(Math.round((camera.current.yaw + clock.current * .017) * 180 / Math.PI));
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
            setCinematic(false);
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
        setCinematic(false);
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
    const visibleNodes = network.nodes.length;
    const visibleEdges = network.edges.length;
    const source = activeTaxonomy ? Object.values(activeTaxonomy.query).join(' / ') : 'AgriDx / api/knowledge/catalog';
    const sourceTitle = activeNode?.label ?? t('选择节点查看目录', 'Select a catalog node');
    const claim = activeTaxonomy ? t(`${activeTaxonomy.count} 条关联资料 · ${activeTaxonomy.count ? '目录归属' : '待补资料'}`, `${activeTaxonomy.count} linked entries · ${activeTaxonomy.count ? 'Catalog membership' : 'Evidence gap'}`) : t('品牌 → 机型 → 系统 → 零件', 'Brand → Model → System → Part');

    const command = activeTaxonomy ? `> catalog select ${Object.values(activeTaxonomy.query).join(' / ')}` : '> catalog browse --source archived-index --read-only';
    const fullScreen = async () => { if (document.fullscreenElement)
        await document.exitFullscreen();
    else
        await root.current?.parentElement?.requestFullscreen?.(); };
    const entries = index.entries;
    return <div className="knowledge-engine-shell">
    <div className="engine-controls" aria-label={t('图谱控制', 'Graph controls')}>
      <span className="engine-controls-label">{t('真实知识库', 'Knowledge catalog')}</span>
      <button aria-pressed={running && !reduced} disabled={reduced} onClick={() => setRunning(value => !value)}>{reduced ? t('减少动态', 'Reduced motion') : running ? t('暂停', 'Pause') : t('播放', 'Play')}</button>
      <button onClick={() => zoom(1.4)} aria-label={t('放大图谱', 'Zoom in')}>＋</button><output aria-label={t('当前缩放比例', 'Current zoom')}>{zoomPercent}%</output><button onClick={() => zoom(1 / 1.4)} aria-label={t('缩小图谱', 'Zoom out')}>−</button>
      <button onClick={reset}>{t('复位', 'Reset')}</button><button onClick={() => { void fullScreen().catch(() => { }); }}>{t('全屏', 'Fullscreen')}</button>
      <button onClick={onRelations}>{t('关系聚焦', 'Focus relations')}</button>
    </div>
    <div className="knowledge-engine" ref={root} data-mode="catalog" data-phase={'CATALOG'}>
      <header className="engine-masthead"><div><h3>{'AGRIDX / KNOWLEDGE ENGINE'}</h3><p>{`KB ${catalog.kbVersion ?? 'ARCHIVE'}`} / {entries.toLocaleString('en-US')} {'ENTRIES'} / {visibleNodes} NODES / {visibleEdges} LINKS</p></div><div className="engine-clock"><span>{'CATALOG / READ ONLY'} <i /></span><strong>{pad(Math.floor(seconds / 3600))}:{pad(Math.floor(seconds / 60) % 60)}:{pad(seconds % 60)} <small>{running && !reduced ? t('旋转中', 'ROTATING') : t('已暂停', 'PAUSED')}</small></strong></div></header>
      <div className="engine-agents">{[t('目录', 'CATALOG'), t('原文', 'SOURCE'), t('范围', 'SCOPE')].map((name, index) => <div key={name} data-agent={index} data-active={false}><b>● {name}</b><span>{[t('已加载', 'LOADED'), t('只读', 'READ ONLY'), t('需核对', 'VERIFY')][index]}</span><i style={{ width: `${100}%` }}/></div>)}<code>{command}</code></div>
      <div className="engine-stage"><div className="engine-stage-heading"><span>GRAPH / {visibleNodes.toLocaleString('en-US')} RECORDS · {visibleEdges.toLocaleString('en-US')} LINKS</span><span>AZ {azimuth}° Z {zoomPercent}</span></div>
        <canvas ref={canvas} tabIndex={0} role="img" aria-label={t('三维知识网络：拖动旋转，Shift拖动平移，滚轮或双指缩放，点击节点查看详情。', '3D knowledge network: drag to rotate, Shift-drag to pan, wheel or pinch to zoom; select a node for details.')} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={event => { pointers.current.delete(event.pointerId); gesture.current.moved = true; }} onContextMenu={event => event.preventDefault()} onDoubleClick={event => { const box = event.currentTarget.getBoundingClientRect(); zoomGraph(camera.current, 1.8, { x: event.clientX - box.left - box.width / 2, y: event.clientY - box.top - box.height / 2 }); setCinematic(false); wake.current(); }} onKeyDown={event => {
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
                setCinematic(false);
                camera.current.targetYaw += event.key === 'ArrowLeft' ? -.12 : event.key === 'ArrowRight' ? .12 : 0;
                camera.current.targetPitch = Math.max(-1.2, Math.min(1.2, camera.current.targetPitch + (event.key === 'ArrowUp' ? -.12 : event.key === 'ArrowDown' ? .12 : 0)));
                wake.current();
            }
        }}/>
        <aside ref={tooltip} className="engine-node-card" style={{ display: activeNode ? undefined : 'none' }} aria-label={t('节点详情', 'Node details')}><strong>{sourceTitle}</strong><small>{t('目录信息', 'CATALOG')}</small><p>{claim}</p><small>{t('目录标识', 'CATALOG QUERY')}</small><p>{source}</p><div><small>{t('范围', 'SCOPE')}</small><span>{scopeLabel}</span></div><i style={{ width: `${100}%` }}/></aside>
        <div className="engine-stage-log">{seconds.toFixed(2)} {'catalog'} :: {t('连线仅表示目录归属', 'Edges show catalog membership only')}</div>
      </div>
      <div className="engine-command"><code>{command}</code><b>{'CATALOG'}</b></div>
      <div className="engine-dashboard">
        <Panel title={t('01 目录概览', '01 CATALOG OVERVIEW')} status={t('只读', 'READ ONLY')} footer={t('保留原始目录与来源', 'ORIGINAL CATALOG & SOURCES')}>
          <div className="engine-chat">{[
            [t('归档', 'ARCHIVE'), t(`${entries.toLocaleString()} 条关联资料`, `${entries.toLocaleString()} linked entries`)],
            [t('目录', 'CATALOG'), t(`${nodes.length.toLocaleString()} 个节点`, `${nodes.length.toLocaleString()} nodes`)],
            [t('当前', 'SELECTED'), sourceTitle],
            [t('路径', 'PATH'), view.path.map(node => node.label).join(' / ') || t('全部归档', 'All archives')],
          ].map(([role, text], i) => <div key={role}><small>{pad(i + 1)}</small><p><b>{role}</b><br />{text}</p></div>)}</div>
        </Panel>
        <Panel title={t('02 下级目录', '02 DIRECTORY')} status={String(view.children.length)} footer={t('完整列表 · 按原目录顺序', 'ALL CHILDREN / ORIGINAL ORDER')}>
          <div className="engine-directory-nav" ref={directory} tabIndex={-1} role="group" aria-label={t('当前下级目录', 'Current directory')}><button onClick={event => selectDirectory(activeTaxonomy?.parent ?? '', event.detail === 0)} disabled={!activeTaxonomy}>{t('↑ 返回上级', '↑ Parent')}</button><span>{activeTaxonomy?.label ?? t('全部品牌', 'All brands')}</span></div>
          <div className="engine-queue">{view.children.map((node, i) => <button key={node.id} onClick={event => selectDirectory(node.id, event.detail === 0)} title={node.label}><small>{pad(i + 1)}</small><span>{node.label}</span><b>{node.count ? node.count.toLocaleString() : t('待补', 'GAP')}</b></button>)}</div>
          {!view.children.length && <div className="engine-empty"><p>{t('已到本级末端，可查看当前范围的原始资料。', 'End of this branch. Review evidence for this scope.')}</p><button onClick={onRelations}>{t('查看关系与原文', 'View relations & evidence')}</button></div>}
        </Panel>
        <Panel title={t('03 节点详情', '03 NODE INSPECTOR')} status={t('溯源', 'TRACE')} footer={t('目录归属不等于故障因果', 'MEMBERSHIP / NOT CAUSALITY')}>
          <div className="engine-inspector"><h4>{sourceTitle}</h4><small>{t('关联资料', 'LINKED ENTRIES')}</small><p>{activeTaxonomy ? t(`${activeTaxonomy.count} 条`, `${activeTaxonomy.count} entries`) : t('请选择图谱或目录中的节点', 'Select a graph or directory node')}</p><small>{t('目录路径', 'CATALOG PATH')}</small><p>{view.path.map(node => node.label).join(' → ') || '—'}</p><small>{t('层级 / 适用范围', 'LEVEL / SCOPE')}</small><p>{activeTaxonomy ? t(levelLabels[activeTaxonomy.level][0], levelLabels[activeTaxonomy.level][1]) : '—'} / {scopeLabel}</p>{activeTaxonomy && <button className="engine-evidence-action" onClick={onRelations}>{t('查看关系与原文 ↗', 'Relations & evidence ↗')}</button>}</div>
        </Panel>
        <Panel title={t('04 图谱索引', '04 GRAPH INDEX')} status={running && !reduced ? t('旋转', 'ROTATING') : t('暂停', 'PAUSED')} footer={t(`${visibleNodes} 个节点 / ${visibleEdges} 条父子边`, `${visibleNodes} NODES / ${visibleEdges} PARENT EDGES`)}><div className="engine-index"><svg viewBox="0 0 160 120" aria-label={t('图谱缩略图', 'Graph overview')}><g stroke="#73796b" strokeWidth=".55">{overviewEdges.map(({ from, to }) => <line key={`${from}-${to}`} x1={80 + network.nodes[from].x * 26} y1={60 - network.nodes[from].y * 22} x2={80 + network.nodes[to].x * 26} y2={60 - network.nodes[to].y * 22}/>)}</g>{network.hubs.map((i, j) => <g key={i}><circle cx={80 + network.nodes[i].x * 26} cy={60 - network.nodes[i].y * 22} r={i === active ? 3 : 1.6} fill={i === active ? '#ebc568' : '#e99a89'}/><text x={84 + network.nodes[i].x * 26} y={61 - network.nodes[i].y * 22}>{pad(j + 1)}</text></g>)}</svg><dl><dt>{t('关联资料', 'ENTRIES')}</dt><dd>{entries.toLocaleString()}</dd><dt>{t('归属连线', 'LINKS')}</dt><dd>{visibleEdges.toLocaleString()}</dd></dl></div></Panel>
        <Panel title={t('05 原始资料', '05 ORIGINAL SOURCE')} status={t('只读', 'LOCK')} footer={t('原始手册及知识条目保持不变', 'ORIGINAL KNOWLEDGE PRESERVED')}><div className="engine-raw"><div><span>{t('知识库快照', 'Knowledge snapshot')}</span><b>RO</b><small>{catalog.kbVersion ?? t('未提供版本', 'Version unavailable')}</small></div><div><span>{t('目录来源', 'Catalog source')}</span><small>AgriDx / knowledge catalog</small></div><div><span>{t('原始编号', 'ORIGINAL ID')}</span><small>{activeTaxonomy?.id ?? t('选择节点后查看', 'Select a node')}</small></div></div></Panel>
        <Panel title={t('06 适用边界', '06 NODE SCOPE')} status={scopeLabel} footer={t('请核对完整机型及配置', 'CHECK MODEL & CONFIGURATION')}><div className="engine-inspector"><h4>{sourceTitle}</h4><small>{t('范围', 'SCOPE')}</small><p>{scopeLabel}</p><small>{t('证据状态', 'EVIDENCE')}</small><p>{activeTaxonomy ? activeTaxonomy.count ? t('已有相关资料，具体依据请查看原文及页码。', 'Linked evidence available. Check original text and pages.') : t('此目录暂无关联资料，保留缺口。', 'No linked evidence for this node.') : t('先选择品牌、机型、系统或零件。', 'Select a brand, model, system or part.')}</p><p>{t('目录连线仅表示归属；系列资料不可直接套用到所有具体型号。', 'Edges show membership. Series evidence does not establish applicability to every model.')}</p></div></Panel>
        <Panel title={t('07 当前目录覆盖', '07 DIRECTORY COVERAGE')} status={String(view.coverage.length)} footer={t('实心：有关联资料 / 空心：待补资料', 'FILLED: LINKED ENTRIES / OUTLINED: GAP')}><div className="engine-coverage">{view.coverage.map(node => <button key={node.id} data-filled={node.count > 0} aria-pressed={node.id === selectedId} onClick={event => selectDirectory(node.id, event.detail === 0)} title={`${node.label} · ${node.count}`}><i aria-hidden="true"/><span>{node.label}</span><small>{node.count}</small></button>)}</div>{!view.coverage.length && <p className="engine-empty">{t('暂无已定位目录', 'No catalog nodes')}</p>}</Panel>
        <Panel title={t('08 归档分布', '08 CATALOG PROFILE')} status={t('快照', 'SNAPSHOT')} footer={t('关联条目计数 · 不代表维修覆盖率', 'ENTRY COUNTS / NOT REPAIR COVERAGE')}><div className="engine-checker"><strong>{t(`${index.brands.length} 个品牌 / ${index.models} 个机型目录`, `${index.brands.length} BRANDS / ${index.models} MODELS`)}</strong><div className="engine-histogram" role="img" aria-label={t('各品牌关联资料数量，按最大值同比例显示', 'Brand entry counts scaled to the largest count')}>{index.distribution.map(({ node, percent }) => <i key={node.id} data-hot={view.path[0]?.id === node.id} title={`${node.label}: ${node.count}`} style={{ height: `${percent}%` }}/>)}</div><div className="engine-brand-counts">{index.brands.map(node => <button key={node.id} aria-pressed={view.path[0]?.id === node.id} onClick={event => selectDirectory(node.id, event.detail === 0)}><span>{node.label}</span><b>{node.count.toLocaleString()}</b></button>)}</div></div></Panel>
      </div>
    </div>
    <p className="engine-caption">{t('实际目录快照；节点与连线来自已有知识库。连线表示目录归属，不能解释为故障因果。', 'Real catalog snapshot. Nodes and parent edges come from the existing knowledge base; edges do not imply fault causality.')}</p>
  </div>;
}
function Panel({ title, status, footer, children }: {
    title: string;
    status: string;
    footer: string;
    children: React.ReactNode;
}) {
    return <section className="engine-panel"><header><h4>{title}</h4><span>{status}</span></header><div className="engine-panel-body">{children}</div><footer>{footer}</footer></section>;
}

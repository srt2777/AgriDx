import { createPortal } from 'react-dom';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useUiVersion } from '@/hooks/useUiVersion';
import { classicGraphPalette } from '@/ui/graph-palette';
import { palette } from './taxonomy-graph-layout';
import { selectGraphHit } from './graph-gestures';
import { useGraphGestures } from './useGraphGestures';
import { useGraphOverlay } from './useGraphOverlay';
import { focusEnginePoint, clearGraphFocus } from './graph-visuals';
import { useReducedMotion } from 'framer-motion';
import { useUiCopy } from '@/ui/useUiCopy';
import type { KnowledgeCatalog } from '@shared/knowledge-catalog';
import type { TaxonomyNode } from './knowledge-taxonomy-data';
import { createGraphFlowLoop } from './graph-flow-loop';
import { cameraMoving, createGraphCamera, fitGraph, stepGraphCamera, graphNeighborhood, zoomGraph } from './graph-interaction';
import { indexEngineCatalog, selectEngineCatalog } from './knowledge-engine-catalog';
import { catalogNetwork } from './knowledge-engine-model';
import { KnowledgeEngineRenderer } from './knowledge-engine-renderer';
import './knowledge-engine.css';
const levelLabels = { brand: ['品牌', 'Brand'], model: ['机型 / 系列', 'Model / series'], component: ['系统 / 组件', 'System / component'], part: ['零部件', 'Part'] } as const;
export default function KnowledgeEngine({ nodes, selectedId, onSelect, lang, onRelations, onEvidence, diagnosisState }: {
    nodes: TaxonomyNode[];
    selectedId: string;
    onSelect: (id: string) => void;
    catalog: KnowledgeCatalog;
    lang: string;
    onRelations: () => void;
    onEvidence: () => void;
    diagnosisState?: {brand?:string;model:string;question:string};
}) {
    const { t } = useUiCopy(lang);
    const reduced = !!useReducedMotion();
    const classic=useUiVersion()==='old';
    const colors=classic?classicGraphPalette:palette;
    const [hover,setHover]=useState(-1), [focusMode,setFocusMode]=useState(false), [expanded,setExpanded]=useState(false);
    useEffect(()=>setFocusMode(!!selectedId),[selectedId]);
    const closeOverlay=useCallback(()=>setExpanded(false),[]);
    const [running, setRunning] = useState(!reduced);
    const [zoomPercent, setZoomPercent] = useState(100);
    const root = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), tooltip = useRef<HTMLElement>(null);
    const camera = useRef(createGraphCamera()), clock = useRef(0), wake = useRef(() => { });
    const renderer = useRef<KnowledgeEngineRenderer | null>(null);
    const directory = useRef<HTMLDivElement>(null);
    const network = useMemo(() => catalogNetwork(nodes,colors), [nodes,colors]);
    const active = useMemo(() => network.nodes.findIndex(node => node.id === selectedId), [network, selectedId]);
    const activeNode = network.nodes[active];
    const neighborhood=useMemo(()=>graphNeighborhood(nodes,selectedId,Infinity),[nodes,selectedId]);
    const related=useMemo(()=>new Set(neighborhood.shown.map(n=>n.id)),[neighborhood]);
    const tooltipNode=nodes[hover];
    const lastFocused=useRef('');
    const detailsPanel=useRef<HTMLDivElement>(null);
    const gestures=useGraphGestures(canvas,camera,{reduced,revision:expanded,wake:()=>wake.current(),pick:p=>{
      const box=canvas.current?.getBoundingClientRect();if(!box)return;
      const hit=renderer.current?.pick(p.x+box.width/2,p.y+box.height/2);
      if(!hit)fitGraph(camera.current);
      selectGraphHit(selectedId,hit?network.nodes[hit.index].id:undefined,onSelect);wake.current();
    },hover:p=>{
      const box=canvas.current?.getBoundingClientRect();const hit=p&&box?renderer.current?.pick(p.x+box.width/2,p.y+box.height/2):undefined;
      setHover(hit?.index??-1);if(canvas.current)canvas.current.style.cursor=hit?'pointer':'grab';
    }});
    useGraphOverlay(expanded,root,canvas,closeOverlay);
    useEffect(()=>{const media=matchMedia('(forced-colors: active)');const change=()=>wake.current();media.addEventListener('change',change);return()=>media.removeEventListener('change',change);},[]);
    const index = useMemo(() => indexEngineCatalog(nodes), [nodes]);
    const view = useMemo(() => selectEngineCatalog(index, selectedId), [index, selectedId]);
    const activeTaxonomy = view.selected;
    const scopeLabel = activeTaxonomy?.scope === 'exact' ? t('具体型号', 'Specific model') : activeTaxonomy?.scope === 'series' ? t('系列范围', 'Series scope') : activeTaxonomy?.scope === 'pending' ? t('待核实', 'Unconfirmed') : t('目录分类', 'Catalog');
    const latest = useRef({ running, active, reduced, hover, related, focusMode, selectedId });
    useLayoutEffect(() => { latest.current = { running, active, reduced, hover, related, focusMode, selectedId }; wake.current(); }, [running, active, reduced, hover, related, focusMode, selectedId]);
    const zoom = (factor: number) => { zoomGraph(camera.current, factor); setZoomPercent(Math.round(camera.current.targetZoom * 100)); wake.current(); };
    const reset = () => { fitGraph(camera.current); setZoomPercent(100); wake.current(); };
    useEffect(() => {
        const element = canvas.current;
        if (!element?.getContext('2d'))
            return;
        const engine = new KnowledgeEngineRenderer(element, network);
        renderer.current = engine;
        let visible = true, dirty = true, lastReport = 0;
        const render = (delta = 0) => {
            const state = latest.current;
            if (state.running && !state.reduced && !gestures.controller.active())
                clock.current = clock.current + delta;
            if(state.selectedId!==lastFocused.current) {
              const box=element.getBoundingClientRect(),node=network.nodes[state.active];
              if(node)focusEnginePoint(camera.current,node,box.width,box.height,engine.extent);else clearGraphFocus(camera.current);
              lastFocused.current=state.selectedId;
            }
            if(state.running&&!state.reduced&&state.active<0&&!gestures.controller.active())camera.current.targetYaw+=delta*.017;
            stepGraphCamera(camera.current, Math.max(delta, 1 / 60), state.reduced);
            engine.draw({ time: clock.current, active: state.active, hover:state.hover,related:state.related,focusMode:state.focusMode,animate: state.running && !state.reduced, camera: camera.current, tooltip: tooltip.current });
            dirty = false;
            if (performance.now() - lastReport > 250) {
                setZoomPercent(Math.round(camera.current.zoom * 100));
                lastReport = performance.now();
            }
        };
        const loop = createGraphFlowLoop({ active: () => visible && !document.hidden && (dirty || cameraMoving(camera.current) || latest.current.running && !latest.current.reduced), render, request: requestAnimationFrame, cancel: cancelAnimationFrame });
        wake.current = () => { dirty = true; if(visible&&!document.hidden) loop.start(); };
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
        wake.current();
        return () => { resize.disconnect(); intersection.disconnect(); loop.stop(); document.removeEventListener('visibilitychange', visibility); wake.current = () => { }; renderer.current = null; };
        // Selection is read from latest so changing a card does not rebuild the 3k-node network.
    }, [network,gestures.controller,expanded]);
    const selectDirectory = (id: string, keyboard: boolean) => {
        onSelect(id);
        if (keyboard) requestAnimationFrame(() => directory.current?.focus());
    };
    const sourceTitle = activeNode?.label ?? t('选择一个节点', 'Select a node');
    const graphic = <div ref={root} className={`knowledge-engine-shell${expanded?' engine-expanded':''}`} role={expanded?'dialog':undefined} aria-modal={expanded||undefined} aria-label={expanded?t('放大的知识图谱画布','Expanded knowledge graph'):undefined}>
    <div className="engine-controls" aria-label={t('图谱控制', 'Graph controls')}>
      <button aria-pressed={running && !reduced} disabled={reduced} onClick={() => setRunning(value => !value)}>{reduced ? t('减少动态', 'Reduced motion') : running ? t('暂停', 'Pause') : t('播放', 'Play')}</button>
      <button onClick={() => zoom(1.4)} aria-label={t('放大图谱', 'Zoom in')}>＋</button><output aria-label={t('当前缩放比例', 'Current zoom')}>{zoomPercent}%</output><button onClick={() => zoom(1 / 1.4)} aria-label={t('缩小图谱', 'Zoom out')}>−</button>
      <button onClick={reset}>{t('复位', 'Reset')}</button><button onClick={()=>{onSelect('');setFocusMode(false);reset();}}>{t('全部','All')}</button>
      <button data-overlay-toggle aria-pressed={expanded} onClick={()=>setExpanded(v=>!v)}>{expanded?t('收起画布','Collapse canvas'):t('放大画布','Expand canvas')}</button>
      <button disabled={!selectedId} aria-pressed={focusMode} onClick={()=>setFocusMode(v=>!v)}>{focusMode?t('全图上下文','Full context'):t('关系聚焦','Focus relations')}</button>
      <button onClick={()=>{setExpanded(false);onRelations();}}>{t('备用关系画布','Alternative relation view')}</button>
    </div>
    <div className="knowledge-engine" data-mode="catalog" data-phase={'CATALOG'}>
      <div className="engine-stage" style={{minHeight:Math.max(460,related.size*50+32)}}>
        <canvas ref={canvas} tabIndex={0} role="img" aria-label={t('三维知识网络：单指拖动旋转，双指平移与缩放；点击节点查看资料，点空白或Esc返回全部。方向键旋转，加减缩放，Home复位，Enter打开资料。', '3D knowledge graph: drag to rotate, use two fingers to pan and zoom. Select a node for details, blank space or Escape clears selection. Arrows rotate, +/- zoom, Home resets, Enter opens details.')} {...gestures.bindings} onKeyDown={event => {
            if (['+', '=', '-', 'Home', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'Enter'].includes(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey)
                event.preventDefault();
            if(event.ctrlKey||event.metaKey||event.altKey)return;
            if (event.key === '+' || event.key === '=')
                zoom(1.4);
            else if (event.key === '-')
                zoom(1 / 1.4);
            else if (event.key === 'Home')
                reset();
            else if (event.key === ' ')
                setRunning(value => !value);
            else if(event.key==='Enter')detailsPanel.current?.focus();
            else if (event.key === 'Escape') { onSelect('');fitGraph(camera.current);wake.current(); }
            else if (event.key.startsWith('Arrow')) {
                        camera.current.targetYaw += event.key === 'ArrowLeft' ? -.12 : event.key === 'ArrowRight' ? .12 : 0;
                camera.current.targetPitch = Math.max(-1.2, Math.min(1.2, camera.current.targetPitch + (event.key === 'ArrowUp' ? -.12 : event.key === 'ArrowDown' ? .12 : 0)));
                wake.current();
            }
        }}/>
        <aside ref={tooltip} className="engine-node-card" style={{display:tooltipNode?undefined:'none'}} aria-label={t('节点提示','Node tooltip')}><strong>{tooltipNode?.label}</strong><p>{tooltipNode&&t(levelLabels[tooltipNode.level][0],levelLabels[tooltipNode.level][1])}</p><p>{tooltipNode?.count?t(`${tooltipNode.count} 条关联资料`,`${tooltipNode.count} linked entries`):t('待补资料','Evidence gap')}</p></aside>
      </div>
      <div className="engine-dashboard">
        <Panel title={t('目录', 'Directory')} count={view.children.length}>
          <div className="engine-directory-nav" ref={directory} tabIndex={-1} role="group" aria-label={t('当前下级目录', 'Current directory')}><button onClick={event => selectDirectory(activeTaxonomy?.parent ?? '', event.detail === 0)} disabled={!activeTaxonomy}>{t('返回上级', 'Parent')}</button><span>{activeTaxonomy?.label ?? t('全部品牌', 'All brands')}</span></div>
          <div className="engine-queue">{view.children.map(node => <button key={node.id} onClick={event => selectDirectory(node.id, event.detail === 0)}><span>{node.label}</span><b>{node.count ? node.count.toLocaleString() : t('待补资料', 'No entries')}</b></button>)}</div>
          {!view.children.length && <p className="engine-empty">{t('已到末级目录，请查看节点资料。', 'End of this branch. Review the node details.')}</p>}
        </Panel>
        <Panel title={t('节点资料', 'Node details')}>
          <div ref={detailsPanel} tabIndex={-1}>
          {activeTaxonomy ? <div className="engine-inspector"><h4>{sourceTitle}</h4><p className="engine-node-path">{view.path.map(node => node.label).join(' / ')}</p><dl><dt>{t('关联资料', 'Linked entries')}</dt><dd>{activeTaxonomy.count.toLocaleString()}</dd><dt>{t('层级', 'Level')}</dt><dd>{t(levelLabels[activeTaxonomy.level][0], levelLabels[activeTaxonomy.level][1])}</dd><dt>{t('适用范围', 'Scope')}</dt><dd>{scopeLabel}</dd></dl>{activeTaxonomy.scope === 'series' && <p>{t('系列资料需核对具体型号与配置。', 'Check the specific model and configuration for series evidence.')}</p>}{!activeTaxonomy.count && <p>{t('此目录暂未关联资料。', 'No evidence linked to this node yet.')}</p>}<button className="engine-evidence-action" onClick={()=>{setExpanded(false);onEvidence();}}>{t('查看原文','View source evidence')}</button>{diagnosisState&&<Link className="engine-evidence-action" to="/chat" state={diagnosisState}>{t('带机型去诊断','Diagnose with this model')}</Link>}
          <h5>{t('上级路径','Parent path')}</h5>{neighborhood.ancestors.map(n=><button className="engine-evidence-action" key={n.id} onClick={()=>onSelect(n.id)}>{n.label}</button>)}
          <h5>{t('直接下级','Direct children')}</h5>{view.children.map(n=><button className="engine-child" key={n.id} onClick={()=>onSelect(n.id)}>{n.label}<small>{n.count?t(`${n.count} 条资料`,`${n.count} entries`):t('待补资料','Evidence gap')}</small></button>)}</div> : <p className="engine-empty">{t('选择图谱节点或目录，查看关联资料。', 'Select a graph node or directory to review evidence.')}</p>}
          </div>
        </Panel>
      </div>
      <details className="engine-legend"><summary>{t('图例','Legend')}</summary><p>{t('颜色表示品牌，大小与形状表示层级；空心虚线表示待补资料，计数不可按层级相加。','Color shows brand; size and shape show level. Hollow dashed nodes have no linked evidence. Do not sum counts across levels.')}</p><p>{t('圆形：品牌 · 菱形：机型 · 圆角方形：系统 · 三角形：零件','Circle: brand · Diamond: model · Rounded square: system · Triangle: part')}</p>{index.brands.map((n,i)=><button key={n.id} onClick={()=>onSelect(n.id)}><i style={{background:colors[i%colors.length]}}/>{n.label}</button>)}</details>
    </div>

  </div>;
  return expanded ? createPortal(graphic,document.body) : graphic;
}
function Panel({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
    return <section className="engine-panel"><header><h4>{title}</h4>{count !== undefined && <span>{count}</span>}</header><div className="engine-panel-body">{children}</div></section>;
}

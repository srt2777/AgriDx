import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { useUiCopy } from '@/ui/useUiCopy';
import { useUiVersion } from '@/hooks/useUiVersion';
import { useTheme } from '@/hooks/useTheme';
import { classicGraphPalette } from '@/ui/graph-palette';
import type { RelationEdge, KnowledgeRelations } from '../../../shared/knowledge-relations';
import { membershipStrength } from '../../../shared/relation-strength';
import { fetchKnowledgeRelations } from '@/features/knowledge/relations-api';
import type { TaxonomyNode } from './knowledge-taxonomy-data';
import { palette } from './taxonomy-graph-layout';
import { terrainLayout } from './knowledge-terrain-layout';
import { terrainCacheKey } from './knowledge-terrain-cache';
import type { TerrainField } from './knowledge-terrain-field';
import type { ContourSegment } from './knowledge-terrain-contours';
import { TerrainRenderer } from './knowledge-terrain-renderer';
import { createGraphCamera, cameraMoving, fitGraph, stepGraphCamera, zoomGraph } from './graph-interaction';
import { createGraphFlowLoop } from './graph-flow-loop';
import './knowledge-terrain.css';

function memberships(nodes: TaxonomyNode[]): RelationEdge[] {
  const index=new Map(nodes.map(node=>[node.id,node])), edges:RelationEdge[]=[];
  for(const child of nodes){if(!child.parent)continue;const parent=index.get(child.parent);if(!parent)continue;
    edges.push({from:parent.id,to:child.id,type:'membership',strength:membershipStrength(parent.count,child.count),basis:'目录归属',evidence:{parentCount:parent.count,childCount:child.count}});
  }
  return edges;
}
interface TerrainData { edges:RelationEdge[]; warning:string; kbVersion:string|null }
interface Calculated { width:number;height:number;values:Float32Array;contours:ContourSegment[];elapsedMs:number }
export default function KnowledgeTerrain({ nodes, allNodes, selectedId, onSelect, lang, kbVersion }: { nodes:TaxonomyNode[]; allNodes:TaxonomyNode[]; selectedId:string; onSelect:(id:string)=>void; lang:string; kbVersion:string|null }) {
  const {t}=useUiCopy(lang), reduced=!!useReducedMotion(), classic=useUiVersion()==='old', theme=useTheme();
  const [data,setData]=useState<TerrainData|null>(null), [computed,setComputed]=useState<Calculated|null>(null);
  const [dimension,setDimension]=useState<'2d'|'3d'>('3d'), [running,setRunning]=useState(!reduced), [zoomPercent,setZoomPercent]=useState(100);
  const [compact,setCompact]=useState(()=>window.innerWidth<600);
  const [error,setError]=useState('');
  const canvas=useRef<HTMLCanvasElement>(null), root=useRef<HTMLDivElement>(null), renderer=useRef<TerrainRenderer|null>(null), camera=useRef(createGraphCamera()), wake=useRef(()=>{});
  const workerRef=useRef<Worker|null>(null), workerRequest=useRef(0);
  const points=useMemo(()=>terrainLayout(nodes),[nodes]);
  const nodeIds=useMemo(()=>new Set(nodes.map(node=>node.id)),[nodes]);
  const edges=useMemo(()=>data?.edges.filter(edge=>nodeIds.has(edge.from)&&nodeIds.has(edge.to)) ?? [],[data,nodeIds]);
  const top=useMemo(()=>edges.filter(edge=>edge.from===selectedId||edge.to===selectedId).sort((a,b)=>b.strength-a.strength).slice(0,5),[edges,selectedId]);
  const labels=useMemo(()=>new Map(nodes.map(node=>[node.id,node.label])),[nodes]);
  const latest=useRef({points,edges,selectedId,dimension,running,reduced,classic,theme,computed});
  useLayoutEffect(()=>{latest.current={points,edges,selectedId,dimension,running,reduced,classic,theme,computed};wake.current();},[points,edges,selectedId,dimension,running,reduced,classic,theme,computed]);
  useEffect(()=>{
    const controller=new AbortController(), ids=new Set(allNodes.map(node=>node.id));
    setData(null);setError('');
    const fallback=(message:string)=>{if(!controller.signal.aborted)setData({edges:memberships(allNodes),warning:message,kbVersion});};
    void (async()=>{
      try {
        const first=await fetchKnowledgeRelations(ids,controller.signal,{offset:0,limit:10000});
        if(first.kbVersion!==kbVersion)throw Error('知识快照版本不一致');
        if(first.degraded.length){fallback(t('语义报告不可用，地形仅使用目录归属。','Semantic report unavailable; terrain uses catalog membership only.'));return;}
        const collected=[...first.edges];let page=first.page;
        while(page?.hasMore){const next:KnowledgeRelations=await fetchKnowledgeRelations(ids,controller.signal,{offset:page.offset+page.limit,limit:10000});if(next.kbVersion!==first.kbVersion||next.page?.total!==first.page?.total)throw Error('关系数据在分页期间改变');collected.push(...next.edges);page=next.page;}
        if(!controller.signal.aborted)setData({edges:collected,warning:'',kbVersion:first.kbVersion});
      } catch { if(!controller.signal.aborted)fallback(t('关系接口不可用，地形仅使用目录归属。','Relations unavailable; terrain uses catalog membership only.')); }
    })();return()=>controller.abort();
  },[allNodes,kbVersion,t]);
  useEffect(()=>{const resize=()=>setCompact(window.innerWidth<600);window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize);},[]);
  useEffect(()=>{try{const worker=new Worker(new URL('./knowledge-terrain.worker.ts',import.meta.url),{type:'module'});workerRef.current=worker;return()=>{workerRef.current=null;worker.terminate();};}catch{setError(t('地形计算不可用，仍可使用下方辅助目录。','Terrain computation unavailable; use the directory below.'));}},[t]);
  useEffect(()=>{
    const worker=workerRef.current;if(!data||!worker)return;
    const id=++workerRequest.current;
    const width=compact?36:48,height=compact?27:36;
    const key=terrainCacheKey(data.kbVersion,data.warning,width,height,nodes,edges);
    setComputed(null);setError('');
    worker.onmessage=(event:MessageEvent<Calculated & {id:number;error?:string}>)=>{if(event.data.id!==id)return;if(event.data.error)setError(event.data.error);else setComputed(event.data);};
    worker.onerror=()=>setError(t('地形计算不可用，仍可使用下方辅助目录。','Terrain computation unavailable; use the directory below.'));
    worker.postMessage({id,key,points,edges,width,height});return()=>{worker.onmessage=null;};
  },[data,nodes,edges,points,t,compact]);
  useEffect(()=>{
    const el=canvas.current;if(!el)return;let engine:TerrainRenderer;
    try{engine=new TerrainRenderer(el);}catch{setError(t('当前浏览器不支持 Canvas 2D，请使用辅助目录。','Canvas 2D unavailable; use the directory.'));return;}
    renderer.current=engine;let visible=true,dirty=true,mapT=latest.current.dimension==='3d'?1:0;
    const render=(dt=0)=>{
      const state=latest.current,target=state.dimension==='3d'?1:0;
      if(state.reduced||!state.running)mapT=target;else mapT += Math.sign(target-mapT)*Math.min(Math.abs(target-mapT),Math.max(dt,1/60)/.4);
      stepGraphCamera(camera.current,Math.max(dt,1/60),state.reduced);
      if(state.computed){const frameMs=engine.draw({field:state.computed as TerrainField,contours:state.computed.contours,points:state.points,edges:state.edges,selectedId:state.selectedId,mapT,camera:camera.current,palette:state.classic?classicGraphPalette:palette,light:state.theme==='light'});el.dataset.terrainFrameMs=frameMs.toFixed(2);el.dataset.terrainWorkerMs=state.computed.elapsedMs.toFixed(2);}
      dirty=false;setZoomPercent(Math.round(camera.current.zoom*100));
    };
    const loop=createGraphFlowLoop({active:()=>visible&&!document.hidden&&(dirty||cameraMoving(camera.current)||Math.abs(mapT-(latest.current.dimension==='3d'?1:0))>.005&&latest.current.running),render,request:requestAnimationFrame,cancel:cancelAnimationFrame});
    wake.current=()=>{dirty=true;render();loop.start();};
    const resize=new ResizeObserver(()=>wake.current());resize.observe(el);
    const io=new IntersectionObserver(entries=>{visible=entries[0]?.isIntersecting??false;if(visible)wake.current();else loop.stop();});io.observe(el);
    const visibility=()=>{if(document.hidden)loop.stop();else wake.current();};document.addEventListener('visibilitychange',visibility);
    const wheel=(event:WheelEvent)=>{event.preventDefault();const r=el.getBoundingClientRect();zoomGraph(camera.current,Math.exp(-Math.max(-180,Math.min(180,event.deltaY))*.0025),{x:event.clientX-r.left-r.width/2,y:event.clientY-r.top-r.height/2});wake.current();};
    el.addEventListener('wheel',wheel,{passive:false});wake.current();
    return()=>{resize.disconnect();io.disconnect();document.removeEventListener('visibilitychange',visibility);el.removeEventListener('wheel',wheel);loop.stop();wake.current=()=>{};renderer.current=null;};
  },[t]);
  const drag=useRef({x:0,y:0,moved:false,pan:false,pinch:0}), pointers=useRef(new Map<number,{x:number;y:number}>());
  const zoom=(factor:number)=>{zoomGraph(camera.current,factor);wake.current();};
  const pointerDown=(event:React.PointerEvent<HTMLCanvasElement>)=>{event.currentTarget.setPointerCapture(event.pointerId);pointers.current.set(event.pointerId,{x:event.clientX,y:event.clientY});if(pointers.current.size===1)Object.assign(drag.current,{x:event.clientX,y:event.clientY,moved:false,pan:event.shiftKey||event.button===2,pinch:0});else{const [a,b]=[...pointers.current.values()];drag.current.pinch=Math.hypot(a.x-b.x,a.y-b.y);drag.current.moved=true;}};
  const pointerMove=(event:React.PointerEvent<HTMLCanvasElement>)=>{if(!pointers.current.has(event.pointerId))return;pointers.current.set(event.pointerId,{x:event.clientX,y:event.clientY});const d=drag.current;if(pointers.current.size>1){const [a,b]=[...pointers.current.values()],distance=Math.hypot(a.x-b.x,a.y-b.y),box=event.currentTarget.getBoundingClientRect();if(d.pinch)zoomGraph(camera.current,distance/d.pinch,{x:(a.x+b.x)/2-box.left-box.width/2,y:(a.y+b.y)/2-box.top-box.height/2});d.pinch=distance;d.moved=true;wake.current();return;}const dx=event.clientX-d.x,dy=event.clientY-d.y;if(Math.hypot(dx,dy)>2)d.moved=true;if(d.pan){camera.current.targetPanX+=dx;camera.current.targetPanY+=dy;}else{camera.current.targetYaw+=dx*.005;camera.current.targetPitch=Math.max(-1.2,Math.min(1.2,camera.current.targetPitch+dy*.005));}d.x=event.clientX;d.y=event.clientY;wake.current();};
  const pointerUp=(event:React.PointerEvent<HTMLCanvasElement>)=>{pointers.current.delete(event.pointerId);if(drag.current.moved)return;const box=event.currentTarget.getBoundingClientRect(), id=renderer.current?.pick(event.clientX-box.left,event.clientY-box.top);if(id)onSelect(id);};
  const current=nodes.find(node=>node.id===selectedId);
  const evidenceLabel=(key:string)=>({parentCount:t('上级条目数','Parent entries'),childCount:t('下级条目数','Child entries'),name:t('名称','Name'),leftCount:t('一侧条目数','First entry count'),rightCount:t('另一侧条目数','Second entry count'),roleSimilarity:t('角色相似度','Role similarity'),membershipCap:t('归属强度上限','Membership cap'),relation:t('候选类型','Candidate type'),count:t('候选数量','Candidate count'),ids:t('候选编号','Candidate IDs')}[key]??key);
  return <div className="knowledge-terrain-shell" ref={root}>
    <div className="engine-controls" aria-label={t('地形控制','Terrain controls')}><button aria-pressed={dimension==='2d'} onClick={()=>setDimension('2d')}>2D</button><button aria-pressed={dimension==='3d'} onClick={()=>setDimension('3d')}>3D</button><button onClick={()=>setRunning(!running)} disabled={reduced}>{running?t('暂停','Pause'):t('继续','Resume')}</button><button onClick={()=>zoom(1.4)} aria-label={t('放大地形','Zoom in')}>＋</button><output>{zoomPercent}%</output><button onClick={()=>zoom(1/1.4)} aria-label={t('缩小地形','Zoom out')}>−</button><button onClick={()=>{fitGraph(camera.current);wake.current();}}>{t('适应画布','Fit')}</button><button onClick={()=>{if(document.fullscreenElement)void document.exitFullscreen();else void root.current?.requestFullscreen?.();}}>{t('全屏','Fullscreen')}</button></div>
    {data?.warning&&<p role="status">{data.warning}</p>}{error&&<p role="alert">{error}</p>}{!computed&&!error&&<p role="status">{t('正在生成知识地形…','Generating knowledge terrain…')}</p>}
    <canvas ref={canvas} className="knowledge-terrain-canvas" tabIndex={0} role="img" aria-label={t('知识地形：拖动旋转，Shift 拖动平移，滚轮或双指缩放，点击节点查看资料。','Knowledge terrain: drag to rotate, Shift-drag to pan, wheel or pinch to zoom, select a node.')} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={event=>{pointers.current.delete(event.pointerId);drag.current.moved=true;}} onContextMenu={event=>event.preventDefault()} onDoubleClick={event=>{const box=event.currentTarget.getBoundingClientRect();zoomGraph(camera.current,1.8,{x:event.clientX-box.left-box.width/2,y:event.clientY-box.top-box.height/2});wake.current();}} onKeyDown={event=>{if(['+','=','-','Home','Escape','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))event.preventDefault();if(event.key==='+'||event.key==='=')zoom(1.4);else if(event.key==='-')zoom(1/1.4);else if(event.key==='Home'){fitGraph(camera.current);wake.current();}else if(event.key==='Escape')onSelect('');else if(event.key==='ArrowLeft'||event.key==='ArrowRight'){camera.current.targetYaw+=event.key==='ArrowLeft'?-.12:.12;wake.current();}else if(event.key==='ArrowUp'||event.key==='ArrowDown'){camera.current.targetPitch=Math.max(-1.2,Math.min(1.2,camera.current.targetPitch+(event.key==='ArrowUp'?-.12:.12)));wake.current();}}}/>
    <p className="terrain-legend">{t('颜色：品牌；选中节点后，实线表示目录归属，点线表示同名部件，虚线表示语义候选（待审）。线越密越陡表示启发式强度越高；不表示维修因果、先修关系或适用性。','Color: brand. For a selected node, solid lines show membership, dots show same-named components and dashes show pending semantic candidates. Denser contours indicate stronger heuristic associations, not repair causality, priority or applicability.')}</p>
    {current&&<section className="terrain-relations"><h3>{t('最强的 5 条关系','Top 5 relations')} / {current.label}</h3>{current.count===0&&<p>{t('待补资料','Evidence gap')}</p>}{top.length?<ol>{top.map(edge=><li key={`${edge.type}:${edge.from}:${edge.to}:${edge.evidence.relation ?? ''}`}><button onClick={()=>onSelect(edge.from===selectedId?edge.to:edge.from)}>{labels.get(edge.from===selectedId?edge.to:edge.from)}</button><meter min={0} max={1} value={edge.strength}/><span>{Math.round(edge.strength*100)}% {edge.type==='membership'?t('目录归属','Catalog membership'):edge.type==='shared-component'?t('同名部件','Same-named component'):t('语义候选（待审）','Semantic candidate (pending)')}</span><small>{Object.entries(edge.evidence).map(([key,value])=>`${evidenceLabel(key)}: ${value}`).join(' / ')}</small></li>)}</ol>:<p>{t('没有可展示的关系。','No relations to display.')}</p>}</section>}
  </div>;
}

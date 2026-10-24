import { sage, sageDark, grass } from '@radix-ui/colors';
import { useUiCopy } from '@/ui/useUiCopy';
import { useUiVersion } from '@/hooks/useUiVersion';
import { useTheme } from '@/hooks/useTheme';
import { classicGraphPalette } from '@/ui/graph-palette';
import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import type { TaxonomyNode } from './knowledge-taxonomy-data';

import { createGraphFlowLoop } from './graph-flow-loop';
import { graphPositions, palette, fluidPosition, diffusionParticle } from './taxonomy-graph-layout';

export default function TaxonomyGraphCanvas({ nodes, selectedId, onSelect, lang }: { nodes: TaxonomyNode[]; selectedId: string; onSelect: (id: string) => void; lang: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [branchOnly, setBranchOnly] = useState(false);
  const [flowing, setFlowing] = useState(true);
  const reducedMotion = !!useReducedMotion();
  const flowClock = useRef(0);
  const [revision, redraw] = useState(0);
  const camera = useRef({ yaw: -.13, pitch: -.08, zoom: 1 });
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const hits = useRef<{ id: string; x: number; y: number; radius: number }[]>([]);
  const { t } = useUiCopy(lang);
  const classic = useUiVersion() === 'old';
  const theme = useTheme();
  const graphPalette = classic ? classicGraphPalette : palette;
  const neutral = theme === 'dark' ? sageDark : sage;
  useEffect(() => {
    const element = canvas.current;
    const stopPageScroll = (event: WheelEvent) => event.preventDefault();
    element?.addEventListener('wheel', stopPageScroll, { passive: false });
    return () => element?.removeEventListener('wheel', stopPageScroll);
  }, []);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const context = element.getContext('2d');
    if (!context) return;
    const positions = graphPositions(nodes, graphPalette);
    const byId = new Map(nodes.map(node => [node.id, node]));
    const ancestors = new Set<string>();
    let current = byId.get(selectedId);
    while (current) { ancestors.add(current.id); current = current.parent ? byId.get(current.parent) : undefined; }
    const descendants = new Set<string>(selectedId ? [selectedId] : []);
    nodes.forEach(node => { if (node.parent && descendants.has(node.parent)) descendants.add(node.id); });
    const related = new Set([...ancestors, ...descendants]);
    const shown = branchOnly && selectedId ? nodes.filter(node => related.has(node.id)) : nodes;
    let visible = true;
    const draw = () => {
      const { width, height } = element.getBoundingClientRect();
      if (!width || !height) return;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      if (element.width !== Math.round(width * dpr) || element.height !== Math.round(height * dpr)) {
        element.width = Math.round(width * dpr); element.height = Math.round(height * dpr);
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      const time = flowClock.current;
      const yaw = camera.current.yaw + Math.sin(time * .065) * .24;
      const pitch = camera.current.pitch + Math.sin(time * .09) * .1;
      const project = (point: { x: number; y: number; z: number }, scale: number, focusX = 0) => {
        const x = point.x - focusX;
        const rx = x * Math.cos(yaw) + point.z * Math.sin(yaw);
        const rz = -x * Math.sin(yaw) + point.z * Math.cos(yaw);
        const ry = point.y * Math.cos(pitch) - rz * Math.sin(pitch);
        const depth = rz * Math.cos(pitch) + point.y * Math.sin(pitch);
        const perspective = 7 / Math.max(2, 7 + depth);
        return { x: width / 2 + rx * scale * perspective, y: height / 2 - ry * scale * perspective, scale: perspective, depth };
      };
      const projected = new Map<string, { x: number; y: number; scale: number; depth: number }>();
      const focus = branchOnly && selectedId ? positions.get(selectedId) : undefined;
      const extent = branchOnly && shown.length ? Math.max(.7, ...shown.map(node => Math.abs(positions.get(node.id)!.x - (focus?.x ?? 0)))) : 2.9;
      const scale = Math.min(width / (extent * 2 + 1), height / 7.1) * camera.current.zoom;
      const aura = context.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, scale * 3.3);
      aura.addColorStop(0, classic ? '#3a947b09' : '#5b8dce18');
      aura.addColorStop(.6, classic ? '#3a947b05' : '#4267a40c');
      aura.addColorStop(1, '#00000000');
      context.fillStyle = aura; context.fillRect(0, 0, width, height);
      if (!branchOnly) {
        context.fillStyle = classic ? neutral.sage11 : '#b5d6f4';
        for (let index = 0; index < (width < 600 ? 140 : 380); index++) {
          const particle = diffusionParticle(index, time);
          const point = project(particle, scale);
          context.globalAlpha = particle.alpha * (selectedId ? .2 : 1);
          context.beginPath(); context.arc(point.x, point.y, particle.size * point.scale, 0, Math.PI * 2); context.fill();
        }
        context.globalAlpha = 1;
      }
      for (const node of shown) {
        const base = positions.get(node.id)!;
        const point = reducedMotion ? base : fluidPosition(base, time);
        projected.set(node.id, project(point, scale, focus?.x ?? 0));
      }
      shown.forEach(node => {
        const point = projected.get(node.id)!;
        const parent = node.parent && projected.get(node.parent);
        if (!parent) return;
        const highlighted = ancestors.has(node.id) || node.parent === selectedId;
        context.strokeStyle = classic ? (highlighted ? neutral.sage8 : neutral.sage6) : highlighted ? '#e2f0ffb0' : selectedId ? '#8da7c217' : '#8da7c230';
        context.globalAlpha = highlighted ? .85 : selectedId ? .08 : .18;
        context.lineWidth = highlighted ? 1.2 : .45;
        context.beginPath(); context.moveTo(parent.x, parent.y); context.lineTo(point.x, point.y); context.stroke();
      });
      context.globalAlpha = 1;
      hits.current = [];
      const depthOrdered = [...shown].sort((a, b) => projected.get(b.id)!.depth - projected.get(a.id)!.depth);
      depthOrdered.forEach(node => {
        const point = projected.get(node.id)!;
        const active = selectedId === node.id;
        const radius = (active ? 7 : node.level === 'brand' ? 3.5 : node.level === 'model' ? 2 : 1.05 + positions.get(node.id)!.phase * .09) * point.scale;
        context.globalAlpha = selectedId && !related.has(node.id) ? .16 : Math.max(.35, Math.min(1, .75 - point.depth * .17));
        context.fillStyle = positions.get(node.id)!.color;
        context.shadowBlur = active ? 16 : node.level === 'brand' ? 7 : 0;
        context.shadowColor = context.fillStyle;
        context.beginPath(); context.arc(point.x, point.y, radius, 0, Math.PI * 2); context.fill();
        context.shadowBlur = 0;
        if (active) { context.strokeStyle = classic ? grass.grass8 : '#ffffff'; context.lineWidth = classic ? .5 : 2; context.stroke(); }
        if (active || node.level === 'brand' || branchOnly && (ancestors.has(node.id) || node.parent === selectedId)) {
          context.font = `${classic ? 12 : active ? 13 : 11}px system-ui`; context.fillStyle = classic ? neutral.sage12 : '#edf3ff';
          context.fillText(node.label, point.x + radius + 5, point.y + 4);
        }
        hits.current.push({ id: node.id, x: point.x, y: point.y, radius });
      });
      context.globalAlpha = 1;
    };
    const loop = createGraphFlowLoop({
      active: () => visible && !document.hidden && flowing && !reducedMotion && !selectedId,
      render: delta => { if (!drag.current) flowClock.current += delta; draw(); },
      request: callback => requestAnimationFrame(callback), cancel: id => cancelAnimationFrame(id),
    });
    const observer = new ResizeObserver(draw); observer.observe(element);
    const intersection = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? false; if (visible) loop.start(); else loop.stop(); });
    intersection.observe(element);
    const visibility = () => { if (document.hidden) loop.stop(); else loop.start(); };
    document.addEventListener('visibilitychange', visibility);
    draw(); loop.start();
    return () => { loop.stop(); observer.disconnect(); intersection.disconnect(); document.removeEventListener('visibilitychange', visibility); };
  }, [nodes, selectedId, branchOnly, revision, classic, graphPalette, neutral, flowing, reducedMotion]);
  const zoom = (factor: number) => { camera.current.zoom = Math.min(8, Math.max(.4, camera.current.zoom * factor)); redraw(value => value + 1); };
  return <div className="taxonomy-map">
    <div className="taxonomy-map-tools"><span>{t('品牌 → 机型 → 系统 → 零件', 'Brand → Model → System → Part')}</span><button aria-pressed={flowing && !reducedMotion} disabled={reducedMotion} onClick={() => setFlowing(value => !value)}>{reducedMotion ? t('减少动态已启用', 'Reduced motion') : flowing ? t('暂停流动', 'Pause flow') : t('继续流动', 'Resume flow')}</button>{selectedId && <small>{t('查看节点时暂停流动', 'Flow paused while inspecting')}</small>}<button onClick={() => zoom(1.25)} aria-label={t('放大图谱', 'Zoom in')}>＋</button><button onClick={() => zoom(.8)} aria-label={t('缩小图谱', 'Zoom out')}>−</button><button onClick={() => { camera.current = { yaw: -.13, pitch: -.08, zoom: 1 }; redraw(value => value + 1); }}>{t('复位', 'Reset')}</button><button disabled={!selectedId} aria-pressed={branchOnly} onClick={() => setBranchOnly(value => !value)}>{t('仅选中分支', 'Selected branch')}</button></div>
    <canvas ref={canvas} tabIndex={0} role="img" aria-label={t('三维分类关系图，可拖动旋转、滚轮缩放；搜索或下方节点按钮提供键盘操作。', '3D taxonomy graph. Drag to rotate, scroll to zoom. Search and node buttons provide keyboard selection.')} style={{ touchAction: 'none' }}
      onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY, moved: false }; }}
      onPointerMove={event => { const pointer = drag.current; if (!pointer) return; const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y; if (Math.abs(dx) + Math.abs(dy) > 2) pointer.moved = true; camera.current.yaw += dx * .005; camera.current.pitch = Math.max(-1, Math.min(1, camera.current.pitch + dy * .005)); pointer.x = event.clientX; pointer.y = event.clientY; redraw(value => value + 1); }}
      onPointerUp={event => { const pointer = drag.current; drag.current = null; if (!pointer || pointer.moved) return; const box = event.currentTarget.getBoundingClientRect(); const x = event.clientX - box.left, y = event.clientY - box.top; const nearest = hits.current.map(point => ({ ...point, distance: Math.hypot(point.x - x, point.y - y) })).filter(point => point.distance <= point.radius + 7).sort((a, b) => a.distance - b.distance)[0]; if (nearest) onSelect(nearest.id); }}
      onPointerCancel={() => { drag.current = null; }} onWheel={event => { zoom(event.deltaY < 0 ? 1.08 : .92); }}
      onKeyDown={event => { if (event.key === '+' || event.key === '=') zoom(1.2); else if (event.key === '-') zoom(.8); else if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) { event.preventDefault(); camera.current.yaw += event.key === 'ArrowLeft' ? -.1 : event.key === 'ArrowRight' ? .1 : 0; camera.current.pitch += event.key === 'ArrowUp' ? -.1 : event.key === 'ArrowDown' ? .1 : 0; redraw(value => value + 1); } }} />
    <div className="taxonomy-map-legend">{nodes.filter(node => node.level === 'brand').map((node, index) => <button key={node.id} aria-pressed={selectedId === node.id} onClick={() => onSelect(node.id)}><i style={{ background: graphPalette[index % graphPalette.length] }} />{node.label}</button>)}</div>
    <p>{t('拖动旋转 · 滚轮或按钮缩放 · 点击节点查看关联与原文 · 流动与扩散仅为视觉效果，知识结构不变', 'Drag to rotate · Zoom · Select a node for evidence · Flow and diffusion are visual only; knowledge structure unchanged')}</p>
  </div>;
}

import { useEffect, useRef, useState } from 'react';
import type { TaxonomyNode } from './knowledge-taxonomy-data';

import { graphPositions, palette } from './taxonomy-graph-layout';

export default function TaxonomyGraphCanvas({ nodes, selectedId, onSelect, lang }: { nodes: TaxonomyNode[]; selectedId: string; onSelect: (id: string) => void; lang: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [branchOnly, setBranchOnly] = useState(false);
  const [revision, redraw] = useState(0);
  const camera = useRef({ yaw: -.13, pitch: -.08, zoom: 1 });
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const hits = useRef<{ id: string; x: number; y: number; radius: number }[]>([]);
  const t = (zh: string, en: string) => lang === 'zh' ? zh : en;
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
    const positions = graphPositions(nodes);
    const byId = new Map(nodes.map(node => [node.id, node]));
    const ancestors = new Set<string>();
    let current = byId.get(selectedId);
    while (current) { ancestors.add(current.id); current = current.parent ? byId.get(current.parent) : undefined; }
    const descendants = new Set<string>(selectedId ? [selectedId] : []);
    nodes.forEach(node => { if (node.parent && descendants.has(node.parent)) descendants.add(node.id); });
    const related = new Set([...ancestors, ...descendants]);
    const shown = branchOnly && selectedId ? nodes.filter(node => related.has(node.id)) : nodes;
    const draw = () => {
      const { width, height } = element.getBoundingClientRect();
      if (!width || !height) return;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      element.width = width * dpr; element.height = height * dpr;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      const projected = new Map<string, { x: number; y: number; scale: number }>();
      const focus = branchOnly && selectedId ? positions.get(selectedId) : undefined;
      const extent = branchOnly && shown.length ? Math.max(.7, ...shown.map(node => Math.abs(positions.get(node.id)!.x - (focus?.x ?? 0)))) : 2.9;
      const scale = Math.min(width / (extent * 2 + 1), height / 4.7) * camera.current.zoom;
      for (const node of shown) {
        const point = positions.get(node.id)!;
        const x = point.x - (focus?.x ?? 0);
        const rx = x * Math.cos(camera.current.yaw) + point.z * Math.sin(camera.current.yaw);
        const rz = -x * Math.sin(camera.current.yaw) + point.z * Math.cos(camera.current.yaw);
        const ry = point.y * Math.cos(camera.current.pitch) - rz * Math.sin(camera.current.pitch);
        const perspective = 6 / (6 + rz * Math.cos(camera.current.pitch) + point.y * Math.sin(camera.current.pitch));
        projected.set(node.id, { x: width / 2 + rx * scale * perspective, y: height / 2 - ry * scale * perspective, scale: perspective });
      }
      shown.forEach(node => {
        const point = projected.get(node.id)!;
        const parent = node.parent && projected.get(node.parent);
        if (!parent) return;
        const highlighted = ancestors.has(node.id) || node.parent === selectedId;
        context.strokeStyle = highlighted ? '#e2f0ffb0' : selectedId ? '#8da7c217' : '#8da7c230';
        context.lineWidth = highlighted ? 1.8 : .6;
        context.beginPath(); context.moveTo(parent.x, parent.y); context.lineTo(point.x, point.y); context.stroke();
      });
      hits.current = [];
      shown.forEach(node => {
        const point = projected.get(node.id)!;
        const active = selectedId === node.id;
        const radius = (active ? 7 : node.level === 'brand' ? 5.5 : node.level === 'model' ? 3.5 : 2.5) * point.scale;
        context.globalAlpha = selectedId && !related.has(node.id) ? .2 : .95;
        context.fillStyle = positions.get(node.id)!.color;
        context.beginPath(); context.arc(point.x, point.y, radius, 0, Math.PI * 2); context.fill();
        if (active) { context.strokeStyle = '#ffffff'; context.lineWidth = 2; context.stroke(); }
        if (active || node.level === 'brand' || branchOnly && (ancestors.has(node.id) || node.parent === selectedId)) {
          context.font = `${active ? 13 : 11}px system-ui`; context.fillStyle = '#edf3ff';
          context.fillText(node.label, point.x + radius + 5, point.y + 4);
        }
        hits.current.push({ id: node.id, x: point.x, y: point.y, radius });
      });
      context.globalAlpha = 1;
    };
    const observer = new ResizeObserver(draw); observer.observe(element); draw();
    return () => observer.disconnect();
  }, [nodes, selectedId, branchOnly, revision]);
  const zoom = (factor: number) => { camera.current.zoom = Math.min(8, Math.max(.4, camera.current.zoom * factor)); redraw(value => value + 1); };
  return <div className="taxonomy-map">
    <div className="taxonomy-map-tools"><span>{t('品牌 → 机型 → 系统 → 零件', 'Brand → Model → System → Part')}</span><button onClick={() => zoom(1.25)} aria-label={t('放大图谱', 'Zoom in')}>＋</button><button onClick={() => zoom(.8)} aria-label={t('缩小图谱', 'Zoom out')}>−</button><button onClick={() => { camera.current = { yaw: -.13, pitch: -.08, zoom: 1 }; redraw(value => value + 1); }}>{t('复位', 'Reset')}</button><button disabled={!selectedId} aria-pressed={branchOnly} onClick={() => setBranchOnly(value => !value)}>{t('仅选中分支', 'Selected branch')}</button></div>
    <canvas ref={canvas} tabIndex={0} role="img" aria-label={t('三维分类关系图，可拖动旋转、滚轮缩放；搜索或下方节点按钮提供键盘操作。', '3D taxonomy graph. Drag to rotate, scroll to zoom. Search and node buttons provide keyboard selection.')} style={{ touchAction: 'none' }}
      onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY, moved: false }; }}
      onPointerMove={event => { const pointer = drag.current; if (!pointer) return; const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y; if (Math.abs(dx) + Math.abs(dy) > 2) pointer.moved = true; camera.current.yaw += dx * .005; camera.current.pitch = Math.max(-1, Math.min(1, camera.current.pitch + dy * .005)); pointer.x = event.clientX; pointer.y = event.clientY; redraw(value => value + 1); }}
      onPointerUp={event => { const pointer = drag.current; drag.current = null; if (!pointer || pointer.moved) return; const box = event.currentTarget.getBoundingClientRect(); const x = event.clientX - box.left, y = event.clientY - box.top; const nearest = hits.current.map(point => ({ ...point, distance: Math.hypot(point.x - x, point.y - y) })).filter(point => point.distance <= point.radius + 7).sort((a, b) => a.distance - b.distance)[0]; if (nearest) onSelect(nearest.id); }}
      onPointerCancel={() => { drag.current = null; }} onWheel={event => { zoom(event.deltaY < 0 ? 1.08 : .92); }}
      onKeyDown={event => { if (event.key === '+' || event.key === '=') zoom(1.2); else if (event.key === '-') zoom(.8); else if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) { event.preventDefault(); camera.current.yaw += event.key === 'ArrowLeft' ? -.1 : event.key === 'ArrowRight' ? .1 : 0; camera.current.pitch += event.key === 'ArrowUp' ? -.1 : event.key === 'ArrowDown' ? .1 : 0; redraw(value => value + 1); } }} />
    <div className="taxonomy-map-legend">{nodes.filter(node => node.level === 'brand').map((node, index) => <button key={node.id} aria-pressed={selectedId === node.id} onClick={() => onSelect(node.id)}><i style={{ background: palette[index % palette.length] }} />{node.label}</button>)}</div>
    <p>{t('拖动旋转 · 滚轮或按钮缩放 · 点击节点查看关联与原文 · 高度表示分类层级，非维修步骤', 'Drag to rotate · Zoom · Select a node for evidence · Height indicates classification, not repair sequence')}</p>
  </div>;
}

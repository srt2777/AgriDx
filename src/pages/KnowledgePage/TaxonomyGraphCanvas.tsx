import { createPortal } from 'react-dom';
import { sage, sageDark } from '@radix-ui/colors';
import { useUiCopy } from '@/ui/useUiCopy';
import { useUiVersion } from '@/hooks/useUiVersion';
import { useTheme } from '@/hooks/useTheme';
import { classicGraphPalette } from '@/ui/graph-palette';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import type { TaxonomyNode } from './knowledge-taxonomy-data';
import { createGraphFlowLoop } from './graph-flow-loop';
import { graphPositions, palette, fluidPosition, diffusionParticle } from './taxonomy-graph-layout';
import { createGraphCamera, zoomGraph, fitGraph, cameraMoving, stepGraphCamera, graphNeighborhood, relationCoordinates, graphNodeScale, graphLabelScale } from './graph-interaction';

type ScreenPoint = { x: number; y: number; scale: number; depth: number };
type Pointer = { x: number; y: number };

export default function TaxonomyGraphCanvas({ nodes, selectedId, onSelect, lang }: { nodes: TaxonomyNode[]; selectedId: string; onSelect: (id: string) => void; lang: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const [flowing, setFlowing] = useState(true);
  const [overviewFor, setOverviewFor] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [zoomPercent, setZoomPercent] = useState(100);
  const reduced = !!useReducedMotion();
  const { t } = useUiCopy(lang);
  const classic = useUiVersion() === 'old';
  const theme = useTheme();
  const colors = classic ? classicGraphPalette : palette;
  const neutral = theme === 'dark' ? sageDark : sage;
  const focusMode = !!selectedId && overviewFor !== selectedId;
  const neighborhood = useMemo(() => graphNeighborhood(nodes, selectedId, 10), [nodes, selectedId]);
  const camera = useRef(createGraphCamera());
  const clock = useRef(0);
  const wake = useRef<() => void>(() => {});
  const screenPositions = useRef(new Map<string, ScreenPoint>());
  const hits = useRef<{ id: string; x: number; y: number; radius: number; halfWidth?: number; halfHeight?: number }[]>([]);
  const pointers = useRef(new Map<number, Pointer>());
  const gesture = useRef({ startX: 0, startY: 0, lastX: 0, lastY: 0, lastTime: 0, moved: false, pinched: false, pinchDistance: 0, pan: false, vx: 0, vy: 0 });
  const reportZoom = useRef(0);

  const zoom = (factor: number, anchor?: Pointer) => { zoomGraph(camera.current, factor, anchor); setZoomPercent(Math.round(camera.current.targetZoom * 100)); wake.current(); };
  const reset = () => { fitGraph(camera.current); setZoomPercent(100); wake.current(); };
  useEffect(() => { fitGraph(camera.current); setZoomPercent(100); wake.current(); }, [selectedId, focusMode]);
  useEffect(() => {
    if (!expanded) return;
    const previous = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = 'hidden';
    canvas.current?.focus({ preventScroll: true });
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false);
      if (event.key !== 'Tab') return;
      const controls = [...(container.current?.querySelectorAll<HTMLElement>('button:not(:disabled),canvas[tabindex],a[href]') ?? [])];
      const first = controls[0], last = controls.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && (document.activeElement === first || !container.current?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !container.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', escape);
    return () => { document.body.style.overflow = previous; document.removeEventListener('keydown', escape); previousFocus?.focus({ preventScroll: true }); };
  }, [expanded]);

  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (!element || !context) return;
    const positions = graphPositions(nodes, colors);
    const pathIds = new Set([...neighborhood.ancestors.map(node => node.id), selectedId]);
    const directIds = new Set(neighborhood.children.map(node => node.id));
    const related = new Set([...pathIds, ...directIds]);
    const shown = focusMode ? neighborhood.shown : nodes;
    let visible = true, layoutMoving = true;
    const hitNode = (x: number, y: number) => [...hits.current].reverse().filter(point => point.halfWidth ? Math.abs(point.x - x) <= point.halfWidth && Math.abs(point.y - y) <= point.halfHeight! : Math.hypot(point.x - x, point.y - y) <= point.radius + 6).sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0];
    const draw = (delta = 1 / 30) => {
      stepGraphCamera(camera.current, delta, reduced);
      const { width, height } = element.getBoundingClientRect();
      if (!width || !height) return;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const pixelWidth = Math.round(width * dpr), pixelHeight = Math.round(height * dpr);
      if (element.width !== pixelWidth || element.height !== pixelHeight) { element.width = pixelWidth; element.height = pixelHeight; }
      context.setTransform(dpr, 0, 0, dpr, 0, 0); context.clearRect(0, 0, width, height);
      const view = camera.current, time = clock.current;
      const scale = Math.min(width / 6.8, height / 7.1) * view.zoom;
      const yaw = view.yaw + Math.sin(time * .065) * .24, pitch = view.pitch + Math.sin(time * .09) * .1;
      const project = (point: { x: number; y: number; z: number }): ScreenPoint => {
        const rx = point.x * Math.cos(yaw) + point.z * Math.sin(yaw);
        const rz = -point.x * Math.sin(yaw) + point.z * Math.cos(yaw);
        const ry = point.y * Math.cos(pitch) - rz * Math.sin(pitch);
        const depth = rz * Math.cos(pitch) + point.y * Math.sin(pitch), perspective = 7 / Math.max(2, 7 + depth);
        return { x: width / 2 + rx * scale * perspective + view.panX, y: height / 2 - ry * scale * perspective + view.panY, scale: perspective, depth };
      };
      if (focusMode) {
        context.fillStyle = classic ? neutral.sage11 : '#b5d9f3'; context.font = '12px system-ui';
        if (width >= 600) { context.fillText(t('上级路径', 'Parent path'), width * .18 - 24, 24); context.fillText(t('选中节点', 'Selected node'), width * .5 - 24, 24); context.fillText(t('直接下级', 'Direct children'), width * .82 - 24, 24); }
        else context.fillText(t('上级 → 当前节点 → 直接下级', 'Parents → Selected → Children'), 16, 16);
      }
      const desired = new Map<string, ScreenPoint>();
      if (focusMode && neighborhood.selected) {
        const layout = relationCoordinates(neighborhood.ancestors, neighborhood.selected, neighborhood.visibleChildren, width, height);
        layout.forEach((point, id) => desired.set(id, { x: width / 2 + (point.x - width / 2) * view.zoom + view.panX, y: height / 2 + (point.y - height / 2) * view.zoom + view.panY, scale: Math.min(view.zoom, 2.5), depth: 0 }));
      } else {
        const aura = context.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.max(1, scale * 3.3));
        aura.addColorStop(0, classic ? '#3a947b09' : '#5b8dce18'); aura.addColorStop(1, '#00000000');
        context.fillStyle = aura; context.fillRect(0, 0, width, height);
        context.fillStyle = classic ? neutral.sage11 : '#b5d6f4';
        for (let index = 0; index < (width < 600 ? 140 : 380); index++) {
          const particle = diffusionParticle(index, time), point = project(particle);
          context.globalAlpha = particle.alpha * (selectedId ? .1 : 1);
          context.beginPath(); context.arc(point.x, point.y, particle.size * point.scale, 0, Math.PI * 2); context.fill();
        }
        context.globalAlpha = 1;
        shown.forEach(node => { const base = positions.get(node.id)!; desired.set(node.id, project(reduced ? base : fluidPosition(base, time))); });
      }
      const blend = reduced ? 1 : 1 - Math.exp(-Math.max(delta, .001) * 18);
      layoutMoving = false;
      const projected = new Map<string, ScreenPoint>();
      desired.forEach((target, id) => {
        const previous = screenPositions.current.get(id) ?? target;
        const point = { x: previous.x + (target.x - previous.x) * blend, y: previous.y + (target.y - previous.y) * blend, scale: target.scale, depth: target.depth };
        if (Math.abs(point.x - target.x) + Math.abs(point.y - target.y) > .2) layoutMoving = true;
        projected.set(id, point);
      });
      screenPositions.current = projected;
      shown.forEach(node => {
        const point = projected.get(node.id)!, parent = node.parent && projected.get(node.parent);
        if (!parent) return;
        const highlighted = focusMode || pathIds.has(node.id) || node.parent === selectedId;
        context.globalAlpha = highlighted ? .95 : selectedId ? .018 : .16;
        context.strokeStyle = highlighted ? (classic ? '#20865e' : '#9edbff') : (classic ? neutral.sage6 : '#8da7c2');
        context.lineWidth = highlighted ? 2.3 : .45;
        const middle = (parent.x + point.x) / 2;
        context.beginPath(); context.moveTo(parent.x, parent.y);
        if (focusMode) context.bezierCurveTo(middle, parent.y, middle, point.y, point.x, point.y); else context.lineTo(point.x, point.y);
        context.stroke();
        if (focusMode) {
          const angle = Math.atan2(point.y - parent.y, point.x - parent.x), cx = parent.x + (point.x - parent.x) * .53, cy = parent.y + (point.y - parent.y) * .53;
          context.fillStyle = context.strokeStyle; context.beginPath(); context.moveTo(cx + Math.cos(angle) * 7, cy + Math.sin(angle) * 7); context.lineTo(cx + Math.cos(angle + 2.5) * 6, cy + Math.sin(angle + 2.5) * 6); context.lineTo(cx + Math.cos(angle - 2.5) * 6, cy + Math.sin(angle - 2.5) * 6); context.fill();
        }
      });
      context.globalAlpha = 1; hits.current = [];
      const ordered = [...shown].sort((a, b) => Number(related.has(a.id)) - Number(related.has(b.id)) || projected.get(b.id)!.depth - projected.get(a.id)!.depth);
      ordered.forEach(node => {
        const point = projected.get(node.id)!, active = selectedId === node.id, relevant = related.has(node.id);
        const radius = (active ? 8 : relevant && selectedId ? 5 : node.level === 'brand' ? 3.5 : 1.2) * point.scale * (focusMode ? 1 : graphNodeScale(view.zoom));
        context.globalAlpha = focusMode || relevant ? 1 : selectedId ? .045 : Math.max(.3, Math.min(1, .75 - point.depth * .17));
        const color = positions.get(node.id)!.color;
        if (focusMode) {
          const labelScale = graphLabelScale(view.zoom);
          const fontSize = (width < 600 ? 11 : 13) * labelScale;
          context.font = `${active ? '600' : '400'} ${fontSize}px system-ui`;
          const maxWidth = Math.min(width < 600 ? width * .42 : width * .24, 210) * labelScale;
          let label = node.label;
          while (label.length > 2 && context.measureText(label).width > maxWidth - 24 * labelScale) label = label.slice(0, -2) + '…';
          const cardWidth = Math.max(62 * labelScale, Math.min(maxWidth, context.measureText(label).width + 26 * labelScale)), cardHeight = (active ? 42 : 32) * labelScale;
          context.fillStyle = classic ? (active ? '#d6efdd' : theme === 'dark' ? '#1e302b' : '#ffffff') : active ? '#244d67' : '#162738';
          context.strokeStyle = active ? (classic ? '#16834b' : '#b1e5ff') : color; context.lineWidth = active ? 2.5 : 1.1;
          context.beginPath(); context.roundRect(point.x - cardWidth / 2, point.y - cardHeight / 2, cardWidth, cardHeight, 7); context.fill(); context.stroke();
          context.fillStyle = classic ? (theme === 'dark' && !active ? '#e5f2ed' : '#153f2c') : '#f0f8ff'; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(label, point.x, point.y); context.textAlign = 'start'; context.textBaseline = 'alphabetic';
          hits.current.push({ id: node.id, x: point.x, y: point.y, radius, halfWidth: cardWidth / 2, halfHeight: cardHeight / 2 });
        } else {
          context.fillStyle = color; context.shadowBlur = active ? 14 : 0; context.shadowColor = color;
          context.beginPath(); context.arc(point.x, point.y, radius, 0, Math.PI * 2); context.fill(); context.shadowBlur = 0;
          if (active) { context.strokeStyle = classic ? '#146e42' : '#ffffff'; context.lineWidth = 2; context.stroke(); }
          if (active || selectedId && relevant || !selectedId && node.level === 'brand') {
            context.font = `${active ? '600 ' : ''}${(active ? 14 : 12) * Math.min(1.8, graphNodeScale(view.zoom))}px system-ui`; context.fillStyle = classic ? neutral.sage12 : '#edf3ff';
            context.fillText(node.label, point.x + radius + 6, point.y + 4);
          }
          if (!selectedId || relevant) hits.current.push({ id: node.id, x: point.x, y: point.y, radius });
        }
      });
      context.globalAlpha = 1;
      if (performance.now() - reportZoom.current > 120) { reportZoom.current = performance.now(); setZoomPercent(Math.round(view.zoom * 100)); }
    };
    const loop = createGraphFlowLoop({
      active: () => visible && !document.hidden && (cameraMoving(camera.current) || layoutMoving || flowing && !reduced && !selectedId),
      render: delta => { if (!pointers.current.size && flowing && !reduced && !selectedId) clock.current += delta; draw(delta); },
      request: callback => requestAnimationFrame(callback), cancel: id => cancelAnimationFrame(id),
    });
    wake.current = () => { if (reduced) draw(); loop.start(); };
    const observer = new ResizeObserver(() => { layoutMoving = true; draw(); loop.start(); }); observer.observe(element);
    const intersection = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? false; if (visible) loop.start(); else loop.stop(); }); intersection.observe(element);
    const visibility = () => { if (document.hidden) loop.stop(); else loop.start(); };
    const wheel = (event: WheelEvent) => {
      event.preventDefault(); const rect = element.getBoundingClientRect();
      zoomGraph(camera.current, Math.exp(-Math.max(-180, Math.min(180, event.deltaY * (event.deltaMode === 1 ? 16 : 1))) * .0025), { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 });
      loop.start();
    };
    const hover = (event: PointerEvent) => { if (pointers.current.size) return; const rect = element.getBoundingClientRect(); element.style.cursor = hitNode(event.clientX - rect.left, event.clientY - rect.top) ? 'pointer' : 'grab'; };
    element.addEventListener('wheel', wheel, { passive: false }); element.addEventListener('pointermove', hover);
    document.addEventListener('visibilitychange', visibility); draw(); loop.start();
    return () => { wake.current = () => {}; loop.stop(); observer.disconnect(); intersection.disconnect(); document.removeEventListener('visibilitychange', visibility); element.removeEventListener('wheel', wheel); element.removeEventListener('pointermove', hover); };
  }, [nodes, selectedId, focusMode, neighborhood, classic, colors, neutral, theme, flowing, reduced, expanded, t]);

  const pointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    camera.current.velocityYaw = 0; camera.current.velocityPitch = 0;
    camera.current.targetYaw = camera.current.yaw; camera.current.targetPitch = camera.current.pitch;
    const points = [...pointers.current.values()];
    if (points.length === 2) { gesture.current.pinched = true; gesture.current.moved = true; gesture.current.pinchDistance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y); }
    else gesture.current = { startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY, lastTime: event.timeStamp, moved: false, pinched: false, pinchDistance: 0, pan: focusMode || event.shiftKey || event.button === 2, vx: 0, vy: 0 };
  };
  const pointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const g = gesture.current, points = [...pointers.current.values()];
    if (points.length === 2) {
      const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y), rect = event.currentTarget.getBoundingClientRect();
      if (g.pinchDistance > 0) zoom(distance / g.pinchDistance, { x: (points[0].x + points[1].x) / 2 - rect.left - rect.width / 2, y: (points[0].y + points[1].y) / 2 - rect.top - rect.height / 2 });
      g.pinchDistance = distance; g.moved = true; return;
    }
    if (g.pinched) return;
    const dx = event.clientX - g.lastX, dy = event.clientY - g.lastY, dt = Math.max(.008, (event.timeStamp - g.lastTime) / 1000);
    if (Math.hypot(event.clientX - g.startX, event.clientY - g.startY) > 4) g.moved = true;
    if (g.pan) { camera.current.targetPanX += dx; camera.current.targetPanY += dy; }
    else { camera.current.targetYaw += dx * .005; camera.current.targetPitch = Math.max(-1.2, Math.min(1.2, camera.current.targetPitch + dy * .005)); g.vx = Math.max(-2, Math.min(2, dx * .005 / dt)); g.vy = Math.max(-2, Math.min(2, dy * .005 / dt)); }
    g.lastX = event.clientX; g.lastY = event.clientY; g.lastTime = event.timeStamp; wake.current();
  };
  const pointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    pointers.current.delete(event.pointerId);
    const g = gesture.current;
    if (g.moved || g.pinched) { if (!pointers.current.size && !g.pan && !g.pinched && !reduced) { camera.current.velocityYaw = g.vx * .32; camera.current.velocityPitch = g.vy * .32; wake.current(); } return; }
    const rect = event.currentTarget.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
    const found = [...hits.current].reverse().filter(point => point.halfWidth ? Math.abs(point.x - x) <= point.halfWidth && Math.abs(point.y - y) <= point.halfHeight! : Math.hypot(point.x - x, point.y - y) <= point.radius + 6).sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0];
    if (found) onSelect(found.id);
  };
  const graphic = <div ref={container} role={expanded ? 'dialog' : undefined} aria-modal={expanded || undefined} aria-label={expanded ? t('放大的知识图谱画布', 'Expanded knowledge graph') : undefined} className={`taxonomy-map ${expanded ? 'taxonomy-map-expanded' : ''}`} data-classic={classic ? 'true' : 'false'} style={classic ? { background: neutral.sage2, color: neutral.sage12 } : undefined}>
    <div className="taxonomy-map-tools"><span>{t('品牌 → 机型 → 系统 → 零件', 'Brand → Model → System → Part')}</span>
      <div className="graph-zoom-controls" role="group" aria-label={t('图谱缩放', 'Graph zoom')}><button onClick={() => zoom(1.4)} aria-label={t('放大图谱', 'Zoom in')}>＋ {t('放大', 'Zoom in')}</button><output aria-label={t('当前缩放比例', 'Current zoom')}>{zoomPercent}%</output><button onClick={() => zoom(1 / 1.4)} aria-label={t('缩小图谱', 'Zoom out')}>− {t('缩小', 'Zoom out')}</button></div>
      <button onClick={reset}>{t('适应画布', 'Fit view')}</button><button aria-pressed={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? t('收起画布', 'Collapse canvas') : t('放大画布', 'Expand canvas')}</button>
      {selectedId && <><button aria-pressed={focusMode} onClick={() => { setOverviewFor(null); reset(); }}>{t('关系聚焦', 'Focus relations')}</button><button aria-pressed={!focusMode} onClick={() => { setOverviewFor(selectedId); reset(); }}>{t('全图上下文', 'Full context')}</button><button onClick={() => onSelect('')}>{t('清除选择', 'Clear selection')}</button></>}
      {!selectedId && <button aria-pressed={flowing && !reduced} disabled={reduced} onClick={() => setFlowing(value => !value)}>{reduced ? t('减少动态已启用', 'Reduced motion') : flowing ? t('暂停流动', 'Pause flow') : t('继续流动', 'Resume flow')}</button>}
    </div>
    <div className="graph-focus-layout"><canvas ref={canvas} tabIndex={0} role="img" aria-label={t('知识图谱：滚轮或双指缩放，双击放大；选中节点自动展开上下级关系。', 'Knowledge graph: wheel or pinch to zoom, double-click to enlarge; selection reveals parent and child relations.')} style={{ touchAction: 'none' }}
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={event => { pointers.current.delete(event.pointerId); }} onContextMenu={event => event.preventDefault()}
      onDoubleClick={event => { const rect = event.currentTarget.getBoundingClientRect(); zoom(1.8, { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 }); }}
      onKeyDown={event => { if (['+','=','-','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','Escape'].includes(event.key)) event.preventDefault(); if (event.key === '+' || event.key === '=') zoom(1.4); else if (event.key === '-') zoom(1 / 1.4); else if (event.key === 'Home') reset(); else if (event.key === 'Escape') { if (expanded) setExpanded(false); else onSelect(''); } else if (event.key.startsWith('Arrow')) { if (focusMode) { camera.current.targetPanX += event.key === 'ArrowLeft' ? -24 : event.key === 'ArrowRight' ? 24 : 0; camera.current.targetPanY += event.key === 'ArrowUp' ? -24 : event.key === 'ArrowDown' ? 24 : 0; } else { camera.current.targetYaw += event.key === 'ArrowLeft' ? -.15 : event.key === 'ArrowRight' ? .15 : 0; camera.current.targetPitch = Math.max(-1.2, Math.min(1.2, camera.current.targetPitch + (event.key === 'ArrowUp' ? -.15 : event.key === 'ArrowDown' ? .15 : 0))); } wake.current(); } }} />
    {neighborhood.selected && <aside className="graph-relations-panel" aria-label={t('选中节点的联系', 'Selected node relations')}><h3>{neighborhood.selected.label}</h3><p>{t('连线表示目录归属', 'Edges show catalog membership')}</p><h4>{t('上级路径', 'Parent path')}</h4>{neighborhood.ancestors.map(node => <button key={node.id} onClick={() => onSelect(node.id)}>{node.label}<span> →</span></button>)}{!neighborhood.ancestors.length && <p>{t('当前为品牌层级', 'Brand level')}</p>}<h4>{t(`直接下级（${neighborhood.children.length}）`, `Direct children (${neighborhood.children.length})`)}</h4>{neighborhood.children.map(node => <button key={node.id} onClick={() => onSelect(node.id)}>{node.label}<small>{node.count ? `${node.count} ${t('条资料', 'entries')}` : t('资料缺口', 'Evidence gap')}</small></button>)}{!neighborhood.children.length && <p>{t('无已归档下级，查看当前节点证据。', 'No archived children; review this node’s evidence.')}</p>}{neighborhood.children.length > neighborhood.visibleChildren.length && <p>{t(`画布显示前${neighborhood.visibleChildren.length}项，完整下级见此列表。`, `Canvas shows the first ${neighborhood.visibleChildren.length}; this list includes all children.`)}</p>}<button className="graph-evidence-jump" onClick={() => { setExpanded(false); requestAnimationFrame(() => document.getElementById('taxonomy-evidence-heading')?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })); }}>{t('查看此节点原始证据 ↓', 'View source evidence ↓')}</button></aside>}
    </div>
    {!selectedId && <div className="taxonomy-map-legend">{nodes.filter(node => node.level === 'brand').map((node, index) => <button key={node.id} onClick={() => onSelect(node.id)}><i style={{ background: colors[index % colors.length] }} />{node.label}</button>)}</div>}
    <p>{focusMode ? t('选中节点已展开直接联系 · 拖动平移 · 滚轮/双指缩放 · 点击标签继续追踪', 'Direct relations expanded · Drag to pan · Wheel/pinch to zoom · Select a label to follow') : t('拖动旋转 · Shift拖动平移 · 滚轮/双指缩放 · 双击放大 · 点击节点展开联系', 'Drag to rotate · Shift-drag to pan · Wheel/pinch to zoom · Double-click to enlarge · Select a node for relations')}</p>
  </div>;
  return expanded ? createPortal(graphic, document.body) : graphic;
}

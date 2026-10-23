import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useReducedMotion } from 'framer-motion';
import { ArrowUpRight, Minus, Pause, Play, Plus, RotateCcw, X } from 'lucide-react';
import type { KnowledgeCatalog } from '@shared/knowledge-catalog';
import { sphereNodes, sphereLevel, type SphereNode } from './knowledge-sphere-data';
import './knowledge-sphere.css';
import { useKnowledgeCatalog } from '@/hooks/useKnowledgeCatalog';
import EvidenceEntry from './EvidenceEntry';
import type { KnowledgeGalaxyRenderer, GalaxyOrb } from './KnowledgeGalaxyRenderer';

const colors = { root: '#9ddbcf', brand: '#e7c47d', model: '#76cbbb', component: '#8daff0', part: '#d9a4db' };
export default function KnowledgeSphere({ catalog, lang }: { catalog: KnowledgeCatalog; lang: string }) {
  const t = (zh: string, en: string) => (lang === 'zh' ? zh : en);
  const reduced = !!useReducedMotion();
  const allNodes = useMemo(() => sphereNodes(catalog), [catalog]);
  const childrenByParent = useMemo(() => {
    const groups = new Map<string, SphereNode[]>();
    for (const node of allNodes) {
      const parent = node.parent ?? 'universe';
      const children = groups.get(parent) ?? [];
      children.push(node);
      groups.set(parent, children);
    }
    return groups;
  }, [allNodes]);
  const [selected, setSelected] = useState<SphereNode | null>(null);
  const [running, setRunning] = useState(true);
  const [field, setField] = useState<'repel' | 'attract'>('repel');
  const [search, setSearch] = useState('');
  const rootNode = useMemo<SphereNode>(
    () => ({
      id: 'universe',
      label: lang === 'zh' ? '农机知识星系' : 'Knowledge galaxy',
      kind: 'root',
      count: catalog.totals.archivedEntries,
      query: {},
      position: [0, 0, 0],
    }),
    [catalog, lang],
  );
  const [regionId, setRegionId] = useState('universe');
  const [expanded, setExpanded] = useState(false);
  const region = allNodes.find((node) => node.id === regionId) ?? rootNode;
  const nodes = useMemo(() => sphereLevel(allNodes, region, expanded), [allNodes, region, expanded]);
  const trail: SphereNode[] = [];
  let ancestor: SphereNode | undefined = region;
  while (ancestor && ancestor.kind !== 'root') {
    trail.unshift(ancestor);
    ancestor = allNodes.find((node) => node.id === ancestor?.parent);
  }
  trail.unshift(rootNode);
  const detailQuery = selected?.query.model ? new URLSearchParams(selected.query).toString() : 'collection=all';
  const details = useKnowledgeCatalog(detailQuery);
  const selectedBrand = catalog.brands.find((brand) => brand.id === selected?.query.brand);
  const selectedModel = selectedBrand?.models.find((model) => model.id === selected?.query.model);
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const reveal = useRef(0);
  const galaxyRef = useRef<KnowledgeGalaxyRenderer | null>(null);
  const lastInteraction = useRef(0);
  const noteInteraction = () => {
    lastInteraction.current = performance.now();
  };
  const camera = useRef({ yaw: 0.2, pitch: -0.15, zoom: 1, targetZoom: 1, vx: 0, vy: 0 });
  const pointer = useRef({
    x: -10000,
    y: -10000,
    down: false,
    dragged: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
  });
  const enter = (node: SphereNode) => {
    const hasChildren = node.kind === 'root' || !!childrenByParent.get(node.id)?.length;
    setSelected(node.kind === 'root' ? null : node);
    if (hasChildren) {
      reveal.current = 0;
      setRegionId(node.id);
      setExpanded(true);
      camera.current.targetZoom = 1;
    } else {
      if (node.parent) {
        setRegionId(node.parent);
        setExpanded(true);
      }
      camera.current.targetZoom = 1.35;
    }
    camera.current.vx = 0;
    camera.current.vy = 0;
  };
  const reset = () => {
    setSelected(null);
    setRegionId('universe');
    setExpanded(false);
    Object.assign(camera.current, { targetZoom: 1, vx: 0, vy: 0 });
  };
  const zoom = useCallback(
    (delta: number) => {
      const c = camera.current;
      const next = Math.max(0.5, Math.min(2, c.targetZoom + delta));
      if (!expanded && next > 1.25) {
        reveal.current = 0;
        setExpanded(true);
        c.targetZoom = 1;
      } else if (expanded && next < 0.65) {
        const parent = allNodes.find((node) => node.id === region.parent) ?? rootNode;
        reveal.current = 0;
        setRegionId(parent.id);
        setSelected(null);
        setExpanded(region.kind !== 'root');
        c.targetZoom = 1;
      } else c.targetZoom = next;
    },
    [expanded, allNodes, region, rootNode],
  );
  useEffect(() => {
    const host = stage.current,
      surface = canvas.current;
    if (!host || !surface) return;
    let disposed = false;
    host.dataset.renderer = 'canvas';
    const fallback = () => {
      galaxyRef.current?.dispose();
      galaxyRef.current = null;
      if (!disposed) {
        surface.style.opacity = '1';
        host.dataset.renderer = 'canvas';
      }
    };
    void import('./KnowledgeGalaxyRenderer')
      .then(({ KnowledgeGalaxyRenderer: Renderer }) => {
        if (disposed) return;
        try {
          galaxyRef.current = new Renderer(host, fallback);
          surface.style.opacity = '0';
          host.dataset.renderer = 'webgl';
        } catch {
          fallback();
        }
      })
      .catch(fallback);
    return () => {
      disposed = true;
      galaxyRef.current?.dispose();
      galaxyRef.current = null;
    };
  }, []);
  useEffect(() => {
    const host = stage.current;
    const surface = canvas.current;
    if (!host || !surface) return;
    const ctx = surface.getContext('2d');
    if (!ctx) return;
    let width = 1,
      height = 1,
      frame = 0,
      last = 0;
    const observer = new ResizeObserver(() => {
      width = host.clientWidth;
      height = host.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      surface.width = width * dpr;
      surface.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    });
    observer.observe(host);
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      zoom(Math.max(-0.3, Math.min(0.3, -event.deltaY * 0.002)));
    };
    host.addEventListener('wheel', wheel, { passive: false });
    const draw = (time: number) => {
      const galaxy = galaxyRef.current;
      const step = Math.min((time - last) / 16.67 || 1, 3);
      last = time;
      const c = camera.current,
        p = pointer.current;
      const idle = running && !reduced && !p.down && time - lastInteraction.current > 4000;
      const drift = idle ? Math.sin(time * 0.00012) * 0.12 : 0;
      if (selected && selected.id !== region.id && !p.down) {
        const [x, y, z] = nodes.find((node) => node.id === selected.id)?.position ?? selected.position;
        const yaw = -Math.atan2(x, z) + drift,
          pitch = Math.atan2(y, Math.hypot(x, z)) + drift * 0.35;
        c.yaw += Math.atan2(Math.sin(yaw - c.yaw), Math.cos(yaw - c.yaw)) * (reduced ? 1 : 0.075 * step);
        c.pitch += (pitch - c.pitch) * (reduced ? 1 : 0.075 * step);
      } else if (!p.down) {
        c.yaw += c.vx * step + (idle ? 0.0022 * step : 0);
        c.pitch = Math.max(-1.4, Math.min(1.4, c.pitch + c.vy * step));
        if (idle) c.pitch += (Math.sin(time * 0.00017) * 0.24 - c.pitch) * 0.003 * step;
        c.vx *= Math.pow(0.93, step);
        c.vy *= Math.pow(0.93, step);
      }
      c.zoom += (c.targetZoom * (idle ? 1 + Math.sin(time * 0.0002) * 0.035 : 1) - c.zoom) * (reduced ? 1 : 0.1 * step);
      reveal.current += ((expanded ? 1 : 0) - reveal.current) * (reduced ? 1 : 0.075 * step);
      const radius = Math.min(width * 0.3, height * 0.31) * c.zoom * reveal.current;
      const projected = nodes.map((node) => {
        const [x, y, z] = node.position;
        const a = x * Math.cos(c.yaw) + z * Math.sin(c.yaw);
        const b = z * Math.cos(c.yaw) - x * Math.sin(c.yaw);
        const yy = y * Math.cos(c.pitch) - b * Math.sin(c.pitch);
        const zz = y * Math.sin(c.pitch) + b * Math.cos(c.pitch);
        const scale = 2.8 / (2.8 - zz);
        let px = width / 2 + a * radius * scale,
          py = height / 2 + yy * radius * scale;
        const dx = px - p.x,
          dy = py - p.y,
          distance = Math.hypot(dx, dy);
        if (!reduced && !p.down && distance > 1 && distance < 130) {
          // Keep the clickable centre stable; outer nodes respond to the cursor field.
          const force = Math.sin((Math.PI * distance) / 130) * 19 * (field === 'repel' ? 1 : -1);
          px += (dx / distance) * force;
          py += (dy / distance) * force;
        }
        return { node, x: px, y: py, z: zz, scale };
      });
      const map = new Map(projected.map((item) => [item.node.id, item]));
      ctx.clearRect(0, 0, width, height);
      if (!galaxy) {
        // A parallax star field gives even an untouched scene a visible depth cue.
        const nebula = ctx.createRadialGradient(width * 0.35, height * 0.38, 0, width * 0.5, height * 0.5, width * 0.6);
        nebula.addColorStop(0, '#15595a55');
        nebula.addColorStop(0.5, '#172b5150');
        nebula.addColorStop(1, '#02081300');
        ctx.fillStyle = nebula;
        ctx.fillRect(0, 0, width, height);
        for (let index = 0; index < 135; index++) {
          const depth = 0.25 + (index % 7) / 7;
          const sx = (((index * 137.508 + Math.sin(c.yaw) * 34 * depth) % width) + width) % width;
          const sy = (((index * 79.71 + c.pitch * 38 * depth) % height) + height) % height;
          const twinkle = reduced ? 0.55 : 0.45 + Math.sin(time * 0.0007 + index) * 0.2;
          ctx.fillStyle = `rgba(185,221,243,${twinkle * depth})`;
          ctx.beginPath();
          ctx.arc(sx, sy, index % 11 === 0 ? 1.5 : 0.65, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      const orbs: GalaxyOrb[] = [];
      // Each child is a small sphere containing its own next-level stars.
      for (const item of [...projected].sort((a, b) => a.z - b.z)) {
        const button = buttons.current.get(item.node.id);
        if (!button) continue;
        const centre = item.node.id === region.id;
        const ballRadius = centre
          ? (Math.min(width * 0.34, 165) * (1 - reveal.current) + 44 * reveal.current) * c.zoom
          : Math.max(
              0.1,
              (20 + Math.min(13, Math.log2(item.node.count + 1))) * Math.max(0.6, item.scale) * reveal.current,
            );
        ctx.globalAlpha = centre ? 1 : reveal.current;
        const color = colors[item.node.kind];
        orbs.push({
          id: item.node.id,
          x: item.x,
          y: item.y,
          z: item.z,
          radius: ballRadius,
          color,
          children: childrenByParent.get(item.node.id)?.length ?? 0,
          centre,
        });
        if (!galaxy) {
          // Opaque shadow hemisphere, bright key light and a soft atmospheric rim.
          const halo = ctx.createRadialGradient(item.x, item.y, ballRadius * 0.75, item.x, item.y, ballRadius * 1.65);
          halo.addColorStop(0, color + '00');
          halo.addColorStop(0.42, color + '42');
          halo.addColorStop(1, color + '00');
          ctx.globalCompositeOperation = 'screen';
          ctx.fillStyle = halo;
          ctx.beginPath();
          ctx.arc(item.x, item.y, ballRadius * 1.65, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalCompositeOperation = 'source-over';
          const glow = ctx.createRadialGradient(
            item.x - ballRadius * 0.4,
            item.y - ballRadius * 0.42,
            ballRadius * 0.04,
            item.x + ballRadius * 0.25,
            item.y + ballRadius * 0.3,
            ballRadius * 1.2,
          );
          glow.addColorStop(0, '#d6fff1');
          glow.addColorStop(0.16, color);
          glow.addColorStop(0.46, color + 'bb');
          glow.addColorStop(0.76, '#102e39');
          glow.addColorStop(1, '#020712');
          ctx.fillStyle = glow;
          ctx.strokeStyle = color + 'bb';
          ctx.lineWidth = centre ? 1.5 : 1;
          ctx.beginPath();
          ctx.arc(item.x, item.y, ballRadius, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.save();
          ctx.beginPath();
          ctx.arc(item.x, item.y, ballRadius, 0, Math.PI * 2);
          ctx.clip();
          ctx.strokeStyle = color + '28';
          ctx.lineWidth = 0.7;
          for (let band = -2; band <= 2; band++) {
            ctx.beginPath();
            ctx.ellipse(
              item.x,
              item.y + ballRadius * band * 0.28,
              ballRadius * Math.sqrt(1 - Math.pow(band * 0.28, 2)),
              ballRadius * 0.17,
              -0.25,
              0,
              Math.PI * 2,
            );
            ctx.stroke();
          }
          ctx.restore();
          ctx.save();
          ctx.translate(item.x, item.y);
          ctx.rotate(-0.35);
          ctx.strokeStyle = color + '35';
          ctx.beginPath();
          ctx.ellipse(0, 0, ballRadius * 0.96, ballRadius * 0.31, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
          const children = childrenByParent.get(item.node.id) ?? [];
          const stars = Math.min(40, children.length);
          for (let index = 0; index < stars; index++) {
            const sy = 1 - (2 * (index + 0.5)) / stars,
              rr = Math.sqrt(1 - sy * sy);
            const angle = index * 2.39996 + c.yaw;
            const sx = Math.cos(angle) * rr,
              sz = Math.sin(angle) * rr;
            const starY = sy * Math.cos(c.pitch) - sz * Math.sin(c.pitch);
            const starZ = sy * Math.sin(c.pitch) + sz * Math.cos(c.pitch);
            if (starZ < 0) continue;
            ctx.shadowColor = color;
            ctx.shadowBlur = centre ? 12 : 7;
            ctx.fillStyle = '#e2fff8';
            ctx.beginPath();
            ctx.arc(
              item.x + sx * ballRadius * 0.8,
              item.y + starY * ballRadius * 0.8,
              centre && !expanded ? 2.8 : 1.4,
              0,
              Math.PI * 2,
            );
            ctx.fill();
            ctx.shadowBlur = 0;
          }
          // Dense boundary grains drifting outward; the WebGL path runs the same idea on the GPU.
          const grains = centre ? 150 : 70;
          const drift = reduced ? 0 : time * 0.00006;
          ctx.globalCompositeOperation = 'screen';
          for (let index = 0; index < grains; index++) {
            const seed = (index * 0.6180339887) % 1;
            const travel = (seed + drift * (0.5 + (index % 9) / 9)) % 1;
            const spread = 1 + Math.pow(travel, 2.6) * (centre ? 0.9 : 0.7);
            const angle = index * 2.39996 + c.yaw * 0.6;
            const edge = Math.sin(angle) * Math.cos(c.pitch) < 0 ? 0.32 : 1;
            const alpha = Math.pow(1 - travel, 1.6) * (centre ? 0.8 : 0.52) * edge;
            if (alpha < 0.02) continue;
            ctx.fillStyle = `${color}${Math.round(Math.min(1, alpha) * 255)
              .toString(16)
              .padStart(2, '0')}`;
            ctx.beginPath();
            ctx.arc(
              item.x + Math.cos(angle) * ballRadius * spread,
              item.y + Math.sin(angle) * ballRadius * spread * 0.92,
              (centre ? 1.8 : 1.15) * (0.6 + (1 - travel) * 0.8),
              0,
              Math.PI * 2,
            );
            ctx.fill();
          }
          ctx.globalCompositeOperation = 'source-over';
          if (expanded && !centre) {
            const parent = map.get(region.id);
            if (parent) {
              ctx.strokeStyle = color + '18';
              ctx.beginPath();
              ctx.moveTo(parent.x, parent.y);
              ctx.quadraticCurveTo(item.x, parent.y, item.x, item.y);
              ctx.stroke();
            }
          }
        }
        button.style.transform = `translate(${item.x}px, ${item.y}px) translate(-50%, -50%)`;
        button.style.width = `${ballRadius * 2}px`;
        button.style.height = `${ballRadius * 2}px`;
        button.style.opacity = String(centre ? 1 : (0.65 + (item.z + 1) * 0.175) * reveal.current);
        button.style.pointerEvents = !centre && reveal.current < 0.7 ? 'none' : 'auto';
        button.style.zIndex = String(Math.round((item.z + 1) * 100));
      }
      ctx.globalAlpha = 1;
      try {
        galaxy?.render(width, height, orbs, reduced ? 0 : time, c.yaw, c.pitch, reduced);
      } catch {
        galaxyRef.current?.dispose();
        galaxyRef.current = null;
        surface.style.opacity = '1';
        host.dataset.renderer = 'canvas';
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      host.removeEventListener('wheel', wheel);
    };
  }, [nodes, selected, running, reduced, field, search, allNodes, region, expanded, zoom, childrenByParent]);
  const related = selected
    ? allNodes.filter((node) =>
        selected.kind === 'root' ? node.kind === 'brand' : node.parent === selected.id || node.id === selected.parent,
      )
    : [];
  return (
    <section
      className="knowledge-universe"
      onPointerDownCapture={noteInteraction}
      onPointerMoveCapture={noteInteraction}
      onWheelCapture={noteInteraction}
      onKeyDownCapture={noteInteraction}
      aria-label={t('球形知识图谱', 'Spherical knowledge graph')}
    >
      <div className="universe-heading">
        <div>
          <span>KNOWLEDGE ORBIT / 01</span>
          <h2>{t('让知识，彼此相连。', 'Knowledge in orbit.')}</h2>
          <p>
            {t(
              '从一颗知识球出发，靠近品牌星系，进入机型与部件的世界。',
              'Start with one sphere. Enter brand systems, then explore models and parts.',
            )}
          </p>
        </div>
        <span className="universe-count">
          {nodes.length} / {allNodes.length + 1} {t('个目录节点', 'catalog nodes')}
        </span>
      </div>
      <div className="universe-toolbar">
        <label>
          <span className="sr-only">{t('定位目录节点', 'Find a catalog node')}</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('搜索品牌、机型或组件…', 'Find brand, model or component…')}
          />
        </label>
        <button aria-pressed={field === 'attract'} onClick={() => setField(field === 'repel' ? 'attract' : 'repel')}>
          {field === 'repel' ? t('力场 · 远离', 'Field · repel') : t('力场 · 靠近', 'Field · attract')}
        </button>
        <button
          aria-label={t('空闲自动漫游', 'Idle camera roam')}
          aria-pressed={running}
          disabled={reduced}
          onClick={() => setRunning(!running)}
        >
          {running ? <Pause size={16} /> : <Play size={16} />}
          <span>{t('自动漫游', 'Auto roam')}</span>
        </button>
        <button aria-label={t('缩小', 'Zoom out')} onClick={() => zoom(-0.3)}>
          <Minus size={17} />
        </button>
        <button aria-label={t('放大', 'Zoom in')} onClick={() => zoom(0.3)}>
          <Plus size={17} />
        </button>
        <button onClick={reset}>
          <RotateCcw size={15} />
          {t('全景', 'Overview')}
        </button>
      </div>
      <nav className="universe-trail" aria-label={t('星系层级', 'System hierarchy')}>
        {trail.map((node, index) => (
          <button key={node.id} onClick={() => enter(node)}>
            {index > 0 && <span> / </span>}
            {node.label}
          </button>
        ))}
        <small>
          {expanded
            ? t('点击子球继续深入 · 缩小返回上一层', 'Enter a child sphere · zoom out to go back')
            : t('点击知识球或放大，展开品牌星系', 'Select or zoom into the sphere to reveal brands')}
        </small>
      </nav>
      <div className="universe-body">
        <div
          ref={stage}
          className="universe-stage"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setSelected(null);
            if (e.target !== e.currentTarget) return;
            const offsets: Record<string, [number, number]> = {
              ArrowLeft: [-0.12, 0],
              ArrowRight: [0.12, 0],
              ArrowUp: [0, -0.12],
              ArrowDown: [0, 0.12],
            };
            if (offsets[e.key]) {
              e.preventDefault();
              setSelected(null);
              camera.current.yaw += offsets[e.key][0];
              camera.current.pitch += offsets[e.key][1];
            }
          }}
          tabIndex={0}
          aria-label={t(
            '拖拽旋转，滚轮缩放；方向键旋转，点击节点查看详情',
            'Drag to rotate, scroll to zoom; arrow keys rotate, select a node for details',
          )}
          onPointerDown={(e) => {
            const onNode = !!(e.target as HTMLElement).closest('button');
            const gesture = pointer.current;
            gesture.dragged = false;
            gesture.startX = e.clientX;
            gesture.startY = e.clientY;
            if (!onNode) e.preventDefault();
            if (!onNode) e.currentTarget.focus({ preventScroll: true });
            const p = pointer.current;
            p.down = true;
            p.lastX = e.clientX;
            p.lastY = e.clientY;
            if (!onNode) {
              e.currentTarget.setPointerCapture(e.pointerId);
              setSelected(null);
            }
          }}
          onPointerMove={(e) => {
            const p = pointer.current,
              rect = e.currentTarget.getBoundingClientRect();
            p.x = e.clientX - rect.left;
            p.y = e.clientY - rect.top;
            if (p.down) {
              if (!p.dragged && Math.hypot(e.clientX - p.startX, e.clientY - p.startY) < 5) return;
              if (!p.dragged) {
                p.dragged = true;
                setSelected(null);
                e.currentTarget.setPointerCapture(e.pointerId);
              }
              const dx = e.clientX - p.lastX,
                dy = e.clientY - p.lastY;
              camera.current.vx = dx * 0.004;
              camera.current.vy = dy * 0.004;
              camera.current.yaw += camera.current.vx;
              camera.current.pitch = Math.max(-1.4, Math.min(1.4, camera.current.pitch + camera.current.vy));
              p.lastX = e.clientX;
              p.lastY = e.clientY;
            }
          }}
          onPointerUp={() => {
            pointer.current.down = false;
            if (reduced) {
              camera.current.vx = 0;
              camera.current.vy = 0;
            }
          }}
          onPointerCancel={() => {
            pointer.current.down = false;
          }}
          onPointerLeave={() => {
            pointer.current.x = -10000;
            pointer.current.y = -10000;
          }}
        >
          <div className="universe-orbit" aria-hidden="true" />
          <canvas ref={canvas} aria-hidden="true" />
          {nodes.map((node) => (
            <button
              key={node.id}
              ref={(el) => {
                if (el) buttons.current.set(node.id, el);
                else buttons.current.delete(node.id);
              }}
              className={`universe-node ${node.kind}`}
              style={{ color: colors[node.kind] }}
              aria-pressed={selected?.id === node.id}
              aria-label={`${node.label} · ${node.count} ${t('条资料', 'entries')}`}
              onClick={(event) => {
                if (event.detail !== 0 && pointer.current.dragged) return;
                enter(node);
              }}
            >
              <i />
              <span>{node.label}</span>
            </button>
          ))}
          {!nodes.length && (
            <p className="universe-empty">{t('当前没有可展示的目录节点。', 'No catalog nodes available.')}</p>
          )}
          <div className="universe-hint">
            {t('拖拽旋转 · 滚轮缩放 · 点击深入', 'DRAG TO ORBIT · SCROLL TO ZOOM · CLICK TO EXPLORE')}
          </div>
        </div>
        {selected && (
          <aside className="universe-detail" aria-live="polite">
            <button
              className="universe-close"
              onClick={() => setSelected(null)}
              aria-label={t('关闭详情', 'Close details')}
            >
              <X size={18} />
            </button>
            <span className="universe-detail-kind">
              {t('已聚焦', 'IN FOCUS')} /{' '}
              {selected.kind === 'root'
                ? t('知识星系', 'Galaxy')
                : selected.kind === 'brand'
                  ? t('品牌', 'Brand')
                  : selected.kind === 'model'
                    ? t('机型', 'Model')
                    : selected.kind === 'component'
                      ? t('组件', 'Component')
                      : t('零部件', 'Part')}
            </span>
            <h3>{selected.label}</h3>
            <strong>
              {selected.count.toLocaleString()} <small>{t('条已索引资料', 'indexed entries')}</small>
            </strong>
            <p>
              {selected.scope === 'series'
                ? t('系列资料，具体型号与配置仍需核对。', 'Series documents. Check specific model and configuration.')
                : selected.scope === 'pending'
                  ? t('完整型号待核实。', 'Complete model needs verification.')
                  : t(
                      '连线表示资料目录的归属关系；资料数量不等于完整维修覆盖。',
                      'Edges show catalog membership. Counts do not imply complete repair coverage.',
                    )}
            </p>
            <Link
              className="universe-open"
              to={`/knowledge?${new URLSearchParams({ view: 'machine', ...selected.query })}`}
            >
              {t('放大查看资料与适用范围', 'Open evidence and applicability')}
              <ArrowUpRight size={17} />
            </Link>
            {selected.query.model && (
              <div className="universe-evidence">
                <h4>{t('资料预览', 'Evidence preview')}</h4>
                {details.loading && <p role="status">{t('正在读取原始资料…', 'Loading evidence…')}</p>}
                {details.failed && (
                  <button onClick={details.retry}>{t('读取失败，重试', 'Failed to load. Retry')}</button>
                )}
                {!details.loading &&
                  !details.failed &&
                  details.catalog?.selected?.gaps.map((gap) => (
                    <p className="universe-gap" key={gap}>
                      {gap}
                    </p>
                  ))}
                {!details.loading &&
                  !details.failed &&
                  details.catalog?.selected?.entries.slice(0, 3).map((entry) => (
                    <EvidenceEntry
                      key={entry.entryId}
                      entry={entry}
                      diagnosisState={{
                        brand: selectedBrand?.name,
                        model: selectedModel?.scope === 'exact' ? selectedModel.name : '',
                        machineType: selectedModel?.machineType === '待核实' ? '' : selectedModel?.machineType,
                        question: t(
                          `关于“${entry.title}”，请结合资料说明适用范围、排查步骤和需要核实的信息。`,
                          `Explain applicability, troubleshooting and uncertainties for ${entry.title}.`,
                        ),
                      }}
                    />
                  ))}
                {!details.loading && !details.failed && !details.catalog?.selected?.entries.length && (
                  <p>{t('暂无归档条目，请查看目录适用范围。', 'No archived entries. Check catalog applicability.')}</p>
                )}
              </div>
            )}
            <h4>
              {t('相连节点', 'Connected nodes')} · {related.length}
            </h4>
            <div className="universe-related">
              {related.map((node) => (
                <button key={node.id} onClick={() => enter(node)}>
                  {node.label}
                  <span>{node.count}</span>
                </button>
              ))}
            </div>
          </aside>
        )}
      </div>
      <footer className="universe-legend">
        <span>
          <i style={{ background: colors.brand }} />
          {t('品牌', 'Brand')}
        </span>
        <span>
          <i style={{ background: colors.model }} />
          {t('机型 / 系列', 'Model / series')}
        </span>
        <span>
          <i style={{ background: colors.component }} />
          {t('组件', 'Component')}
        </span>
        <span>
          <i style={{ background: colors.part }} />
          {t('零部件', 'Part')}
        </span>
        <small>
          {t(
            '归档目录归属 · 通识在独立入口 · 非故障因果图',
            'Archive membership · learning has its own view · not fault causality',
          )}
        </small>
      </footer>
      {search && (
        <div className="universe-results" aria-live="polite">
          {allNodes
            .filter((node) => node.label.toLowerCase().includes(search.toLowerCase()))
            .slice(0, 30)
            .map((node) => (
              <button key={node.id} onClick={() => enter(node)}>
                {node.label}
              </button>
            ))}
          {!allNodes.some((node) => node.label.toLowerCase().includes(search.toLowerCase())) &&
            t('没有匹配节点，请换个关键词。', 'No matches. Try another keyword.')}
        </div>
      )}
    </section>
  );
}

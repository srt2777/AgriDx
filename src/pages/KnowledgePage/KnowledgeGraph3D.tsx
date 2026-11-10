import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FC, Ref } from 'react';
import * as THREE from 'three';
import SpriteText from 'three-spritetext';
import { useReducedMotion } from 'framer-motion';
import { useTheme, type Theme } from '@/hooks/useTheme';
import { useUiCopy } from '@/ui/useUiCopy';
import type { TaxonomyNode } from './knowledge-taxonomy-data';
import { buildForceGraphData, labelVisible, levelColorForTheme, type ForceGraphData, type ForceGraphLink, type ForceGraphNode } from './knowledge-graph-3d-data';
import type { ForceGraphMethods, ForceGraphProps, NodeObject } from 'react-force-graph-3d';
import './knowledge-graph-3d.css';

/**
 * 重型 3D 图库只在用户打开动感图谱时加载，首屏包体不变。
 * lazy 会丢失泛型，这里显式标注节点与连线类型。
 */
const ForceGraph3D = lazy(() => import('react-force-graph-3d')) as unknown as FC<
  ForceGraphProps<GraphNode, ForceGraphLink> & { ref?: Ref<GraphInstance> }
>;

type GraphNode = NodeObject<ForceGraphNode>;
type GraphInstance = ForceGraphMethods<ForceGraphNode, ForceGraphLink>;

const DARK_BACKDROP = '#171310';
const LIGHT_BACKDROP = '#f7f2e7';

interface GraphPalette {
  backdrop: string;
  link: string;
  particle: string;
  label: string;
  /** 辉光精灵基础不透明度。 */
  glowOpacity: number;
  /** 品牌 / 机型光环圆环不透明度。 */
  haloOpacity: number;
}

/** 按主题的图谱配色：浅色用暖纸面底 + 深色线条文字，深色沿用原有暖夜配色。 */
const GRAPH_PALETTES: Record<Theme, GraphPalette> = {
  light: { backdrop: LIGHT_BACKDROP, link: '#a8842f', particle: '#c98f1b', label: '#4a3a20', glowOpacity: 0.32, haloOpacity: 0.5 },
  dark: { backdrop: DARK_BACKDROP, link: '#c9a86a', particle: '#ffd97a', label: '#f5efe4', glowOpacity: 0.4, haloOpacity: 0.4 },
};

let glowTexture: THREE.Texture | null = null;
function getGlowTexture(): THREE.Texture {
  if (glowTexture) return glowTexture;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,0.9)');
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.32)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  glowTexture = new THREE.CanvasTexture(canvas);
  return glowTexture;
}

let ringTexture: THREE.Texture | null = null;
function getRingTexture(): THREE.Texture {
  if (ringTexture) return ringTexture;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 6, 0, Math.PI * 2);
  ctx.stroke();
  ringTexture = new THREE.CanvasTexture(canvas);
  return ringTexture;
}

function webglAvailable(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

interface KnowledgeGraph3DProps {
  nodes: TaxonomyNode[];
  selectedId: string;
  onSelect: (id: string) => void;
  lang: string;
  /** WebGL 不可用时回到经典图谱。 */
  onRequestClassic: () => void;
}

/**
 * 旧版知识库的动感图谱：3D 力导向图，数据直接由当前目录派生，
 * 分类变化随目录加载自动同步，不另存快照。
 */
export default function KnowledgeGraph3D({ nodes, selectedId, onSelect, lang, onRequestClassic }: KnowledgeGraph3DProps) {
  const { t } = useUiCopy(lang);
  const theme = useTheme();
  const palette = GRAPH_PALETTES[theme];
  const reducedMotion = !!useReducedMotion();
  const [webgl] = useState(webglAvailable);
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set());
  const [roam, setRoam] = useState(false);
  const [particles, setParticles] = useState(!reducedMotion);
  const [paused, setPaused] = useState(false);
  const [graphReady, setGraphReady] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [size, setSize] = useState({ width: 720, height: 460 });
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<GraphInstance | null>(null);
  const objectCache = useRef(new Map<string, THREE.Group>());
  const bloomRef = useRef<{ strength: number; threshold: number } | null>(null);
  const lookAtRef = useRef({ x: 0, y: 0, z: 0 });
  const fittedOnce = useRef(false);
  const suppressFocusRef = useRef(false);
  const lastPointerRef = useRef(0);

  /** 挂载即记一次时间：空闲漂移从页面打开 5 秒后才开始，而非立即环绕。 */
  useEffect(() => {
    lastPointerRef.current = Date.now();
  }, []);

  const data: ForceGraphData = useMemo(
    () => buildForceGraphData(nodes, { expandedIds }),
    [nodes, expandedIds],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const width = Math.max(320, el.clientWidth);
      setSize({ width, height: width < 640 ? 400 : 480 });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const buildNodeObject = useCallback((node: GraphNode): THREE.Object3D => {
    const showLabel = labelVisible(node as ForceGraphNode, data.nodes.length);
    const key = `${node.id}:${showLabel ? 'label' : 'plain'}:${theme}`;
    const cached = objectCache.current.get(key);
    if (cached) return cached;
    const group = new THREE.Group();
    group.userData.nodeId = node.id;
    const radius = Math.max(1.4, (node.val ?? 4) * 0.9);
    const color = levelColorForTheme(node.level, theme);
    const isMajor = node.level === 'brand' || node.level === 'model';
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 20, 20),
      new THREE.MeshBasicMaterial({ color }),
    );
    core.name = 'core';
    group.add(core);
    // 更大更柔的辉光：柔化生硬的球体边缘。
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getGlowTexture(), color, blending: THREE.AdditiveBlending,
      depthWrite: false, transparent: true, opacity: palette.glowOpacity,
    }));
    glow.scale.setScalar(radius * 6.5);
    glow.name = 'glow';
    glow.userData.baseOpacity = palette.glowOpacity;
    group.add(glow);
    // 品牌 / 机型多一圈细光环：层级不只靠尺寸区分。
    if (isMajor) {
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: getRingTexture(), color, blending: THREE.AdditiveBlending,
        depthWrite: false, transparent: true, opacity: palette.haloOpacity,
      }));
      halo.scale.setScalar(radius * 3.4);
      halo.name = 'halo-ring';
      group.add(halo);
    }
    // 小高光点：给球体一点纵深，不再是纯平色块。
    const highlight = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getGlowTexture(), color: '#ffffff', blending: THREE.AdditiveBlending,
      depthWrite: false, transparent: true, opacity: theme === 'light' ? 0.5 : 0.35,
    }));
    highlight.scale.setScalar(radius * 2.2);
    highlight.position.set(radius * 0.25, radius * 0.3, radius * 0.4);
    highlight.name = 'highlight';
    group.add(highlight);
    if (showLabel) {
      const text = new SpriteText(node.label ?? '');
      text.textHeight = Math.max(2.4, radius * 0.95);
      text.color = palette.label;
      text.position.y = radius + 3.5;
      group.add(text);
    }
    const ring = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getRingTexture(), color: palette.particle, blending: THREE.AdditiveBlending,
      depthWrite: false, transparent: true, opacity: 0,
    }));
    ring.scale.setScalar(radius * 2);
    ring.userData.baseScale = radius * 2;
    ring.name = 'pulse-ring';
    group.add(ring);
    objectCache.current.set(key, group);
    return group;
  }, [data.nodes.length, palette, theme]);

  /** 主题切换：丢弃按主题缓存的节点对象并让力导向图重建，旧主题颜色不残留。 */
  useEffect(() => {
    objectCache.current.clear();
    fgRef.current?.refresh();
  }, [theme]);

  const focusNode = useCallback((node: GraphNode | undefined, ms = 900) => {
    const fg = fgRef.current;
    if (!fg || !node || node.x === undefined || node.y === undefined || node.z === undefined) return;
    const len = Math.hypot(node.x, node.y, node.z);
    const dir = len < 1 ? { x: 0, y: 0, z: 1 } : { x: node.x / len, y: node.y / len, z: node.z / len };
    const distance = 70;
    const target = { x: node.x, y: node.y, z: node.z };
    fg.cameraPosition(
      { x: node.x + dir.x * distance, y: node.y + dir.y * distance, z: node.z + dir.z * distance },
      target,
      ms,
    );
    lookAtRef.current = target;
  }, []);

  const handleNodeClick = useCallback((node: GraphNode) => {
    if (!node.id) return;
    lastPointerRef.current = Date.now();
    onSelect(node.id);
    if (node.hasChildren && !expandedIds.has(node.id)) {
      setExpandedIds(prev => new Set(prev).add(node.id!));
    }
    suppressFocusRef.current = true;
    focusNode(node);
  }, [expandedIds, focusNode, onSelect]);

  useEffect(() => {
    if (!selectedId || suppressFocusRef.current) {
      suppressFocusRef.current = false;
      return;
    }
    const node = data.nodes.find(item => item.id === selectedId) as GraphNode | undefined;
    focusNode(node, 900);
  }, [selectedId, data, focusNode]);

  /** 选中节点的脉冲波纹：减动效时只显示静态圆环。 */
  useEffect(() => {
    if (!selectedId) return;
    if (reducedMotion) {
      for (const group of objectCache.current.values()) {
        const ring = group.getObjectByName('pulse-ring') as THREE.Sprite | undefined;
        if (!ring) continue;
        const material = ring.material as THREE.SpriteMaterial;
        material.opacity = group.userData.nodeId === selectedId ? 0.5 : 0;
      }
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const elapsed = ((now - start) % 1400) / 1400;
      for (const group of objectCache.current.values()) {
        const ring = group.getObjectByName('pulse-ring') as THREE.Sprite | undefined;
        if (!ring) continue;
        const material = ring.material as THREE.SpriteMaterial;
        if (group.userData.nodeId !== selectedId) {
          material.opacity = 0;
          continue;
        }
        const base = (ring.userData.baseScale as number) || 4;
        ring.scale.setScalar(base * (1 + elapsed * 1.6));
        material.opacity = 0.75 * (1 - elapsed);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [selectedId, reducedMotion]);

  /** 呼吸与悬停反馈：辉光轻微起伏，悬停节点放大并增亮；减动效时保持静止。 */
  useEffect(() => {
    if (reducedMotion) {
      for (const group of objectCache.current.values()) {
        group.scale.setScalar(1);
        const glow = group.getObjectByName('glow') as THREE.Sprite | undefined;
        if (glow) {
          (glow.material as THREE.SpriteMaterial).opacity = (glow.userData.baseOpacity as number) ?? palette.glowOpacity;
        }
      }
      return;
    }
    let raf = 0;
    const hash = (value: string) => {
      let h = 0;
      for (let i = 0; i < value.length; i += 1) h = (h * 31 + value.charCodeAt(i)) >>> 0;
      return h;
    };
    const tick = (now: number) => {
      const seconds = now / 1000;
      for (const group of objectCache.current.values()) {
        const id = group.userData.nodeId as string | undefined;
        if (!id) continue;
        const phase = (hash(id) % 100) / 100 * Math.PI * 2;
        const sway = Math.sin(seconds * 0.9 + phase);
        const isHovered = hoveredId === id;
        group.scale.setScalar((1 + 0.06 * sway) * (isHovered ? 1.18 : 1));
        const glow = group.getObjectByName('glow') as THREE.Sprite | undefined;
        if (glow) {
          const material = glow.material as THREE.SpriteMaterial;
          const base = (glow.userData.baseOpacity as number) ?? palette.glowOpacity;
          material.opacity = base * (isHovered ? 1.6 : 1) * (0.92 + 0.08 * sway);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reducedMotion, hoveredId, palette.glowOpacity]);

  /** 相机绕当前焦点环绕一步；漫游与空闲漂移共用。 */
  const orbitCamera = useCallback((step: number) => {
    const fg = fgRef.current;
    if (!fg) return;
    const cam = fg.camera();
    const lookAt = lookAtRef.current;
    const dx = cam.position.x - lookAt.x;
    const dy = cam.position.y - lookAt.y;
    const dz = cam.position.z - lookAt.z;
    const r = Math.hypot(dx, dy, dz);
    if (r <= 1) return;
    const theta = Math.atan2(dz, dx) + step;
    const phi = Math.acos(Math.max(-1, Math.min(1, dy / r)));
    fg.cameraPosition({
      x: lookAt.x + r * Math.sin(phi) * Math.cos(theta),
      y: lookAt.y + r * Math.cos(phi),
      z: lookAt.z + r * Math.sin(phi) * Math.sin(theta),
    }, lookAt, 0);
  }, []);

  /** 漫游：相机绕当前焦点缓慢环绕；用户操作后 3 秒内暂停环绕。 */
  useEffect(() => {
    if (!roam || reducedMotion) return;
    let raf = 0;
    const tick = () => {
      if (Date.now() - lastPointerRef.current > 3000) orbitCamera(0.0016);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [roam, reducedMotion, orbitCamera]);

  /** 空闲漂移：5 秒无人操作时相机缓慢环绕，比手动漫游更慢；任意指针操作即停，手动漫游优先。 */
  useEffect(() => {
    if (reducedMotion || paused || roam) return;
    let raf = 0;
    const tick = () => {
      if (Date.now() - lastPointerRef.current > 5000) orbitCamera(0.0008);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reducedMotion, paused, roam, orbitCamera]);

  /** 辉光后期处理：失败时仍保留精灵辉光，不影响图谱使用。
   *  浅色模式不加 bloom：纸面亮度 0.93 远高于阈值，整幅画面都会进 bloom 再被加回去，
   *  节点会被白雾盖住（实测浅色下节点全不可见）；只靠精灵辉光做柔光。 */
  useEffect(() => {
    if (!webgl || !graphReady) return;
    if (theme === 'light') {
      if (bloomRef.current) bloomRef.current.strength = 0;
      return;
    }
    let cancelled = false;
    import('three/addons/postprocessing/UnrealBloomPass.js').then(({ UnrealBloomPass }) => {
      const fg = fgRef.current;
      if (cancelled || !fg) return;
      try {
        const strength = 0.4;
        const threshold = 0.25;
        if (bloomRef.current) {
          bloomRef.current.strength = strength;
          bloomRef.current.threshold = threshold;
        } else {
          const bloom = new UnrealBloomPass(new THREE.Vector2(size.width, size.height), strength, 0.5, threshold);
          bloomRef.current = bloom;
          fg.postProcessingComposer().addPass(bloom);
        }
      } catch {
        /* Sprite glow remains as the light effect. */
      }
    }).catch(() => { /* Sprite glow remains as the light effect. */ });
    return () => { cancelled = true; };
  }, [webgl, graphReady, size.width, size.height, theme]);

  const zoomBy = useCallback((factor: number) => {
    const fg = fgRef.current;
    if (!fg) return;
    const cam = fg.camera();
    const lookAt = lookAtRef.current;
    fg.cameraPosition({
      x: lookAt.x + (cam.position.x - lookAt.x) * factor,
      y: lookAt.y + (cam.position.y - lookAt.y) * factor,
      z: lookAt.z + (cam.position.z - lookAt.z) * factor,
    }, lookAt, 350);
  }, []);

  const resetView = useCallback(() => {
    lookAtRef.current = { x: 0, y: 0, z: 0 };
    fgRef.current?.cameraPosition({ x: 0, y: 0, z: 320 }, { x: 0, y: 0, z: 0 }, 800);
  }, []);

  const togglePause = useCallback(() => {
    const fg = fgRef.current;
    if (!fg) return;
    if (paused) fg.resumeAnimation();
    else fg.pauseAnimation();
    setPaused(!paused);
  }, [paused]);

  const selected = data.nodes.find(item => item.id === selectedId);
  const selectedExpanded = selectedId ? expandedIds.has(selectedId) : false;

  if (!webgl) {
    return <div className="knowledge-graph-3d-fallback" role="alert">
      <p>{t('当前浏览器不支持 WebGL，动感图谱无法显示。', 'This browser does not support WebGL, so the dynamic graph cannot be shown.')}</p>
      <button type="button" onClick={onRequestClassic}>{t('返回经典图谱', 'Back to classic graph')}</button>
    </div>;
  }

  return <section className="knowledge-graph-3d" aria-label={t('动感知识图谱', 'Dynamic knowledge graph')}>
    <div
      className="knowledge-graph-3d-viewport"
      ref={containerRef}
      style={{ cursor: hoveredId ? 'pointer' : undefined }}
      onPointerDown={() => { lastPointerRef.current = Date.now(); }}
      onPointerMove={() => { lastPointerRef.current = Date.now(); }}
    >
      <Suspense fallback={<p role="status" className="knowledge-graph-3d-loading">{t('正在加载动感图谱…', 'Loading dynamic graph…')}</p>}>
        <ForceGraph3D
          ref={(instance: GraphInstance | null) => {
            fgRef.current = instance;
            if (instance && !graphReady) setGraphReady(true);
          }}
          graphData={data}
          nodeId="id"
          nodeVal="val"
          nodeColor="color"
          nodeLabel={(node: GraphNode) => `${node.label ?? ''} · ${node.count ?? 0}${t(' 条关联资料', ' linked entries')}`}
          nodeThreeObject={buildNodeObject}
          linkColor={() => palette.link}
          linkOpacity={0.55}
          linkWidth={1}
          linkDirectionalParticles={particles ? 3 : 0}
          linkDirectionalParticleWidth={3}
          linkDirectionalParticleSpeed={0.012}
          linkDirectionalParticleColor={() => palette.particle}
          backgroundColor={palette.backdrop}
          showNavInfo={false}
          enableNodeDrag
          enableNavigationControls
          cooldownTicks={200}
          d3AlphaDecay={0.015}
          d3VelocityDecay={0.28}
          width={size.width}
          height={size.height}
          onEngineStop={() => {
            if (!fittedOnce.current) {
              fittedOnce.current = true;
              fgRef.current?.zoomToFit(600, 40);
            }
          }}
          onNodeClick={handleNodeClick}
          onNodeHover={(node: GraphNode | null) => setHoveredId(node?.id ?? null)}
        />
      </Suspense>
      <p className="knowledge-graph-3d-status" role="status">
        {t(`当前显示 ${data.nodes.length.toLocaleString()} 个节点 · 目录共 ${data.totalAvailable.toLocaleString()} 个`, `${data.nodes.length.toLocaleString()} nodes shown · ${data.totalAvailable.toLocaleString()} in catalog`)}
        {data.truncated && ` · ${t(`已省略 ${data.omitted} 个，点节点展开下级或用搜索定位`, `${data.omitted} omitted; expand a node or use search`)}`}
      </p>
    </div>
    <div className="knowledge-graph-3d-controls" role="group" aria-label={t('图谱控制', 'Graph controls')}>
      <button type="button" onClick={() => zoomBy(0.7)} aria-label={t('放大', 'Zoom in')}>＋</button>
      <button type="button" onClick={() => zoomBy(1.4)} aria-label={t('缩小', 'Zoom out')}>－</button>
      <button type="button" onClick={() => fgRef.current?.zoomToFit(600, 40)}>{t('自适应', 'Fit')}</button>
      <button type="button" onClick={resetView}>{t('重置视角', 'Reset view')}</button>
      <button type="button" aria-pressed={roam} disabled={reducedMotion} onClick={() => setRoam(!roam)}>{t('漫游', 'Roam')}</button>
      <button type="button" aria-pressed={particles} onClick={() => setParticles(!particles)}>{t('粒子', 'Particles')}</button>
      <button type="button" aria-pressed={paused} onClick={togglePause}>{paused ? t('继续动效', 'Resume motion') : t('暂停动效', 'Pause motion')}</button>
      {selected && selected.hasChildren && <button
        type="button"
        onClick={() => setExpandedIds(prev => {
          const next = new Set(prev);
          if (next.has(selected.id)) next.delete(selected.id);
          else next.add(selected.id);
          return next;
        })}
      >{selectedExpanded ? t('收起下级', 'Collapse children') : t(`展开下级（${selected.childrenCount}）`, `Expand children (${selected.childrenCount})`)}</button>}
    </div>
    <p className="knowledge-graph-3d-hint">
      {t('拖拽平移，滚轮或双指缩放，拖动节点可调整布局；点节点查看详情并展开下级。键盘用户可使用下方目录列表浏览。', 'Drag to pan, scroll or pinch to zoom, drag nodes to rearrange; click a node for details and to expand children. Keyboard users can use the directory list below.')}
    </p>
  </section>;
}

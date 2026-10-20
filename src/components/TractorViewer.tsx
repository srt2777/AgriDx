import { lazy, Suspense, useState, useEffect, useRef, useCallback, useId } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Bounds, OrbitControls, Grid } from '@react-three/drei';
import { ErrorBoundary } from 'react-error-boundary';
import { Focus, Loader2, MapPin, MonitorPlay, Pause, Play, RotateCcw, ScanLine, X } from 'lucide-react';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import TractorModel from './TractorModel';
import { TRACTOR_COMPONENTS, TRACTOR_MODEL_URL, type TractorComponent } from './tractor-model-info';
import TractorFraming from './TractorFraming';
import { TRACTOR_VIEWS, type TractorView } from './tractor-view-config';
import { useLang } from '@/hooks/useLang';
import { useTheme } from '@/hooks/useTheme';
import { LiquidGlass } from '@/components/ui/liquid-glass';
import { LiquidSelection } from '@/components/ui/liquid-selection';
import { LayoutGroup, useReducedMotion } from 'framer-motion';
import '@/control-glass.css';
import './tractor-viewer.css';

const TractorOutline = lazy(() => import('./TractorOutline'));

// 相机初始配置（常量避免重渲染触发重置）
const CAMERA_CONFIG = { position: [6.5, 4, 6.5] as [number, number, number], fov: 40 };

// OrbitControls 内置自动旋转配置常量
const AUTO_ROTATE_SPEED = 0.8;

// Canvas 配置常量：避免每次渲染创建新对象字面量导致 R3F 重建 WebGL context（滚动闪屏主因之一）
const GL_CONFIG = { antialias: true, alpha: true } as const;
const DPR_CONFIG: [number, number] = [1, 1.5];
const LIGHT_COLORS = {
  dark: { background: '#18232e', fog: '#18232e', cell: '#344654', section: '#657c8b' },
  light: { background: '#eef3ef', fog: '#eef3ef', cell: '#d9e3dc', section: '#c3d2c7' },
} as const;

interface ModelFallbackProps {
  error: unknown;
  resetErrorBoundary?: () => void;
}

function ModelFallback({ error }: ModelFallbackProps) {
  const lang = useLang();
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-2xl border border-border/50 bg-gradient-to-br from-muted/30 to-transparent text-muted-foreground">
      <MonitorPlay className="size-12 opacity-50" />
      <div className="text-sm">{lang === 'zh' ? '3D 模型加载失败' : 'Unable to load the 3D model'}</div>
      <div className="max-w-[80%] truncate text-xs opacity-60">{message.slice(0, 60)}</div>
    </div>
  );
}

// R3F Canvas 内部的 loading 占位：必须用 three.js 对象，不能用 HTML div
function CanvasLoadingPlaceholder() {
  return (
    <mesh>
      <sphereGeometry args={[0.001, 8, 8]} />
      <meshBasicMaterial visible={false} />
    </mesh>
  );
}

// 程序化环境光照组件：使用 three.js 内置 RoomEnvironment
// 零网络请求，不依赖外部 HDR 贴图，避免跨域/CDN 不可达问题
function ProgrammaticEnvironment() {
  const { scene, gl, invalidate } = useThree();

  useEffect(() => {
    const pmremGenerator = new THREE.PMREMGenerator(gl);
    const envScene = new RoomEnvironment();
    const environment = pmremGenerator.fromScene(envScene, 0.04);
    scene.environment = environment.texture;
    invalidate();

    return () => {
      scene.environment = null;
      environment.dispose();
      envScene.dispose();
      pmremGenerator.dispose();
    };
  }, [scene, gl, invalidate]);

  return null;
}

/**
 * 3D 拖拉机查看器
 * - 使用本地原创分组件拖拉机结构示意 GLB，保留旧模型原件
 * - 环境光照使用 three.js 内置 RoomEnvironment 程序化生成，零网络依赖
 * - 模型工坊可启停自转；无控制栏的首页预览静止，交互后按所选状态恢复
 * - 支持鼠标/触屏拖拽旋转、滚轮缩放
 * - WebGL 不可用时降级为占位提示
 */
export default function TractorViewer({ component = 'all', exploded = false, modelUrl = TRACTOR_MODEL_URL, controls = false, onComponentChange, focusRequest = 0 }: {
  component?: TractorComponent;
  exploded?: boolean;
  modelUrl?: string;
  controls?: boolean;
  onComponentChange?: (component: TractorComponent) => void;
  focusRequest?: number;
}) {
  const selectionGroup = useId();
  const lang = useLang();
  const reducedMotion = useReducedMotion();
  const [view, setView] = useState<TractorView>('isometric');
  const [showHotspots, setShowHotspots] = useState(true);
  const [outlineEnabled, setOutlineEnabled] = useState(() => window.innerWidth >= 640 && !window.matchMedia('(pointer: coarse)').matches);
  const [outlineFailed, setOutlineFailed] = useState(false);
  const [localFocusRequest, setLocalFocusRequest] = useState(0);
  const [layoutRevision, setLayoutRevision] = useState(0);
  const interactive = controls && modelUrl === TRACTOR_MODEL_URL && !!onComponentChange;
  const selectedComponent = modelUrl === TRACTOR_MODEL_URL ? component : 'all';
  const selectedInfo = TRACTOR_COMPONENTS.find(item => item.id === selectedComponent)!;
  // 无控制栏的首页预览保持静止，避免移除暂停入口后出现无法停止的自转。
  const [autoRotate, setAutoRotate] = useState(() => controls && !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [webglSupported] = useState(() => {
    try {
      const context = document.createElement('canvas').getContext('webgl2');
      context?.getExtension('WEBGL_lose_context')?.loseContext();
      return !!context;
    } catch {
      return false;
    }
  });
  const [modelError, setModelError] = useState<{ url: string; message: string } | null>(null);
  const [loadedModel, setLoadedModel] = useState<{ url: string; object: THREE.Object3D } | null>(null);
  const modelObject = loadedModel?.url === modelUrl ? loadedModel.object : null;
  const modelLoaded = !!modelObject;
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const autoRotateTimerRef = useRef<number | null>(null);
  const refitAfterLayout = useRef(true);
  useEffect(() => { refitAfterLayout.current = true; }, [modelUrl, exploded]);

  const isDark = useTheme() === 'dark';

  // 通过 ref 直接启停 OrbitControls 内置自动旋转
  // 不用 React state 驱动 prop，避免 prop 变化触发组件重渲染导致相机重置
  const setAutoRotateByRef = useCallback((enabled: boolean) => {
    if (controlsRef.current) {
      controlsRef.current.autoRotate = enabled;
    }
  }, []);

  useEffect(() => {
    if (selectedComponent !== 'all' || reducedMotion) {
      setAutoRotate(false);
      setAutoRotateByRef(false);
      if (autoRotateTimerRef.current) window.clearTimeout(autoRotateTimerRef.current);
      autoRotateTimerRef.current = null;
    }
  }, [selectedComponent, reducedMotion, focusRequest, localFocusRequest, view, setAutoRotateByRef]);

  // 用户停止交互后延迟 3 秒恢复自动旋转
  const handleInteractionEnd = useCallback(() => {
    if (autoRotateTimerRef.current) {
      window.clearTimeout(autoRotateTimerRef.current);
    }
    autoRotateTimerRef.current = window.setTimeout(() => {
      setAutoRotateByRef(autoRotate && view === 'isometric');
    }, 3000);
  }, [setAutoRotateByRef, autoRotate, view]);

  // 用户开始交互时停止自动旋转
  const handleInteractionStart = useCallback(() => {
    // A later exploded-layout completion must not steal a user's manual view.
    refitAfterLayout.current = false;
    if (autoRotateTimerRef.current) {
      window.clearTimeout(autoRotateTimerRef.current);
      autoRotateTimerRef.current = null;
    }
    setAutoRotateByRef(false);
  }, [setAutoRotateByRef]);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (autoRotateTimerRef.current) {
        window.clearTimeout(autoRotateTimerRef.current);
      }
    };
  }, [autoRotate, view]);

  // Bounds handles framing; OrbitControls remains the single manual controller.
  const handleControlsRef = useCallback(
    (node: OrbitControlsImpl | null) => {
      controlsRef.current = node;
      if (node) {
        node.autoRotate = autoRotate && view === 'isometric';
        node.autoRotateSpeed = AUTO_ROTATE_SPEED;
      }
    },
    [autoRotate, view],
  );

  const handleModelLoaded = useCallback(
    (object: THREE.Object3D) => {
      setLoadedModel({ url: modelUrl, object });
    },
    [modelUrl],
  );
  const handleLayoutSettled = useCallback(() => {
    if (!refitAfterLayout.current) return;
    refitAfterLayout.current = false;
    setLayoutRevision(value => value + 1);
  }, []);
  const focusSelected = () => {
    setAutoRotate(false);
    setAutoRotateByRef(false);
    if (autoRotateTimerRef.current) window.clearTimeout(autoRotateTimerRef.current);
    autoRotateTimerRef.current = null;
    setLocalFocusRequest(value => value + 1);
  };
  const handleComponentSelect = (next: TractorComponent) => {
    focusSelected();
    onComponentChange?.(next);
  };

  if (!webglSupported) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-2xl border border-border/50 bg-gradient-to-br from-muted/30 to-transparent text-muted-foreground">
        <MonitorPlay className="size-16 opacity-40" />
        <div className="text-sm font-medium">{lang === 'zh' ? '3D 模型预览' : '3D model preview'}</div>
        <div className="text-xs opacity-60">{lang === 'zh' ? '当前浏览器环境不支持 WebGL' : 'WebGL is unavailable in this browser'}</div>
        <div className="text-xs opacity-60">{lang === 'zh' ? '支持的设备上可查看可交互 3D 拖拉机模型' : 'Use a supported device to explore the interactive tractor model'}</div>
      </div>
    );
  }

  if (modelError?.url === modelUrl) {
    return <ModelFallback error={modelError.message} />;
  }

  const palette = isDark ? LIGHT_COLORS.dark : LIGHT_COLORS.light;

  return (
    <div className="tractor-viewer relative h-full w-full" data-component={selectedComponent} data-model-state={modelLoaded ? 'ready' : 'loading'}>
      <ErrorBoundary
        resetKeys={[modelUrl]}
        FallbackComponent={ModelFallback}
        onError={(e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          setModelError({ url: modelUrl, message: msg });
        }}
      >
        <Canvas
          className="tractor-canvas"
          frameloop={autoRotate && view === 'isometric' ? 'always' : 'demand'}
          shadows
          camera={CAMERA_CONFIG}
          gl={GL_CONFIG}
          dpr={DPR_CONFIG}
        >
          <fog attach="fog" args={[palette.fog, 8, 20]} />

          {/* 程序化环境光照（零网络依赖，替代 drei Environment preset 的 HDR 贴图） */}
          <ProgrammaticEnvironment />

          {/* 光照 */}
          <ambientLight intensity={0.5} />
          <hemisphereLight args={['#FFF8E7', '#C8B89A', 0.6]} />
          <directionalLight
            position={[5, 8, 5]}
            intensity={1.2}
            castShadow
            shadow-mapSize={[1024, 1024]}
          />
          <directionalLight position={[-3, 4, -3]} intensity={0.3} color="#E8D5B7" />

          {/* 地面网格 */}
          <Grid
            args={[20, 20]}
            cellSize={1}
            cellThickness={0.5}
            cellColor={palette.cell}
            sectionSize={5}
            sectionThickness={1}
            sectionColor={palette.section}
            fadeDistance={15}
            fadeStrength={1}
            position={[0, -0.4, 0]}
          />

          {/* 地面接影 */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.401, 0]} receiveShadow>
            <planeGeometry args={[20, 20]} />
            <shadowMaterial transparent opacity={0.25} />
          </mesh>

          {/* Suspense fallback 必须是 three.js 对象，不能放 HTML 元素 */}
          <Suspense fallback={<CanvasLoadingPlaceholder />}>
            <Bounds margin={1.25} maxDuration={reducedMotion ? 0 : 0.9}>
              <TractorModel onLoaded={handleModelLoaded} onLayoutSettled={handleLayoutSettled} component={selectedComponent}
                exploded={exploded} modelUrl={modelUrl} interactive={interactive} showHotspots={interactive && showHotspots}
                onComponentSelect={handleComponentSelect} />
              <TractorFraming model={modelObject} component={selectedComponent} view={view}
                request={focusRequest + localFocusRequest} layoutRevision={layoutRevision} />
            </Bounds>
          </Suspense>

          {interactive && modelObject && selectedComponent !== 'all' && outlineEnabled && !outlineFailed && <ErrorBoundary
            fallback={null} onError={() => setOutlineFailed(true)}>
            <Suspense fallback={null}><TractorOutline model={modelObject} component={selectedComponent} /></Suspense>
          </ErrorBoundary>}

          <OrbitControls
            makeDefault
            ref={handleControlsRef}
            enableDamping={autoRotate && view === 'isometric'}
            dampingFactor={0.05}
            minDistance={2}
            maxDistance={18}
            maxPolarAngle={Math.PI / 2.2}
            minPolarAngle={0.03}
            autoRotateSpeed={AUTO_ROTATE_SPEED}
            onStart={handleInteractionStart}
            onEnd={handleInteractionEnd}
          />
        </Canvas>
      </ErrorBoundary>

      {/* HTML loading 提示放在 Canvas 外部（DOM 层），避免 R3F 校验 HTML 元素 */}
      {!modelLoaded && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="flex items-center gap-2 rounded-full bg-card/80 px-4 py-2 text-xs text-muted-foreground backdrop-blur-sm shadow-sm">
            <Loader2 className="size-4 animate-spin" />
            {lang === 'zh' ? '模型加载中…' : 'Loading model…'}
          </div>
        </div>
      )}

      <div className="tractor-model-badge absolute left-3 top-3 rounded-full border border-border/50 bg-card/85 px-3 py-1.5 text-[10px] text-muted-foreground backdrop-blur">
        {modelUrl === TRACTOR_MODEL_URL
          ? lang === 'zh' ? '原创结构示意 · 非实机 CAD' : 'Original schematic · Not machine CAD'
          : lang === 'zh' ? '本地模型 · 尺寸待核验' : 'Local model · Dimensions unverified'}
      </div>
      {interactive && <div className="tractor-viewer-tools" role="group" aria-label={lang === 'zh' ? '模型标注与描边' : 'Model annotations and outline'}>
        <button type="button" className="tractor-tool-button" aria-label={lang === 'zh' ? '显示部件热点' : 'Show component hotspots'}
          title={lang === 'zh' ? '部件热点' : 'Component hotspots'} aria-pressed={showHotspots} onClick={() => setShowHotspots(value => !value)}><MapPin size={16} /></button>
        <button type="button" className="tractor-tool-button" aria-label={lang === 'zh' ? '选中部件描边' : 'Selected component outline'}
          title={lang === 'zh' ? '选中描边' : 'Selection outline'} aria-pressed={outlineEnabled && !outlineFailed}
          disabled={selectedComponent === 'all' || outlineFailed} onClick={() => setOutlineEnabled(value => !value)}><ScanLine size={16} /></button>
      </div>}
      {interactive && selectedComponent !== 'all' && <section className="tractor-component-card" aria-label={lang === 'zh' ? '所选部件说明' : 'Selected component details'}>
        <header><h3>{lang === 'zh' ? selectedInfo.zh : selectedInfo.en}</h3>
          <button type="button" className="tractor-card-close" aria-label={lang === 'zh' ? '返回整机' : 'Return to whole machine'} onClick={() => handleComponentSelect('all')}><X size={14} /></button>
        </header>
        <p>{lang === 'zh' ? selectedInfo.descriptionZh : selectedInfo.descriptionEn}</p>
        <button type="button" className="tractor-card-focus" onClick={focusSelected}><Focus size={13} />{lang === 'zh' ? '聚焦部件' : 'Focus component'}</button>
      </section>}
      {controls && <div className="model-control-shell" role="group" aria-label={lang === 'zh' ? '模型视角与旋转控制' : 'Model view and rotation controls'}><LiquidGlass variant="regular" lens displacementScale={36} className="model-control-glass" contentClassName="model-control-content">
        <button type="button" onClick={() => setAutoRotate(value => !value)} aria-label={lang === 'zh' ? autoRotate ? '暂停自转' : '开启自转' : autoRotate ? 'Pause rotation' : 'Start rotation'} aria-pressed={autoRotate} className="model-icon-button">
          {autoRotate ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <LayoutGroup id={selectionGroup}><div className="model-view-segment" role="group" aria-label={lang === 'zh' ? '选择模型视角' : 'Select model view'}>
          {TRACTOR_VIEWS.map(item => <button key={item.id} type="button" aria-pressed={view === item.id} onClick={() => setView(item.id)} className="model-view-button">
            {view === item.id && <LiquidSelection className="model-view-indicator" />}
            <span className="model-view-label">{lang === 'zh' ? item.zh : item.en}</span>
          </button>)}
        </div></LayoutGroup>
        <button type="button" aria-label={lang === 'zh' ? '恢复模型视角' : 'Reset model view'} onClick={() => { setView('isometric'); handleComponentSelect('all'); }} className="model-icon-button"><RotateCcw size={16} /></button>
      </LiquidGlass></div>}
      <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] text-muted-foreground/70">
        {lang === 'zh' ? '拖动旋转 · 滚轮缩放' : 'Drag to rotate · Scroll to zoom'}
      </div>
    </div>
  );
}

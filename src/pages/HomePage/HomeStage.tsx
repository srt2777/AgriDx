import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { ErrorBoundary } from 'react-error-boundary';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import * as THREE from 'three';
import { HONGHU_T70_PARTS_URL } from '@/components/tractor-model-info';
import { catalogByName, hoverLabel } from '@/components/parts-tractor/parts-catalog';
import { loadPartsTractor, type PartRecord, type PreparedTractor } from '@/components/parts-tractor/load-parts-tractor';
import { bindContextLoss, probeWebGL } from '@/lib/webgl';
import { useLang } from '@/hooks/useLang';
import {
  DESKTOP_BEATS,
  MOBILE_BEATS,
  damp,
  presentPose,
  sampleBeats,
  scrollIndex,
  stageIndex,
  type StagePose,
} from './home-stage';

const GL = { antialias: true, alpha: true, powerPreference: 'high-performance' } as const;
const CAMERA = { position: [2.35, 1.15, 3.55] as [number, number, number], fov: 38, near: 0.05, far: 40 };
const DPR: [number, number] = [1, 1.5];
const LAMBDA = 6.2;

type PointerState = { x: number; y: number; drag: number; dragging: boolean; lastX: number };

function interactiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('a, button, input, textarea, select, summary, [role="button"]'));
}

function EnvironmentLight() {
  const { scene, gl, invalidate } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const environment = pmrem.fromScene(room, 0.04);
    scene.environment = environment.texture;
    invalidate();
    return () => {
      scene.environment = null;
      environment.dispose();
      room.dispose();
      pmrem.dispose();
    };
  }, [scene, gl, invalidate]);
  return null;
}

function PauseWhenHidden() {
  const setFrameloop = useThree(state => state.setFrameloop);
  const invalidate = useThree(state => state.invalidate);
  useEffect(() => {
    const sync = () => {
      setFrameloop(document.hidden ? 'never' : 'demand');
      if (!document.hidden) invalidate();
    };
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, [setFrameloop, invalidate]);
  return null;
}

function applyFocus(records: readonly PartRecord[], focus: string | null, strength: number) {
  for (const record of records) {
    const active = focus != null && record.name === focus;
    for (const slot of record.slots) {
      slot.material.opacity = slot.opacity;
      slot.material.transparent = slot.transparent;
      slot.material.depthWrite = slot.depthWrite;
      if (!slot.paint || !slot.color || !slot.emissive) continue;
      slot.paint.color.copy(slot.color);
      if (!active && focus && strength > 0) slot.paint.color.multiplyScalar(1 - strength * 0.16);
      if (active && strength > 0.02) {
        slot.paint.emissive.set('#ffffff');
        slot.paint.emissiveIntensity = 0.08 * strength;
      } else {
        slot.paint.emissive.copy(slot.emissive);
        slot.paint.emissiveIntensity = slot.emissiveIntensity;
      }
    }
  }
}

function applyExplode(records: readonly PartRecord[], factor: number) {
  for (const record of records) {
    record.object.position.copy(record.base).addScaledVector(record.dir, factor);
  }
}

function FittedModel({
  prepared,
  poseRef,
  reducedRef,
  pointerRef,
  onReady,
}: {
  prepared: PreparedTractor;
  poseRef: React.RefObject<StagePose>;
  reducedRef: React.RefObject<boolean>;
  pointerRef: React.RefObject<PointerState>;
  onReady: () => void;
}) {
  const group = useRef<THREE.Group>(null);
  const fit = useRef(1);
  const spin = useRef(0);
  const highlight = useRef(0);
  const nudge = useRef({ yaw: 0, pitch: 0, x: 0, y: 0, zoom: 0 });
  const live = useRef<StagePose>({ ...DESKTOP_BEATS[0].pose });
  const camera = useThree(state => state.camera);
  const invalidate = useThree(state => state.invalidate);
  const ready = useRef(onReady);
  useEffect(() => { ready.current = onReady; }, [onReady]);

  useLayoutEffect(() => {
    const box = new THREE.Box3().setFromObject(prepared.root);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    prepared.root.position.sub(center);
    const maxDim = Math.max(size.x, size.y, size.z, 0.001);
    fit.current = 1.65 / maxDim;
    prepared.root.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
    });
    ready.current();
    invalidate();
  }, [prepared, invalidate]);

  useFrame((_, delta) => {
    const rig = group.current;
    if (!rig) return;
    const reduced = reducedRef.current;
    const target = poseRef.current;
    const dt = Math.min(delta, 0.05);
    const alpha = reduced ? 1 : 1 - Math.exp(-dt * LAMBDA);
    const current = live.current;
    let moving = false;
    (Object.keys(target) as (keyof StagePose)[]).forEach(key => {
      if (key === 'focus') {
        current.focus = target.focus;
        return;
      }
      const next = reduced ? target[key] : current[key] + (target[key] - current[key]) * alpha;
      if (Math.abs(next - current[key]) > 0.0006) moving = true;
      current[key] = next;
    });

    const pointer = pointerRef.current;
    if (reduced) {
      spin.current = 0;
      pointer.drag = 0;
    } else if (Math.abs(current.turn) > 0.001) {
      spin.current += current.turn * dt;
      moving = true;
    } else if (Math.abs(spin.current) > 0.001) {
      spin.current *= Math.exp(-dt * 2.6);
      moving = true;
    } else spin.current = 0;

    if (pointer.dragging) {
      if (Math.abs(pointer.drag) > 0.001) moving = true;
    } else {
      const nextDrag = reduced ? 0 : damp(pointer.drag, 0, dt, 4.5);
      if (Math.abs(nextDrag - pointer.drag) > 0.0006) moving = true;
      pointer.drag = nextDrag;
    }

    const eased = nudge.current;
    const aim = reduced ? { yaw: 0, pitch: 0, x: 0, y: 0, zoom: 0 } : {
      yaw: pointer.x * 0.28,
      pitch: pointer.y * -0.08,
      x: pointer.x * 0.16,
      y: pointer.y * -0.06,
      zoom: Math.hypot(pointer.x, pointer.y) * 0.035,
    };
    (Object.keys(aim) as (keyof typeof aim)[]).forEach(key => {
      const next = reduced ? 0 : damp(eased[key], aim[key], dt, 8);
      if (Math.abs(next - eased[key]) > 0.0006) moving = true;
      eased[key] = next;
    });

    const strengthTarget = current.focus ? 1 : 0;
    const nextStrength = reduced ? strengthTarget : damp(highlight.current, strengthTarget, dt, 7);
    if (Math.abs(nextStrength - highlight.current) > 0.004) moving = true;
    highlight.current = nextStrength;

    rig.position.set(current.x + eased.x, current.y + eased.y, current.z);
    rig.rotation.set(current.pitch + eased.pitch, current.yaw + spin.current + pointer.drag + eased.yaw, 0);
    rig.scale.setScalar(fit.current * current.scale * (1 + eased.zoom));
    camera.position.set(current.camX + eased.x * 0.35, current.camY + eased.pitch, current.camZ);
    camera.lookAt(current.lookX, current.lookY, current.lookZ);
    applyExplode(prepared.records, current.explode);
    applyFocus(prepared.records, current.focus, highlight.current);
    if (moving) invalidate();
  });

  return (
    <group ref={group}>
      <primitive object={prepared.root} />
    </group>
  );
}

function StageScene({
  poseRef,
  reducedRef,
  pointerRef,
  onReady,
  onLost,
}: {
  poseRef: React.RefObject<StagePose>;
  reducedRef: React.RefObject<boolean>;
  pointerRef: React.RefObject<PointerState>;
  onReady: () => void;
  onLost: () => void;
}) {
  const [prepared, setPrepared] = useState<PreparedTractor | null>(null);
  const lost = useRef(onLost);
  useEffect(() => { lost.current = onLost; }, [onLost]);

  useEffect(() => {
    let alive = true;
    let current: PreparedTractor | null = null;
    loadPartsTractor(HONGHU_T70_PARTS_URL, name => catalogByName(name, 't70')).then(next => {
      if (!alive) { next.dispose(); return; }
      current = next;
      setPrepared(next);
    }).catch(() => {
      if (alive) lost.current();
    });
    return () => {
      alive = false;
      current?.dispose();
    };
  }, []);

  return (
    <>
      <PauseWhenHidden />
      <EnvironmentLight />
      <ambientLight intensity={0.42} />
      <hemisphereLight args={['#f4f7fb', '#c5bfb4', 0.48]} />
      <directionalLight position={[4.5, 7.5, 5]} intensity={1.35} />
      <directionalLight position={[-4, 3.2, -2]} intensity={0.28} color="#d9e4f2" />
      {prepared && (
        <FittedModel
          prepared={prepared}
          poseRef={poseRef}
          reducedRef={reducedRef}
          pointerRef={pointerRef}
          onReady={onReady}
        />
      )}
    </>
  );
}

export default function HomeStage() {
  const lang = useLang();
  const [supported] = useState(probeWebGL);
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 959px)').matches);
  const [label, setLabel] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const reducedRef = useRef(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const pointerRef = useRef<PointerState>({ x: 0, y: 0, drag: 0, dragging: false, lastX: 0 });
  const invalidateRef = useRef<() => void>(() => {});
  const poseRef = useRef<StagePose>({ ...DESKTOP_BEATS[0].pose });

  const measure = useCallback(() => {
    const nodes = document.querySelectorAll<HTMLElement>('[data-home-beat]');
    const midpoints: number[] = [];
    nodes.forEach(node => {
      const rect = node.getBoundingClientRect();
      midpoints.push(rect.top + window.scrollY + rect.height / 2);
    });
    const beats = compact ? MOBILE_BEATS : DESKTOP_BEATS;
    const index = stageIndex(scrollIndex(midpoints, window.scrollY, window.innerHeight), midpoints.length, beats.length);
    const next = presentPose(sampleBeats(beats, index), reducedRef.current);
    poseRef.current = next;
    const part = next.focus;
    const named = part ? catalogByName(part, 't70') : null;
    setLabel(named ? hoverLabel(named.node.labelZh, lang, named.node.name, 't70') : '');
    invalidateRef.current();
  }, [compact, lang]);

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const width = window.matchMedia('(max-width: 959px)');
    const sync = () => {
      reducedRef.current = motion.matches;
      setCompact(width.matches);
    };
    sync();
    motion.addEventListener('change', sync);
    width.addEventListener('change', sync);
    return () => {
      motion.removeEventListener('change', sync);
      width.removeEventListener('change', sync);
    };
  }, []);

  useEffect(() => {
    if (!supported) return undefined;
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || event.pointerType !== 'mouse' || interactiveTarget(event.target)) return;
      pointerRef.current.dragging = true;
      pointerRef.current.lastX = event.clientX;
    };
    const onPointerMove = (event: PointerEvent) => {
      const pointer = pointerRef.current;
      pointer.x = event.clientX / Math.max(window.innerWidth, 1) - 0.5;
      pointer.y = event.clientY / Math.max(window.innerHeight, 1) - 0.5;
      if (pointer.dragging) {
        pointer.drag = Math.max(-0.7, Math.min(0.7, pointer.drag + (event.clientX - pointer.lastX) * 0.005));
        pointer.lastX = event.clientX;
      }
      invalidateRef.current();
    };
    const onPointerUp = () => {
      pointerRef.current.dragging = false;
      invalidateRef.current();
    };
    measure();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    document.addEventListener('toggle', schedule, true);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      document.removeEventListener('toggle', schedule, true);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, [measure, supported]);

  const rememberInvalidate = useCallback((invalidate: () => void) => {
    invalidateRef.current = invalidate;
  }, []);

  if (!supported || state === 'error') return null;

  return (
    <div className="home-stage" data-home-stage={state} aria-hidden="true">
      <ErrorBoundary fallback={null} onError={() => setState('error')}>
        <Canvas
          className="home-stage-canvas"
          frameloop="demand"
          dpr={compact ? 1 : DPR}
          camera={CAMERA}
          gl={GL}
          onCreated={({ gl, invalidate }) => {
            gl.setClearColor(0x000000, 0);
            rememberInvalidate(invalidate);
            bindContextLoss(gl.domElement, () => setState('error'));
            invalidate();
          }}
        >
          <StageScene
            poseRef={poseRef}
            reducedRef={reducedRef}
            pointerRef={pointerRef}
            onReady={() => setState('ready')}
            onLost={() => setState('error')}
          />
        </Canvas>
      </ErrorBoundary>
      {label ? <div className="home-stage-label">{label}</div> : null}
    </div>
  );
}

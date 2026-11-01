import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { EffectComposer, Autofocus } from '@react-three/postprocessing';
import { ErrorBoundary } from 'react-error-boundary';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { loadPartsTractor, partOwner, type PartRecord, type PreparedTractor } from '@/components/parts-tractor/load-parts-tractor';
import { publicAsset } from '@/lib/public-asset';
import { bindContextLoss, probeWebGL } from '@/lib/webgl';
import type { HeroPart } from './TractorHero';

type Props = {
  mode: 'orbit' | 'roam';
  autoOrbit: boolean;
  dof: boolean;
  selected: string | null;
  roamKeys: Set<string>;
  onParts: (parts: HeroPart[]) => void;
  onSelect: (name: string | null) => void;
  onReady: () => void;
  onFailed: () => void;
  onUserInteract: () => void;
};

/**
 * 默认取景：文案面板在左侧，画面中心点向左偏，让拖拉机主体落在右侧、
 * 不被面板压住。手机竖屏时中心点同时上移，让车身落在面板下方的空处。
 * FocusRig 复用同一个偏移，保证选中聚焦时零件仍出现在同一画面位置。
 */
function heroFraming() {
  const portrait = typeof window !== 'undefined' && window.innerWidth <= 899;
  return portrait
    ? { camera: [4.6, 3.0, 6.0] as [number, number, number], target: [-0.4, 1.7, 0] as [number, number, number], shift: new THREE.Vector3(-0.4, 0.6, 0) }
    : { camera: [3.2, 2.5, 5.2] as [number, number, number], target: [-1.2, 1.1, 0] as [number, number, number], shift: new THREE.Vector3(-1.2, 0, 0) };
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
  useEffect(() => {
    const sync = () => setFrameloop(document.hidden ? 'never' : 'always');
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, [setFrameloop]);
  return null;
}

function applyHighlight(records: readonly PartRecord[], selected: string | null) {
  for (const record of records) {
    const active = selected != null && record.name === selected;
    for (const edge of record.edges) edge.visible = active;
    for (const slot of record.slots) {
      // 选中时把其他零件幽灵化：变速箱这类藏在车身里的内部件
      // 不靠移近相机也能被看见，否则相机贴到车身面板上只剩一片模糊。
      if (selected && !active) {
        slot.material.transparent = true;
        slot.material.opacity = 0.15;
        slot.material.depthWrite = false;
      } else {
        slot.material.transparent = slot.transparent;
        slot.material.opacity = slot.opacity;
        slot.material.depthWrite = slot.depthWrite;
      }
      if (!slot.paint || !slot.color || !slot.emissive) continue;
      slot.paint.color.copy(slot.color);
      if (selected && !active) slot.paint.color.multiplyScalar(0.72);
      if (active) {
        slot.paint.emissive.set('#2e7d32');
        slot.paint.emissiveIntensity = 0.38;
      } else {
        slot.paint.emissive.copy(slot.emissive);
        slot.paint.emissiveIntensity = slot.emissiveIntensity;
      }
    }
  }
}

/** Smooth camera fly-to for a newly selected part; any user drag cancels it. */
function FocusRig({ focus, radius, controlsRef, reduced, enabled, shift }: {
  focus: THREE.Vector3 | null;
  radius: number;
  controlsRef: React.RefObject<OrbitControlsImpl | null>;
  reduced: boolean;
  enabled: boolean;
  shift: THREE.Vector3;
}) {
  const anim = useRef<{ fromPos: THREE.Vector3; toPos: THREE.Vector3; fromTarget: THREE.Vector3; toTarget: THREE.Vector3; t: number } | null>(null);
  const { camera } = useThree();
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return undefined;
    const cancel = () => { anim.current = null; };
    controls.addEventListener('start', cancel);
    return () => controls.removeEventListener('start', cancel);
  }, [controlsRef]);
  useEffect(() => {
    if (!focus || !enabled) return;
    const controls = controlsRef.current;
    if (!controls) return;
    const dir = camera.position.clone().sub(controls.target);
    if (dir.lengthSq() < 0.001) dir.set(1, 0.4, 1);
    dir.normalize();
    // 距离下限 4.2：小零件不再把相机贴进车身面板；
    // 同时保持与默认取景一致的画面偏移（零件偏右，不被左侧文案面板压住）。
    const distance = THREE.MathUtils.clamp(radius * 3.5 + 2.2, 4.2, 10);
    anim.current = {
      fromPos: camera.position.clone(),
      toPos: focus.clone().addScaledVector(dir, distance).add(shift),
      fromTarget: controls.target.clone(),
      toTarget: focus.clone().add(shift),
      t: 0,
    };
    if (reduced) {
      camera.position.copy(anim.current.toPos);
      controls.target.copy(anim.current.toTarget);
      anim.current = null;
    }
  }, [focus, radius, camera, controlsRef, reduced, shift, enabled]);
  useFrame((_, delta) => {
    const current = anim.current;
    const controls = controlsRef.current;
    if (!current || !controls) return;
    current.t = Math.min(1, current.t + delta / 0.65);
    const ease = 1 - Math.pow(1 - current.t, 3);
    camera.position.lerpVectors(current.fromPos, current.toPos, ease);
    controls.target.lerpVectors(current.fromTarget, current.toTarget, ease);
    controls.update();
    if (current.t >= 1) anim.current = null;
  });
  return null;
}

/** Free-roam: WASD/arrows move, drag looks, camera stays outside the tractor. */
function RoamRig({ active, roamKeys, controlsRef }: {
  active: boolean;
  roamKeys: Set<string>;
  controlsRef: React.RefObject<OrbitControlsImpl | null>;
}) {
  const yaw = useRef(0);
  const pitch = useRef(0);
  const { camera, gl } = useThree();
  const dragging = useRef(false);
  const last = useRef({ x: 0, y: 0 });
  useEffect(() => {
    if (!active) return undefined;
    const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    yaw.current = euler.y;
    pitch.current = euler.x;
    const down = (event: PointerEvent) => {
      if ((event.target as Element | null)?.closest('button, a')) return;
      dragging.current = true;
      last.current = { x: event.clientX, y: event.clientY };
    };
    const move = (event: PointerEvent) => {
      if (!dragging.current) return;
      yaw.current -= (event.clientX - last.current.x) * 0.005;
      pitch.current = THREE.MathUtils.clamp(pitch.current - (event.clientY - last.current.y) * 0.005, -0.9, 0.9);
      last.current = { x: event.clientX, y: event.clientY };
    };
    const up = () => { dragging.current = false; };
    const element = gl.domElement;
    element.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      element.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [active, camera, gl]);
  useFrame((_, delta) => {
    if (!active) return;
    const keys = roamKeys;
    const speed = 2.6 * Math.min(delta, 0.05);
    const forward = new THREE.Vector3(-Math.sin(yaw.current), 0, -Math.cos(yaw.current));
    const right = new THREE.Vector3(Math.cos(yaw.current), 0, -Math.sin(yaw.current));
    const step = new THREE.Vector3();
    if (keys.has('forward')) step.add(forward);
    if (keys.has('back')) step.sub(forward);
    if (keys.has('right')) step.add(right);
    if (keys.has('left')) step.sub(right);
    if (keys.has('turnLeft')) yaw.current += 1.4 * delta;
    if (keys.has('turnRight')) yaw.current -= 1.4 * delta;
    if (step.lengthSq() > 0) camera.position.addScaledVector(step.normalize(), speed);
    camera.position.y = THREE.MathUtils.clamp(camera.position.y, 0.6, 4.5);
    const horizontal = Math.hypot(camera.position.x, camera.position.z);
    if (horizontal > 9) {
      camera.position.x *= 9 / horizontal;
      camera.position.z *= 9 / horizontal;
    }
    camera.rotation.order = 'YXZ';
    camera.rotation.set(pitch.current, yaw.current, 0);
    const controls = controlsRef.current;
    if (controls) controls.target.copy(camera.position).addScaledVector(new THREE.Vector3(-Math.sin(yaw.current), Math.tan(pitch.current), -Math.cos(yaw.current)), 2);
  });
  return null;
}

function FittedModel({ prepared, selected, onFocus, onPick }: {
  prepared: PreparedTractor;
  selected: string | null;
  onFocus: (center: THREE.Vector3, radius: number) => void;
  onPick: (name: string | null) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const { camera, gl } = useThree();
  const downPos = useRef<{ x: number; y: number } | null>(null);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);

  useLayoutEffect(() => {
    const box = new THREE.Box3().setFromObject(prepared.root);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const fit = 3.2 / Math.max(size.x, size.y, size.z, 0.001);
    prepared.root.position.sub(center);
    if (group.current) {
      group.current.scale.setScalar(fit);
      group.current.position.y = -(box.min.y - center.y) * fit;
    }
    prepared.root.updateWorldMatrix(true, true);
  }, [prepared]);

  useEffect(() => {
    applyHighlight(prepared.records, selected);
    if (!selected) return;
    const record = prepared.records.find(item => item.name === selected);
    if (!record) return;
    record.object.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(record.object);
    if (box.isEmpty()) return;
    onFocus(box.getCenter(new THREE.Vector3()), Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.25));
  }, [prepared, selected, onFocus]);

  useEffect(() => {
    const element = gl.domElement;
    const down = (event: PointerEvent) => { downPos.current = { x: event.clientX, y: event.clientY }; };
    const up = (event: PointerEvent) => {
      const start = downPos.current;
      downPos.current = null;
      if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6) return;
      const rect = element.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(prepared.root.children, true);
      const owner = hits.length > 0 ? partOwner(hits[0].object) : null;
      const record = owner ? prepared.records.find(item => item.object === owner) : undefined;
      onPick(record ? record.name : null);
    };
    const move = (event: PointerEvent) => {
      const rect = element.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(prepared.root.children, true);
      element.style.cursor = hits.length > 0 ? 'pointer' : 'grab';
    };
    element.addEventListener('pointerdown', down);
    element.addEventListener('pointerup', up);
    element.addEventListener('pointermove', move);
    return () => {
      element.removeEventListener('pointerdown', down);
      element.removeEventListener('pointerup', up);
      element.removeEventListener('pointermove', move);
    };
  }, [gl, camera, prepared, raycaster, onPick]);

  return (
    <group ref={group}>
      <primitive object={prepared.root} />
    </group>
  );
}

function Scene({ mode, autoOrbit, dof, selected, roamKeys, onParts, onSelect, onReady, onFailed, onUserInteract }: Props) {
  const [prepared, setPrepared] = useState<PreparedTractor | null>(null);
  const [focus, setFocus] = useState<THREE.Vector3>(() => new THREE.Vector3(0, 1.1, 0));
  const [focusRadius, setFocusRadius] = useState(1.6);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const framing = useMemo(() => heroFraming(), []);
  const reduced = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, []);
  const failed = useRef(onFailed);
  useEffect(() => { failed.current = onFailed; }, [onFailed]);

  // 回调经父组件 useCallback 稳定后仍用 ref 持有：父组件任何重渲染
  // 都不能让模型加载 effect 重跑，否则每次清理都会丢弃正在加载的模型。
  const onPartsRef = useRef(onParts);
  const onReadyRef = useRef(onReady);
  useEffect(() => { onPartsRef.current = onParts; }, [onParts]);
  useEffect(() => { onReadyRef.current = onReady; }, [onReady]);
  useEffect(() => {
    let alive = true;
    let current: PreparedTractor | null = null;
    loadPartsTractor(publicAsset('models/tractor-parts/tractor_parts.glb'))
      .then(next => {
        if (!alive) { next.dispose(); return; }
        current = next;
        setPrepared(next);
        onPartsRef.current(next.records.map(record => ({ name: record.name, labelZh: record.labelZh })));
        onReadyRef.current();
      })
      .catch(() => { if (alive) failed.current(); });
    return () => {
      alive = false;
      current?.dispose();
    };
  }, []);

  const onFocus = useCallback((center: THREE.Vector3, radius: number) => {
    setFocus(center.clone());
    setFocusRadius(radius);
  }, []);

  return (
    <>
      <PauseWhenHidden />
      <EnvironmentLight />
      <color attach="background" args={['#0d1512']} />
      <ambientLight intensity={0.55} />
      <hemisphereLight args={['#eef4ee', '#1a241c', 0.5]} />
      <directionalLight position={[5, 8, 3]} intensity={2.2} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-5} shadow-camera-right={5} shadow-camera-top={5} shadow-camera-bottom={-5} />
      <directionalLight position={[-4, 3, -3]} intensity={0.5} color="#cfe0ff" />
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, 0]} receiveShadow>
        <circleGeometry args={[7, 48]} />
        <meshStandardMaterial color="#1a241c" roughness={1} metalness={0} />
      </mesh>
      {prepared && (
        <FittedModel prepared={prepared} selected={selected} onFocus={onFocus} onPick={onSelect} />
      )}
      {mode === 'orbit' && (
        <OrbitControls
          ref={controlsRef}
          makeDefault
          enableDamping
          dampingFactor={0.08}
          minDistance={3.0}
          maxDistance={12}
          maxPolarAngle={Math.PI * 0.52}
          target={framing.target}
          autoRotate={autoOrbit && !selected}
          autoRotateSpeed={0.7}
          onStart={onUserInteract}
        />
      )}
      {mode === 'roam' && <RoamRig active roamKeys={roamKeys} controlsRef={controlsRef} />}
      <FocusRig focus={selected ? focus : null} radius={focusRadius} controlsRef={controlsRef} reduced={reduced} enabled={mode === 'orbit'} shift={framing.shift} />
      {dof && (
        <EffectComposer multisampling={4}>
          <Autofocus target={[focus.x, focus.y, focus.z]} worldFocusRange={2.8} focalLength={0.05} bokehScale={1.6} />
        </EffectComposer>
      )}
    </>
  );
}

export default function TractorScene(props: Props) {
  const [supported] = useState(probeWebGL);
  const [error, setError] = useState(false);
  const framing = useMemo(() => heroFraming(), []);
  const onFailedRef = useRef(props.onFailed);
  useEffect(() => { onFailedRef.current = props.onFailed; }, [props.onFailed]);
  useEffect(() => {
    if (!supported || error) onFailedRef.current();
  }, [supported, error]);
  if (!supported || error) return null;
  return (
    <ErrorBoundary fallback={null} onError={() => setError(true)}>
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: framing.camera, fov: 38, near: 0.05, far: 60 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => {
          gl.setClearColor('#0d1512', 1);
          bindContextLoss(gl.domElement, () => setError(true));
        }}
      >
        <Scene {...props} />
      </Canvas>
    </ErrorBoundary>
  );
}

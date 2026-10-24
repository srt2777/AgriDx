import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, createPortal, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Html, Line, OrbitControls } from '@react-three/drei';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import StudioLighting from './StudioLighting';
import { studioQuality } from './studio-rendering';
import IntegratedEngine from './IntegratedEngine';
import { bindContextLoss } from '@/lib/webgl';
import { catalogByName, hoverLabel, type PartsModelId } from './parts-catalog';
import { loadPartsTractor, partOwner, type PartRecord, type PreparedTractor } from './load-parts-tractor';
import { partVisual, smoothstep, visualSets, type StudioPresentation } from './parts-motion';
import { PARTS_SHOWCASE } from './parts-models';
import { STUDIO_LIGHT_LOOK, type StudioLight } from '@/components/studio-schematic';

const GL = { antialias: true, alpha: true, preserveDrawingBuffer: true } as const;
const GREY = new THREE.Color('#8d9aaa');
const CYAN = new THREE.Color('#7ad7ff');
const HOT = new THREE.Color('#ff5a2a');

type Leader = { key: string; label: string; start: [number, number, number]; end: [number, number, number] };

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

function applyVisual(record: PartRecord, visual: ReturnType<typeof partVisual>) {
  for (const slot of record.slots) {
    slot.material.opacity = slot.opacity * visual.opacity;
    slot.material.transparent = visual.opacity < 0.98 || slot.transparent;
    slot.material.depthWrite = visual.depthWrite && slot.depthWrite && visual.opacity > 0.2;
    const paint = slot.paint;
    if (!paint || !slot.color || !slot.emissive) continue;
    if (visual.pulse) {
      paint.emissive.copy(HOT);
      paint.emissiveIntensity = 0.75;
    } else if (visual.outline) {
      paint.emissive.copy(CYAN);
      paint.emissiveIntensity = 0.28;
    } else {
      paint.emissive.copy(slot.emissive);
      paint.emissiveIntensity = slot.emissiveIntensity;
    }
    paint.color.copy(slot.color);
    if (visual.desaturate > 0) paint.color.lerp(GREY, visual.desaturate);
  }
  // Ghosted or isolated-away shells must not leave an opaque shadow over internals.
  record.object.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    object.castShadow = visual.opacity >= .98 && materials.some(material => material.visible && material.opacity >= .98);
  });
  for (const edge of record.edges) edge.visible = visual.outline && !visual.pulse;
}

function selectedRecord(record: PartRecord, selection: string | null) {
  if (!selection) return false;
  if (selection.startsWith('group:')) return record.partId === selection.slice(6);
  return record.name === selection;
}

function TractorBody({
  prepared,
  engineRunning,
  engineSpeed,
  selection,
  explode,
  presentation,
  faultPartId,
  reduced,
  lang,
  modelId,
  onSelect,
}: {
  prepared: PreparedTractor;
  engineRunning: boolean;
  engineSpeed: number;
  selection: string | null;
  explode: number;
  presentation: StudioPresentation;
  faultPartId: string | null;
  reduced: boolean;
  lang: 'zh' | 'en';
  modelId: PartsModelId;
  onSelect: (name: string) => void;
}) {
  const { camera, invalidate, controls, gl } = useThree();
  const orbit = controls as OrbitControlsImpl | null;
  const current = useRef(0);
  const target = useRef(0);
  const [leaders, setLeaders] = useState<Leader[]>([]);
  const recordsRef = useRef(prepared.records);
  useEffect(() => {
    recordsRef.current = prepared.records;
  }, [prepared.records]);
  const [hovered, setHovered] = useState<string | null>(null);
  const fitted = useRef(false);
  const cam = useRef({
    active: false,
    t: 0,
    fromPos: new THREE.Vector3(),
    toPos: new THREE.Vector3(),
    fromTarget: new THREE.Vector3(),
    toTarget: new THREE.Vector3(),
  });
  const box = useMemo(() => new THREE.Box3(), []);
  const sphere = useMemo(() => new THREE.Sphere(), []);
  const outward = useMemo(() => new THREE.Vector3(), []);
  const hoveredRecord = prepared.records.find(record => record.name === hovered) ?? null;
  const showcase = PARTS_SHOWCASE[modelId];
  const engineRecord = modelId === 'diesel' ? prepared.records.find(record => record.partId === 'engine') : undefined;
  const sets = useMemo(() => visualSets(modelId), [modelId]);

  useEffect(() => {
    target.current = explode;
    if (reduced) {
      current.current = explode;
      writePositions(recordsRef.current, explode);
      setLeaders(explode >= 0.98 ? buildLeaders(recordsRef.current, showcase.leaderLength) : []);
    }
    invalidate();
  }, [explode, invalidate, reduced, showcase.leaderLength]);

  useFrame((_, delta) => {
    const records = recordsRef.current;
    let busy = false;
    if (!reduced && Math.abs(current.current - target.current) > 0.004) {
      const step = 1 - Math.exp(-Math.min(delta, 0.05) * 6);
      current.current += (target.current - current.current) * step;
      if (Math.abs(current.current - target.current) <= 0.004) current.current = target.current;
      writePositions(records, current.current);
      busy = current.current !== target.current;
      if (!busy) setLeaders(current.current >= 0.98 ? buildLeaders(records, showcase.leaderLength) : []);
    }
    if (cam.current.active && orbit) {
      const step = Math.min(delta, 0.05) * 1.6;
      cam.current.t = Math.min(1, cam.current.t + step);
      const eased = smoothstep(cam.current.t);
      camera.position.lerpVectors(cam.current.fromPos, cam.current.toPos, eased);
      orbit.target.lerpVectors(cam.current.fromTarget, cam.current.toTarget, eased);
      orbit.update();
      if (cam.current.t < 1) busy = true;
      else cam.current.active = false;
    }
    if (faultPartId && !reduced) {
      const intensity = 0.35 + 0.4 * (0.5 + 0.5 * Math.sin(performance.now() * 0.004));
      for (const record of records) {
        if (record.partId !== faultPartId) continue;
        for (const slot of record.slots) {
          if (slot.paint) slot.paint.emissiveIntensity = intensity;
        }
      }
      busy = true;
    }
    if (busy) invalidate();
  });

  useEffect(() => {
    const hasSelection = selection !== null;
    for (const record of prepared.records) {
      applyVisual(record, partVisual({
        partId: record.partId,
        selected: selectedRecord(record, selection),
        hovered: record.name === hovered,
        hasSelection,
        presentation,
        faultPartId,
        occluding: sets.occluding,
        internal: sets.internal,
      }));
      if (modelId === 'diesel' && record.partId === 'engine') {
        for (const edge of record.edges) edge.visible = false;
      }
    }
    invalidate();
  }, [faultPartId, hovered, invalidate, prepared.records, presentation, reduced, selection, sets, modelId]);

  useEffect(() => {
    if (!orbit) return;
    const matched = prepared.records.filter(record => selectedRecord(record, selection));
    if (!matched.length) {
      if (selection) return;
      box.setFromObject(prepared.root);
    } else {
      box.makeEmpty();
      for (const record of matched) box.expandByObject(record.object);
    }
    if (box.isEmpty()) return;
    box.getCenter(cam.current.toTarget);
    box.getBoundingSphere(sphere);
    const fov = ((camera instanceof THREE.PerspectiveCamera ? camera.fov : 38) * Math.PI) / 180;
    const distance = THREE.MathUtils.clamp((sphere.radius / Math.sin(fov / 2)) * 1.35, showcase.frameMin, 80);
    if (!fitted.current) outward.set(1, 0.72, 1);
    else outward.copy(camera.position).sub(orbit.target);
    if (outward.lengthSq() < 1e-4) outward.set(1, 0.72, 1);
    outward.normalize().multiplyScalar(distance);
    cam.current.toPos.copy(cam.current.toTarget).add(outward);
    if (!fitted.current) {
      camera.position.copy(cam.current.toPos);
      orbit.target.copy(cam.current.toTarget);
      orbit.update();
      fitted.current = true;
      invalidate();
      return;
    }
    if (reduced) {
      camera.position.copy(cam.current.toPos);
      orbit.target.copy(cam.current.toTarget);
      orbit.update();
      cam.current.active = false;
      invalidate();
      return;
    }
    cam.current.fromPos.copy(camera.position);
    cam.current.fromTarget.copy(orbit.target);
    cam.current.t = 0;
    cam.current.active = true;
    invalidate();
  }, [box, camera, invalidate, orbit, outward, prepared.records, prepared.root, reduced, selection, showcase.frameMin, sphere]);

  const pick = (event: ThreeEvent<PointerEvent>) => {
    const owner = partOwner(event.object);
    return owner ? prepared.records.find(record => record.object === owner) ?? null : null;
  };

  return (
    <>
      <primitive
        object={prepared.root}
        onPointerOver={(event: ThreeEvent<PointerEvent>) => {
          event.stopPropagation();
          const record = pick(event);
          if (!record) return;
          setHovered(record.name);
          gl.domElement.style.cursor = 'pointer';
        }}
        onPointerOut={(event: ThreeEvent<PointerEvent>) => {
          event.stopPropagation();
          setHovered(null);
          gl.domElement.style.cursor = '';
        }}
        onClick={(event: ThreeEvent<PointerEvent>) => {
          event.stopPropagation();
          const record = pick(event);
          if (record) onSelect(record.name);
        }}
      />
      {engineRecord && <IntegratedEngine record={engineRecord} running={engineRunning && !reduced} speed={engineSpeed} explode={explode} presentation={presentation} visible={presentation !== 'isolate' || !selection || selectedRecord(engineRecord, selection)} />}
      {hoveredRecord && createPortal(
        <Html center zIndexRange={[30, 0]} wrapperClass="part-tip-wrap" style={{ pointerEvents: 'none' }}>
          <div className="part-tip" role="tooltip">{hoverLabel(hoveredRecord.labelZh, lang, hoveredRecord.name, modelId)}</div>
        </Html>,
        hoveredRecord.object,
      )}
      {leaders.map(leader => (
        <group key={leader.key}>
          <Line points={[leader.start, leader.end]} color="#7ad7ff" lineWidth={1} raycast={() => undefined} />
          <Html position={leader.end} center wrapperClass="tractor-leader" zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
            <span className="tractor-leader-label">{leader.label}</span>
          </Html>
        </group>
      ))}
    </>
  );
}

function writePositions(records: PartRecord[], t: number) {
  const eased = smoothstep(t);
  for (const record of records) {
    record.object.position.set(
      record.base.x + record.dir.x * eased,
      record.base.y + record.dir.y * eased,
      record.base.z + record.dir.z * eased,
    );
  }
}

function buildLeaders(records: PartRecord[], length: number): Leader[] {
  const world = new THREE.Vector3();
  const outward = new THREE.Vector3();
  return records.map(record => {
    record.object.updateWorldMatrix(true, false);
    record.object.getWorldPosition(world);
    outward.copy(record.dir);
    if (outward.lengthSq() < 1e-4) outward.set(0, 1, 0);
    outward.normalize().multiplyScalar(length);
    return {
      key: record.name,
      label: record.labelZh,
      start: [world.x, world.y, world.z],
      end: [world.x + outward.x, world.y + outward.y, world.z + outward.z],
    };
  });
}

export default function PartsTractorScene({
  url,
  engineRunning = false,
  engineSpeed = 2,
  selection,
  explode,
  presentation,
  light,
  faultPartId,
  reduced,
  lang,
  modelId,
  onSelect,
  onReady,
  onLost,
  onError,
}: {
  url: string;
  engineRunning?: boolean;
  engineSpeed?: number;
  selection: string | null;
  explode: number;
  presentation: StudioPresentation;
  light: StudioLight;
  faultPartId: string | null;
  reduced: boolean;
  lang: 'zh' | 'en';
  modelId: PartsModelId;
  onSelect: (name: string) => void;
  onReady: () => void;
  onLost: () => void;
  onError: (message: string) => void;
}) {
  const look = STUDIO_LIGHT_LOOK[light];
  const [constrained] = useState(() => window.matchMedia('(pointer: coarse)').matches || navigator.hardwareConcurrency <= 4);
  const quality = studioQuality(constrained);
  const showcase = PARTS_SHOWCASE[modelId];
  const [prepared, setPrepared] = useState<PreparedTractor | null>(null);
  const lost = useRef(onLost);
  const ready = useRef(onReady);
  const fail = useRef(onError);
  useEffect(() => {
    lost.current = onLost;
    ready.current = onReady;
    fail.current = onError;
  }, [onLost, onReady, onError]);

  useLayoutEffect(() => {
    let alive = true;
    let current: PreparedTractor | null = null;
    setPrepared(null);
    loadPartsTractor(url, name => catalogByName(name, modelId)).then(next => {
      if (!alive) { next.dispose(); return; }
      current = next;
      setPrepared(next);
      ready.current();
    }).catch((error: unknown) => {
      if (alive) fail.current(error instanceof Error ? error.message : String(error));
    });
    return () => {
      alive = false;
      current?.dispose();
    };
  }, [modelId, url]);

  if (!prepared) return null;

  return (
    <Canvas
      className="tractor-canvas"
      frameloop={engineRunning && modelId === 'diesel' && !reduced ? 'always' : 'demand'}
      shadows
      camera={{ position: [showcase.camera[0], showcase.camera[1], showcase.camera[2]], fov: 38 }}
      gl={GL}
      dpr={quality.dpr}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1;
        gl.outputColorSpace = THREE.SRGBColorSpace;
        gl.shadowMap.type = THREE.PCFSoftShadowMap;
        bindContextLoss(gl.domElement, () => lost.current());
      }}
    >
      <color attach="background" args={[look.background]} />
      <fog attach="fog" args={[look.fog, 24, 70]} />
      <StudioLighting prepared={prepared} light={light} constrained={constrained} />
      <EnvironmentLight />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[2000, 2000]} />
        <meshStandardMaterial color={look.background} roughness={0.88} metalness={0.02} />
      </mesh>
      <TractorBody
        prepared={prepared}
        engineRunning={engineRunning}
        engineSpeed={engineSpeed}
        selection={selection}
        explode={explode}
        presentation={presentation}
        faultPartId={faultPartId}
        reduced={reduced}
        lang={lang}
        modelId={modelId}
        onSelect={onSelect}
      />
      <OrbitControls makeDefault enableDamping={false} minDistance={showcase.orbitMin} maxDistance={80} maxPolarAngle={Math.PI / 2.05} />
    </Canvas>
  );
}

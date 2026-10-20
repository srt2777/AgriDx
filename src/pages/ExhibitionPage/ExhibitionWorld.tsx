import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, MeshReflectorMaterial, OrbitControls, RoundedBox } from '@react-three/drei';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import { ErrorBoundary } from 'react-error-boundary';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { ArrowUpRight, Loader2, Tractor } from 'lucide-react';
import TractorModel from '@/components/TractorModel';
import { useLang } from '@/hooks/useLang';
import { useTheme } from '@/hooks/useTheme';
import {
  initialDriveState,
  nearbyZone,
  planRoute,
  stepDrive,
  stepRoute,
  WORLD_ZONES,
  type DriveAction,
  type DriveState,
  type WorldMode,
  type ZoneId,
} from './world-navigation';

export interface WorldInput {
  actions: Map<string, DriveAction>;
  wake?: () => void;
}
interface WorldProps {
  mode: WorldMode;
  selected: ZoneId | null;
  focus: ZoneId | null;
  destination: { id: ZoneId; revision: number } | null;
  reset: number;
  input: WorldInput;
  reducedMotion: boolean;
  onSelect: (id: ZoneId) => void;
  onPosition: (state: DriveState) => void;
  onNearby: (id: ZoneId | null) => void;
}

const GL_OPTIONS = { alpha: true, antialias: true } as const;
const SHADOW_OPTIONS = { type: THREE.PCFShadowMap };
const CAMERA = { position: [23, 25, 29] as [number, number, number], fov: 35, near: 0.1, far: 150 };

function LocalEnvironment() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const generator = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const target = generator.fromScene(room, 0.025);
    scene.environment = target.texture;
    scene.environmentIntensity = 0.55;
    return () => {
      scene.environment = null;
      target.dispose();
      room.dispose();
      generator.dispose();
    };
  }, [gl, scene]);
  return null;
}

function Block({
  position,
  size,
  color = '#182a3e',
  glow,
  rotation,
}: {
  position: [number, number, number];
  size: [number, number, number];
  color?: string;
  glow?: string;
  rotation?: [number, number, number];
}) {
  // Thin road markings and light strips need only six faces.
  if (Math.min(...size) < 0.2)
    return (
      <mesh position={position} rotation={rotation} castShadow receiveShadow>
        <boxGeometry args={size} />
        <meshStandardMaterial
          color={color}
          roughness={0.33}
          metalness={0.55}
          emissive={glow ?? '#000000'}
          emissiveIntensity={glow ? 0.65 : 0}
        />
      </mesh>
    );
  return (
    <RoundedBox
      args={size}
      position={position}
      rotation={rotation}
      radius={0.055}
      smoothness={2}
      castShadow
      receiveShadow
    >
      <meshStandardMaterial
        color={color}
        roughness={0.33}
        metalness={0.55}
        emissive={glow ?? '#000000'}
        emissiveIntensity={glow ? 0.65 : 0}
      />
    </RoundedBox>
  );
}

function Ring({
  position,
  radius,
  color,
  rotation = [-Math.PI / 2, 0, 0],
  thickness = 0.025,
}: {
  position: [number, number, number];
  radius: number;
  color: string;
  rotation?: [number, number, number];
  thickness?: number;
}) {
  return (
    <mesh position={position} rotation={rotation}>
      <torusGeometry args={[radius, thickness, 8, 80]} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={1.1}
        roughness={0.2}
        metalness={0.65}
      />
    </mesh>
  );
}

function KnowledgeSculpture({ color }: { color: string }) {
  return (
    <group>
      {[-1.1, 0, 1.1].map((x, i) => (
        <group key={x} position={[x, 0.4, 0]} rotation={[0, -0.22 + i * 0.22, -0.08 + i * 0.08]}>
          <Block size={[0.85, 1.65 + i * 0.35, 0.55]} position={[0, 1 + i * 0.16, 0]} color="#b8c9d6" />
          <Block
            size={[0.08, 1.69 + i * 0.35, 0.61]}
            position={[-0.43, 1 + i * 0.16, 0]}
            color="#22658b"
            glow={color}
          />
          {[0.4, 0.75, 1.1].map((y) => (
            <Block
              key={y}
              size={[0.48, 0.025, 0.02]}
              position={[0.03, y + i * 0.35, 0.289]}
              color="#3b5a6c"
            />
          ))}
        </group>
      ))}
      <Block size={[4.2, 0.09, 0.12]} position={[0, 3.35, -0.9]} color={color} glow={color} />
      {[-2, 2].map((x) => (
        <Block key={x} size={[0.1, 3.1, 0.12]} position={[x, 1.8, -0.9]} color="#517888" />
      ))}
    </group>
  );
}

function DiagnosisSculpture({ color }: { color: string }) {
  return (
    <group>
      <Block size={[2.8, 0.3, 2.2]} position={[0, 0.45, 0]} color="#273b4c" />
      {[-1.25, 1.25].map((x) => (
        <group key={x}>
          <Block size={[0.16, 2.7, 0.18]} position={[x, 1.95, -0.7]} color="#b6c0bd" />
          <Block size={[0.035, 2.3, 0.2]} position={[x, 1.95, -0.6]} color={color} glow={color} />
        </group>
      ))}
      <Block size={[2.8, 0.15, 0.5]} position={[0, 3.32, -0.7]} color="#d1c7b7" />
      <mesh position={[0, 1.85, 0]} rotation={[0.3, 0.6, 0.25]} castShadow>
        <icosahedronGeometry args={[0.82, 0]} />
        <meshStandardMaterial color="#a47f47" metalness={0.8} roughness={0.22} />
      </mesh>
      <Ring position={[0, 1.85, 0]} radius={1.15} color={color} rotation={[Math.PI / 2.8, 0.1, 0.2]} />
      {[-0.6, -0.3, 0, 0.3, 0.6].map((x, i) => (
        <Block
          key={x}
          position={[x, 0.73 + Math.sin(i) * 0.08, 1]}
          size={[0.11, 0.3 + (i % 3) * 0.17, 0.1]}
          color={color}
          glow={color}
        />
      ))}
    </group>
  );
}

function ModelSculpture({ color }: { color: string }) {
  return (
    <group>
      <Block size={[3.4, 0.25, 2.2]} position={[0, 0.48, 0]} color="#3e585c" />
      <mesh position={[0, 1.75, 0]} rotation={[0, 0.35, 0.45]} castShadow>
        <torusGeometry args={[0.85, 0.23, 12, 36]} />
        <meshStandardMaterial color="#aab9b8" metalness={0.86} roughness={0.27} />
      </mesh>
      <Ring
        position={[0, 1.75, 0]}
        radius={1.35}
        color={color}
        rotation={[0, 0.35, 0.45]}
        thickness={0.018}
      />
      {[-1, 1].map((sign) => (
        <Block key={sign} size={[0.45, 0.5, 0.5]} position={[sign * 1.15, 1.75, 0]} color="#527b76" />
      ))}
      <Block size={[0.12, 1.1, 0.14]} position={[0, 1.05, 0]} color="#3b565b" />
      <Block size={[2.7, 0.07, 0.08]} position={[0, 0.66, 1.11]} color={color} glow={color} />
    </group>
  );
}

function ResearchSculpture({ color }: { color: string }) {
  return (
    <group>
      <Block size={[2.7, 0.3, 2]} position={[0, 0.48, 0]} color="#354354" />
      <group position={[0, 1.25, 0.1]} rotation={[-0.5, 0, 0]}>
        {[-1, 1].map((sign) => (
          <group key={sign} rotation={[0, 0, sign * -0.3]}>
            <Block size={[1.05, 0.16, 1.5]} position={[sign * 0.5, 0.2, 0]} color="#c3d0d9" />
            {[-0.45, -0.15, 0.15, 0.45].map((z) => (
              <Block key={z} size={[0.65, 0.018, 0.02]} position={[sign * 0.52, 0.29, z]} color="#5a7484" />
            ))}
          </group>
        ))}
      </group>
      <Ring
        position={[0, 2.7, -0.6]}
        radius={0.85}
        color={color}
        rotation={[0.2, 0.25, 0]}
        thickness={0.022}
      />
      {[0, 1, 2].map((i) => (
        <mesh
          key={i}
          position={[
            Math.cos((i * Math.PI * 2) / 3) * 0.85,
            2.7 + Math.sin((i * Math.PI * 2) / 3) * 0.85,
            -0.6,
          ]}
          castShadow
        >
          <sphereGeometry args={[0.13, 16, 12]} />
          <meshStandardMaterial color="#dae7ec" metalness={0.7} roughness={0.2} />
        </mesh>
      ))}
    </group>
  );
}

function Pavilion({
  zone,
  selected,
  onSelect,
}: {
  zone: (typeof WORLD_ZONES)[number];
  selected: boolean;
  onSelect: (id: ZoneId) => void;
}) {
  const lang = useLang();
  const color = zone.color;
  const [hot, setHot] = useState(false);
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => { invalidate(); }, [hot, selected, invalidate]);
  const lit = selected || hot;
  return (
    <group position={[zone.x, 0, zone.z]}>
      <group
        onClick={(event) => {
          event.stopPropagation();
          onSelect(zone.id);
        }}
        onPointerOver={(event) => {
          event.stopPropagation();
          setHot(true);
        }}
        onPointerOut={() => setHot(false)}
      >
        <mesh position={[0, 0.13, 0]} receiveShadow castShadow>
          <cylinderGeometry args={[2.7, 2.8, 0.25, 64]} />
          <meshStandardMaterial color={lit ? '#294b60' : '#1a3042'} emissive={color} emissiveIntensity={lit ? 0.22 : 0} metalness={0.72} roughness={0.35} />
        </mesh>
        <Ring position={[0, 0.27, 0]} radius={2.65} color={color} thickness={lit ? 0.045 : 0.018} />
        {zone.id === 'knowledge' && <KnowledgeSculpture color={color} />}
        {zone.id === 'diagnosis' && <DiagnosisSculpture color={color} />}
        {zone.id === 'models' && <ModelSculpture color={color} />}
        {zone.id === 'research' && <ResearchSculpture color={color} />}
      </group>
      <Html position={[0, 4, 0]} center zIndexRange={[8, 4]} className="world-label-wrap">
        <button
          type="button"
          className={`world-zone-label${selected ? ' is-selected' : ''}`}
          style={{ '--zone-color': color } as React.CSSProperties}
          onClick={() => onSelect(zone.id)}
        >
          <span>
            {zone.number} / {lang === 'zh' ? '展区' : 'ZONE'}
          </span>
          <strong>
            {lang === 'zh' ? zone.zh : zone.en}
            <ArrowUpRight size={13} />
          </strong>
        </button>
      </Html>
    </group>
  );
}

function CampusFloor() {
  const dark = useTheme() === 'dark';
  const small = useThree((state) => state.size.width < 700);
  const posts = useMemo(() => Array.from({ length: 12 }, (_, i) => -11 + i * 2), []);
  return (
    <group>
      <Block position={[0, -0.5, 0]} size={[29, 0.9, 24]} color={dark ? '#202e3a' : '#c4d3df'} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.035, 0]} receiveShadow>
        <planeGeometry args={[28.7, 23.7]} />
        <MeshReflectorMaterial
          resolution={small ? 128 : 256}
          blur={small ? [0, 0] : [40, 20]}
          mixBlur={small ? 0 : 0.75}
          mixStrength={1.3}
          mirror={0.3}
          color={dark ? '#293c4b' : '#b5c9d7'}
          roughness={0.65}
          metalness={0.7}
          depthScale={0.4}
          minDepthThreshold={0.4}
          maxDepthThreshold={1.4}
        />
      </mesh>
      {[-1, 1].map((sign) => (
        <group key={sign}>
          <Block
            position={[0, -0.02, sign * 11.9]}
            size={[28.5, 0.025, 0.035]}
            color="#6fa8b9"
            glow="#63c4d4"
          />
          <Block
            position={[sign * 14.35, -0.02, 0]}
            size={[0.035, 0.025, 23.6]}
            color="#6fa8b9"
            glow="#63c4d4"
          />
          <Block position={[sign * 2, 0.01, 0]} size={[0.025, 0.018, 22.8]} color="#668696" />
          <Block position={[0, 0.01, sign * 1.95]} size={[27, 0.018, 0.025]} color="#668696" />
          {posts.map((x) => (
            <group key={x} position={[x, 0, sign * 11.35]}>
              <Block size={[0.1, 0.35, 0.1]} position={[0, 0.18, 0]} color="#283d4b" />
              <Block size={[0.14, 0.04, 0.14]} position={[0, 0.37, 0]} color="#a7d4dd" glow="#b3e9f4" />
            </group>
          ))}
        </group>
      ))}
      {[-10, -7, -4, 4, 7, 10].map((value) => (
        <group key={value}>
          <Block position={[value, 0.012, 0]} size={[0.6, 0.018, 0.025]} color="#94aab4" />
          <Block position={[0, 0.012, value]} size={[0.025, 0.018, 0.6]} color="#94aab4" />
        </group>
      ))}
      <Ring position={[0, 0.025, 0]} radius={3.2} color={dark ? '#cfb785' : '#a17c38'} thickness={0.013} />
      <Ring position={[0, 0.025, 0]} radius={2.9} color="#254353" thickness={0.014} />
      {[-1, 1].map((sign) => (
        <group key={sign} position={[sign * 13.15, 0, 0]}>
          <Block size={[0.5, 3.4, 0.6]} position={[0, 1.7, -1.1]} color="#283e4c" />
          <Block size={[0.5, 3.4, 0.6]} position={[0, 1.7, 1.1]} color="#283e4c" />
          <Block size={[0.5, 0.25, 3]} position={[0, 3.5, 0]} color="#617f8a" />
          <Block
            size={[0.03, 2.7, 0.06]}
            position={[-sign * 0.26, 1.8, -1.1]}
            color="#93ddde"
            glow="#a4efed"
          />
        </group>
      ))}
      {WORLD_ZONES.map((zone) => (
        <group key={zone.id} position={[zone.x * 1.4, 0, zone.z * 1.75]}>
          <Block size={[1.7, 0.3, 0.75]} position={[0, 0.14, 0]} color="#293e48" />
          {[-0.5, 0, 0.5].map((x) => (
            <mesh key={x} position={[x, 0.48, 0]} castShadow>
              <icosahedronGeometry args={[0.37, 0]} />
              <meshStandardMaterial color="#3f796e" roughness={0.9} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

function WorldScene({
  mode,
  selected,
  focus,
  destination,
  reset,
  input,
  reducedMotion,
  onSelect,
  onPosition,
  onNearby,
  onLoaded,
}: WorldProps & { onLoaded: () => void }) {
  const actor = useRef<THREE.Group>(null);
  const orbit = useRef<OrbitControlsImpl>(null);
  const vehicle = useRef(initialDriveState());
  const route = useRef<[number, number][]>([]);
  const proximity = useRef<ZoneId | null>(null);
  const telemetryTime = useRef(0);
  const lastPublished = useRef(initialDriveState());
  const settling = useRef(true);
  const steered = useRef(false);
  const userOrbit = useRef(false);
  const parallax = useRef(new THREE.Vector2());
  const parallaxGoal = useRef(new THREE.Vector2());
  const viewTarget = useMemo(() => new THREE.Vector3(), []);
  const viewPosition = useMemo(() => new THREE.Vector3(), []);
  const { camera, size, invalidate, gl } = useThree();
  const theme = useTheme();
  useEffect(() => { invalidate(); }, [theme, invalidate]);

  useEffect(() => {
    input.wake = invalidate;
    return () => {
      input.wake = undefined;
    };
  }, [input, invalidate]);
  useEffect(() => {
    vehicle.current = initialDriveState();
    lastPublished.current = { ...vehicle.current };
    route.current = [];
    proximity.current = null;
    input.actions.clear();
    settling.current = true;
    onNearby(null);
    onPosition({ ...vehicle.current });
    invalidate();
  }, [reset, input, invalidate, onNearby, onPosition]);
  useEffect(() => {
    route.current = destination ? planRoute(vehicle.current, destination.id) : [];
    invalidate();
  }, [destination, invalidate]);
  useEffect(() => {
    settling.current = true;
    steered.current = false;
    parallax.current.set(0, 0);
    parallaxGoal.current.set(0, 0);
    if (mode === 'overview') {
      route.current = [];
      input.actions.clear();
    }
    invalidate();
  }, [mode, focus, size.width, size.height, input, invalidate]);
  useEffect(() => {
    const canvas = gl.domElement;
    const move = (event: PointerEvent) => {
      if (reducedMotion || mode !== 'overview' || focus || steered.current || event.buttons) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      const nextX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const nextY = ((event.clientY - rect.top) / rect.height) * 2 - 1;
      if (Math.abs(nextX - parallaxGoal.current.x) < 0.004 && Math.abs(nextY - parallaxGoal.current.y) < 0.004) return;
      parallaxGoal.current.set(nextX, nextY);
      settling.current = true;
      invalidate();
    };
    const leave = () => {
      if (parallaxGoal.current.lengthSq() < 0.0001) return;
      parallaxGoal.current.set(0, 0);
      settling.current = true;
      invalidate();
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerleave', leave);
    return () => {
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerleave', leave);
    };
  }, [gl, invalidate, mode, focus, reducedMotion]);

  useFrame((state, elapsed) => {
    const actions = new Set(input.actions.values());
    if (actions.size) route.current = [];
    if (mode === 'drive') {
      // Keep driving consistent on slower devices; cap a resumed tab's time jump.
      let remaining = Math.min(elapsed, 0.2);
      while (remaining > 0) {
        const step = Math.min(remaining, 0.05);
        if (route.current.length) {
          const result = stepRoute(vehicle.current, route.current[0], step);
          vehicle.current = result.state;
          if (result.arrived) route.current.shift();
        } else vehicle.current = stepDrive(vehicle.current, actions, step);
        remaining -= step;
      }
    } else vehicle.current.speed = 0;
    const current = vehicle.current;
    if (actor.current) {
      actor.current.position.set(current.x, 0.4, current.z);
      actor.current.rotation.y = current.heading;
    }
    const nextNear = nearbyZone(current.x, current.z);
    if (nextNear !== proximity.current) {
      proximity.current = nextNear;
      onNearby(nextNear);
    }
    const moving =
      mode === 'drive' && (actions.size > 0 || route.current.length > 0 || Math.abs(current.speed) > 0.01);
    const published = lastPublished.current;
    const poseChanged =
      current.x !== published.x || current.z !== published.z || current.heading !== published.heading;
    if (poseChanged && (state.clock.elapsedTime - telemetryTime.current > 0.18 || !moving)) {
      lastPublished.current = { ...current };
      onPosition(lastPublished.current);
      telemetryTime.current = state.clock.elapsedTime;
    }

    if (mode === 'drive' || settling.current) {
      if (mode === 'drive') {
        viewTarget.set(current.x, 0.5, current.z);
        viewPosition.set(current.x + 8, 7, current.z + 10);
        if (size.width < 650) viewPosition.set(current.x + 8, 11, current.z + 14);
      } else if (focus) {
        const zone = WORLD_ZONES.find((item) => item.id === focus)!;
        viewTarget.set(zone.x, 0.8, zone.z);
        viewPosition.set(zone.x + 9, 9, zone.z + 12);
        if (size.width < 650) viewPosition.set(zone.x + 10, 13, zone.z + 18);
      } else {
        viewTarget.set(0, 0, 0);
        const aspect = size.width / size.height;
        const scale = Math.max(1, 1.25 / aspect);
        viewPosition.set(23 * scale, 25 * scale, 29 * scale);
        if (!reducedMotion && !userOrbit.current && !steered.current) {
          const follow = 1 - Math.exp(-3.2 * Math.min(elapsed, 0.05));
          parallax.current.lerp(parallaxGoal.current, follow);
          viewPosition.x += parallax.current.x * 1.15;
          viewPosition.y += parallax.current.y * -0.38;
          viewTarget.x += parallax.current.x * 0.28;
        }
      }
      const ease = reducedMotion ? 1 : 1 - Math.exp(-5 * Math.min(elapsed, 0.2));
      camera.position.lerp(viewPosition, ease);
      orbit.current?.target.lerp(viewTarget, ease);
      orbit.current?.update();
      const cameraMoving =
        camera.position.distanceToSquared(viewPosition) > 0.0008 ||
        (orbit.current?.target.distanceToSquared(viewTarget) ?? 0) > 0.0008;
      const parallaxMoving = mode === 'overview' && !focus && parallax.current.distanceToSquared(parallaxGoal.current) > 0.0004;
      if (cameraMoving || moving || parallaxMoving) invalidate();
      else settling.current = false;
    }
    if (moving) invalidate();
  });

  return (
    <>
      <fog attach="fog" args={[theme === 'dark' ? '#18232e' : '#eaf0f5', 42, 100]} />
      <ambientLight intensity={theme === 'dark' ? 0.85 : 1.15} color="#d6e2eb" />
      <directionalLight
        position={[-8, 18, 10]}
        intensity={3.2}
        color="#fff3db"
        castShadow
        shadow-mapSize={size.width < 700 ? [512, 512] : [1024, 1024]}
        shadow-camera-left={-18}
        shadow-camera-right={18}
        shadow-camera-top={18}
        shadow-camera-bottom={-18}
        shadow-camera-far={60}
        shadow-bias={-0.00015}
        shadow-normalBias={0.025}
      />
      <directionalLight position={[8, 6, -12]} intensity={1.8} color="#80caff" />
      <LocalEnvironment />
      <CampusFloor />
      {WORLD_ZONES.map((zone) => (
        <Pavilion key={zone.id} zone={zone} selected={selected === zone.id} onSelect={onSelect} />
      ))}
      <Suspense fallback={null}>
        <group ref={actor}>
          <TractorModel onLoaded={onLoaded} />
        </group>
      </Suspense>
      <OrbitControls
        ref={orbit}
        makeDefault
        enabled={mode === 'overview'}
        enablePan={false}
        enableDamping={!reducedMotion}
        minDistance={9}
        maxDistance={100}
        minPolarAngle={0.15}
        maxPolarAngle={Math.PI / 2.4}
        onStart={() => {
          steered.current = true;
          userOrbit.current = true;
          settling.current = false;
        }}
        onEnd={() => {
          userOrbit.current = false;
        }}
      />
      {mode === 'overview' && !reducedMotion && size.width >= 900 && (
        <EffectComposer multisampling={0} enableNormalPass={false}>
          <Bloom luminanceThreshold={0.85} luminanceSmoothing={0.25} intensity={0.28} mipmapBlur radius={0.35} levels={4} />
          <Vignette eskil={false} offset={0.25} darkness={0.28} />
        </EffectComposer>
      )}
    </>
  );
}

function WorldFallback() {
  const lang = useLang();
  return (
    <div className="world-fallback">
      <Tractor size={70} strokeWidth={1} />
      <h2>{lang === 'zh' ? '三维空间暂不可用' : '3D space is unavailable'}</h2>
      <p>
        {lang === 'zh'
          ? '通过展区导航，仍可进入知识库、诊断和模型工坊。'
          : 'Use the zone navigation to open knowledge, diagnosis and the model studio.'}
      </p>
    </div>
  );
}

export default function ExhibitionWorld(props: WorldProps) {
  const lang = useLang();
  const [ready, setReady] = useState(false);
  const [supported] = useState(() => {
    try {
      const context = document.createElement('canvas').getContext('webgl2');
      context?.getExtension('WEBGL_lose_context')?.loseContext();
      return !!context;
    } catch {
      return false;
    }
  });
  const loaded = useCallback(() => setReady(true), []);
  if (!supported) return <WorldFallback />;
  return (
    <ErrorBoundary FallbackComponent={WorldFallback}>
      <Canvas
        shadows={SHADOW_OPTIONS}
        camera={CAMERA}
        gl={GL_OPTIONS}
        dpr={[1, 1.25]}
        frameloop="demand"
        role="group"
        aria-label={
          lang === 'zh'
            ? '农机三维园区，四个展区围绕中央广场'
            : '3D machinery campus with four pavilions around a central plaza'
        }
      >
        <WorldScene {...props} onLoaded={loaded} />
      </Canvas>
      {!ready && (
        <div className="world-loading" role="status">
          <Loader2 size={20} />
          <span>{lang === 'zh' ? '正在打开三维园区…' : 'Opening the 3D campus…'}</span>
        </div>
      )}
    </ErrorBoundary>
  );
}

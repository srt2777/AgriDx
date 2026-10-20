import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { ContactShadows, Html, MeshReflectorMaterial } from '@react-three/drei';
import { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { ErrorBoundary } from 'react-error-boundary';
import * as THREE from 'three';
import { useLang } from '@/hooks/useLang';
import { frameEase, MOTION, rateFor } from '@/lib/motion-tokens';
import { bindContextLoss, probeWebGL } from '@/lib/webgl';
import {
  HALL_EXAMPLE_DEVICES,
  exampleDataLabel,
  HALL_STATUS_EXAMPLE,
  HALL_ZONES,
  type HallZoneId,
} from './hall-example-data';
import { hallCameraGoal, HALL_OVERVIEW } from './hall-camera';
import { EXHIBITS, HALL_FLOOR, exhibitStatus, floorAoUv } from './hall-machines';
import { ExhibitModel, HallIdle, StatusHalo } from './hall-exhibits';

const HallGlow = lazy(() => import('@/components/SceneGlow').then((mod) => ({ default: mod.HallGlow })));

export interface HallSceneProps {
  selected: HallZoneId;
  focus: HallZoneId | null;
  hovered: HallZoneId | null;
  reducedMotion: boolean;
  idle: boolean;
  onSelect: (id: HallZoneId) => void;
  onHover: (id: HallZoneId | null) => void;
  onLive?: () => void;
  onLost?: () => void;
}

const HOME = new THREE.Vector3(...HALL_OVERVIEW.position);
const HOME_LOOK = new THREE.Vector3(...HALL_OVERVIEW.look);

const SHORT: Record<HallZoneId, { zh: string; en: string }> = {
  A: { zh: '动力农机', en: 'Power' },
  B: { zh: '耕作播种', en: 'Tillage' },
  C: { zh: '收获植保', en: 'Harvest' },
  D: { zh: '智慧农业', en: 'Smart' },
};

function useFloorAoTexture() {
  return useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 342;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (const exhibit of EXHIBITS) {
      const { u, v } = floorAoUv(exhibit.position[0], exhibit.position[2]);
      const x = u * canvas.width;
      const y = (1 - v) * canvas.height;
      const gradient = context.createRadialGradient(x, y, 4, x, y, 54);
      gradient.addColorStop(0, 'rgba(18, 28, 38, 0.55)');
      gradient.addColorStop(1, 'rgba(18, 28, 38, 0)');
      context.fillStyle = gradient;
      context.beginPath();
      context.arc(x, y, 54, 0, Math.PI * 2);
      context.fill();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.NoColorSpace;
    texture.anisotropy = 2;
    return texture;
  }, []);
}

function useFloorTexture() {
  return useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.clearRect(0, 0, 512, 512);
    context.strokeStyle = 'rgba(198, 224, 238, 0.42)';
    context.lineWidth = 1;
    for (let line = 0; line <= 512; line += 64) {
      context.beginPath();
      context.moveTo(line, 0);
      context.lineTo(line, 512);
      context.stroke();
      context.beginPath();
      context.moveTo(0, line);
      context.lineTo(512, line);
      context.stroke();
    }
    context.strokeStyle = 'rgba(232, 246, 252, 0.78)';
    context.lineWidth = 2;
    for (let line = 0; line <= 512; line += 256) {
      context.beginPath();
      context.moveTo(line, 0);
      context.lineTo(line, 512);
      context.stroke();
      context.beginPath();
      context.moveTo(0, line);
      context.lineTo(512, line);
      context.stroke();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(3, 2);
    texture.anisotropy = 4;
    return texture;
  }, []);
}

function FocusCamera({
  focus,
  reducedMotion,
  onSettled,
  onRelease,
}: {
  focus: HallZoneId | null;
  reducedMotion: boolean;
  onSettled: () => void;
  onRelease: () => void;
}) {
  const { camera, invalidate, size } = useThree();
  const look = useRef(HOME_LOOK.clone());
  const goal = useRef(HOME.clone());
  const goalLook = useRef(HOME_LOOK.clone());
  const settled = useRef(false);
  useLayoutEffect(() => {
    settled.current = false;
    onRelease();
    invalidate();
  }, [focus, size.width, reducedMotion, onRelease, invalidate]);
  useFrame((_, delta) => {
    if (settled.current) return;
    const next = hallCameraGoal(focus, size.width);
    goal.current.set(next.position[0], next.position[1], next.position[2]);
    goalLook.current.set(next.look[0], next.look[1], next.look[2]);
    const ease = frameEase(rateFor(MOTION.ms.enter), delta, reducedMotion);
    camera.position.lerp(goal.current, ease);
    look.current.lerp(goalLook.current, ease);
    const left = camera.position.distanceToSquared(goal.current) + look.current.distanceToSquared(goalLook.current);
    if (left > 0.002) {
      camera.lookAt(look.current);
      invalidate();
      return;
    }
    camera.position.copy(goal.current);
    look.current.copy(goalLook.current);
    camera.lookAt(look.current);
    settled.current = true;
    onSettled();
  });
  return null;
}

function HallEnvironment() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const generator = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const target = generator.fromScene(room, 0.04);
    scene.environment = target.texture;
    scene.environmentIntensity = 0.28;
    return () => {
      scene.environment = null;
      target.dispose();
      room.dispose();
      generator.dispose();
    };
  }, [gl, scene]);
  return null;
}

function useZoneGrid(color: string) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 160;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.clearRect(0, 0, 256, 160);
    context.strokeStyle = color;
    context.globalAlpha = 0.32;
    context.lineWidth = 1;
    for (let x = 16; x < 256; x += 16) {
      context.beginPath();
      context.moveTo(x, 6);
      context.lineTo(x, 154);
      context.stroke();
    }
    for (let y = 16; y < 160; y += 16) {
      context.beginPath();
      context.moveTo(6, y);
      context.lineTo(250, y);
      context.stroke();
    }
    context.globalAlpha = 1;
    context.lineWidth = 5;
    context.strokeRect(3, 3, 250, 154);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 4;
    return map;
  }, [color]);
  useEffect(() => () => texture?.dispose(), [texture]);
  return texture;
}

function Plant({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.07, 0]} castShadow>
        <cylinderGeometry args={[0.16, 0.12, 0.14, 8]} />
        <meshStandardMaterial color="#e7eef3" metalness={0.28} roughness={0.42} />
      </mesh>
      <mesh position={[0, 0.28, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.07, 0.28, 8]} />
        <meshStandardMaterial color="#d7e4ee" roughness={0.4} metalness={0.15} />
      </mesh>
      <mesh position={[0, 0.5, 0]} castShadow>
        <sphereGeometry args={[0.18, 10, 8]} />
        <meshStandardMaterial color="#3f9a62" roughness={0.55} />
      </mesh>
    </group>
  );
}

function Signboard({ id, color, position }: { id: string; color: string; position: [number, number, number] }) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.fillStyle = '#102033';
    context.fillRect(0, 0, 256, 128);
    context.fillStyle = color;
    context.fillRect(0, 0, 16, 128);
    context.fillStyle = '#f5fbff';
    context.font = '700 72px sans-serif';
    context.fillText(id, 48, 88);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 4;
    return map;
  }, [id, color]);
  useEffect(() => () => texture?.dispose(), [texture]);
  if (!texture) return null;
  return (
    <group position={position} rotation={[0, Math.PI / 5, 0]}>
      <mesh position={[0, 0.55, 0]} castShadow>
        <boxGeometry args={[0.08, 1.1, 0.08]} />
        <meshStandardMaterial color="#d5e2ee" metalness={0.55} roughness={0.28} />
      </mesh>
      <mesh position={[0.42, 1.05, 0]} castShadow>
        <boxGeometry args={[0.96, 0.42, 0.05]} />
        <meshStandardMaterial map={texture} metalness={0.18} roughness={0.4} />
      </mesh>
    </group>
  );
}

function CeilingTruss() {
  const chords = [-4.6, 0.1, 4.8];
  const crosses = [-8.2, 0.1, 8.2];
  return (
    <group>
      {chords.map((z) => (
        <mesh key={`chord-${z}`} position={[0, 4.05, z]}>
          <boxGeometry args={[21.4, 0.028, 0.028]} />
          <meshStandardMaterial color="#d5e6f2" metalness={0.35} roughness={0.4} envMapIntensity={0.2} transparent opacity={0.72} />
        </mesh>
      ))}
      {crosses.map((x) => (
        <mesh key={`cross-${x}`} position={[x, 4.02, 0.1]}>
          <boxGeometry args={[0.024, 0.024, 13.2]} />
          <meshStandardMaterial color="#d5e6f2" metalness={0.35} roughness={0.4} envMapIntensity={0.2} transparent opacity={0.62} />
        </mesh>
      ))}
      {[-3.2, 3.2].map((z) => (
        <mesh key={`strip-${z}`} position={[0, 3.92, z]}>
          <boxGeometry args={[14.5, 0.018, 0.08]} />
          <meshStandardMaterial color="#9adfff" emissive="#7ec8ee" emissiveIntensity={0.22} />
        </mesh>
      ))}
    </group>
  );
}

function HallEnclosure() {
  const skirt = 0.78;
  const glass = 2.35;
  const span = 23.2;
  const depth = 15.2;
  const wall = '#1a3346';
  const glaze = '#c5e7f6';
  const side = (x: number) => (
    <group key={x} position={[x, 0, 0]}>
      <mesh position={[0, skirt / 2, 0]}>
        <boxGeometry args={[0.14, skirt, depth]} />
        <meshStandardMaterial color={wall} roughness={0.58} metalness={0.22} />
      </mesh>
      <mesh position={[0, skirt + glass / 2, 0]}>
        <boxGeometry args={[0.045, glass, depth]} />
        <meshStandardMaterial color={glaze} transparent opacity={0.2} roughness={0.06} metalness={0.18} depthWrite={false} />
      </mesh>
      <mesh position={[0, skirt + glass + 0.03, 0]}>
        <boxGeometry args={[0.08, 0.035, depth]} />
        <meshStandardMaterial color="#9adfff" emissive="#7ec8ee" emissiveIntensity={0.35} />
      </mesh>
    </group>
  );
  return (
    <group position={[0, 0, 0.1]}>
      <mesh position={[0, skirt / 2, -depth / 2]}>
        <boxGeometry args={[span, skirt, 0.14]} />
        <meshStandardMaterial color={wall} roughness={0.58} metalness={0.22} />
      </mesh>
      <mesh position={[0, skirt + glass / 2, -depth / 2]}>
        <boxGeometry args={[span, glass, 0.04]} />
        <meshStandardMaterial color={glaze} transparent opacity={0.18} roughness={0.06} metalness={0.16} depthWrite={false} />
      </mesh>
      {[-1, 1].map((sign) => (
        <mesh key={`front-${sign}`} position={[sign * 6.7, skirt / 2, depth / 2]}>
          <boxGeometry args={[9.6, skirt, 0.14]} />
          <meshStandardMaterial color={wall} roughness={0.58} metalness={0.22} />
        </mesh>
      ))}
      {side(-span / 2)}
      {side(span / 2)}
      <group position={[0, 0, depth / 2]}>
        <mesh position={[0, 2.85, 0]}>
          <boxGeometry args={[4.4, 0.1, 0.16]} />
          <meshStandardMaterial color="#d7eaf4" metalness={0.4} roughness={0.28} />
        </mesh>
        {[-2.15, 2.15].map((x) => (
          <mesh key={`jamb-${x}`} position={[x, 1.4, 0]}>
            <boxGeometry args={[0.1, 2.8, 0.12]} />
            <meshStandardMaterial color="#d7eaf4" metalness={0.4} roughness={0.28} />
          </mesh>
        ))}
        {[-0.95, 0.95].map((x) => (
          <mesh key={`door-${x}`} position={[x, 1.35, 0.02]}>
            <boxGeometry args={[1.7, 2.45, 0.03]} />
            <meshStandardMaterial color={glaze} transparent opacity={0.28} roughness={0.05} metalness={0.25} depthWrite={false} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function ZoneStand({
  id,
  position,
  color,
  active,
  hovered,
  onSelect,
  onHover,
}: {
  id: HallZoneId;
  position: [number, number, number];
  color: string;
  active: boolean;
  hovered: boolean;
  onSelect: (id: HallZoneId) => void;
  onHover: (id: HallZoneId | null) => void;
}) {
  const lang = useLang();
  const width = useThree((state) => state.size.width);
  const grid = useZoneGrid(color);
  const lit = active || hovered;
  const label = SHORT[id];
  const edge = lit ? 0.95 : 0.48;
  return (
    <group position={position}>
      <mesh
        position={[0, 0.06, 0]}
        receiveShadow
        onClick={(event) => { event.stopPropagation(); onSelect(id); }}
        onPointerOver={(event) => { event.stopPropagation(); onHover(id); }}
        onPointerOut={() => onHover(null)}
      >
        <boxGeometry args={[7.7, 0.08, 4.45]} />
        <meshStandardMaterial color="#102433" roughness={0.34} metalness={0.48} />
      </mesh>
      <mesh position={[0, 0.12, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[7.35, 4.15]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={lit ? 0.28 : 0.14}
          transparent
          opacity={lit ? 0.2 : 0.12}
          roughness={0.16}
          metalness={0.22}
          depthWrite={false}
        />
      </mesh>
      <mesh position={[0, 0.128, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[7.35, 4.15]} />
        <meshBasicMaterial map={grid ?? undefined} transparent depthWrite={false} />
      </mesh>
      {([[0, 2.08, 7.35, 0.028], [0, -2.08, 7.35, 0.028], [3.68, 0, 0.028, 4.15], [-3.68, 0, 0.028, 4.15]] as const).map(([x, z, w, d]) => (
        <mesh key={`${x}-${z}`} position={[x, 0.14, z]}>
          <boxGeometry args={[w, 0.025, d]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={edge} />
        </mesh>
      ))}
      <Html position={[0, 2.15, 0]} center zIndexRange={[12, 0]} distanceFactor={width < 720 ? 18 : 14}>
        <button
          type="button"
          className={`hall-marker${active ? ' is-on' : ''}`}
          style={{ '--zone-color': color } as CSSProperties}
          onClick={() => onSelect(id)}
          onPointerEnter={() => onHover(id)}
          onPointerLeave={() => onHover(null)}
        >
          <b>{id}</b>
          <span>{lang === 'zh' ? label.zh : label.en}</span>
        </button>
      </Html>
    </group>
  );
}

function ExhibitTip({ id }: { id: string }) {
  const lang = useLang();
  const device = HALL_EXAMPLE_DEVICES.find((item) => item.id === id)!;
  const zone = HALL_ZONES.find((item) => item.id === device.zone)!;
  const status = HALL_STATUS_EXAMPLE.find((item) => item.id === device.status)!;
  return (
    <Html position={[0, 2.15, 0]} center distanceFactor={11} zIndexRange={[24, 0]} style={{ pointerEvents: 'none' }}>
      <div className="hall-tip">
        <strong>{device.name}</strong>
        <span>{zone.id} · {lang === 'zh' ? zone.zh : zone.en}</span>
        <em className={`is-${device.status}`}>{lang === 'zh' ? status.zh : status.en}</em>
        <small>{exampleDataLabel(lang)}</small>
      </div>
    </Html>
  );
}

function Exhibit({
  id,
  position,
  rotation,
  scale,
  tipped,
  onSelect,
  onHover,
  onTip,
  children,
}: {
  id: string;
  position: [number, number, number];
  rotation: number;
  scale: number;
  tipped: boolean;
  onSelect: (id: HallZoneId) => void;
  onHover: (id: HallZoneId | null) => void;
  onTip: (id: string | null) => void;
  children: ReactNode;
}) {
  const { gl } = useThree();
  const device = HALL_EXAMPLE_DEVICES.find((item) => item.id === id)!;
  const zone = HALL_ZONES.find((item) => item.id === device.zone)!;
  const enter = (event: { stopPropagation: () => void; pointerType?: string }) => {
    event.stopPropagation();
    if (event.pointerType === 'touch') return;
    onTip(id);
    onHover(device.zone);
    gl.domElement.style.cursor = 'pointer';
  };
  const leave = (event?: { pointerType?: string }) => {
    if (event?.pointerType === 'touch') return;
    onTip(null);
    onHover(null);
    gl.domElement.style.cursor = '';
  };
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, 0.1, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.78, 0.92, 0.2, 6]} />
        <meshStandardMaterial color="#f7fbfe" metalness={0.22} roughness={0.38} envMapIntensity={0.8} />
      </mesh>
      <mesh position={[0, 0.22, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[1.05, 28]} />
        <meshStandardMaterial
          color={tipped ? '#ffffff' : '#d5e4ef'}
          emissive={zone.color}
          emissiveIntensity={tipped ? 0.55 : 0.08}
          roughness={0.72}
        />
      </mesh>
      <mesh
        position={[0, 0.95, 0]}
        onClick={(event) => { event.stopPropagation(); onSelect(device.zone); onTip(id); }}
        onPointerOver={enter}
        onPointerOut={leave}
      >
        <boxGeometry args={[2.1, 1.7, 1.45]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <StatusHalo id={id} />
      <group scale={scale}>{children}</group>
      {tipped && <ExhibitTip id={id} />}
    </group>
  );
}


function HallWorld({ selected, focus, hovered, reducedMotion, idle, onSelect, onHover }: HallSceneProps) {
  const floor = useFloorTexture();
  const ao = useFloorAoTexture();
  const { invalidate, size, gl } = useThree();
  const [tip, setTip] = useState<string | null>(null);
  const [orbit, setOrbit] = useState(false);
  const settle = useCallback(() => setOrbit(true), []);
  const release = useCallback(() => setOrbit(false), []);
  const framed = focus ? HALL_ZONES.find((item) => item.id === focus)! : null;
  const lookTarget: [number, number, number] = framed
    ? [framed.position[0], 0.55, framed.position[2]]
    : [HOME_LOOK.x, HOME_LOOK.y, HOME_LOOK.z];
  useEffect(() => () => { floor?.dispose(); ao?.dispose(); }, [floor, ao]);
  useEffect(() => () => { gl.domElement.style.cursor = ''; }, [gl]);
  useEffect(() => { invalidate(); }, [selected, hovered, tip, invalidate]);
  return (
    <>
      <HallEnvironment />
      <color attach="background" args={['#071622']} />
      <fog attach="fog" args={['#071622', 24, 52]} />
      <hemisphereLight args={['#8ec4e4', '#071018', 0.38]} />
      <ambientLight intensity={0.18} color="#9ecae0" />
      <directionalLight
        position={[9, 18, 7]}
        intensity={0.92}
        color="#d5ecff"
        castShadow
        shadow-mapSize={[512, 512]}
        shadow-camera-left={-16}
        shadow-camera-right={16}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
        shadow-camera-far={42}
        shadow-bias={-0.0002}
      />
      <directionalLight position={[-10, 7, -4]} intensity={0.26} color="#7eb6d8" />
      <directionalLight position={[-12, 6, 14]} intensity={0.48} color="#e7f7ff" />
      {framed && (
        <pointLight position={[framed.position[0], 3.2, framed.position[2]]} color={framed.color} intensity={4.5} distance={9} decay={2} />
      )}
      <FocusCamera focus={focus} reducedMotion={reducedMotion} onSettled={settle} onRelease={release} />
      <HallLook enabled={orbit} target={lookTarget} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0.1]} receiveShadow>
        <planeGeometry args={[24, 16]} />
        <MeshReflectorMaterial
          resolution={size.width < 720 ? 128 : 256}
          blur={size.width < 720 ? [0, 0] : [90, 36]}
          mixBlur={0.65}
          mixStrength={1.05}
          mirror={0.38}
          color="#0e1a28"
          roughness={0.32}
          metalness={0.58}
          depthScale={0.45}
          minDepthThreshold={0.25}
          maxDepthThreshold={1.25}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0.1]}>
        <planeGeometry args={[23.6, 15.6]} />
        <meshBasicMaterial map={floor ?? undefined} transparent depthWrite={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.008, 0.1]}>
        <planeGeometry args={[HALL_FLOOR.width, HALL_FLOOR.depth]} />
        <meshBasicMaterial map={ao ?? undefined} transparent depthWrite={false} blending={THREE.MultiplyBlending} />
      </mesh>
      <mesh position={[0, 0.02, 0.1]}>
        <boxGeometry args={[1.2, 0.025, 14.4]} />
        <meshStandardMaterial color="#7ec8ee" emissive="#5eb4e0" emissiveIntensity={0.28} />
      </mesh>
      <HallEnclosure />
      <mesh position={[0, 0.16, -7.62]} receiveShadow>
        <boxGeometry args={[23.2, 0.32, 0.1]} />
        <meshStandardMaterial color="#d5e2ee" metalness={0.35} roughness={0.4} />
      </mesh>
      <mesh position={[0, 4.22, 0.1]}>
        <boxGeometry args={[23.2, 0.05, 15.6]} />
        <meshStandardMaterial color="#0e2436" transparent opacity={0.55} roughness={0.45} metalness={0.04} envMapIntensity={0.12} />
      </mesh>
      <CeilingTruss />
      {[[-10.9, -6.9], [10.9, -6.9], [-10.9, 7.05], [10.9, 7.05]].map(([x, z]) => (
        <mesh key={`post-${x}-${z}`} position={[x, 2.1, z]} castShadow>
          <boxGeometry args={[0.18, 4.2, 0.18]} />
          <meshStandardMaterial color="#9bb4c6" metalness={0.55} roughness={0.32} envMapIntensity={0.35} />
        </mesh>
      ))}
      {HALL_ZONES.map((item) => (
        <Signboard
          key={`sign-${item.id}`}
          id={item.id}
          color={item.color}
          position={[item.position[0] + (item.position[0] < 0 ? 2.7 : -2.7), 0, item.position[2] + 2.15]}
        />
      ))}
      {HALL_ZONES.map((item) => (
        <ZoneStand
          key={item.id}
          id={item.id}
          position={item.position}
          color={item.color}
          active={selected === item.id}
          hovered={hovered === item.id}
          onSelect={onSelect}
          onHover={onHover}
        />
      ))}
      {EXHIBITS.map((exhibit) => (
        <Exhibit
          key={exhibit.id}
          id={exhibit.id}
          position={exhibit.position}
          rotation={exhibit.rotation}
          scale={exhibit.scale}
          tipped={tip === exhibit.id}
          onSelect={onSelect}
          onHover={onHover}
          onTip={setTip}
        >
          <ExhibitModel
            kind={exhibit.kind}
            accent={exhibit.accent}
            moving={
              idle
              && !reducedMotion
              && (exhibit.kind === 'drone' || exhibitStatus(exhibit.id) !== 'offline')
            }
          />
        </Exhibit>
      ))}
      {[[-9.6, -5.6], [-9.6, 5.8], [9.6, -5.6], [9.6, 5.8], [-1.15, -6.3], [1.15, -6.3], [-1.15, 6.2], [1.15, 6.2], [-3.3, 6.15], [3.3, 6.15], [-7.4, 0.15], [7.4, 0.15]].map(([x, z]) => (
        <Plant key={`${x}-${z}`} position={[x, 0, z]} />
      ))}
      <HallIdle enabled={idle} reduced={reducedMotion} />
      {!reducedMotion && size.width >= 720 && (
        <ContactShadows frames={1} position={[0, 0.016, 0.1]} opacity={0.28} scale={22} blur={2.4} far={3.4} resolution={192} />
      )}
      {!reducedMotion && size.width >= 720 && (
        <Suspense fallback={null}>
          <HallGlow />
        </Suspense>
      )}
    </>
  );
}

function HallLook({ enabled, target }: { enabled: boolean; target: readonly [number, number, number] }) {
  const { camera, gl, invalidate } = useThree();
  const spot = `${target[0]},${target[1]},${target[2]}`;
  useEffect(() => {
    if (!enabled) return;
    const controls = new OrbitControlsImpl(camera, gl.domElement);
    controls.enablePan = false;
    controls.enableDamping = false;
    controls.rotateSpeed = 0.65;
    controls.zoomSpeed = 0.7;
    controls.minDistance = 6;
    controls.maxDistance = 40;
    controls.minPolarAngle = 0.35;
    controls.maxPolarAngle = 1.2;
    controls.touches.ONE = THREE.TOUCH.ROTATE;
    controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
    const [x, y, z] = spot.split(',').map(Number);
    controls.target.set(x, y, z);
    controls.update();
    const onChange = () => invalidate();
    controls.addEventListener('change', onChange);
    return () => {
      controls.removeEventListener('change', onChange);
      controls.dispose();
    };
  }, [enabled, camera, gl, invalidate, spot]);
  return null;
}

function HallLost() {
  return null;
}

export default function HallScene({ onLive, onLost, ...props }: HallSceneProps) {
  const lang = useLang();
  const [supported] = useState(probeWebGL);
  const reported = useRef(false);
  useEffect(() => {
    if (!supported) onLost?.();
  }, [supported, onLost]);
  const markLive = useCallback((canvas: HTMLCanvasElement) => {
    if (reported.current) return;
    reported.current = true;
    onLive?.();
    bindContextLoss(canvas, () => onLost?.());
  }, [onLive, onLost]);
  if (!supported) return null;
  return (
    <ErrorBoundary FallbackComponent={HallLost} onError={() => onLost?.()}>
      <Canvas
        shadows
        camera={{ position: [HOME.x, HOME.y, HOME.z], fov: 32, near: 0.1, far: 80 }}
        gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
        dpr={[1, 1.25]}
        frameloop="demand"
        onCreated={({ camera, gl }) => {
          camera.lookAt(HOME_LOOK);
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 0.92;
          gl.domElement.style.touchAction = 'none';
          markLive(gl.domElement);
        }}
        aria-label={lang === 'zh' ? '农机数字孪生展示大厅的等轴示意。单指拖动环视，双指缩放。点按机具可查看示例状态。' : 'Isometric hall. Drag to look around, pinch to zoom, and tap a machine for its example status.'}
      >
        <HallWorld {...props} />
      </Canvas>
    </ErrorBoundary>
  );
}

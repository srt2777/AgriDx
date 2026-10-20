import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { ContactShadows, Html, RoundedBox } from '@react-three/drei';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import { ErrorBoundary } from 'react-error-boundary';
import { Tractor } from 'lucide-react';
import * as THREE from 'three';
import { useLang } from '@/hooks/useLang';
import {
  HALL_EXAMPLE_DEVICES,
  HALL_EXAMPLE_LABEL,
  HALL_STATUS_EXAMPLE,
  HALL_ZONES,
  type HallZoneId,
} from './hall-example-data';

export interface HallSceneProps {
  selected: HallZoneId;
  hovered: HallZoneId | null;
  reducedMotion: boolean;
  onSelect: (id: HallZoneId) => void;
  onHover: (id: HallZoneId | null) => void;
}

const HOME = new THREE.Vector3(16.2, 13.2, 16.2);
const HOME_LOOK = new THREE.Vector3(0, 0.35, 0.1);
const CLOSE = new THREE.Vector3(6.4, 5.6, 6.4);
const WIDE = new THREE.Vector3(8.8, 7.8, 8.8);

const SHORT: Record<HallZoneId, { zh: string; en: string }> = {
  A: { zh: '动力农机', en: 'Power' },
  B: { zh: '耕作播种', en: 'Tillage' },
  C: { zh: '收获植保', en: 'Harvest' },
  D: { zh: '智慧农业', en: 'Smart' },
};

type ExhibitKind = 'rig' | 'seeder' | 'harvester' | 'combine' | 'drone' | 'rover';

const EXHIBITS: readonly {
  id: string;
  kind: ExhibitKind;
  position: [number, number, number];
  rotation: number;
  scale: number;
  accent?: string;
}[] = [
  { id: 'a1', kind: 'rig', position: [-6.55, 0, -3.9], rotation: 0.5, scale: 1.08, accent: '#d94a3a' },
  { id: 'a2', kind: 'rig', position: [-4.05, 0, -2.2], rotation: -0.72, scale: 0.92, accent: '#2f7d46' },
  { id: 'b2', kind: 'rig', position: [4.05, 0, -3.75], rotation: 2.4, scale: 1, accent: '#e07a2f' },
  { id: 'b3', kind: 'seeder', position: [6.55, 0, -2.15], rotation: 2.05, scale: 1 },
  { id: 'c3', kind: 'harvester', position: [-6.55, 0, 3.95], rotation: 0.42, scale: 1 },
  { id: 'c1', kind: 'combine', position: [-3.95, 0, 2.4], rotation: -0.5, scale: 1 },
  { id: 'd1', kind: 'drone', position: [4.35, 0, 2.55], rotation: 0.3, scale: 1 },
  { id: 'd3', kind: 'rover', position: [6.6, 0, 4.05], rotation: 2.55, scale: 1 },
];

function supportsWebGL(): boolean {
  try {
    const context = document.createElement('canvas').getContext('webgl2');
    context?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!context;
  } catch {
    return false;
  }
}

function useFloorTexture() {
  return useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.fillStyle = '#e7f1f8';
    context.fillRect(0, 0, 512, 512);
    context.strokeStyle = '#c5d8e8';
    context.lineWidth = 2;
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
    context.strokeStyle = '#b7cfe2';
    context.lineWidth = 4;
    context.strokeRect(8, 8, 496, 496);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(6, 4);
    texture.anisotropy = 4;
    return texture;
  }, []);
}

function FocusCamera({ selected, reducedMotion }: { selected: HallZoneId; reducedMotion: boolean }) {
  const { camera, invalidate, size } = useThree();
  const look = useRef(HOME_LOOK.clone());
  const goal = useRef(HOME.clone());
  const goalLook = useRef(HOME_LOOK.clone());
  const settled = useRef(false);
  useEffect(() => {
    settled.current = false;
    invalidate();
  }, [selected, size.width, reducedMotion, invalidate]);
  useFrame((_, delta) => {
    if (settled.current) return;
    const zone = HALL_ZONES.find((item) => item.id === selected)!;
    const offset = size.width < 720 ? WIDE : CLOSE;
    goal.current.set(zone.position[0] + offset.x, offset.y, zone.position[2] + offset.z);
    goalLook.current.set(zone.position[0], 0.55, zone.position[2]);
    const ease = reducedMotion ? 1 : 1 - Math.exp(-5 * Math.min(delta, 0.2));
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
    scene.environmentIntensity = 0.62;
    return () => {
      scene.environment = null;
      target.dispose();
      room.dispose();
      generator.dispose();
    };
  }, [gl, scene]);
  return null;
}

function GlassWall({ position, size }: { position: [number, number, number]; size: [number, number, number] }) {
  return (
    <mesh position={position}>
      <boxGeometry args={size} />
      <meshStandardMaterial color="#d5eaf6" transparent opacity={0.32} roughness={0.06} metalness={0.62} envMapIntensity={1.4} depthWrite={false} />
    </mesh>
  );
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
  const chords = [-6.4, -2.1, 2.2, 6.4];
  const crosses = [-10.4, -6.9, -3.4, 0.1, 3.5, 7, 10.4];
  return (
    <group>
      {chords.map((z) => (
        <mesh key={`chord-${z}`} position={[0, 3.72, z]}>
          <boxGeometry args={[22.2, 0.08, 0.08]} />
          <meshStandardMaterial color="#8eabbf" metalness={0.74} roughness={0.28} envMapIntensity={1.1} />
        </mesh>
      ))}
      {crosses.map((x) => (
        <mesh key={`cross-${x}`} position={[x, 3.64, 0.1]}>
          <boxGeometry args={[0.07, 0.07, 14.4]} />
          <meshStandardMaterial color="#9bb6c8" metalness={0.7} roughness={0.3} envMapIntensity={1.05} />
        </mesh>
      ))}
      {[-5.1, -1.5, 2.1, 5.5].map((z) => (
        <mesh key={`strip-${z}`} position={[0, 3.48, z]}>
          <boxGeometry args={[16.2, 0.035, 0.18]} />
          <meshStandardMaterial color="#e9f8ff" emissive="#b9e7ff" emissiveIntensity={0.85} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

function EntranceDoors() {
  return (
    <group position={[0, 0, 6.55]}>
      <mesh position={[0, 3.05, 0]}>
        <boxGeometry args={[4.6, 0.1, 0.12]} />
        <meshStandardMaterial color="#e7f1f8" metalness={0.62} roughness={0.22} envMapIntensity={1.2} />
      </mesh>
      {[-2.2, 2.2].map((x) => (
        <mesh key={`jamb-${x}`} position={[x, 1.5, 0]} castShadow>
          <boxGeometry args={[0.1, 3, 0.1]} />
          <meshStandardMaterial color="#e7f1f8" metalness={0.62} roughness={0.22} envMapIntensity={1.2} />
        </mesh>
      ))}
      {[-1, 1].map((side) => (
        <group key={side} position={[side * 2.15, 1.45, 0]} rotation={[0, side * -0.85, 0]}>
          <mesh position={[side * -0.9, 0, 0]}>
            <boxGeometry args={[1.75, 2.55, 0.035]} />
            <meshStandardMaterial color="#d7eef8" transparent opacity={0.38} roughness={0.05} metalness={0.48} envMapIntensity={1.3} depthWrite={false} />
          </mesh>
          <mesh position={[side * -0.9, 0, 0.03]}>
            <boxGeometry args={[0.04, 2.2, 0.04]} />
            <meshStandardMaterial color="#f7fbff" metalness={0.7} roughness={0.2} />
          </mesh>
        </group>
      ))}
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
  const lit = active || hovered;
  const label = SHORT[id];
  return (
    <group position={position}>
      <mesh
        position={[0, 0.08, 0]}
        receiveShadow
        onClick={(event) => { event.stopPropagation(); onSelect(id); }}
        onPointerOver={(event) => { event.stopPropagation(); onHover(id); }}
        onPointerOut={() => onHover(null)}
      >
        <boxGeometry args={[8.2, 0.16, 5.05]} />
        <meshStandardMaterial color={lit ? '#f7fbfe' : '#e4eef6'} roughness={0.55} metalness={0.06} />
      </mesh>
      <mesh position={[0, 0.17, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[7.5, 4.35]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={lit ? 1.35 : 0.42}
          transparent
          opacity={lit ? 0.62 : 0.28}
          toneMapped={false}
          depthWrite={false}
        />
      </mesh>
      <mesh position={[0, 0.175, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[3.35, 3.5, 64]} />
        <meshBasicMaterial color={color} transparent opacity={lit ? 0.95 : 0.4} toneMapped={false} />
      </mesh>
      <Html position={[0, 2.35, 0]} center zIndexRange={[12, 0]} distanceFactor={width < 720 ? 20 : 12}>
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

function Metal({ color, glow = 0, metal = 0.45, rough = 0.32 }: { color: string; glow?: number; metal?: number; rough?: number }) {
  return (
    <meshStandardMaterial
      color={color}
      metalness={metal}
      roughness={rough}
      envMapIntensity={1.15}
      emissive={glow > 0 ? color : '#000000'}
      emissiveIntensity={glow}
      toneMapped={glow < 0.9}
    />
  );
}

function Axle({ spots }: { spots: readonly (readonly [number, number])[] }) {
  return spots.map(([x, z]) => (
    <mesh key={`${x}-${z}`} position={[x, 0.24, z]} rotation={[0, 0, Math.PI / 2]} castShadow>
      <cylinderGeometry args={[0.22, 0.22, 0.16, 14]} />
      <meshStandardMaterial color="#1b2631" roughness={0.65} metalness={0.25} />
    </mesh>
  ));
}

function Rig({ accent = '#d94a3a' }: { accent?: string }) {
  return (
    <group>
      <RoundedBox args={[1.15, 0.42, 0.78]} position={[0.28, 0.62, 0]} radius={0.06} smoothness={2} castShadow>
        <Metal color="#e7eef4" metal={0.28} rough={0.42} />
      </RoundedBox>
      <mesh position={[-0.48, 0.96, 0]} castShadow>
        <boxGeometry args={[0.62, 0.52, 0.72]} />
        <Metal color="#d5e7f5" metal={0.12} rough={0.18} />
      </mesh>
      <mesh position={[0.72, 0.78, 0]} castShadow>
        <boxGeometry args={[0.55, 0.32, 0.62]} />
        <Metal color={accent} glow={0.22} metal={0.2} rough={0.45} />
      </mesh>
      <mesh position={[0.15, 0.95, 0]} castShadow>
        <boxGeometry args={[0.7, 0.12, 0.7]} />
        <Metal color="#243240" metal={0.45} rough={0.35} />
      </mesh>
      <Axle spots={[[-0.35, 0.48], [-0.35, -0.48], [0.62, 0.48], [0.62, -0.48]]} />
    </group>
  );
}

function Seeder() {
  return (
    <group>
      <mesh position={[-1.15, 0.48, 0]} castShadow>
        <boxGeometry args={[1.5, 0.08, 0.12]} />
        <Metal color="#9aa8b5" metal={0.7} rough={0.25} />
      </mesh>
      <RoundedBox args={[0.95, 0.55, 0.72]} position={[0.05, 0.78, 0]} radius={0.06} smoothness={2} castShadow>
        <Metal color="#f4f7fb" metal={0.25} rough={0.4} />
      </RoundedBox>
      <mesh position={[0.05, 1.12, 0]} castShadow>
        <boxGeometry args={[0.55, 0.16, 0.42]} />
        <Metal color="#7dffa8" glow={0.35} metal={0.2} rough={0.45} />
      </mesh>
      <mesh position={[0.72, 0.4, 0]} castShadow>
        <boxGeometry args={[0.16, 0.1, 2.15]} />
        <Metal color="#2c3d4d" metal={0.55} rough={0.35} />
      </mesh>
      {[-0.8, -0.4, 0, 0.4, 0.8].map((z) => (
        <mesh key={z} position={[0.78, 0.28, z]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.16, 0.16, 0.05, 12]} />
          <meshStandardMaterial color="#5c6b78" metalness={0.6} roughness={0.3} />
        </mesh>
      ))}
      <Axle spots={[[-0.2, 0.55], [-0.2, -0.55], [0.85, 0.7], [0.85, -0.7]]} />
    </group>
  );
}

function Harvester({ compact = false }: { compact?: boolean }) {
  const header = compact ? 1.7 : 2.35;
  const body: [number, number, number] = compact ? [1.85, 0.62, 1.05] : [2.25, 0.72, 1.2];
  const accent = compact ? '#ffb15a' : '#ffd36a';
  return (
    <group>
      <RoundedBox args={body} position={[0, 0.72, 0]} radius={0.08} smoothness={2} castShadow>
        <Metal color="#f3f6fa" metal={0.3} rough={0.38} />
      </RoundedBox>
      <mesh position={compact ? [-0.35, 1.22, 0] : [-0.15, 1.28, 0]} castShadow>
        <boxGeometry args={compact ? [0.7, 0.38, 0.85] : [0.9, 0.42, 0.95]} />
        <Metal color={accent} glow={0.25} metal={0.15} rough={0.45} />
      </mesh>
      <mesh position={compact ? [-0.85, 1.18, 0] : [-0.85, 1.25, 0]} castShadow>
        <boxGeometry args={[0.62, 0.5, 0.9]} />
        <Metal color="#d5e8f6" metal={0.15} rough={0.18} />
      </mesh>
      <mesh position={[body[0] / 2 + 0.12, 0.46, 0]} castShadow>
        <boxGeometry args={[0.28, 0.32, header]} />
        <Metal color={accent} glow={0.45} metal={0.2} rough={0.4} />
      </mesh>
      <mesh position={[body[0] / 2 + 0.28, 0.72, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.16, 0.16, header - 0.15, 12]} />
        <meshStandardMaterial color="#243240" metalness={0.45} roughness={0.4} />
      </mesh>
      <Axle spots={[[-0.45, 0.55], [-0.45, -0.55], [0.55, 0.58], [0.55, -0.58]]} />
    </group>
  );
}

function Drone() {
  return (
    <group position={[0, 1.25, 0]}>
      <mesh castShadow>
        <boxGeometry args={[0.38, 0.1, 0.38]} />
        <Metal color="#1d2b38" metal={0.55} rough={0.28} />
      </mesh>
      <mesh position={[0, -0.12, 0]}>
        <boxGeometry args={[0.12, 0.08, 0.12]} />
        <Metal color="#49c2ff" glow={0.9} metal={0.2} rough={0.3} />
      </mesh>
      {[0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2].map((angle) => (
        <group key={angle} rotation={[0, angle, 0]}>
          <mesh position={[0.38, 0.02, 0]} castShadow>
            <boxGeometry args={[0.62, 0.025, 0.05]} />
            <Metal color="#d7e6f2" metal={0.65} rough={0.22} />
          </mesh>
          <mesh position={[0.68, 0.03, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.14, 0.012, 6, 18]} />
            <meshBasicMaterial color="#8fd4ff" toneMapped={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Rover() {
  return (
    <group>
      <RoundedBox args={[1.35, 0.28, 0.78]} position={[0, 0.42, 0]} radius={0.05} smoothness={2} castShadow>
        <Metal color="#eef3f8" metal={0.35} rough={0.35} />
      </RoundedBox>
      <mesh position={[0.15, 0.78, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.06, 0.55, 8]} />
        <Metal color="#8ea0b0" metal={0.6} rough={0.25} />
      </mesh>
      <mesh position={[0.15, 1.1, 0]} castShadow>
        <sphereGeometry args={[0.16, 14, 12]} />
        <Metal color="#c9b6ff" glow={0.7} metal={0.2} rough={0.3} />
      </mesh>
      <mesh position={[-0.35, 0.62, 0]} castShadow>
        <boxGeometry args={[0.4, 0.16, 0.46]} />
        <Metal color="#2a3a4a" metal={0.4} rough={0.4} />
      </mesh>
      <Axle spots={[[-0.4, 0.4], [-0.4, -0.4], [0.42, 0.4], [0.42, -0.4]]} />
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
        <small>{HALL_EXAMPLE_LABEL}</small>
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
  const enter = (event: { stopPropagation: () => void }) => {
    event.stopPropagation();
    onTip(id);
    onHover(device.zone);
    gl.domElement.style.cursor = 'pointer';
  };
  const leave = () => {
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
      <mesh position={[0, 0.95, 0]} onClick={(event) => { event.stopPropagation(); onSelect(device.zone); }} onPointerOver={enter} onPointerOut={leave}>
        <boxGeometry args={[2.1, 1.7, 1.45]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <group scale={scale}>{children}</group>
      {tipped && <ExhibitTip id={id} />}
    </group>
  );
}

function Silhouette({ kind, accent }: { kind: ExhibitKind; accent?: string }) {
  if (kind === 'seeder') return <Seeder />;
  if (kind === 'harvester') return <Harvester />;
  if (kind === 'combine') return <Harvester compact />;
  if (kind === 'drone') return <Drone />;
  if (kind === 'rover') return <Rover />;
  return <Rig accent={accent} />;
}

function HallWorld({ selected, hovered, reducedMotion, onSelect, onHover }: HallSceneProps) {
  const floor = useFloorTexture();
  const { invalidate, size, gl } = useThree();
  const [tip, setTip] = useState<string | null>(null);
  const zone = HALL_ZONES.find((item) => item.id === selected)!;
  useEffect(() => () => { floor?.dispose(); }, [floor]);
  useEffect(() => () => { gl.domElement.style.cursor = ''; }, [gl]);
  useEffect(() => { invalidate(); }, [selected, hovered, tip, invalidate]);
  return (
    <>
      <HallEnvironment />
      <color attach="background" args={['#c5ddf0']} />
      <fog attach="fog" args={['#c5ddf0', 26, 52]} />
      <hemisphereLight args={['#f5fbff', '#7fa4be', 0.72]} />
      <ambientLight intensity={0.55} color="#f7fbff" />
      <directionalLight
        position={[9, 18, 7]}
        intensity={2.7}
        color="#fff6ea"
        castShadow
        shadow-mapSize={[512, 512]}
        shadow-camera-left={-16}
        shadow-camera-right={16}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
        shadow-camera-far={42}
        shadow-bias={-0.0002}
      />
      <directionalLight position={[-10, 7, -4]} intensity={0.85} color="#9fd4ff" />
      <pointLight position={[zone.position[0], 3.6, zone.position[2]]} color={zone.color} intensity={26} distance={11} decay={2} />
      <FocusCamera selected={selected} reducedMotion={reducedMotion} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0.1]} receiveShadow>
        <planeGeometry args={[24, 16]} />
        <meshStandardMaterial map={floor ?? undefined} color="#eef5fb" roughness={0.9} metalness={0.02} />
      </mesh>
      <mesh position={[0, 0.02, 0.1]}>
        <boxGeometry args={[1.2, 0.025, 14.4]} />
        <meshStandardMaterial color="#d5ebf8" emissive="#8fd4ff" emissiveIntensity={1.05} toneMapped={false} />
      </mesh>
      <GlassWall position={[0, 2.15, -7.7]} size={[23.2, 4.3, 0.08]} />
      <GlassWall position={[-11.6, 2.15, 0.1]} size={[0.08, 4.3, 15.6]} />
      <GlassWall position={[11.6, 2.15, 0.1]} size={[0.08, 4.3, 15.6]} />
      <mesh position={[0, 0.16, -7.62]} receiveShadow>
        <boxGeometry args={[23.2, 0.32, 0.1]} />
        <meshStandardMaterial color="#d5e2ee" metalness={0.35} roughness={0.4} />
      </mesh>
      <mesh position={[0, 4.22, 0.1]}>
        <boxGeometry args={[23.2, 0.05, 15.6]} />
        <meshStandardMaterial color="#e7f3fb" transparent opacity={0.34} roughness={0.12} metalness={0.28} envMapIntensity={0.9} />
      </mesh>
      <CeilingTruss />
      <EntranceDoors />
      {[[-10.9, -6.9], [10.9, -6.9], [-10.9, 7.05], [10.9, 7.05]].map(([x, z]) => (
        <mesh key={`post-${x}-${z}`} position={[x, 2.1, z]} castShadow>
          <boxGeometry args={[0.18, 4.2, 0.18]} />
          <meshStandardMaterial color="#e7f1f8" metalness={0.72} roughness={0.18} envMapIntensity={1.35} />
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
          <Silhouette kind={exhibit.kind} accent={exhibit.accent} />
        </Exhibit>
      ))}
      {[[-9.6, -5.6], [-9.6, 5.8], [9.6, -5.6], [9.6, 5.8], [-1.15, -6.3], [1.15, -6.3], [-1.15, 6.2], [1.15, 6.2], [-3.3, 6.15], [3.3, 6.15], [-7.4, 0.15], [7.4, 0.15]].map(([x, z]) => (
        <Plant key={`${x}-${z}`} position={[x, 0, z]} />
      ))}
      {!reducedMotion && size.width >= 720 && (
        <ContactShadows frames={1} position={[0, 0.012, 0.1]} opacity={0.32} scale={22} blur={2.2} far={3.2} resolution={192} />
      )}
      <StageGlow reducedMotion={reducedMotion} />
    </>
  );
}

/** Desktop glow only. Narrow screens and reduced motion keep the plain framebuffer. */
function StageGlow({ reducedMotion }: { reducedMotion: boolean }) {
  const width = useThree((state) => state.size.width);
  if (reducedMotion || width < 720) return null;
  return (
    <EffectComposer multisampling={0} enableNormalPass={false} resolutionScale={0.7}>
      <Bloom luminanceThreshold={0.58} luminanceSmoothing={0.22} intensity={0.4} mipmapBlur radius={0.42} levels={3} />
      <Vignette eskil={false} offset={0.18} darkness={0.42} />
    </EffectComposer>
  );
}

function HallFallback() {
  const lang = useLang();
  return (
    <div className="hall-fallback" role="status">
      <Tractor size={42} strokeWidth={1.2} />
      <p>{lang === 'zh' ? '三维展厅暂不可用，展区导航和示例清单仍可使用。' : 'The 3D hall is unavailable. Zone navigation and the example list still work.'}</p>
    </div>
  );
}

export default function HallScene(props: HallSceneProps) {
  const lang = useLang();
  const [supported] = useState(supportsWebGL);
  if (!supported) return <HallFallback />;
  return (
    <ErrorBoundary FallbackComponent={HallFallback}>
      <Canvas
        shadows
        camera={{ position: [HOME.x, HOME.y, HOME.z], fov: 32, near: 0.1, far: 80 }}
        gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
        dpr={[1, 1.25]}
        frameloop="demand"
        onCreated={({ camera }) => camera.lookAt(HOME_LOOK)}
        aria-label={lang === 'zh' ? '农机数字孪生展示大厅的等轴示意' : 'Isometric schematic of the machinery hall'}
      >
        <HallWorld {...props} />
      </Canvas>
    </ErrorBoundary>
  );
}

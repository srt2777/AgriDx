import { useEffect, useLayoutEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import {
  HALL_IDLE_INTERVAL_MS,
  STATUS_HALO,
  exhibitStatus,
  idleMotionAllowed,
  type ExhibitKind,
} from './hall-machines';

function Metal({ color, glow = 0, metal = 0.45, rough = 0.32 }: { color: string; glow?: number; metal?: number; rough?: number }) {
  return (
    <meshStandardMaterial
      color={color}
      metalness={metal}
      roughness={rough}
      envMapIntensity={0.42}
      emissive={glow > 0 ? color : '#000000'}
      emissiveIntensity={glow}
      toneMapped={glow < 0.9}
    />
  );
}

function Wheel({ position, large = false }: { position: [number, number, number]; large?: boolean }) {
  const radius = large ? 0.42 : 0.3;
  return (
    <group name="wheel" position={position} rotation={[Math.PI / 2, 0, 0]}>
      <mesh castShadow>
        <cylinderGeometry args={[radius, radius, large ? 0.22 : 0.16, 12]} />
        <meshStandardMaterial color="#1a232c" roughness={0.72} metalness={0.18} />
      </mesh>
      <mesh position={[0, large ? 0.02 : 0.01, 0]}>
        <cylinderGeometry args={[radius * 0.46, radius * 0.46, large ? 0.24 : 0.18, 8]} />
        <meshStandardMaterial color="#d5dee6" metalness={0.62} roughness={0.28} />
      </mesh>
    </group>
  );
}

export function Tractor({ accent = '#d94a3a' }: { accent?: string }) {
  return (
    <group>
      <mesh position={[0.15, 0.58, 0]} castShadow>
        <boxGeometry args={[1.35, 0.28, 0.72]} />
        <Metal color="#e7eef4" metal={0.32} rough={0.4} />
      </mesh>
      <mesh position={[0.55, 0.82, 0]} castShadow>
        <boxGeometry args={[0.7, 0.32, 0.62]} />
        <Metal color={accent} glow={0.18} metal={0.22} rough={0.42} />
      </mesh>
      <group name="cab">
        <mesh position={[-0.28, 1.05, 0]} castShadow>
          <boxGeometry args={[0.62, 0.58, 0.7]} />
          <Metal color="#d7e8f4" metal={0.16} rough={0.2} />
        </mesh>
        <mesh position={[-0.28, 1.08, 0]}>
          <boxGeometry args={[0.48, 0.36, 0.72]} />
          <meshStandardMaterial color="#9fd4ef" transparent opacity={0.45} roughness={0.05} metalness={0.4} envMapIntensity={1.3} />
        </mesh>
        <mesh position={[-0.28, 1.38, 0]} castShadow>
          <boxGeometry args={[0.7, 0.06, 0.78]} />
          <Metal color="#243240" metal={0.4} rough={0.35} />
        </mesh>
      </group>
      <mesh name="exhaust" position={[0.42, 1.15, 0.28]} castShadow>
        <cylinderGeometry args={[0.045, 0.05, 0.72, 8]} />
        <Metal color="#2c3a46" metal={0.7} rough={0.28} />
      </mesh>
      <mesh position={[0.42, 1.52, 0.28]}>
        <cylinderGeometry args={[0.06, 0.045, 0.06, 8]} />
        <Metal color="#1b2630" metal={0.5} rough={0.4} />
      </mesh>
      <Wheel position={[-0.48, 0.42, 0.42]} large />
      <Wheel position={[-0.48, 0.42, -0.42]} large />
      <Wheel position={[0.62, 0.32, 0.4]} />
      <Wheel position={[0.62, 0.32, -0.4]} />
    </group>
  );
}

export function Seeder() {
  return (
    <group>
      <mesh position={[-0.85, 0.42, 0]} castShadow>
        <boxGeometry args={[1.15, 0.08, 0.16]} />
        <Metal color="#9aa8b5" metal={0.7} rough={0.25} />
      </mesh>
      <mesh name="hopper" position={[0.05, 0.95, 0]} castShadow>
        <cylinderGeometry args={[0.28, 0.42, 0.62, 10]} />
        <Metal color="#f4f7fb" metal={0.22} rough={0.38} />
      </mesh>
      <mesh position={[0.05, 1.28, 0]} castShadow>
        <cylinderGeometry args={[0.16, 0.2, 0.1, 8]} />
        <Metal color="#7dffa8" glow={0.28} metal={0.2} rough={0.4} />
      </mesh>
      <mesh position={[0.72, 0.38, 0]} castShadow>
        <boxGeometry args={[0.16, 0.1, 2.05]} />
        <Metal color="#2c3d4d" metal={0.55} rough={0.35} />
      </mesh>
      {[-0.7, -0.35, 0, 0.35, 0.7].map((z) => (
        <mesh key={z} position={[0.82, 0.26, z]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.12, 0.12, 0.05, 8]} />
          <meshStandardMaterial color="#5c6b78" metalness={0.55} roughness={0.32} />
        </mesh>
      ))}
      <Wheel position={[-0.15, 0.28, 0.48]} />
      <Wheel position={[-0.15, 0.28, -0.48]} />
    </group>
  );
}

function HeaderAndReel({ header, accent, moving }: { header: number; accent: string; moving: boolean }) {
  return (
    <group position={[1.15, 0.5, 0]}>
      <mesh name="header" castShadow>
        <boxGeometry args={[0.34, 0.28, header]} />
        <Metal color={accent} glow={0.2} metal={0.2} rough={0.4} />
      </mesh>
      <group name={moving ? 'reel' : undefined} position={[0.22, 0.28, 0]}>
        <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.08, 0.08, header - 0.2, 8]} />
          <Metal color="#243240" metal={0.45} rough={0.35} />
        </mesh>
        {[-0.7, -0.25, 0.25, 0.7].map((z) => (
          <mesh key={z} position={[0, 0, z * (header / 2.6)]} castShadow>
            <boxGeometry args={[0.36, 0.03, 0.04]} />
            <meshStandardMaterial color="#c5d2dc" metalness={0.4} roughness={0.35} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

export function Harvester({ compact = false, moving = false }: { compact?: boolean; moving?: boolean }) {
  const header = compact ? 1.85 : 2.45;
  const accent = compact ? '#ffb15a' : '#ffd36a';
  return (
    <group>
      <RoundedBox args={compact ? [1.7, 0.58, 1.02] : [2.05, 0.66, 1.16]} position={[0, 0.7, 0]} radius={0.08} smoothness={2} castShadow>
        <Metal color="#f3f6fa" metal={0.3} rough={0.38} />
      </RoundedBox>
      <mesh position={compact ? [-0.35, 1.18, 0] : [-0.2, 1.24, 0]} castShadow>
        <boxGeometry args={compact ? [0.62, 0.36, 0.82] : [0.82, 0.4, 0.92]} />
        <Metal color={accent} glow={0.16} metal={0.15} rough={0.42} />
      </mesh>
      <mesh name="cab" position={compact ? [-0.85, 1.12, 0] : [-0.95, 1.18, 0]} castShadow>
        <boxGeometry args={[0.55, 0.48, 0.82]} />
        <Metal color="#d5e8f6" metal={0.12} rough={0.16} />
      </mesh>
      <HeaderAndReel header={header} accent={accent} moving={moving} />
      <Wheel position={[-0.45, 0.4, 0.55]} large />
      <Wheel position={[-0.45, 0.4, -0.55]} large />
      <Wheel position={[0.5, 0.32, 0.5]} />
      <Wheel position={[0.5, 0.32, -0.5]} />
    </group>
  );
}

export function Drone({ moving }: { moving: boolean }) {
  return (
    <group name={moving ? 'drone-body' : undefined} position={[0, 1.35, 0]}>
      <mesh castShadow>
        <boxGeometry args={[0.42, 0.1, 0.42]} />
        <Metal color="#1d2b38" metal={0.55} rough={0.28} />
      </mesh>
      <mesh position={[0, -0.14, 0]}>
        <boxGeometry args={[0.12, 0.1, 0.12]} />
        <Metal color="#49c2ff" glow={moving ? 0.7 : 0.15} metal={0.2} rough={0.3} />
      </mesh>
      {[0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2].map((angle) => (
        <group key={angle} rotation={[0, angle, 0]}>
          <mesh position={[0.36, 0.04, 0]} castShadow>
            <boxGeometry args={[0.55, 0.03, 0.06]} />
            <Metal color="#d7e6f2" metal={0.6} rough={0.24} />
          </mesh>
          <group name={moving ? 'rotor' : undefined} position={[0.62, 0.08, 0]}>
            <mesh>
              <boxGeometry args={[0.34, 0.012, 0.045]} />
              <meshBasicMaterial color="#d7f4ff" toneMapped={false} />
            </mesh>
            <mesh rotation={[0, Math.PI / 2, 0]}>
              <boxGeometry args={[0.34, 0.012, 0.045]} />
              <meshBasicMaterial color="#9fdfff" toneMapped={false} />
            </mesh>
          </group>
        </group>
      ))}
    </group>
  );
}

export function Rover() {
  return (
    <group>
      <RoundedBox args={[1.25, 0.26, 0.72]} position={[0, 0.4, 0]} radius={0.05} smoothness={2} castShadow>
        <Metal color="#eef3f8" metal={0.35} rough={0.35} />
      </RoundedBox>
      <mesh position={[0.12, 0.72, 0]} castShadow>
        <cylinderGeometry args={[0.045, 0.05, 0.42, 8]} />
        <Metal color="#8ea0b0" metal={0.6} rough={0.25} />
      </mesh>
      <mesh name="sensor" position={[0.12, 0.98, 0]} castShadow>
        <cylinderGeometry args={[0.16, 0.16, 0.08, 12]} />
        <Metal color="#c9b6ff" glow={0.45} metal={0.25} rough={0.3} />
      </mesh>
      <mesh name="sensor" position={[-0.28, 0.62, 0.18]} castShadow>
        <boxGeometry args={[0.16, 0.1, 0.12]} />
        <Metal color="#2a3a4a" metal={0.4} rough={0.35} />
      </mesh>
      <mesh name="sensor" position={[-0.28, 0.66, 0.28]}>
        <sphereGeometry args={[0.05, 8, 6]} />
        <meshStandardMaterial color="#9fd4ff" emissive="#9fd4ff" emissiveIntensity={0.4} />
      </mesh>
      <Wheel position={[-0.38, 0.24, 0.36]} />
      <Wheel position={[-0.38, 0.24, -0.36]} />
      <Wheel position={[0.4, 0.24, 0.36]} />
      <Wheel position={[0.4, 0.24, -0.36]} />
    </group>
  );
}

export function ExhibitModel({ kind, accent, moving }: { kind: ExhibitKind; accent?: string; moving: boolean }) {
  if (kind === 'seeder') return <Seeder />;
  if (kind === 'harvester') return <Harvester moving={moving} />;
  if (kind === 'combine') return <Harvester compact moving={moving} />;
  if (kind === 'drone') return <Drone moving={moving} />;
  if (kind === 'rover') return <Rover />;
  return <Tractor accent={accent} />;
}

export function StatusHalo({ id }: { id: string }) {
  const status = exhibitStatus(id);
  const color = STATUS_HALO[status];
  return (
    <group>
      <mesh position={[0, 0.23, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.78, 0.96, 28]} />
        <meshBasicMaterial color={color} transparent opacity={status === 'offline' ? 0.35 : 0.9} toneMapped={false} />
      </mesh>
      {status === 'online' && (
        <mesh name="beacon" position={[0, 1.72, 0]}>
          <boxGeometry args={[0.22, 0.05, 0.06]} />
          <meshBasicMaterial color={color} toneMapped={false} />
        </mesh>
      )}
    </group>
  );
}

/** Slow optional loop. Hidden tabs and reduced motion never schedule the next tick. */
export function HallIdle({ enabled, reduced }: { enabled: boolean; reduced: boolean }) {
  const scene = useThree((state) => state.scene);
  const invalidate = useThree((state) => state.invalidate);
  const live = useRef({ scene, invalidate });
  useLayoutEffect(() => {
    live.current = { scene, invalidate };
  });
  useEffect(() => {
    if (!idleMotionAllowed({ enabled, reduced, hidden: false })) return undefined;
    let timer = 0;
    let alive = true;
    let pending = false;
    const loop = () => {
      pending = false;
      if (!alive || !idleMotionAllowed({ enabled: true, reduced: false, hidden: document.hidden })) return;
      const current = live.current;
      const t = performance.now() / 1000;
      current.scene.traverse((obj) => {
        if (obj.name === 'rotor') obj.rotation.y = t * 12;
        if (obj.name === 'beacon') obj.rotation.y = t * 2.2;
        if (obj.name === 'reel') obj.rotation.x = t * 0.9;
        if (obj.name === 'drone-body') {
          const base = typeof obj.userData.baseY === 'number' ? obj.userData.baseY : obj.position.y;
          obj.userData.baseY = base;
          obj.position.y = base + Math.sin(t * 1.6) * 0.045;
        }
      });
      try {
        current.invalidate();
      } catch {
        // A failed redraw must not cancel the next idle tick.
      }
      pending = true;
      timer = window.setTimeout(loop, HALL_IDLE_INTERVAL_MS);
    };
    const start = () => {
      if (!alive || pending || document.hidden) return;
      loop();
    };
    const onVisibility = () => {
      if (document.hidden) {
        window.clearTimeout(timer);
        pending = false;
        return;
      }
      start();
    };
    document.addEventListener('visibilitychange', onVisibility);
    start();
    return () => {
      alive = false;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, reduced]);
  return null;
}

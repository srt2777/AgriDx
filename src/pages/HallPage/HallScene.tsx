import { Suspense, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, RoundedBox } from '@react-three/drei';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import { ErrorBoundary } from 'react-error-boundary';
import { Tractor } from 'lucide-react';
import * as THREE from 'three';
import TractorModel from '@/components/TractorModel';
import { useLang } from '@/hooks/useLang';
import { HALL_ZONES, type HallZoneId } from './hall-example-data';

interface HallSceneProps {
  selected: HallZoneId;
  hovered: HallZoneId | null;
  reducedMotion: boolean;
  onSelect: (id: HallZoneId) => void;
  onHover: (id: HallZoneId | null) => void;
}

const HOME = new THREE.Vector3(16.2, 13.2, 16.2);
const HOME_LOOK = new THREE.Vector3(0, 0.35, 0.1);
const bias = new THREE.Vector3();

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
    context.fillStyle = '#f3f8fc';
    context.fillRect(0, 0, 512, 512);
    context.strokeStyle = '#d5e3ef';
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
  const goal = useRef(new THREE.Vector3());
  const goalLook = useRef(new THREE.Vector3());
  useEffect(() => { invalidate(); }, [selected, size.width, invalidate]);
  useFrame((_, delta) => {
    const zone = HALL_ZONES.find((item) => item.id === selected)!;
    const narrow = size.width < 720;
    const distance = narrow ? 1.22 : 1;
    bias.set(zone.position[0], 0, zone.position[2]);
    goal.current.copy(HOME).multiplyScalar(distance).addScaledVector(bias, 0.18);
    goalLook.current.copy(HOME_LOOK).addScaledVector(bias, 0.22);
    const ease = reducedMotion ? 1 : 1 - Math.exp(-2.6 * Math.min(delta, 0.08));
    const before = camera.position.distanceToSquared(goal.current) + look.current.distanceToSquared(goalLook.current);
    camera.position.lerp(goal.current, ease);
    look.current.lerp(goalLook.current, ease);
    camera.lookAt(look.current);
    if (before > 0.0015) invalidate();
  });
  return null;
}

function GlassWall({ position, size }: { position: [number, number, number]; size: [number, number, number] }) {
  return (
    <mesh position={position}>
      <boxGeometry args={size} />
      <meshStandardMaterial color="#b9def4" transparent opacity={0.22} roughness={0.05} metalness={0.15} depthWrite={false} />
    </mesh>
  );
}

function Plant({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.18, 0]} castShadow>
        <cylinderGeometry args={[0.07, 0.09, 0.36, 8]} />
        <meshStandardMaterial color="#d7e4ee" roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.48, 0]} castShadow>
        <sphereGeometry args={[0.2, 12, 10]} />
        <meshStandardMaterial color="#67b37a" roughness={0.55} />
      </mesh>
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
  const lit = active || hovered;
  return (
    <group position={position}>
      <mesh
        position={[0, 0.08, 0]}
        receiveShadow
        onClick={(event) => { event.stopPropagation(); onSelect(id); }}
        onPointerOver={(event) => { event.stopPropagation(); onHover(id); }}
        onPointerOut={() => onHover(null)}
      >
        <boxGeometry args={[8.4, 0.16, 5.15]} />
        <meshStandardMaterial color={lit ? '#ffffff' : '#f7fbfe'} emissive={color} emissiveIntensity={lit ? 0.28 : 0.05} roughness={0.42} metalness={0.08} />
      </mesh>
      <mesh position={[0, 0.18, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[3.55, 3.68, 64]} />
        <meshBasicMaterial color={color} transparent opacity={lit ? 0.95 : 0.45} />
      </mesh>
      <Html position={[0, 2.55, 0]} center zIndexRange={[12, 0]} distanceFactor={14}>
        <button
          type="button"
          className={`hall-marker${active ? ' is-on' : ''}`}
          style={{ '--zone-color': color } as CSSProperties}
          onClick={() => onSelect(id)}
          onPointerEnter={() => onHover(id)}
          onPointerLeave={() => onHover(null)}
        >
          {id} {lang === 'zh' ? '展区' : 'zone'}
        </button>
      </Html>
    </group>
  );
}

function MachinePad({ position, rotation, children }: { position: [number, number, number]; rotation: number; children: ReactNode }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[1.15, 24]} />
        <meshStandardMaterial color="#d5e2ee" roughness={0.8} />
      </mesh>
      {children}
    </group>
  );
}

function BlockMachine({ position, rotation, color }: { position: [number, number, number]; rotation: number; color: string }) {
  return (
    <MachinePad position={position} rotation={rotation}>
      <RoundedBox args={[1.7, 0.55, 0.9]} position={[0, 0.55, 0]} radius={0.06} smoothness={2} castShadow>
        <meshStandardMaterial color="#f4f7fb" metalness={0.35} roughness={0.35} />
      </RoundedBox>
      <RoundedBox args={[0.7, 0.45, 0.7]} position={[-0.15, 0.95, 0]} radius={0.05} smoothness={2} castShadow>
        <meshStandardMaterial color="#dbe7f1" metalness={0.2} roughness={0.4} />
      </RoundedBox>
      <mesh position={[0.95, 0.48, 0]} castShadow>
        <boxGeometry args={[0.7, 0.28, 1.15]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.35} metalness={0.4} roughness={0.35} />
      </mesh>
      {[[-0.45, 0.28], [0.5, 0.28]].map(([x, z]) => (
        <mesh key={`${x}-${z}`} position={[x, 0.22, z]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.2, 0.2, 0.16, 12]} />
          <meshStandardMaterial color="#243140" roughness={0.6} />
        </mesh>
      ))}
    </MachinePad>
  );
}

function HallWorld({ selected, hovered, reducedMotion, onSelect, onHover }: HallSceneProps) {
  const floor = useFloorTexture();
  const { invalidate, size } = useThree();
  useEffect(() => () => { floor?.dispose(); }, [floor]);
  useEffect(() => { invalidate(); }, [selected, hovered, invalidate]);
  const shadow = size.width < 800 ? 512 : 1024;
  return (
    <>
      <color attach="background" args={['#d7e8f5']} />
      <fog attach="fog" args={['#d7e8f5', 28, 58]} />
      <ambientLight intensity={1.15} color="#f4f8fc" />
      <directionalLight
        position={[8, 16, 6]}
        intensity={2.4}
        color="#fffaf2"
        castShadow
        shadow-mapSize={[shadow, shadow]}
        shadow-camera-left={-16}
        shadow-camera-right={16}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
        shadow-camera-far={40}
        shadow-bias={-0.0002}
      />
      <directionalLight position={[-8, 8, -6]} intensity={0.7} color="#9fd6ff" />
      <FocusCamera selected={selected} reducedMotion={reducedMotion} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0.1]} receiveShadow>
        <planeGeometry args={[24, 16]} />
        <meshStandardMaterial map={floor ?? undefined} color="#f4f8fc" roughness={0.86} metalness={0.02} />
      </mesh>
      <mesh position={[0, 0.015, 0.1]}>
        <boxGeometry args={[1.35, 0.03, 14.2]} />
        <meshStandardMaterial color="#d5ebf8" emissive="#7ec8ee" emissiveIntensity={0.18} />
      </mesh>
      <GlassWall position={[0, 2.1, -7.7]} size={[23.2, 4.2, 0.08]} />
      <GlassWall position={[-11.6, 2.1, 0.1]} size={[0.08, 4.2, 15.6]} />
      <GlassWall position={[11.6, 2.1, 0.1]} size={[0.08, 4.2, 15.6]} />
      <mesh position={[0, 4.15, 0.1]}>
        <boxGeometry args={[23.2, 0.06, 15.6]} />
        <meshStandardMaterial color="#e7f3fb" transparent opacity={0.35} roughness={0.1} metalness={0.05} />
      </mesh>
      {[-8, -2.6, 2.6, 8].map((x) => (
        <mesh key={x} position={[x, 4.05, 0.1]}>
          <boxGeometry args={[0.08, 0.05, 14.4]} />
          <meshStandardMaterial color="#9fd8ff" emissive="#7ecfff" emissiveIntensity={1.8} toneMapped={false} />
        </mesh>
      ))}
      {[-4.2, 0.2, 4.6].map((z) => (
        <mesh key={z} position={[0, 4.02, z]}>
          <boxGeometry args={[20, 0.04, 0.06]} />
          <meshStandardMaterial color="#bfe6ff" emissive="#8fd4ff" emissiveIntensity={1.35} toneMapped={false} />
        </mesh>
      ))}
      {HALL_ZONES.map((zone) => (
        <ZoneStand
          key={zone.id}
          id={zone.id}
          position={zone.position}
          color={zone.color}
          active={selected === zone.id}
          hovered={hovered === zone.id}
          onSelect={onSelect}
          onHover={onHover}
        />
      ))}
      <Suspense fallback={null}>
        <MachinePad position={[-6.5, 0, -3.7]} rotation={0.55}>
          <group scale={0.72}><TractorModel /></group>
        </MachinePad>
        <MachinePad position={[-4.1, 0, -2.35]} rotation={-0.7}>
          <group scale={0.62}><TractorModel /></group>
        </MachinePad>
        <MachinePad position={[4.2, 0, -3.5]} rotation={2.5}>
          <group scale={0.68}><TractorModel /></group>
        </MachinePad>
        <MachinePad position={[6.5, 0, -2.2]} rotation={2.1}>
          <group scale={0.58}><TractorModel /></group>
        </MachinePad>
      </Suspense>
      <BlockMachine position={[-6.4, 0, 3.9]} rotation={0.4} color="#f0c24a" />
      <BlockMachine position={[-4.0, 0, 2.5]} rotation={-0.5} color="#ef8b4c" />
      <BlockMachine position={[4.3, 0, 2.6]} rotation={2.2} color="#7d6cff" />
      <BlockMachine position={[6.6, 0, 4.0]} rotation={2.6} color="#49c2ff" />
      {[[-9.6, -5.6], [-9.6, 5.8], [9.6, -5.6], [9.6, 5.8], [-1.1, -6.2], [1.1, -6.2], [-1.1, 6.4], [1.1, 6.4]].map(([x, z]) => (
        <Plant key={`${x}-${z}`} position={[x, 0, z]} />
      ))}
      <StageGlow reducedMotion={reducedMotion} />
    </>
  );
}

/** Desktop glow only. Narrow screens and reduced motion keep the plain framebuffer. */
function StageGlow({ reducedMotion }: { reducedMotion: boolean }) {
  const width = useThree((state) => state.size.width);
  if (reducedMotion || width < 720) return null;
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      <Bloom luminanceThreshold={0.2} luminanceSmoothing={0.25} intensity={0.65} mipmapBlur radius={0.5} levels={5} />
      <Vignette eskil={false} offset={0.2} darkness={0.38} />
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
        dpr={[1, 1.5]}
        frameloop="demand"
        onCreated={({ camera }) => camera.lookAt(HOME_LOOK)}
        aria-label={lang === 'zh' ? '农机数字孪生展示大厅的等轴示意' : 'Isometric schematic of the machinery hall'}
      >
        <HallWorld {...props} />
      </Canvas>
    </ErrorBoundary>
  );
}

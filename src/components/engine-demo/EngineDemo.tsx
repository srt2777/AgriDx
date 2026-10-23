import { Suspense, useEffect, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { ContactShadows, Environment, OrbitControls } from '@react-three/drei';
import { ErrorBoundary } from 'react-error-boundary';
import { useReducedMotion } from 'framer-motion';
import { Group, DoubleSide } from 'three';
import { useLang } from '@/hooks/useLang';
import { probeWebGL } from '@/lib/webgl';
import './engine-demo.css';
import { pistonPosition } from './kinematics';

// Keep the whole assembly in frame as its parts move apart.
function ExplosionFraming({ explode }: { explode: number }) {
  const { camera, invalidate } = useThree();
  useEffect(() => {
    camera.zoom = 1 / (1 + explode * .3);
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, explode, invalidate]);
  return null;
}

function Cylinder({ x, phase, clock, explode, transparent }: { x: number; phase: number; clock: React.RefObject<number>; explode: number; transparent: boolean }) {
  const piston = useRef<Group>(null), rod = useRef<Group>(null), crank = useRef<Group>(null);
  useFrame(() => {
    const angle = clock.current + phase;
    const z = .32 * Math.sin(angle), y = .32 * Math.cos(angle);
    const top = pistonPosition(angle);
    if (piston.current) piston.current.position.y = .9 + top + explode * .75;
    if (rod.current) {
      rod.current.position.set(x, .9 + (y + top) / 2 + explode * .35, z / 2);
      rod.current.rotation.x = Math.atan2(-z, top - y);
    }
    if (crank.current) crank.current.rotation.x = angle;
  });
  return <>
    <group position={[x, .9, 0]} ref={crank}>
      <mesh position={[0, .16, 0]}><boxGeometry args={[.13, .48, .17]} /><meshStandardMaterial color="#c5a052" metalness={.78} roughness={.27} /></mesh>
      <mesh position={[0, .32, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[.10, .10, .34, 24]} /><meshStandardMaterial color="#b5bec3" metalness={.8} roughness={.23} /></mesh>
    </group>
    <group ref={rod}><mesh><boxGeometry args={[.12, 1.12, .13]} /><meshStandardMaterial color="#b99a52" metalness={.72} roughness={.3} /></mesh></group>
    <group ref={piston} position={[x, 2, 0]}>
      <mesh><cylinderGeometry args={[.29, .29, .4, 48]} /><meshStandardMaterial color="#c6ced0" metalness={.72} roughness={.24} /></mesh>
      {[-.1, -.04, .02].map(y => <mesh key={y} position={[0, y, 0]}><cylinderGeometry args={[.294, .294, .018, 48]} /><meshStandardMaterial color="#606e72" metalness={.8} roughness={.3} /></mesh>)}
    </group>
    <mesh position={[x, 2.08 + explode * 1.7, 0]}><cylinderGeometry args={[.34, .34, .95, 48, 1, true]} /><meshStandardMaterial color="#bdc9ca" metalness={.45} roughness={.23} transparent={transparent} opacity={transparent ? .15 : 1} depthWrite={!transparent} side={DoubleSide} /></mesh>
    {[1.605, 2.555].map(y => <mesh key={y} position={[x, y + explode * 1.7, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[.34, .025, 10, 48]} /><meshStandardMaterial color="#d3dcdd" metalness={.7} roughness={.25} /></mesh>)}
  </>;
}
function Mechanism({ running, speed, explode, transparent }: { running: boolean; speed: number; explode: number; transparent: boolean }) {
  const clock = useRef(0), flywheel = useRef<Group>(null);
  useFrame((_, delta) => { if (running) clock.current += Math.min(delta, .05) * speed; if (flywheel.current) flywheel.current.rotation.x = clock.current; });
  return <group position={[0, -1.25, 0]}>
    <mesh position={[0, .12, 0]}><boxGeometry args={[4.8, .16, 1.8]} /><meshStandardMaterial color="#244d8d" metalness={.45} roughness={.32} /></mesh>
    {[-1.95, -1, 0, 1, 1.95].map(x => <group key={x} position={[x, .55, 0]}>
      <mesh><boxGeometry args={[.14, .85, .65]} /><meshStandardMaterial color="#2b5491" metalness={.45} roughness={.32} /></mesh>
      {[-.48, .48].map(z => <mesh key={z} position={[0, -.3, z]}><cylinderGeometry args={[.06, .06, .08, 6]} /><meshStandardMaterial color="#b5bec3" metalness={.8} roughness={.3} /></mesh>)}
    </group>)}
    <mesh position={[0, .9, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[.09, .09, 4.5, 32]} /><meshStandardMaterial color="#9da9af" metalness={.85} roughness={.22} /></mesh>
    <group ref={flywheel} position={[2.3 + explode * .8, .9, 0]}><mesh rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[.64, .64, .16, 64]} /><meshStandardMaterial color="#647078" metalness={.82} roughness={.26} /></mesh>{Array.from({ length: 8 }, (_, i) => <mesh key={i} position={[.09, .46 * Math.cos(i * Math.PI / 4), .46 * Math.sin(i * Math.PI / 4)]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[.048, .048, .02, 16]} /><meshStandardMaterial color="#25333c" /></mesh>)}</group>
    {[-1.5, -.5, .5, 1.5].map((x, i) => <Cylinder key={x} x={x} phase={i === 0 || i === 3 ? 0 : Math.PI} clock={clock} explode={explode} transparent={transparent} />)}
    <mesh position={[0, 1.57 + explode * 1.7, 0]}><boxGeometry args={[4.05, .09, 1.02]} /><meshStandardMaterial color="#b9c5cc" metalness={.7} roughness={.3} /></mesh>
  </group>;
}
export default function EngineDemo() {
  const lang = useLang(), reduced = useReducedMotion();
  const t = (zh: string, en: string) => lang === 'zh' ? zh : en;
  const [running, setRunning] = useState(false), [transparent, setTransparent] = useState(true);
  const [explode, setExplode] = useState(0), [speed, setSpeed] = useState(2), [reset, setReset] = useState(0);
  const [supported] = useState(probeWebGL);
  const fallback = <div className="engine-fallback">{t('三维演示暂不可用，请使用支持 WebGL 的浏览器。', '3D is unavailable. Use a browser with WebGL support.')}</div>;
  return <section className="engine-demo" aria-label={t('四缸运动演示', 'Four-cylinder motion demo')}>
    <header className="engine-masthead"><span>AGRIDX / MOTION STUDY</span><span>{t('原创机构示意', 'ORIGINAL MECHANISM STUDY')} · 01</span></header>
    <div className="engine-layout"><aside className="engine-intro"><p>{t('结构观察 → 运动理解', 'STRUCTURE → MOTION')}</p><h2>{t('四缸机构', 'Four-cylinder')}<br />{t('运动演示', 'motion study')}</h2><p>{t('曲轴、连杆、活塞。拆开看，也能一起动。', 'Crankshaft, connecting rods, pistons. Inspect separately, move together.')}</p><div className="engine-stat">04<small>{t('气缸 · 同轴联动', 'CYLINDERS · ONE SHAFT')}</small></div><p>{t('拖动旋转 · 滚轮缩放。透明缸套下，观察活塞与曲轴的运动关系。', 'Drag to orbit, scroll to zoom. Observe piston and crankshaft motion through transparent liners.')}</p><p className="engine-note">{t('原理动画，非实机 CAD；不代表点火顺序或维修尺寸。', 'Illustrative geometry; not measured CAD, firing order or service dimensions.')}</p></aside>
      <div className="engine-stage"><span className="engine-stage-label">{explode > 0 ? '03 / ' + t('部件拆解', 'EXPLODED') : running ? '02 / ' + t('曲柄连杆联动', 'SLIDER-CRANK MOTION') : '01 / ' + t('完整装配', 'ASSEMBLY')}</span><ErrorBoundary fallback={fallback}>{supported ? <Canvas key={reset} shadows camera={{ position: [6, 4.2, 6], fov: 38 }} frameloop={running && !reduced ? 'always' : 'demand'}><ExplosionFraming explode={explode} /><color attach="background" args={['#edf0e9']} /><ambientLight intensity={1.1} /><directionalLight position={[3, 7, 5]} intensity={2.4} /><Suspense fallback={null}><Environment preset={undefined}><mesh scale={10}><sphereGeometry args={[1, 16, 16]} /><meshBasicMaterial color="#fff" side={1} /></mesh></Environment><Mechanism running={running && !reduced} speed={speed} explode={explode} transparent={transparent} /><ContactShadows position={[0, -1.23, 0]} opacity={.3} scale={12} blur={2.5} far={5} /></Suspense><OrbitControls makeDefault minDistance={4} maxDistance={14} target={[0, .3 + explode * .7, 0]} /></Canvas> : fallback}</ErrorBoundary></div></div>
    <div className="engine-controls"><button type="button" aria-pressed={running} disabled={!!reduced || !supported} onClick={() => setRunning(v => !v)}>{running ? t('暂停运动', 'Pause') : t('播放运动', 'Play motion')}</button><button type="button" aria-pressed={transparent} onClick={() => setTransparent(v => !v)}>{t('透明缸套', 'Transparent liners')}</button><label>{t('拆解', 'Explode')}<input aria-label={t('拆解程度', 'Explosion amount')} type="range" min="0" max="1" step=".01" value={explode} onChange={e => setExplode(Number(e.target.value))} /><output>{Math.round(explode * 100)}%</output></label><label>{t('转速', 'Speed')}<select value={speed} onChange={e => setSpeed(Number(e.target.value))}><option value="1">0.5×</option><option value="2">1×</option><option value="4">2×</option></select></label><button type="button" onClick={() => { setRunning(false); setExplode(0); setTransparent(true); setSpeed(2); setReset(v => v + 1); }}>{t('复位', 'Reset')}</button></div>
    <footer>{t(reduced ? '已遵循减少动态效果偏好，支持静态拆解观察。' : '原理演示 · 活塞与曲轴按曲柄连杆几何关系联动', reduced ? 'Reduced motion enabled; static exploded inspection is available.' : 'MECHANISM STUDY · GEOMETRIC SLIDER-CRANK MOTION')}<span>{t('拖拉机部件模型见下方 ↓', 'TRACTOR PARTS BELOW ↓')}</span></footer>
  </section>;
}

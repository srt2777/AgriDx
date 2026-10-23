import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Group, DoubleSide } from 'three';
import { pistonPosition } from './kinematics';

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
export default function EngineMechanism({ running, speed, explode, transparent }: { running: boolean; speed: number; explode: number; transparent: boolean }) {
  const clock = useRef(0), flywheel = useRef<Group>(null);
  useFrame((_, delta) => { if (running) clock.current += Math.min(delta, .05) * speed; if (flywheel.current) flywheel.current.rotation.x = clock.current; });
  return <group position={[0, -1.25, 0]}>
    <mesh position={[0, .9, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[.09, .09, 4.5, 32]} /><meshStandardMaterial color="#9da9af" metalness={.85} roughness={.22} /></mesh>
    <group ref={flywheel} position={[2.3 + explode * .8, .9, 0]}><mesh rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[.64, .64, .16, 64]} /><meshStandardMaterial color="#647078" metalness={.82} roughness={.26} /></mesh>{Array.from({ length: 8 }, (_, i) => <mesh key={i} position={[.09, .46 * Math.cos(i * Math.PI / 4), .46 * Math.sin(i * Math.PI / 4)]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[.048, .048, .02, 16]} /><meshStandardMaterial color="#25333c" /></mesh>)}</group>
    {[-1.5, -.5, .5, 1.5].map((x, i) => <Cylinder key={x} x={x} phase={i === 0 || i === 3 ? 0 : Math.PI} clock={clock} explode={explode} transparent={transparent} />)}
    <mesh position={[0, 1.57 + explode * 1.7, 0]}><boxGeometry args={[4.05, .09, 1.02]} /><meshStandardMaterial color="#b9c5cc" metalness={.7} roughness={.3} /></mesh>
  </group>;
}

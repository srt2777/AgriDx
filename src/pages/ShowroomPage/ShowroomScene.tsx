/**
 * Showroom 3D scene: the hall, the T70, the four zones, weather and the
 * camera/drive rig. WebGL2 via React Three Fiber; quality tiers switch
 * pixel ratio / shadows / post-processing. A WebGPU renderer is not used:
 * R3F 9 has no stable WebGPURenderer binding, so the scene renders on the
 * WebGL2 path and reports WebGPU availability only as a capability badge
 * (see ShowroomPage). Post uses the in-repo @react-three/postprocessing
 * stack (N8AO + Bloom + DepthOfField) — no extra effect libraries.
 */
import { Suspense, use, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, MeshReflectorMaterial, useGLTF, useProgress } from '@react-three/drei';
import { Bloom, DepthOfField, EffectComposer, N8AO, Vignette } from '@react-three/postprocessing';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import { HONGHU_T70_PARTS_URL } from '@/components/tractor-model-info';
import { HALL, QUALITY_TIERS, SHOWROOM_ZONES, T70_PARTS, T70_PART_SOURCES, type QualityId, type ZoneId } from './showroom-data';
import type { BlendedWeather } from './showroom-weather';
import { autopilotInput, clampWalk, resolveCollision, stepVehicle, TRACTOR_PARAMS, TRACTOR_RADIUS, WALK_PARAMS } from './showroom-drive';
import { createRapierVehicle, type RapierVehicle } from './rapier-vehicle';
import type { SimState } from './showroom-state';

let studioMeshoptReady: Promise<void> | undefined;
function ensureStudioMeshopt() {
  studioMeshoptReady ??= (async () => {
    if (!MeshoptDecoder.supported) throw new Error('Meshopt decoder is unavailable');
    await MeshoptDecoder.ready;
  })();
  return studioMeshoptReady;
}
function attachStudioMeshopt(loader: { setMeshoptDecoder(decoder: typeof MeshoptDecoder): void }) {
  loader.setMeshoptDecoder(MeshoptDecoder);
}
useGLTF.preload(HONGHU_T70_PARTS_URL);

/* ---------------------------------------------------------------- */
/* Canvas texture helpers                                            */
/* ---------------------------------------------------------------- */

function canvasTexture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas unavailable');
  draw(ctx);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function wallTextTexture(): THREE.CanvasTexture {
  return canvasTexture(1600, 320, (ctx) => {
    ctx.fillStyle = '#f4f7f4';
    ctx.fillRect(0, 0, 1600, 320);
    ctx.fillStyle = '#20553f';
    ctx.font = 'bold 120px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('智 慧 农 业', 800, 150);
    ctx.fillStyle = '#886423';
    ctx.font = '44px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText('S M A R T   A G R I C U L T U R E', 800, 240);
  });
}

function kioskTexture(): THREE.CanvasTexture {
  return canvasTexture(1024, 576, (ctx) => {
    ctx.fillStyle = '#0e2a22';
    ctx.fillRect(0, 0, 1024, 576);
    ctx.fillStyle = '#7ad7ff';
    ctx.font = 'bold 54px "PingFang SC", sans-serif';
    ctx.fillText('司稼 · 智能诊断', 48, 88);
    ctx.fillStyle = '#e8f4ee';
    ctx.font = '30px "PingFang SC", sans-serif';
    ctx.fillText('故障输入 → 知识库检索 → 诊断与维修建议', 48, 150);
    ctx.fillStyle = '#2e7d46';
    ctx.fillRect(48, 190, 420, 150);
    ctx.fillStyle = '#ffffff';
    ctx.font = '28px "PingFang SC", sans-serif';
    ctx.fillText('鸿鹄 T70 · 作业监测', 72, 240);
    ctx.fillText('发动机 正常 · 液压 正常', 72, 290);
    ctx.fillStyle = '#123f2e';
    ctx.fillRect(508, 190, 468, 150);
    ctx.fillStyle = '#a3d4ec';
    ctx.fillText('知识库 6,000+ 条', 532, 240);
    ctx.fillText('诊断准确率 98.2%（演示）', 532, 290);
    ctx.fillStyle = '#886423';
    ctx.fillRect(48, 380, 928, 130);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 34px "PingFing SC", sans-serif';
    ctx.fillText('点 击 屏 幕 开 始 诊 断 演 示', 48, 460);
  });
}

function boardTexture(lines: string[], title: string): THREE.CanvasTexture {
  return canvasTexture(768, 512, (ctx) => {
    ctx.fillStyle = '#fbfaf6';
    ctx.fillRect(0, 0, 768, 512);
    ctx.fillStyle = '#20553f';
    ctx.font = 'bold 46px "PingFang SC", sans-serif';
    ctx.fillText(title, 40, 80);
    ctx.fillStyle = '#33413c';
    ctx.font = '30px "PingFang SC", sans-serif';
    lines.forEach((line, i) => ctx.fillText(line, 40, 150 + i * 52));
  });
}

function cloudTexture(): THREE.CanvasTexture {
  return canvasTexture(256, 128, (ctx) => {
    const blob = (x: number, y: number, r: number) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.85)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    };
    blob(80, 80, 55);
    blob(130, 65, 60);
    blob(180, 85, 50);
    blob(120, 90, 55);
  });
}

/* ---------------------------------------------------------------- */
/* T70                                                               */
/* ---------------------------------------------------------------- */

function findPartNodes(root: THREE.Object3D): Map<string, THREE.Object3D[]> {
  const map = new Map<string, THREE.Object3D[]>();
  root.traverse((node) => {
    for (const [id, source] of Object.entries(T70_PART_SOURCES)) {
      if (node.name === id || node.name === source || node.name.includes(id) || node.name.includes(source)) {
        const list = map.get(id) ?? [];
        list.push(node);
        map.set(id, list);
      }
    }
  });
  return map;
}

function T70({ sim, onPartSelect }: { sim: SimState; onPartSelect: (id: string) => void }) {
  use(ensureStudioMeshopt());
  const { scene } = useGLTF(HONGHU_T70_PARTS_URL, false, false, attachStudioMeshopt);
  const group = useRef<THREE.Group>(null);
  const wheelPivots = useRef<Map<string, THREE.Group>>(new Map());
  const wheelMeshes = useRef<Map<string, THREE.Object3D>>(new Map());
  const radar = useRef<THREE.Group>(null);

  const model = useMemo(() => {
    const cloned = SkeletonUtils.clone(scene);
    cloned.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      const copies = materials.map((material) => {
        const copy = material.clone();
        if (copy instanceof THREE.MeshStandardMaterial) {
          copy.envMapIntensity = Math.max(copy.envMapIntensity, 0.9);
          // Clearcoat highlight on the painted shell / roof (PBR clearcoat).
          if (node.name.includes('part_4') || node.name.includes('part_5') || node.name.includes('body_shell') || node.name.includes('roof_cap')) {
            const physical = new THREE.MeshPhysicalMaterial();
            physical.copy(copy as THREE.MeshStandardMaterial);
            physical.clearcoat = 1;
            physical.clearcoatRoughness = 0.12;
            return physical;
          }
        }
        return copy;
      });
      // Keep single materials single: a 1-element material array on a mesh
      // without geometry groups renders nothing in three.js.
      node.material = Array.isArray(node.material) ? copies : copies[0];
      node.castShadow = true;
      node.receiveShadow = true;
    });
    const box = new THREE.Box3().setFromObject(cloned);
    const size = box.getSize(new THREE.Vector3());
    const maxDimension = Math.max(size.x, size.y, size.z);
    cloned.scale.setScalar(2.8 / maxDimension);
    cloned.updateMatrixWorld(true);
    const scaled = new THREE.Box3().setFromObject(cloned);
    const center = scaled.getCenter(new THREE.Vector3());
    cloned.position.set(-center.x, -scaled.min.y, -center.z);
    cloned.updateMatrixWorld(true);
    return cloned;
  }, [scene]);

  const hotspots = useMemo(() => {
    const nodes = findPartNodes(model);
    return T70_PARTS.filter((p) => p.hotspot).map((part) => {
      const targets = nodes.get(part.id) ?? [];
      if (targets.length === 0) return null;
      const box = new THREE.Box3();
      targets.forEach((t) => box.expandByObject(t));
      if (box.isEmpty()) return null;
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      return { part, position: [center.x, center.y + size.y * 0.5 + 0.12, center.z] as [number, number, number] };
    }).filter((h): h is NonNullable<typeof h> => h !== null);
  }, [model]);

  // Wrap front wheels in steer pivots; record spin meshes.
  useEffect(() => {
    const nodes = findPartNodes(model);
    wheelPivots.current.clear();
    wheelMeshes.current.clear();
    for (const id of ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr']) {
      const targets = nodes.get(id) ?? [];
      targets.forEach((mesh) => {
        wheelMeshes.current.set(`${id}:${mesh.uuid}`, mesh);
        if (id === 'wheel_fl' || id === 'wheel_fr') {
          const parent = mesh.parent;
          if (!parent) return;
          const box = new THREE.Box3().setFromObject(mesh);
          const center = box.getCenter(new THREE.Vector3());
          const pivot = new THREE.Group();
          pivot.position.copy(parent.worldToLocal(center.clone()));
          parent.add(pivot);
          pivot.attach(mesh);
          wheelPivots.current.set(id, pivot);
        }
      });
    }
  }, [model]);

  useFrame(() => {
    const spin = sim.wheelSpin;
    wheelMeshes.current.forEach((mesh) => {
      mesh.rotation.x = spin;
    });
    wheelPivots.current.forEach((pivot) => {
      pivot.rotation.y = sim.tractor.steer * 0.9;
    });
    if (radar.current) radar.current.rotation.y = sim.radarAngle;
  });

  return (
    <group
      ref={group}
      position={[sim.tractor.x, 0, sim.tractor.z]}
      rotation={[0, sim.tractor.heading, 0]}
    >
      <primitive object={model} />
      {/* Lidar sweep ring above the roof sensors. */}
      <group ref={radar} position={[0, 2.05, 0]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.55, 0.62, 48]} />
          <meshBasicMaterial color="#7ad7ff" transparent opacity={0.55} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0.3, 0, 0]} rotation={[0, 0, -0.5]}>
          <coneGeometry args={[0.06, 0.5, 12]} />
          <meshBasicMaterial color="#7ad7ff" transparent opacity={0.35} />
        </mesh>
      </group>
      {hotspots.map(({ part, position }) => (
        <Html key={part.id} position={position} center zIndexRange={[30, 0]} style={{ pointerEvents: 'auto' }}>
          <button
            type="button"
            className="showroom-hotspot"
            title={part.zh}
            onClick={(event) => {
              event.stopPropagation();
              onPartSelect(part.id);
            }}
          >
            <span className="showroom-hotspot-dot" />
            <span className="showroom-hotspot-label">{part.zh}</span>
          </button>
        </Html>
      ))}
    </group>
  );
}

/* ---------------------------------------------------------------- */
/* Weather visuals                                                   */
/* ---------------------------------------------------------------- */

const skyVertex = /* glsl */ `
  varying vec3 vPos;
  void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const skyFragment = /* glsl */ `
  uniform vec3 uTop; uniform vec3 uHorizon;
  varying vec3 vPos;
  void main() {
    float h = normalize(vPos).y * 0.5 + 0.5;
    gl_FragColor = vec4(mix(uHorizon, uTop, smoothstep(0.0, 0.65, h)), 1.0);
  }
`;

const dropletVertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const dropletFragment = /* glsl */ `
  uniform float uDroplets; uniform float uTime;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  void main() {
    vec2 grid = vec2(46.0, 26.0);
    vec2 cell = floor(vUv * grid);
    vec2 f = fract(vUv * grid);
    float r = hash(cell);
    float fall = fract(uTime * (0.02 + r * 0.05) + r);
    vec2 center = vec2(0.3 + r * 0.4, fall);
    float d = distance(f, center);
    float drop = smoothstep(0.16, 0.02, d) * step(0.35, r);
    float streak = smoothstep(0.05, 0.0, abs(f.x - center.x)) * smoothstep(0.0, 0.5, f.y) * step(0.6, r);
    float a = 0.06 + uDroplets * (drop * 0.55 + streak * 0.25);
    gl_FragColor = vec4(vec3(0.82, 0.9, 0.95), a);
  }
`;

function SkyDome({ weather }: { weather: BlendedWeather }) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: skyVertex,
        fragmentShader: skyFragment,
        uniforms: {
          uTop: { value: new THREE.Color('#7db8e8') },
          uHorizon: { value: new THREE.Color('#dceefb') },
        },
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    [],
  );
  useEffect(() => {
    (material.uniforms.uTop.value as THREE.Color).set(weather.skyTop);
    (material.uniforms.uHorizon.value as THREE.Color).set(weather.skyHorizon);
  }, [weather, material]);
  return (
    <mesh material={material} renderOrder={-10}>
      <sphereGeometry args={[160, 32, 20]} />
    </mesh>
  );
}

function Clouds({ weather }: { weather: BlendedWeather }) {
  const texture = useMemo(() => cloudTexture(), []);
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  const seeds = useMemo(
    () =>
      Array.from({ length: 9 }, (_, i) => ({
        x: -70 + i * 17 + ((i * 37) % 11),
        y: 16 + ((i * 13) % 14),
        z: -34 - ((i * 7) % 18),
        s: 16 + ((i * 11) % 14),
        speed: 0.25 + ((i * 3) % 5) * 0.12,
      })),
    [],
  );
  useFrame((_, dt) => {
    refs.current.forEach((mesh, i) => {
      if (!mesh) return;
      mesh.position.x += seeds[i].speed * dt;
      if (mesh.position.x > 80) mesh.position.x = -80;
    });
  });
  return (
    <group>
      {seeds.map((seed, i) => (
        <mesh
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          position={[seed.x, seed.y, seed.z]}
          scale={[seed.s, seed.s * 0.45, 1]}
        >
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial map={texture} transparent opacity={Math.min(0.95, weather.clouds * 1.1)} depthWrite={false} fog={false} />
        </mesh>
      ))}
    </group>
  );
}

const MAX_PARTICLES = 2200;

/** Module-level lazy caches: particle layouts are generated once, so the
 * scene stays stable across re-renders (and render stays pure). */
let precipitationPositions: Float32Array | null = null;
function getPrecipitationPositions(): Float32Array {
  if (!precipitationPositions) {
    const arr = new Float32Array(MAX_PARTICLES * 3);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      arr[i * 3] = -45 + Math.random() * 90;
      arr[i * 3 + 1] = Math.random() * 26;
      const side = Math.random() > 0.5 ? 1 : -1;
      arr[i * 3 + 2] = side * (17 + Math.random() * 26);
    }
    precipitationPositions = arr;
  }
  return precipitationPositions;
}

let dustGeometry: THREE.BufferGeometry | null = null;
function getDustGeometry(): THREE.BufferGeometry {
  if (!dustGeometry) {
    const geo = new THREE.BufferGeometry();
    const arr = new Float32Array(90 * 3);
    for (let i = 0; i < 90; i++) {
      arr[i * 3] = -20 + Math.random() * 40;
      arr[i * 3 + 1] = 0.5 + Math.random() * 5.5;
      arr[i * 3 + 2] = 8 + Math.random() * 6;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    dustGeometry = geo;
  }
  return dustGeometry;
}

function Precipitation({ weather, quality }: { weather: BlendedWeather; quality: QualityId }) {
  const points = useRef<THREE.Points>(null);
  const positions = useMemo(() => getPrecipitationPositions(), []);
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return geo;
  }, [positions]);
  const count = Math.round(weather.particles * QUALITY_TIERS[quality].particles);
  useFrame((_, dt) => {
    if (!points.current) return;
    const attr = points.current.geometry.getAttribute('position') as THREE.BufferAttribute;
    const isSnow = weather.particleKind === 'snow';
    const fall = (isSnow ? 1.6 : 13) * dt;
    for (let i = 0; i < count; i++) {
      let y = attr.getY(i) - fall;
      if (y < 0) y = 24 + Math.random() * 2;
      attr.setY(i, y);
      if (isSnow) attr.setX(i, attr.getX(i) + Math.sin(y * 0.6 + i) * dt * 0.6);
    }
    attr.needsUpdate = true;
    points.current.geometry.setDrawRange(0, count);
  });
  if (weather.particleKind === 'none' || count === 0) return null;
  return (
    <points ref={points} geometry={geometry} frustumCulled={false}>
      <pointsMaterial size={weather.particleKind === 'snow' ? 0.22 : 0.09} color={weather.particleKind === 'snow' ? '#ffffff' : '#bcd8ea'} transparent opacity={0.85} sizeAttenuation depthWrite={false} />
    </points>
  );
}

function DustMotes() {
  const points = useRef<THREE.Points>(null);
  const geometry = useMemo(() => getDustGeometry(), []);
  useFrame(({ clock }) => {
    if (!points.current) return;
    points.current.position.y = Math.sin(clock.elapsedTime * 0.12) * 0.15;
  });
  return (
    <points ref={points} geometry={geometry} frustumCulled={false}>
      <pointsMaterial size={0.05} color="#fff6d8" transparent opacity={0.4} sizeAttenuation depthWrite={false} />
    </points>
  );
}

function WindowGlass({ weather, width, height, position, rotationY }: { weather: BlendedWeather; width: number; height: number; position: [number, number, number]; rotationY: number }) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: dropletVertex,
        fragmentShader: dropletFragment,
        uniforms: { uDroplets: { value: 0 }, uTime: { value: 0 } },
        transparent: true,
        depthWrite: false,
      }),
    [],
  );
  useFrame(({ clock }) => {
    material.uniforms.uTime.value = clock.elapsedTime;
    material.uniforms.uDroplets.value = weather.droplets;
  });
  return (
    <mesh material={material} position={position} rotation={[0, rotationY, 0]}>
      <planeGeometry args={[width, height]} />
    </mesh>
  );
}

/* ---------------------------------------------------------------- */
/* Hall + zones                                                      */
/* ---------------------------------------------------------------- */

function GuideLine() {
  const arrows = useMemo(() => Array.from({ length: 7 }, (_, i) => -18 + i * 6), []);
  return (
    <group>
      <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[40, 0.35]} />
        <meshBasicMaterial color="#2e7d46" transparent opacity={0.85} />
      </mesh>
      {arrows.map((x) => (
        <mesh key={x} position={[x, 0.02, 0]} rotation={[-Math.PI / 2, 0, Math.PI]}>
          <coneGeometry args={[0.28, 0.7, 4]} />
          <meshBasicMaterial color="#7ad7ff" />
        </mesh>
      ))}
    </group>
  );
}

function Plant({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.3, 0]} castShadow>
        <cylinderGeometry args={[0.42, 0.34, 0.6, 16]} />
        <meshStandardMaterial color="#8a8f8c" roughness={0.8} />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[(i - 1) * 0.3, 1.15 + (i % 2) * 0.25, (i % 2 ? 0.15 : -0.12)]} castShadow>
          <icosahedronGeometry args={[0.5, 1]} />
          <meshStandardMaterial color={i % 2 ? '#2e7d46' : '#3a9a58'} roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

function WheatSheaf({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.45, 0]}>
        <cylinderGeometry args={[0.16, 0.2, 0.9, 10]} />
        <meshStandardMaterial color="#c8b18a" roughness={0.85} />
      </mesh>
      {Array.from({ length: 7 }, (_, i) => {
        const a = (i / 7) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * 0.22, 1.15, Math.sin(a) * 0.22]} rotation={[Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25]}>
            <coneGeometry args={[0.09, 0.55, 8]} />
            <meshStandardMaterial color="#d9a441" roughness={0.7} />
          </mesh>
        );
      })}
    </group>
  );
}

function RobotArm({ position, rotationY, color }: { position: [number, number, number]; rotationY: number; color: string }) {
  const j1 = useRef<THREE.Group>(null);
  const j2 = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime * 0.5;
    if (j1.current) j1.current.rotation.y = Math.sin(t) * 0.7;
    if (j2.current) j2.current.rotation.z = -0.5 + Math.sin(t * 1.3) * 0.35;
  });
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh position={[0, 0.25, 0]} castShadow>
        <cylinderGeometry args={[0.34, 0.42, 0.5, 20]} />
        <meshStandardMaterial color={color} roughness={0.4} metalness={0.5} />
      </mesh>
      <group ref={j1} position={[0, 0.5, 0]}>
        <mesh position={[0, 0.45, 0]} castShadow>
          <boxGeometry args={[0.22, 0.9, 0.22]} />
          <meshStandardMaterial color="#e8e8e6" roughness={0.35} metalness={0.6} />
        </mesh>
        <group ref={j2} position={[0, 0.9, 0]}>
          <mesh position={[0.35, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.09, 0.09, 0.7, 12]} />
            <meshStandardMaterial color={color} roughness={0.4} metalness={0.5} />
          </mesh>
          <mesh position={[0.7, -0.12, 0]}>
            <boxGeometry args={[0.16, 0.3, 0.16]} />
            <meshStandardMaterial color="#33383a" roughness={0.5} metalness={0.4} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

function DiagLightStrip({ sim }: { sim: SimState }) {
  const mats = useRef<(THREE.MeshStandardMaterial | null)[]>([]);
  useFrame(() => {
    const phase = Math.floor(sim.diagPhase) % 3;
    mats.current.forEach((mat, i) => {
      if (!mat) return;
      const active = phase === i;
      mat.color.set(active ? '#2e7d46' : '#9aa5a0');
      mat.emissive.set(active ? '#2e7d46' : '#000000');
      mat.emissiveIntensity = active ? 1.2 : 0;
    });
  });
  return (
    <group>
      {['检测', '定位', '诊断'].map((label, i) => (
        <mesh key={label} position={[-1.4 + i * 1.4, 1.55, -0.4]}>
          <boxGeometry args={[1.1, 0.22, 0.1]} />
          <meshStandardMaterial
            ref={(el) => {
              mats.current[i] = el;
            }}
            color="#9aa5a0"
          />
        </mesh>
      ))}
    </group>
  );
}

function ZoneBooth({ zone, sim, onZoneSelect }: { zone: (typeof SHOWROOM_ZONES)[number]; sim: SimState; onZoneSelect: (id: ZoneId) => void }) {
  const wallTexture = useMemo(() => (zone.id === 'embodied' ? boardTexture(['感知 — 激光雷达 · 摄像头', '决策 — 任务规划 · 避障', '执行 — 六轴机械臂 · 采摘'], '具身智能闭环') : null), [zone.id]);
  const kiosk = useMemo(() => (zone.id === 'agridex' ? kioskTexture() : null), [zone.id]);
  const center: [number, number, number] =
    zone.id === 'diagnosis' ? [16.5, 0, -10] : zone.id === 'embodied' ? [-16.5, 0, -10] : [16.5, 0, 10];
  return (
    <group position={center}>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} onClick={() => onZoneSelect(zone.id)}>
        <ringGeometry args={[2.6, 2.85, 48]} />
        <meshBasicMaterial color={zone.color} transparent opacity={0.7} side={THREE.DoubleSide} />
      </mesh>
      <Html position={[0, 3.4, 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
        <div className="showroom-zone-tag" style={{ borderColor: zone.color }}>{zone.zh}</div>
      </Html>
      {zone.id === 'diagnosis' && (
        <>
          <mesh position={[0, 0.35, 0]} receiveShadow castShadow onClick={() => onZoneSelect(zone.id)}>
            <boxGeometry args={[4.4, 0.7, 1.6]} />
            <meshStandardMaterial color="#dfe3e2" roughness={0.6} />
          </mesh>
          <mesh position={[0, 1.05, -0.4]} castShadow>
            <boxGeometry args={[1.6, 0.7, 0.9]} />
            <meshStandardMaterial color="#2e4a5a" roughness={0.4} metalness={0.4} />
          </mesh>
          {/* 检测—定位—诊断 三步灯带（useFrame 驱动） */}
          <DiagLightStrip sim={sim} />
          <RobotArm position={[-1.6, 0.7, 0.4]} rotationY={0.6} color="#245d7d" />
          <RobotArm position={[1.6, 0.7, 0.4]} rotationY={-0.6} color="#245d7d" />
        </>
      )}
      {zone.id === 'embodied' && (
        <>
          <mesh position={[0, 0.5, 0]} receiveShadow castShadow onClick={() => onZoneSelect(zone.id)}>
            <cylinderGeometry args={[1.7, 1.9, 1, 28]} />
            <meshStandardMaterial color="#eef0ee" roughness={0.55} />
          </mesh>
          <mesh position={[0, 1.35, 0]} castShadow>
            <boxGeometry args={[0.9, 1.1, 0.7]} />
            <meshStandardMaterial color="#3a3f42" roughness={0.4} metalness={0.5} />
          </mesh>
          <mesh position={[0, 2.1, 0]} castShadow>
            <sphereGeometry args={[0.32, 20, 16]} />
            <meshStandardMaterial color="#d9a441" roughness={0.4} metalness={0.3} />
          </mesh>
          <RobotArm position={[1.2, 1, 0.6]} rotationY={-0.8} color="#886423" />
          {wallTexture && (
            <mesh position={[0, 1.7, -1.2]}>
              <planeGeometry args={[2.6, 1.73]} />
              <meshStandardMaterial map={wallTexture} roughness={0.8} />
            </mesh>
          )}
        </>
      )}
      {zone.id === 'agridex' && (
        <>
          <mesh position={[0, 0.15, 0]} receiveShadow castShadow>
            <boxGeometry args={[5.4, 0.3, 1.2]} />
            <meshStandardMaterial color="#e6e9e7" roughness={0.6} />
          </mesh>
          {kiosk && (
            <mesh position={[0, 1.9, -0.35]} onClick={() => onZoneSelect(zone.id)}>
              <planeGeometry args={[4.6, 2.59]} />
              <meshStandardMaterial map={kiosk} emissive="#ffffff" emissiveMap={kiosk} emissiveIntensity={0.55} roughness={0.4} />
            </mesh>
          )}
          <mesh position={[0, 1.9, -0.42]}>
            <boxGeometry args={[4.9, 2.9, 0.08]} />
            <meshStandardMaterial color="#1d2123" roughness={0.4} metalness={0.5} />
          </mesh>
        </>
      )}
    </group>
  );
}

/* ---------------------------------------------------------------- */
/* Camera + drive rig                                                */
/* ---------------------------------------------------------------- */

function CameraRig({ sim, weather, onPosition, onAutopilotArrived }: { sim: SimState; weather: BlendedWeather; onPosition: (x: number, z: number, speedKmh: number, mode: string) => void; onAutopilotArrived: (zoneId: ZoneId) => void }) {
  const { camera, gl } = useThree();
  const velocity = useRef({ x: 0, z: 0 });
  const lastReport = useRef(0);
  const rapierRef = useRef<RapierVehicle | null>(null);
  const rapierTried = useRef(false);
  const sunRef = useRef<THREE.DirectionalLight>(null);
  const lampRef = useRef<THREE.Group>(null);

  useEffect(() => {
    if (rapierTried.current) return;
    rapierTried.current = true;
    let cancelled = false;
    void createRapierVehicle(sim.tractor)
      .then((vehicle) => {
        if (cancelled) return vehicle.dispose();
        rapierRef.current = vehicle;
        sim.rapierReady = true;
      })
      .catch(() => {
        sim.rapierReady = false;
      });
    return () => {
      cancelled = true;
      rapierRef.current?.dispose();
      rapierRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      if (document.pointerLockElement !== gl.domElement) return;
      sim.walk.yaw -= event.movementX * 0.0022;
      sim.walk.pitch = Math.max(-1.1, Math.min(1.1, sim.walk.pitch - event.movementY * 0.0022));
    };
    document.addEventListener('mousemove', onMove);
    return () => document.removeEventListener('mousemove', onMove);
  }, [gl, sim]);

  useFrame((state, dt) => {
    const clampedDt = Math.min(Math.max(dt, 0.0001), 0.05);
    sim.elapsed += clampedDt;
    sim.radarAngle += clampedDt * 0.9;
    sim.diagPhase = (sim.elapsed / 4) % 3;
    const keys = sim.keys;
    const joy = sim.joystick;

    // --- fly-to tween ---
    if (sim.flyTo) {
      const goal = sim.flyTo;
      const k = 1 - Math.exp(-clampedDt * 2.2);
      camera.position.lerp(new THREE.Vector3(...goal.pos), k);
      const look = new THREE.Vector3(...goal.look);
      camera.lookAt(look);
      if (camera.position.distanceTo(new THREE.Vector3(...goal.pos)) < 0.15) {
        sim.flyTo = null;
        if (sim.mode === 'fly') {
          sim.mode = 'walk';
          // Face the look target so the view does not snap 180° on arrival.
          sim.walk.x = camera.position.x;
          sim.walk.z = camera.position.z;
          const dx = goal.look[0] - goal.pos[0];
          const dz = goal.look[2] - goal.pos[2];
          if (Math.hypot(dx, dz) > 0.01) sim.walk.yaw = Math.atan2(-dx, -dz);
        }
      }
    } else if (sim.mode === 'walk') {
      const forward = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) + -joy.y;
      const strafe = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) + joy.x;
      const sin = Math.sin(sim.walk.yaw);
      const cos = Math.cos(sim.walk.yaw);
      void sin;
      void cos;
      // Forward is -z rotated by yaw; strafe is perpendicular.
      const fx = -Math.sin(sim.walk.yaw);
      const fz = -Math.cos(sim.walk.yaw);
      const rx = Math.cos(sim.walk.yaw);
      const rz = -Math.sin(sim.walk.yaw);
      const mx = fx * forward + rx * strafe;
      const mz = fz * forward + rz * strafe;
      const len = Math.hypot(mx, mz) || 1;
      const speed = WALK_PARAMS.speed * Math.min(1, Math.hypot(forward, strafe));
      const targetVx = (mx / len) * speed;
      const targetVz = (mz / len) * speed;
      const a = 1 - Math.exp(-clampedDt * WALK_PARAMS.accel);
      velocity.current.x += (targetVx - velocity.current.x) * a;
      velocity.current.z += (targetVz - velocity.current.z) * a;
      const next = clampWalk(sim.walk.x + velocity.current.x * clampedDt, sim.walk.z + velocity.current.z * clampedDt);
      sim.walk.x = next.x;
      sim.walk.z = next.z;
      const breathe = Math.sin(sim.elapsed * 1.3) * 0.02 + Math.min(0.03, Math.hypot(velocity.current.x, velocity.current.z) * 0.008);
      camera.position.set(sim.walk.x, 1.7 + breathe, sim.walk.z);
      camera.rotation.set(sim.walk.pitch, sim.walk.yaw, 0, 'YXZ');
    } else if (sim.mode === 'drive') {
      let input = {
        throttle: (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) + -joy.y,
        steer: (keys.has('KeyA') || keys.has('ArrowLeft') ? -1 : 0) + (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) + joy.x,
        brake: keys.has('Space'),
      };
      input.throttle = Math.max(-1, Math.min(1, input.throttle));
      input.steer = Math.max(-1, Math.min(1, input.steer));
      if (sim.autopilot) {
        // Any manual drive input takes over immediately.
        const manual = keys.has('KeyW') || keys.has('KeyS') || keys.has('KeyA') || keys.has('KeyD')
          || keys.has('ArrowUp') || keys.has('ArrowDown') || keys.has('ArrowLeft') || keys.has('ArrowRight')
          || keys.has('Space') || Math.abs(joy.x) > 0.15 || Math.abs(joy.y) > 0.15;
        if (manual) {
          sim.autopilot = null;
        } else {
          const target = sim.autopilot.route[sim.autopilot.index];
          if (target) {
            const result = autopilotInput(sim.tractor, target);
            input = result.input;
            if (result.arrived) {
              sim.autopilot.index += 1;
              if (sim.autopilot.index >= sim.autopilot.route.length) {
                const zone = sim.focusZone;
                sim.autopilot = null;
                if (zone) onAutopilotArrived(zone);
              }
            }
          } else {
            sim.autopilot = null;
          }
        }
      }
      const vehicle = rapierRef.current;
      let next = sim.tractor;
      if (vehicle) {
        const stepped = vehicle.step(input, clampedDt);
        next = stepped.pose;
        sim.tractor = next;
      } else {
        next = resolveCollision(stepVehicle(sim.tractor, input, clampedDt), sim.tractor, TRACTOR_RADIUS);
        sim.tractor = next;
      }
      sim.wheelSpin += (next.speed / 0.45) * clampedDt;
      const heading = next.heading;
      if (sim.driveView === 'cabin') {
        camera.position.set(next.x + Math.sin(heading) * 0.35, 1.95, next.z - Math.cos(heading) * 0.35);
        camera.lookAt(next.x + Math.sin(heading) * 12, 1.6, next.z - Math.cos(heading) * 12);
      } else {
        const bx = next.x - Math.sin(heading) * 7.5;
        const bz = next.z + Math.cos(heading) * 7.5;
        const desired = new THREE.Vector3(bx, 3.4, bz);
        camera.position.lerp(desired, 1 - Math.exp(-clampedDt * 3.5));
        camera.lookAt(next.x, 1.2, next.z);
      }
    }

    if (sunRef.current) sunRef.current.intensity = 1.6 * weather.sun;
    if (lampRef.current) {
      lampRef.current.children.forEach((child) => {
        const mesh = child as THREE.Mesh;
        const material = mesh.material as THREE.MeshStandardMaterial;
        if (material.emissive) material.emissiveIntensity = 0.9 * weather.lamps + 0.25;
      });
    }
    const now = state.clock.elapsedTime;
    if (now - lastReport.current > 0.15) {
      lastReport.current = now;
      const speedKmh = Math.abs(sim.tractor.speed) * 3.6;
      if (sim.mode === 'drive') onPosition(sim.tractor.x, sim.tractor.z, speedKmh, 'drive');
      else onPosition(sim.walk.x, sim.walk.z, Math.hypot(velocity.current.x, velocity.current.z) * 3.6, 'walk');
    }
  });

  return (
    <>
      <directionalLight ref={sunRef} position={[18, 22, 10]} intensity={1.6} castShadow={false} />
      <hemisphereLight args={['#e8f0f4', '#a8aca9', 0.7]} />
      <pointLight position={[0, 5.5, 0]} intensity={18} distance={34} decay={1.6} color="#fff2d8" />
      <group ref={lampRef}>
        {[-15, -5, 5, 15].map((x) => (
          <mesh key={x} position={[x, 6.9, 0]}>
            <boxGeometry args={[6, 0.12, 0.7]} />
            <meshStandardMaterial color="#f5f5f2" emissive="#fff4d6" emissiveIntensity={0.9} />
          </mesh>
        ))}
      </group>
    </>
  );
}

/* ---------------------------------------------------------------- */
/* Scene contents + Canvas                                           */
/* ---------------------------------------------------------------- */

export interface ShowroomSceneProps {
  sim: SimState;
  weather: BlendedWeather;
  quality: QualityId;
  photoRequest: number;
  onPosition: (x: number, z: number, speedKmh: number, mode: string) => void;
  onProgress: (progress: number) => void;
  onPartSelect: (id: string) => void;
  onZoneSelect: (id: ZoneId) => void;
  onAutopilotArrived: (zoneId: ZoneId) => void;
}

function ProgressReporter({ onProgress }: { onProgress: (progress: number) => void }) {
  const { progress, active } = useProgress();
  useEffect(() => {
    onProgress(active ? progress : 100);
  }, [progress, active, onProgress]);
  return null;
}

function SceneContents({ sim, weather, quality, photoRequest, onPosition, onProgress, onPartSelect, onZoneSelect, onAutopilotArrived }: ShowroomSceneProps) {
  const { gl, scene, camera } = useThree();
  const wallTex = useMemo(() => wallTextTexture(), []);
  const photoRef = useRef(0);
  const tier = QUALITY_TIERS[quality];

  useEffect(() => {
    scene.background = new THREE.Color(weather.skyHorizon);
    const fogDensity = weather.fog;
    scene.fog = new THREE.Fog(weather.skyHorizon, 30, Math.max(48, 170 - fogDensity * 2600));
  }, [scene, weather]);

  useEffect(() => {
    gl.shadowMap.enabled = tier.shadows;
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.05;
  }, [gl, tier]);

  // 4K still capture: render once at 3840×2160, download, restore.
  useEffect(() => {
    if (photoRequest === 0 || photoRequest === photoRef.current) return;
    photoRef.current = photoRequest;
    const prevSize = new THREE.Vector2();
    gl.getSize(prevSize);
    const prevRatio = gl.getPixelRatio();
    const camera2 = camera as THREE.PerspectiveCamera;
    const prevAspect = camera2.aspect;
    gl.setPixelRatio(1);
    gl.setSize(3840, 2160, false);
    camera2.aspect = 3840 / 2160;
    camera2.updateProjectionMatrix();
    gl.render(scene, camera);
    gl.domElement.toBlob((blob) => {
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `agridx-showroom-4k-${photoRequest}.png`;
        a.click();
        URL.revokeObjectURL(url);
      }
      gl.setPixelRatio(prevRatio);
      gl.setSize(prevSize.x, prevSize.y, false);
      camera2.aspect = prevAspect;
      camera2.updateProjectionMatrix();
    }, 'image/png');
  }, [photoRequest, gl, scene, camera]);

  return (
    <>
      <ProgressReporter onProgress={onProgress} />
      <CameraRig sim={sim} weather={weather} onPosition={onPosition} onAutopilotArrived={onAutopilotArrived} />
      <SkyDome weather={weather} />
      <Clouds weather={weather} />
      <Precipitation weather={weather} quality={quality} />
      <DustMotes />
      {/* Floor: subtle reflector on high/medium, plain PBR on low. */}
      {tier.post !== 'none' ? (
        <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[HALL.halfX * 2, HALL.halfZ * 2]} />
          <MeshReflectorMaterial
            blur={[180, 60]}
            resolution={1024}
            mixBlur={0.6}
            mixStrength={7}
            roughness={0.55}
            depthScale={0.6}
            minDepthThreshold={0.4}
            maxDepthThreshold={1.2}
            color="#b7bbb9"
            metalness={0.08}
            mirror={0.22}
          />
        </mesh>
      ) : (
        <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[HALL.halfX * 2, HALL.halfZ * 2]} />
          <meshStandardMaterial color="#c9cdcb" roughness={0.6} metalness={0.05} />
        </mesh>
      )}
      <GuideLine />
      {/* Ceiling (slightly emissive so the downward face never goes black: the key light comes from above). */}
      <mesh position={[0, HALL.height, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[HALL.halfX * 2, HALL.halfZ * 2]} />
        <meshStandardMaterial color="#f2f3f1" roughness={0.9} emissive="#ffffff" emissiveIntensity={0.28} />
      </mesh>
      {/* Walls: north/south window walls, east/west solid. */}
      <mesh position={[0, 3.5, -HALL.halfZ]} receiveShadow>
        <boxGeometry args={[HALL.halfX * 2, HALL.height, 0.3]} />
        <meshStandardMaterial color="#eef0ee" roughness={0.85} />
      </mesh>
      <mesh position={[0, 3.5, HALL.halfZ]} receiveShadow>
        <boxGeometry args={[HALL.halfX * 2, HALL.height, 0.3]} />
        <meshStandardMaterial color="#eef0ee" roughness={0.85} />
      </mesh>
      <mesh position={[-HALL.halfX, 3.5, 0]} receiveShadow>
        <boxGeometry args={[0.3, HALL.height, HALL.halfZ * 2]} />
        <meshStandardMaterial color="#eef0ee" roughness={0.85} />
      </mesh>
      <mesh position={[HALL.halfX, 3.5, 0]} receiveShadow>
        <boxGeometry args={[0.3, HALL.height, HALL.halfZ * 2]} />
        <meshStandardMaterial color="#eef0ee" roughness={0.85} />
      </mesh>
      {/* Window glass with rain droplets (both long walls). */}
      {[-14, -5, 5, 14].map((x) => (
        <WindowGlass key={`n${x}`} weather={weather} width={6.4} height={3.6} position={[x, 3.6, -HALL.halfZ + 0.2]} rotationY={0} />
      ))}
      {[-14, -5, 5, 14].map((x) => (
        <WindowGlass key={`s${x}`} weather={weather} width={6.4} height={3.6} position={[x, 3.6, HALL.halfZ - 0.2]} rotationY={Math.PI} />
      ))}
      {/* Window frames (mullions) */}
      {[-14, -5, 5, 14].map((x) => (
        <mesh key={`f${x}`} position={[x, 3.6, -HALL.halfZ + 0.16]}>
          <boxGeometry args={[6.6, 0.1, 0.06]} />
          <meshStandardMaterial color="#b9bebc" roughness={0.5} metalness={0.4} />
        </mesh>
      ))}
      {/* Theme background wall: 智慧农业 */}
      <mesh position={[-HALL.halfX + 0.2, 3.4, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[12, 2.4]} />
        <meshStandardMaterial map={wallTex} roughness={0.85} />
      </mesh>
      {/* Guide light strip along the aisle edges */}
      {[-3.2, 3.2].map((z) => (
        <mesh key={z} position={[0, 0.015, z]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[40, 0.08]} />
          <meshBasicMaterial color="#7ad7ff" transparent opacity={0.8} />
        </mesh>
      ))}
      {/* Decor: plants in corners, wheat sheaves between zones */}
      <Plant position={[-19.5, 0, -12.5]} />
      <Plant position={[19.5, 0, -12.5]} />
      <Plant position={[-19.5, 0, 12.5]} />
      <Plant position={[19.5, 0, 12.5]} />
      <WheatSheaf position={[-10, 0, -13.8]} />
      <WheatSheaf position={[10, 0, -13.8]} />
      <WheatSheaf position={[-10, 0, 13.8]} />
      {/* T70 centre stage */}
      <Suspense fallback={null}>
        <T70 sim={sim} onPartSelect={onPartSelect} />
      </Suspense>
      {SHOWROOM_ZONES.filter((z) => z.id !== 'tractor').map((zone) => (
        <ZoneBooth key={zone.id} zone={zone} sim={sim} onZoneSelect={onZoneSelect} />
      ))}
      {/* Post: full on high, bloom only on medium, none on low. */}
      {tier.post === 'full' && (
        <EffectComposer multisampling={4}>
          <N8AO aoRadius={1.4} distanceFalloff={1} intensity={1.1} />
          <Bloom intensity={0.35} luminanceThreshold={0.85} luminanceSmoothing={0.2} mipmapBlur />
          <DepthOfField worldFocusDistance={9} worldFocusRange={7} bokehScale={1.4} />
          <Vignette offset={0.22} darkness={0.55} />
        </EffectComposer>
      )}
      {tier.post === 'bloom' && (
        <EffectComposer multisampling={0}>
          <Bloom intensity={0.3} luminanceThreshold={0.85} luminanceSmoothing={0.2} mipmapBlur />
        </EffectComposer>
      )}
    </>
  );
}

export default function ShowroomScene(props: ShowroomSceneProps) {
  const tier = QUALITY_TIERS[props.quality];
  return (
    <Canvas
      dpr={tier.pixelRatio}
      shadows={tier.shadows}
      gl={{ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' }}
      camera={{ position: [24, 16, 26], fov: 55, near: 0.1, far: 400 }}
      style={{ touchAction: 'none' }}
    >
      <SceneContents {...props} />
    </Canvas>
  );
}

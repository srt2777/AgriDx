/**
 * Showroom 3D scene: the field, the T70, the four zones, weather and the
 * camera/drive rig. WebGL2 via React Three Fiber; quality tiers switch
 * pixel ratio / shadows / post-processing. A WebGPU renderer is not used:
 * R3F 9 has no stable WebGPURenderer binding, so the scene renders on the
 * WebGL2 path and reports WebGPU availability only as a capability badge
 * (see ShowroomPage). Post uses the in-repo @react-three/postprocessing
 * stack (N8AO + Bloom) — no extra effect libraries.
 */
import { Suspense, use, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, useGLTF, useProgress } from '@react-three/drei';
import { Bloom, EffectComposer, N8AO } from '@react-three/postprocessing';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HONGHU_T70_PARTS_URL } from '@/components/tractor-model-info';
import { CROP_PLOTS, FIELD_OBSTACLES, QUALITY_TIERS, SHOWROOM_ZONES, T70_PARTS, T70_PART_SOURCES, cropHeight, gripForWeather, terrainHeight, type QualityId, type ZoneId } from './showroom-data';
import type { BlendedWeather } from './showroom-weather';
import { autopilotInput, FIELD_PARAMS, hasManualInput, keysToDriveInput, resolveCollision, stepVehicle, TRACTOR_RADIUS } from './showroom-drive';
import { createRapierVehicle, type RapierVehicle } from './rapier-vehicle';
import { cropGeometry, farmGroundGeometry, paintFarmGround } from './showroom-farm-meshes';
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

function cloudTexture(variant: number): THREE.CanvasTexture {
  return canvasTexture(512, 256, (ctx) => {
    let seed = 523 + variant * 73;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 38; i++) {
      const x = 50 + random() * 410;
      const envelope = Math.sin(Math.PI * (x - 35) / 450);
      const radius = (17 + random() * 62) * envelope;
      const y = 164 - envelope * 38 - random() * radius * 0.65;
      const gradient = ctx.createRadialGradient(x, y, radius * 0.08, x, y, radius);
      gradient.addColorStop(0, 'rgba(255, 253, 246, 0.94)');
      gradient.addColorStop(0.42, 'rgba(245, 248, 251, 0.68)');
      gradient.addColorStop(0.73, 'rgba(217, 228, 241, 0.26)');
      gradient.addColorStop(1, 'rgba(200, 220, 240, 0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
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

function T70({ sim, snow, onPartSelect }: { sim: SimState; snow: { value: number }; onPartSelect: (id: string) => void }) {
  use(ensureStudioMeshopt());
  const { scene } = useGLTF(HONGHU_T70_PARTS_URL, false, false, attachStudioMeshopt);
  const group = useRef<THREE.Group>(null);
  const wheelPivots = useRef<Map<string, THREE.Group>>(new Map());
  const wheelMeshes = useRef<Map<string, THREE.Object3D>>(new Map());
  const hubMeshes = useRef<Map<string, THREE.Object3D>>(new Map());
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
      // The four sensor hotspots sit within ~30 px of each other on
      // screen, so their labels used to land on the same spot and
      // overlap. The dot stays exactly on its part; only the label is
      // fanned out into its own screen quadrant (see the CSS offsets).
      const labelClass =
        part.id === 'gps_antenna'
          ? 'showroom-hotspot-label--beidou'
          : part.id === 'sensor_roof_l'
            ? 'showroom-hotspot-label--roof-l'
            : part.id === 'sensor_roof_r'
              ? 'showroom-hotspot-label--roof-r'
              : 'showroom-hotspot-label--battery';
      const lift = part.id === 'sensor_roof_l' ? 0.3 : 0.12;
      return { part, labelClass, position: [center.x, center.y + size.y * 0.5 + lift, center.z] as [number, number, number] };
    }).filter((h): h is NonNullable<typeof h> => h !== null);
  }, [model]);

  // Wrap front wheels in steer pivots; record spin meshes.
  // Wheel fix (see showroom-data WHEEL_SPIN_AXIS): the GLB tyre is a
  // disc in the XY plane (axle = local Z) and the hub is a separate,
  // smaller disc (diameter ~57% of the tyre, offset 4 cm outboard), so
  // the annulus between hub edge and tyre inner edge is see-through —
  // the "hollow donut" in the screenshot. A procedural filler disc
  // (rim + centre cap, child of the wheel mesh so it steers/spins with
  // it) closes that annulus without touching the GLB file.
  useEffect(() => {
    const nodes = findPartNodes(model);
    wheelPivots.current.clear();
    wheelMeshes.current.clear();
    hubMeshes.current.clear();
    for (const id of ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr']) {
      const targets = nodes.get(id) ?? [];
      targets.forEach((mesh) => {
        wheelMeshes.current.set(`${id}:${mesh.uuid}`, mesh);
        if (mesh instanceof THREE.Mesh && mesh.geometry) {
          mesh.geometry.computeBoundingBox();
          const bb = mesh.geometry.boundingBox;
          if (bb) {
            const size = new THREE.Vector3();
            bb.getSize(size);
            const centre = new THREE.Vector3();
            bb.getCenter(centre);
            const radius = (size.y / 2) * 0.88;
            const thickness = size.z * 0.55;
            const filler = new THREE.Group();
            filler.position.copy(centre);
            const rim = new THREE.Mesh(
              new THREE.CylinderGeometry(radius, radius, thickness, 40),
              new THREE.MeshStandardMaterial({ color: '#6f7477', metalness: 0.7, roughness: 0.35 }),
            );
            rim.rotation.x = Math.PI / 2;
            rim.castShadow = true;
            filler.add(rim);
            const cap = new THREE.Mesh(
              new THREE.CylinderGeometry(radius * 0.28, radius * 0.28, thickness * 1.15, 24),
              new THREE.MeshStandardMaterial({ color: '#d7d9d6', metalness: 0.6, roughness: 0.3 }),
            );
            cap.rotation.x = Math.PI / 2;
            filler.add(cap);
            for (let s = 0; s < 5; s++) {
              const spoke = new THREE.Mesh(
                new THREE.BoxGeometry(radius * 1.7, radius * 0.2, thickness * 0.5),
                new THREE.MeshStandardMaterial({ color: '#8a8f92', metalness: 0.65, roughness: 0.4 }),
              );
              spoke.rotation.z = (s / 5) * Math.PI;
              filler.add(spoke);
            }
            mesh.add(filler);
          }
        }
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
    for (const id of ['hub_fl', 'hub_fr', 'hub_rl', 'hub_rr']) {
      (nodes.get(id) ?? []).forEach((mesh) => {
        hubMeshes.current.set(`${id}:${mesh.uuid}`, mesh);
      });
    }
  }, [model]);

  useFrame(() => {
    // Follow the terrain: the body rides on the field undulation
    // (flat on the dirt track) with a gentle pitch/roll from the slope.
    const g = group.current;
    if (g) {
      const { x, z, heading } = sim.tractor;
      const y = terrainHeight(x, z);
      const e = 0.6;
      const dydx = (terrainHeight(x + e, z) - terrainHeight(x - e, z)) / (2 * e);
      const dydz = (terrainHeight(x, z + e) - terrainHeight(x, z - e)) / (2 * e);
      const pitch = Math.max(-0.12, Math.min(0.12, Math.atan(dydx * Math.sin(heading) - dydz * Math.cos(heading))));
      const roll = Math.max(-0.12, Math.min(0.12, Math.atan(dydx * Math.cos(heading) + dydz * Math.sin(heading))));
      g.position.set(x, y, z);
      g.rotation.order = 'YXZ';
      // The GLB faces +X (the front wheel pair has the greater X).
      // Simulation headings are clockwise from -Z.
      g.rotation.set(-roll, Math.PI / 2 - heading, pitch);
    }
    const spin = -sim.wheelSpin;
    // Spin around the axle (local Z): rotating around X flipped the
    // wheel out of its plane like a coin.
    wheelMeshes.current.forEach((mesh) => {
      mesh.rotation.z = spin;
    });
    hubMeshes.current.forEach((mesh) => {
      mesh.rotation.z = spin;
    });
    wheelPivots.current.forEach((pivot) => {
      pivot.rotation.y = -sim.tractor.steer * 0.9;
    });
    if (radar.current) radar.current.rotation.y = sim.radarAngle;
  });

  return (
    <group
      ref={group}
      position={[sim.tractor.x, 0, sim.tractor.z]}
      rotation={[0, Math.PI / 2 - sim.tractor.heading, 0]}
    >
      <primitive object={model} />
      {/* Snow settling on the cab roof (opacity follows accumulation). */}
      <mesh position={[0, 2.32, -0.1]}>
        <boxGeometry args={[1.7, 0.14, 2.3]} />
        <meshStandardMaterial color="#ffffff" roughness={1} transparent opacity={snow.value * 0.95} depthWrite={false} />
      </mesh>
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
      {hotspots.map(({ part, labelClass, position }) => (
        <Html key={part.id} position={position} center zIndexRange={[30, 0]} style={{ pointerEvents: 'none' }}>
          <div className="showroom-hotspot-anchor">
            <button
              type="button"
              className="showroom-hotspot-dotbtn"
              title={part.zh}
              onClick={(event) => {
                event.stopPropagation();
                onPartSelect(part.id);
              }}
            >
              <span className="showroom-hotspot-dot" />
            </button>
            <span className={`showroom-hotspot-label ${labelClass}`}>{part.zh}</span>
          </div>
        </Html>
      ))}
    </group>
  );
}

/* ---------------------------------------------------------------- */
/* Weather visuals                                                   */
/* ---------------------------------------------------------------- */

const SUN_POSITION = [38, 10, -9] as const;

const skyVertex = /* glsl */ `
  varying vec3 vPos;
  void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const skyFragment = /* glsl */ `
  uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSunDirection; uniform float uSun;
  varying vec3 vPos;
  void main() {
    vec3 direction = normalize(vPos);
    float h = smoothstep(0.0, 0.67, direction.y);
    vec3 sky = mix(uHorizon, uTop, h);
    float sunAngle = max(0.0, dot(direction, uSunDirection));
    float disk = smoothstep(0.99972, 0.99985, sunAngle);
    float glow = pow(sunAngle, 28.0) * 0.14 + pow(sunAngle, 230.0) * 0.34;
    sky += vec3(1.0, 0.83, 0.56) * (disk * 2.6 + glow) * uSun;
    gl_FragColor = vec4(sky, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
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
          uSunDirection: { value: new THREE.Vector3(...SUN_POSITION).normalize() },
          uSun: { value: 1 },
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
    material.uniforms.uSun.value = Math.max(0, (weather.sun - 0.45) / 0.55);
  }, [weather, material]);
  return (
    <mesh material={material} renderOrder={-10}>
      <sphereGeometry args={[160, 32, 20]} />
    </mesh>
  );
}

function Clouds({ weather }: { weather: BlendedWeather }) {
  const textures = useMemo(() => [cloudTexture(0), cloudTexture(1), cloudTexture(2)], []);
  const refs = useRef<(THREE.Sprite | null)[]>([]);
  const clouds = useMemo(() => Array.from({ length: 14 }, (_, i) => {
    const angle = i * Math.PI * 2 / 14 + 0.12;
    const radius = 68 + (i * 17) % 25;
    return {
      position: [Math.cos(angle) * radius, 13 + (i * 11) % 15, Math.sin(angle) * radius] as const,
      size: 30 + (i * 13) % 26,
    };
  }), []);
  const drift = useRef(new THREE.Vector2());
  useFrame((_, dt) => {
    const direction = weather.windDeg * Math.PI / 180;
    const speed = (0.25 + weather.windKmh * 0.07) * dt;
    drift.current.x -= Math.sin(direction) * speed;
    drift.current.y += Math.cos(direction) * speed;
    refs.current.forEach((sprite, i) => {
      if (!sprite) return;
      const [x, y, z] = clouds[i].position;
      sprite.position.set(THREE.MathUtils.euclideanModulo(x + drift.current.x + 105, 210) - 105,
        y, THREE.MathUtils.euclideanModulo(z + drift.current.y + 105, 210) - 105);
    });
  });
  return (
    <group>
      {clouds.map(({ position, size }, i) => (
        <sprite key={i} ref={(el) => { refs.current[i] = el; }} position={position} scale={[size, size * 0.47, 1]}>
          <spriteMaterial map={textures[i % textures.length]} color={weather.sun < 0.5 ? '#bac3d0' : '#fff8ec'}
            transparent opacity={Math.min(0.94, 0.38 + weather.clouds * 0.56)} depthWrite={false} fog={false} />
        </sprite>
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
      arr[i * 3 + 2] = -30 + Math.random() * 60;
    }
    precipitationPositions = arr;
  }
  return precipitationPositions;
}

/* ---------------------------------------------------------------- */
/* Farm field: crops swaying in the wind + treeline                */
/* ---------------------------------------------------------------- */

/**
 * Farm plots: one InstancedMesh per plot (6 plots, 3 crops at different
 * growth stages), each plant an X-shaped pair of alpha-cutout planes
 * merged into a single geometry, so the whole field costs 6 draw calls.
 * Wind is a vertex-shader bend along the weather wind direction
 * (uWindDir) with amplitude uSway — no per-plant CPU work per frame.
 * LOD: every 0.5 s each plot's instance count is thinned by camera
 * distance (full < 25 m, half < 45 m, quarter beyond); the low quality
 * tier also caps density at 35%. Snow (uSnow) whitens the plants and
 * bends them down. Instances are shuffled so thinning stays uniform.
 */
function CropField({ weather, quality, snow }: { weather: BlendedWeather; quality: QualityId; snow: { value: number } }) {
  const tier = QUALITY_TIERS[quality];
  const wind = useMemo(
    () => ({ uTime: { value: 0 }, uSway: { value: 0.15 }, uWindDir: { value: new THREE.Vector2(0.7, 0.7) }, uSnow: { value: 0 } }),
    [],
  );
  const geometries = useMemo(() => CROP_PLOTS.map(cropGeometry), []);
  const plots = useMemo(() => {
    let seed = 4242;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    return CROP_PLOTS.map((plot) => {
      const [minX, minZ, maxX, maxZ] = plot.bounds;
      const height = cropHeight(plot.crop, plot.stage);
      const list: { x: number; z: number; rot: number; s: number; h: number; tint: number }[] = [];
      for (let z = minZ; z <= maxZ; z += plot.spacing[1]) {
        for (let x = minX; x <= maxX; x += plot.spacing[0]) {
          if (rand() < 0.04 || FIELD_OBSTACLES.some(({ box: [left, near, right, far] }) =>
            x >= left - 0.3 && x <= right + 0.3 && z >= near - 0.3 && z <= far + 0.3)) continue;
          list.push({
            x: x + (rand() - 0.5) * 0.3,
            z: z + (rand() - 0.5) * 0.5,
            rot: rand() * Math.PI,
            s: 0.85 + rand() * 0.4,
            h: height * (0.85 + rand() * 0.3),
            tint: 0.72 + rand() * 0.27,
          });
        }
      }
      // Shuffle so distance-based count thinning stays uniform.
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
      return {
        plot,
        list,
        full: Math.max(1, Math.floor(list.length * tier.crops)),
        center: new THREE.Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2),
      };
    });
  }, [tier.crops]);
  const meshRefs = useRef<(THREE.InstancedMesh | null)[]>([]);
  const matRefs = useRef<(THREE.MeshStandardMaterial | null)[]>([]);
  const lodTimer = useRef(0);
  useEffect(() => {
    const dummy = new THREE.Object3D();
    const tint = new THREE.Color();
    plots.forEach((entry, pi) => {
      const mesh = meshRefs.current[pi];
      if (!mesh) return;
      entry.list.forEach((inst, i) => {
        dummy.position.set(inst.x, terrainHeight(inst.x, inst.z) - 0.018, inst.z);
        dummy.rotation.set(0, inst.rot, 0);
        dummy.scale.set(inst.s, inst.h, inst.s);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        mesh.setColorAt(i, tint.setRGB(inst.tint, inst.tint, inst.tint * 0.96));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.count = entry.full;
    });
  }, [plots]);
  useFrame(({ clock, camera }) => {
    wind.uTime.value = clock.elapsedTime;
    wind.uSway.value = weather.sway;
    wind.uSnow.value = snow.value;
    const direction = weather.windDeg * Math.PI / 180;
    wind.uWindDir.value.set(-Math.sin(direction), Math.cos(direction));
    const wet = weather.wet;
    const sn = snow.value;
    for (const ref of matRefs.current) {
      if (!ref) continue;
      // Wet darkens, snow whitens (both gradual — snow.value ramps).
      const r = (1 - wet * 0.35) * (1 - sn * 0.6) + sn * 0.6;
      const g = (1 - wet * 0.3) * (1 - sn * 0.6) + sn * 0.6;
      const b = (1 - wet * 0.3) * (1 - sn * 0.55) + sn * 0.6;
      ref.color.setRGB(r, g, b);
    }
    // LOD / distance culling, throttled to twice a second.
    lodTimer.current += 1;
    if (lodTimer.current % 30 === 0) {
      plots.forEach((entry, pi) => {
        const mesh = meshRefs.current[pi];
        if (!mesh) return;
        const d = camera.position.distanceTo(entry.center);
        const frac = d < 25 ? 1 : d < 45 ? 0.5 : 0.25;
        mesh.count = Math.max(1, Math.floor(entry.full * frac));
      });
    }
  });
  const cropMaterial = (pi: number) => (
    <meshStandardMaterial
      ref={(el) => {
        matRefs.current[pi] = el;
      }}
      vertexColors
      side={THREE.DoubleSide}
      roughness={0.9}
      onBeforeCompile={(shader) => {
        shader.uniforms.uTime = wind.uTime;
        shader.uniforms.uSway = wind.uSway;
        shader.uniforms.uWindDir = wind.uWindDir;
        shader.uniforms.uSnow = wind.uSnow;
        shader.vertexShader = `uniform float uTime; uniform float uSway; uniform vec2 uWindDir; uniform float uSnow;
${shader.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          {
            float swayH = pow(clamp(position.y, 0.0, 1.0), 1.75);
            vec2 root = instanceMatrix[3].xz;
            float phase = dot(root, uWindDir) * 0.52 - uTime * 2.2;
            float gust = sin(phase) * 0.56 + sin(phase * 0.49 + uTime * 0.7) * 0.44;
            vec2 bend = uWindDir * ((gust * 0.21 + 0.08) * uSway + uSnow * 0.08) * swayH;
            transformed.x += dot(bend, normalize(instanceMatrix[0].xz));
            transformed.z += dot(bend, normalize(instanceMatrix[2].xz));
            transformed.y *= 1.0 - uSnow * 0.19 * swayH;
          }`,
        )}`;
      }}
    />
  );
  return (
    <group>
      {plots.map((entry, pi) => (
        <instancedMesh
          key={entry.plot.id}
          ref={(el) => {
            meshRefs.current[pi] = el;
          }}
          args={[geometries[pi], undefined, entry.list.length]}
          frustumCulled={false}
          castShadow={false}
          receiveShadow
        >
          {cropMaterial(pi)}
        </instancedMesh>
      ))}
    </group>
  );
}

function Treeline({ weather }: { weather: BlendedWeather }) {
  const crown = useMemo(() => {
    const lobes = [
      [-0.95, 0.25, 0.22, 1.25, 1.45], [0.83, 0.48, -0.3, 1.35, 1.55],
      [0.12, 1.35, 0.07, 1.42, 1.65], [0.18, 0.03, 0.7, 1.45, 1.2],
      [-0.28, 0.26, -0.89, 1.36, 1.25],
    ].map(([x, y, z, width, height]) =>
      new THREE.IcosahedronGeometry(1, 1).scale(width, height, width).translate(x, y, z));
    const geometry = mergeGeometries(lobes);
    lobes.forEach((lobe) => lobe.dispose());
    if (!geometry) throw new Error('Could not build tree crown');
    return geometry;
  }, []);
  const canopies = useRef<(THREE.Mesh | null)[]>([]);
  const trees = useMemo(() => {
    let seed = 777;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    return Array.from({ length: 56 }, (_, i) => {
      const a = (i / 56) * Math.PI * 2 + rand() * 0.1;
      const r = 46 + rand() * 12;
      return { x: Math.cos(a) * r, z: Math.sin(a) * r * 0.8, s: 0.8 + rand() * 0.9, phase: rand() * Math.PI * 2 };
    });
  }, []);
  // Canopy sway: the whole crown leans with the wind (amplitude follows
  // the weather sway; trunks stay put).
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    canopies.current.forEach((mesh, i) => {
      if (!mesh) return;
      const phase = trees[i]?.phase ?? 0;
      mesh.rotation.z = Math.sin(t * 1.1 + phase) * weather.sway * 0.05;
      mesh.rotation.x = Math.cos(t * 0.9 + phase) * weather.sway * 0.03;
    });
  });
  return (
    <group>
      {trees.map((t, i) => (
        <group key={i} position={[t.x, terrainHeight(t.x, t.z), t.z]} scale={t.s}>
          <mesh position={[0, 1, 0]} castShadow>
            <cylinderGeometry args={[0.22, 0.3, 2, 8]} />
            <meshStandardMaterial color="#6b4a2f" roughness={0.9} />
          </mesh>
          <mesh
            position={[0, 2.7, 0]}
            geometry={crown}
            castShadow
            ref={(el) => {
              canopies.current[i] = el;
            }}
          >
            <meshStandardMaterial color={['#405c28', '#516d35', '#36532c'][i % 3]} roughness={0.94} />
          </mesh>
        </group>
      ))}
    </group>
  );
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
    // Rain slants with the wind; snow drifts more slowly sideways.
    const drift = (isSnow ? weather.windKmh * 0.02 : weather.windKmh * 0.08) * dt;
    for (let i = 0; i < count; i++) {
      let y = attr.getY(i) - fall;
      if (y < 0) y = 24 + Math.random() * 2;
      attr.setY(i, y);
      let x = attr.getX(i) + drift;
      if (x > 45) x = -45;
      if (x < -45) x = 45;
      attr.setX(i, x);
      if (isSnow) attr.setX(i, attr.getX(i) + Math.sin(y * 0.6 + i) * dt * 0.6);
    }
    attr.needsUpdate = true;
    points.current.geometry.setDrawRange(0, count);
  });
  if (weather.particleKind === 'none' || count === 0) return null;
  return (
    <points ref={points} geometry={geometry} frustumCulled={false}>
      {/* depthWrite: precipitation must write depth. The high tier's
          depth of field blurs each pixel by the depth-buffer value
          behind it — with depthWrite off, flakes inherit the sky /
          far-ground depth and are blurred to nothing, so a snow scene
          showed no falling snow at all (rain only looked rainy
          because of the separate DOM droplet overlay). With depth
          written, near flakes stay sharp and far ones soften
          naturally. Overlap artefacts are negligible at this size. */}
      <pointsMaterial size={weather.particleKind === 'snow' ? 0.5 : 0.09} color={weather.particleKind === 'snow' ? '#ffffff' : '#bcd8ea'} transparent opacity={0.85} sizeAttenuation depthWrite />
    </points>
  );
}

/** Rain puddles on the track + expanding ripple rings while it rains. */
function Puddles({ weather }: { weather: BlendedWeather }) {
  const spots: [number, number, number][] = [
    [8, 0.5, 1.6], [-6, -0.8, 2.0], [18, 1.2, 1.4], [-14, 0.6, 1.8], [24, -1, 1.2],
  ];
  const rings = useRef<(THREE.Mesh | null)[]>([]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    rings.current.forEach((mesh, i) => {
      if (!mesh) return;
      const phase = ((t * 0.5 + i * 0.33) % 1 + 1) % 1;
      const s = 0.4 + phase * 1.6;
      mesh.scale.set(s, s, 1);
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = (weather.particleKind === 'rain' ? 0.5 : 0) * (1 - phase) * weather.droplets;
    });
  });
  const opacity = weather.wet * 0.75;
  if (opacity <= 0.02 && weather.particleKind !== 'rain') return null;
  return (
    <group>
      {spots.map(([x, z, r], i) => (
        <mesh key={`puddle-${i}`} position={[x, 0.025, z]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[r, 24]} />
          <meshStandardMaterial color="#8fb4c8" metalness={0.85} roughness={0.08} transparent opacity={opacity} />
        </mesh>
      ))}
      {spots.slice(0, 3).map(([x, z], i) => (
        <mesh
          key={`ripple-${i}`}
          position={[x, 0.03, z]}
          rotation={[-Math.PI / 2, 0, 0]}
          ref={(el) => {
            rings.current[i] = el;
          }}
        >
          <ringGeometry args={[0.45, 0.55, 24]} />
          <meshBasicMaterial color="#cfe4ee" transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Dust kicked up behind the tractor on dry dirt, muddy spray when wet.
 * A small Points pool recycled behind the rear wheels; only active
 * while driving. Colour and size stay modest on purpose.
 */
function DustPuffs({ sim, weather }: { sim: SimState; weather: BlendedWeather }) {
  const COUNT = 48;
  const points = useRef<THREE.Points>(null);
  const data = useRef(
    Array.from({ length: COUNT }, () => ({ life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 })),
  );
  const positions = useMemo(() => new Float32Array(COUNT * 3), []);
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return geo;
  }, [positions]);
  useFrame((_, dt) => {
    const driving = Math.abs(sim.tractor.speed) > 1.2;
    const heading = sim.tractor.heading;
    const bx = sim.tractor.x - Math.sin(heading) * 1.6;
    const bz = sim.tractor.z + Math.cos(heading) * 1.6;
    data.current.forEach((p, i) => {
      if (p.life <= 0) {
        if (driving && Math.random() < 0.5) {
          p.life = 0.9;
          p.x = bx + (Math.random() - 0.5) * 1.2;
          p.y = 0.25;
          p.z = bz + (Math.random() - 0.5) * 1.2;
          p.vx = (Math.random() - 0.5) * 0.6 - Math.sin(heading) * sim.tractor.speed * 0.2;
          p.vy = 0.5 + Math.random() * 0.5;
          p.vz = (Math.random() - 0.5) * 0.6 + Math.cos(heading) * sim.tractor.speed * 0.2;
        } else {
          positions[i * 3 + 1] = -10;
          return;
        }
      }
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      positions[i * 3] = p.x;
      positions[i * 3 + 1] = Math.max(0.05, p.y);
      positions[i * 3 + 2] = p.z;
    });
    const attr = geometry.getAttribute('position') as THREE.BufferAttribute;
    attr.needsUpdate = true;
    if (points.current) points.current.visible = driving || data.current.some((p) => p.life > 0);
  });
  const wet = weather.wet > 0.4;
  return (
    <points ref={points} geometry={geometry} frustumCulled={false}>
      <pointsMaterial size={0.55} color={wet ? '#6d7a72' : '#c9b18a'} transparent opacity={0.4} depthWrite={false} />
    </points>
  );
}

/* ---------------------------------------------------------------- */
/* Track guide + zones                                               */
/* ---------------------------------------------------------------- */

function GuideLine() {
  const arrows = useMemo(() => Array.from({ length: 7 }, (_, i) => -18 + i * 6), []);
  return (
    <group>
      {arrows.map((x) => (
        <mesh key={x} position={[x, 0.02, 0]} rotation={[-Math.PI / 2, 0, Math.PI]}>
          <coneGeometry args={[0.28, 0.7, 4]} />
          <meshBasicMaterial color="#7ad7ff" />
        </mesh>
      ))}
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
      <mesh position={[0, 0.008, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[3.4, 40]} />
        <meshStandardMaterial color="#a98f63" roughness={1} />
      </mesh>
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

function CameraRig({ sim, weather, quality, onPosition, onAutopilotArrived }: Pick<ShowroomSceneProps,
  'sim' | 'weather' | 'quality' | 'onPosition' | 'onAutopilotArrived'>) {
  const { camera } = useThree();
  const lastReport = useRef(0);
  const rapierRef = useRef<RapierVehicle | null>(null);
  const lookTarget = useRef(new THREE.Vector3(0, 1.2, 0));
  const cameraReady = useRef(false);
  const prevSpeed = useRef(0);
  const sunRef = useRef<THREE.DirectionalLight>(null);
  const hemiRef = useRef<THREE.HemisphereLight>(null);

  useEffect(() => {
    let cancelled = false;
    void createRapierVehicle(sim.tractor)
      .then((vehicle) => {
        if (cancelled) return vehicle.dispose();
        vehicle.setPose(sim.tractor);
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
      sim.rapierReady = false;
    };
  }, [sim]);

  useFrame((state, dt) => {
    const clampedDt = Math.min(Math.max(dt, 0.0001), 0.05);
    const camDt = Math.min(Math.max(dt, 0.0001), 0.1);
    sim.elapsed += clampedDt;
    sim.radarAngle += clampedDt * 0.9;
    sim.diagPhase = (sim.elapsed / 4) % 3;
    const keys = sim.keys;
    const joy = sim.joystick;

    let input = keysToDriveInput(keys, joy);
    input.throttle = Math.max(-1, Math.min(1, input.throttle));
    input.steer = Math.max(-1, Math.min(1, input.steer));
    if (sim.autopilot) {
      // Any manual drive input takes over immediately.
      if (hasManualInput(keys, joy)) {
        sim.autopilot = null;
      } else {
        const target = sim.autopilot.route[sim.autopilot.index];
        if (target) {
          const result = autopilotInput(sim.tractor, target);
          input = result.input;
          if (result.arrived) {
            sim.autopilot.index += 1;
            if (sim.autopilot.index >= sim.autopilot.route.length) {
              onAutopilotArrived(sim.autopilot.zone);
              sim.autopilot = null;
            }
          }
        } else {
          sim.autopilot = null;
        }
      }
    }
    const vehicle = rapierRef.current;
    let next = sim.tractor;
    // Field speed limit + wet/snow grip (see showroom-drive).
    const params = FIELD_PARAMS;
    const grip = gripForWeather(weather.wet, weather.snow);
    if (vehicle) {
      const stepped = vehicle.step(input, clampedDt, { grip });
      next = stepped.pose;
      sim.tractor = next;
    } else {
      next = resolveCollision(stepVehicle(sim.tractor, input, clampedDt, params, { grip }), sim.tractor, TRACTOR_RADIUS);
      sim.tractor = next;
    }
    sim.wheelSpin += (next.speed / 0.45) * clampedDt;
    const heading = next.heading;
    const speedAbs = Math.abs(next.speed);
    const accel = (next.speed - prevSpeed.current) / Math.max(camDt, 0.001);
    prevSpeed.current = next.speed;
    const pitchLook = Math.max(-0.3, Math.min(0.3, -accel * 0.02));
    // Speed pulls the chase camera back and widens the FOV a touch;
    // turns swing it slightly outward; accel/brake pitch the view.
    const dist = 7.5 + Math.min(3.5, speedAbs * 0.45);
    const height = 3.4 + Math.min(0.6, speedAbs * 0.06);
    const lateral = -next.steer * Math.min(0.9, speedAbs * 0.12);
    const bx = next.x - Math.sin(heading) * dist + Math.cos(heading) * lateral;
    const bz = next.z + Math.cos(heading) * dist + Math.sin(heading) * lateral;
    const desired = new THREE.Vector3(bx, height + terrainHeight(bx, bz), bz);
    const aim = new THREE.Vector3(next.x + Math.sin(heading) * 2.3,
      1.55 + terrainHeight(next.x, next.z) + pitchLook, next.z - Math.cos(heading) * 2.3);
    if (!cameraReady.current) {
      cameraReady.current = true;
      camera.position.copy(desired);
      lookTarget.current.copy(aim);
    } else {
      camera.position.lerp(desired, 1 - Math.exp(-camDt * 3.5));
    }
    // Smooth the look target too: looking straight at the live pose
    // while the camera lagged behind made the view whip and shake
    // whenever the tractor turned or the Rapier pose jittered.
    lookTarget.current.lerp(aim, 1 - Math.exp(-camDt * 8));
    camera.lookAt(lookTarget.current);
    const persp = camera as THREE.PerspectiveCamera;
    const targetFov = 55 + Math.min(8, speedAbs * 0.9);
    if (Math.abs(persp.fov - targetFov) > 0.1) {
      persp.fov += (targetFov - persp.fov) * Math.min(1, camDt * 3);
      persp.updateProjectionMatrix();
    }
    if (sunRef.current) sunRef.current.intensity = 2.1 * weather.sun;
    // Outdoor fill: grey/rainy days get extra sky fill (there is no
    // ceiling in the open field — the fill is sky light).
    if (hemiRef.current) hemiRef.current.intensity = 0.64 + weather.lamps * 0.35;
    const now = state.clock.elapsedTime;
    if (now - lastReport.current > 0.15) {
      lastReport.current = now;
      const speedKmh = Math.abs(sim.tractor.speed) * 3.6;
      onPosition(sim.tractor.x, sim.tractor.z, speedKmh);
    }
  });

  return (
    <>
      <directionalLight ref={sunRef} position={SUN_POSITION} color="#fff1d5" intensity={2.1}
        castShadow={QUALITY_TIERS[quality].shadows} shadow-mapSize-width={2048} shadow-mapSize-height={2048}
        shadow-camera-left={-36} shadow-camera-right={36} shadow-camera-top={30} shadow-camera-bottom={-30}
        shadow-camera-far={95} shadow-normalBias={0.075} shadow-bias={-0.0003} />
      <hemisphereLight ref={hemiRef} args={['#e8f0f4', '#8a7a5a', 0.7]} />
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
  onPosition: (x: number, z: number, speedKmh: number) => void;
  onProgress: (progress: number) => void;
  onAutopilotArrived: (id: ZoneId) => void;
  onPartSelect: (id: string) => void;
  onZoneSelect: (id: ZoneId) => void;
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
  const farmGroundTex = useMemo(() => canvasTexture(2048, 2048, paintFarmGround), []);
  const terrain = useMemo(() => farmGroundGeometry(), []);
  const photoRef = useRef(0);
  const tier = QUALITY_TIERS[quality];
  // Snow accumulation: builds slowly while it snows (~50 s to full
  // cover), melts slowly after — a gradual ramp, never a snap. A
  // stable memo object (not a ref) so children can receive it as a prop.
  // Verification hook: ?snow=1 starts with full cover (see NOTES).
  const snow = useMemo(() => {
    const query = window.location.hash.split('?')[1] ?? '';
    return { value: new URLSearchParams(query).get('snow') === '1' ? 1 : 0 };
  }, []);
  const groundMat = useRef<THREE.MeshStandardMaterial>(null);
  // One shared snow-cover material for the field snow sheet.
  const snowCoverMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, transparent: true, opacity: 0, depthWrite: false }),
    [],
  );
  useFrame((_, dt) => {
    const dtc = Math.min(Math.max(dt, 0), 0.1);
    if (weather.snow > 0.5) snow.value = Math.min(1, snow.value + dtc * 0.02);
    else snow.value = Math.max(0, snow.value - dtc * 0.008);
    const sn = snow.value;
    if (groundMat.current) {
      // Rain makes the soil darker and glossier (wet reflection);
      // snow whitens it. Both follow the gradual snow/wet values.
      groundMat.current.roughness = 1 - weather.wet * 0.55;
      const r = 1 - weather.wet * 0.3;
      groundMat.current.color.setRGB(r + (1 - r) * sn * 0.7, r + (1 - r) * sn * 0.7, r + (1 - r) * sn * 0.65);
    }
    snowCoverMaterial.opacity = sn * 0.85;
  });

  useEffect(() => {
    scene.background = new THREE.Color(weather.skyHorizon);
    const fogDensity = weather.fog;
    // Near plane also closes in with density, so a higher fog value
    // really reads as denser fog: at fog 0.08 the tractor (~26 m from
    // the overview camera) is lightly hazed and the treeline (46 m+)
    // is fully gone, while the near field (camera < 10 m) stays clear.
    // Small densities barely move near/far, so sunny/rain/storm keep
    // their old distances. (The old far floor of 48 m clamped any
    // density above ~0.047 to the same distance, so raising the preset
    // alone changed almost nothing.)
    const fogNear = Math.max(10, 30 - fogDensity * 100);
    const fogFar = Math.max(40, 170 - fogDensity * 2600);
    scene.fog = new THREE.Fog(weather.skyHorizon, fogNear, fogFar);
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
      <CameraRig sim={sim} weather={weather} quality={quality} onPosition={onPosition} onAutopilotArrived={onAutopilotArrived} />
      <SkyDome weather={weather} />
      <Clouds weather={weather} />
      <Precipitation weather={weather} quality={quality} />
      <CropField weather={weather} quality={quality} snow={snow} />
      <Treeline weather={weather} />
      <Puddles weather={weather} />
      <DustPuffs sim={sim} weather={weather} />
      {/* Farm ground: textured soil/grass with furrows + dirt track. */}
      <mesh geometry={terrain} receiveShadow>
        <meshStandardMaterial ref={groundMat} map={farmGroundTex} bumpMap={farmGroundTex}
          bumpScale={quality === 'low' ? 0 : 0.075} roughness={1} metalness={0} />
      </mesh>
      {/* Snow cover over the whole field (opacity ramps with
          accumulation) — one uniform sheet. */}
      <mesh position={[0, 0.02, 0]} geometry={terrain} material={snowCoverMaterial} />
      <GuideLine />
      {/* Guide light strip along the track edges */}
      {[-3.2, 3.2].map((z) => (
        <mesh key={z} position={[0, 0.015, z]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[40, 0.08]} />
          <meshBasicMaterial color="#7ad7ff" transparent opacity={0.8} />
        </mesh>
      ))}
      {/* T70 centre stage */}
      <Suspense fallback={null}>
        <T70 sim={sim} snow={snow} onPartSelect={onPartSelect} />
      </Suspense>
      {SHOWROOM_ZONES.filter((z) => z.id !== 'tractor').map((zone) => (
        <ZoneBooth key={zone.id} zone={zone} sim={sim} onZoneSelect={onZoneSelect} />
      ))}
      {/* Post: full on high, bloom only on medium, none on low. */}
      {tier.post === 'full' && (
        <EffectComposer multisampling={4}>
          <N8AO aoRadius={1.4} distanceFalloff={1} intensity={0.85} />
          <Bloom intensity={0.35} luminanceThreshold={0.85} luminanceSmoothing={0.2} mipmapBlur />
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
      camera={{ fov: 55, near: 0.1, far: 400 }}
      style={{ touchAction: 'none' }}
    >
      <SceneContents {...props} />
    </Canvas>
  );
}

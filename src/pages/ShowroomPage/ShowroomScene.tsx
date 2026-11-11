/**
 * Showroom 3D scene: the field, the T70, the four zones, weather and the
 * camera/drive rig. WebGL2 via React Three Fiber; quality tiers switch
 * pixel ratio / shadows / post-processing. A WebGPU renderer is not used:
 * R3F 9 has no stable WebGPURenderer binding, so the scene renders on the
 * WebGL2 path and reports WebGPU availability only as a capability badge
 * (see ShowroomPage). Post uses the in-repo @react-three/postprocessing
 * stack (N8AO + Bloom + DepthOfField) — no extra effect libraries.
 */
import { Suspense, use, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, useGLTF, useProgress } from '@react-three/drei';
import { Bloom, DepthOfField, EffectComposer, N8AO, Vignette } from '@react-three/postprocessing';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import { HONGHU_T70_PARTS_URL } from '@/components/tractor-model-info';
import { CROP_PLOTS, QUALITY_TIERS, SHOWROOM_ZONES, T70_PARTS, T70_PART_SOURCES, cropHeight, gripForWeather, terrainHeight, type CropKind, type QualityId, type ZoneId } from './showroom-data';
import type { BlendedWeather } from './showroom-weather';
import { autopilotInput, clampWalk, FIELD_PARAMS, hasManualInput, keysToDriveInput, keysToWalkInput, resolveCollision, stepVehicle, TRACTOR_RADIUS, WALK_PARAMS } from './showroom-drive';
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

/* Wheat plant silhouettes on a transparent canvas. The cutout
 * (alphaTest, see CropField) turns each flat quad into a shaped plant
 * — tapered stem, curved blades with midribs, golden ear with awns —
 * instead of the old solid green board. Two variants (A: eared wheat,
 * B: leafier and taller, small ear) are mixed across the rows so the
 * field does not read as one repeating stamp. Canvas 256×512, plant
 * centred at x = 128, base y = 508, ear tip near y = 20. */
function drawLeaf(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, len: number, angleDeg: number, width: number,
  base: string, tip: string,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((angleDeg * Math.PI) / 180);
  const g = ctx.createLinearGradient(0, 0, len, 0);
  g.addColorStop(0, base);
  g.addColorStop(1, tip);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(len * 0.3, -width, len * 0.75, -width * 0.55, len, 0);
  ctx.bezierCurveTo(len * 0.75, width * 0.55, len * 0.3, width, 0, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(238, 242, 196, 0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(6, 0);
  ctx.lineTo(len - 8, 0);
  ctx.stroke();
  ctx.restore();
}

function drawEar(ctx: CanvasRenderingContext2D, cx: number, topY: number, grains: number) {
  ctx.strokeStyle = '#a8842f';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(cx, topY + grains * 13 + 14);
  ctx.lineTo(cx, topY);
  ctx.stroke();
  for (let i = 0; i < grains; i++) {
    const y = topY + 8 + i * 13;
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(cx + side * 9, y);
      ctx.rotate(side * 0.6);
      ctx.fillStyle = i % 2 ? '#d9b45b' : '#c9a24a';
      ctx.beginPath();
      ctx.ellipse(0, 0, 7, 13, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = 'rgba(216, 178, 92, 0.85)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx + side * 14, y - 6);
      ctx.lineTo(cx + side * 30, y - 42);
      ctx.stroke();
    }
  }
}

/** Rice: broad bright-green blades, a drooping panicle, no awns. */
function drawPanicle(ctx: CanvasRenderingContext2D, cx: number, topY: number) {
  ctx.strokeStyle = '#8a9a3a';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(cx, topY + 90);
  ctx.quadraticCurveTo(cx + 14, topY + 40, cx + 26, topY + 8);
  ctx.stroke();
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    const x = cx + 6 + t * 22;
    const y = topY + 80 - t * 68;
    ctx.fillStyle = i % 2 ? '#b8c25a' : '#a2b04a';
    ctx.beginPath();
    ctx.ellipse(x, y, 6, 11, 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Corn: tall stalk, wide leaves, a cob with husk mid-stem. */
function drawCob(ctx: CanvasRenderingContext2D, cx: number, y: number) {
  ctx.fillStyle = '#7fae4e';
  ctx.beginPath();
  ctx.ellipse(cx + 16, y, 13, 34, 0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e8c95a';
  ctx.beginPath();
  ctx.ellipse(cx + 16, y - 6, 8, 24, 0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#5d8a35';
  ctx.lineWidth = 2;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(cx + 16 + i * 3, y - 28);
    ctx.lineTo(cx + 16 + i * 3, y + 16);
    ctx.stroke();
  }
}

function cropTextureFor(crop: CropKind, variant: 'A' | 'B'): THREE.CanvasTexture {
  if (crop === 'rice') {
    return canvasTexture(256, 512, (ctx) => {
      ctx.clearRect(0, 0, 256, 512);
      const stemGrad = ctx.createLinearGradient(0, 508, 0, 200);
      stemGrad.addColorStop(0, '#3d5c1e');
      stemGrad.addColorStop(1, '#6da03a');
      ctx.fillStyle = stemGrad;
      ctx.beginPath();
      ctx.moveTo(124, 508);
      ctx.lineTo(132, 508);
      ctx.lineTo(130, 200);
      ctx.lineTo(126, 200);
      ctx.closePath();
      ctx.fill();
      const leaves: [number, number, number, number][] =
        variant === 'A'
          ? [[128, 460, 95, -55], [128, 400, 110, 55], [128, 330, 100, -60], [128, 260, 90, 60]]
          : [[128, 470, 120, -40], [128, 410, 125, 42], [128, 340, 115, -48], [128, 270, 105, 48], [128, 210, 85, -55]];
      for (const [x, y, len, angle] of leaves) drawLeaf(ctx, x, y, len, angle, 22, '#3f7a24', '#7cc24a');
      drawPanicle(ctx, 128, variant === 'A' ? 60 : 90);
    });
  }
  if (crop === 'corn') {
    return canvasTexture(256, 512, (ctx) => {
      ctx.clearRect(0, 0, 256, 512);
      const stemGrad = ctx.createLinearGradient(0, 508, 0, 60);
      stemGrad.addColorStop(0, '#4a6b22');
      stemGrad.addColorStop(1, '#7fae4e');
      ctx.fillStyle = stemGrad;
      ctx.beginPath();
      ctx.moveTo(122, 508);
      ctx.lineTo(134, 508);
      ctx.lineTo(131, 60);
      ctx.lineTo(125, 60);
      ctx.closePath();
      ctx.fill();
      const leaves: [number, number, number, number][] = [
        [128, 470, 130, -30], [128, 410, 145, 32], [128, 340, 140, -35], [128, 270, 130, 35], [128, 200, 120, -40], [128, 140, 100, 42],
      ];
      for (const [x, y, len, angle] of leaves) drawLeaf(ctx, x, y, len, angle, 26, '#3c6e20', '#69a83e');
      drawCob(ctx, 128, variant === 'A' ? 300 : 330);
    });
  }
  return canvasTexture(256, 512, (ctx) => {
    ctx.clearRect(0, 0, 256, 512);
    // Stem: tapered, slightly darker at the base.
    const stemTop = variant === 'A' ? 150 : 110;
    const stemGrad = ctx.createLinearGradient(0, 508, 0, stemTop);
    stemGrad.addColorStop(0, '#4c6426');
    stemGrad.addColorStop(1, '#7ba23f');
    ctx.fillStyle = stemGrad;
    ctx.beginPath();
    ctx.moveTo(123, 508);
    ctx.lineTo(133, 508);
    ctx.lineTo(130, stemTop);
    ctx.lineTo(126, stemTop);
    ctx.closePath();
    ctx.fill();
    // Back leaves (darker) first, then front leaves (lighter).
    const back: [number, number, number, number][] =
      variant === 'A'
        ? [[128, 430, 95, -115], [128, 360, 105, 115], [128, 290, 90, -125]]
        : [[128, 440, 120, -105], [128, 360, 125, 105], [128, 280, 110, -120], [128, 210, 95, 120]];
    for (const [x, y, len, angle] of back) drawLeaf(ctx, x, y, len, angle, 13, '#3c5c20', '#6d8a38');
    const front: [number, number, number, number][] =
      variant === 'A'
        ? [[128, 470, 80, -35], [128, 410, 115, 35], [128, 340, 105, -48], [128, 265, 95, 48], [128, 200, 75, -60]]
        : [[128, 480, 110, -28], [128, 420, 130, 30], [128, 350, 120, -42], [128, 285, 110, 42], [128, 220, 95, -55], [128, 165, 80, 55]];
    for (const [x, y, len, angle] of front) drawLeaf(ctx, x, y, len, angle, variant === 'A' ? 15 : 20, '#4a7028', '#93b84e');
    drawEar(ctx, 128, variant === 'A' ? 28 : 48, variant === 'A' ? 8 : 5);
  });
}

function groundTexture(): THREE.CanvasTexture {
  // 1024² texture over a 140×100 m field: green crop ground, brown
  // furrow lines in the north/south crop belts, dirt track along z = 0.
  return canvasTexture(1024, 1024, (ctx) => {
    ctx.fillStyle = '#7fa055';
    ctx.fillRect(0, 0, 1024, 1024);
    ctx.fillStyle = '#74944c';
    for (let i = 0; i < 900; i++) {
      ctx.fillRect(Math.random() * 1024, Math.random() * 1024, 3, 3);
    }
    // Furrows: horizontal bands in the crop belts (top/bottom thirds).
    ctx.strokeStyle = 'rgba(122, 90, 52, 0.5)';
    ctx.lineWidth = 3;
    for (let y = 40; y < 380; y += 14) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1024, y); ctx.stroke();
    }
    for (let y = 650; y < 990; y += 14) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1024, y); ctx.stroke();
    }
    // Dirt track along the middle (z = 0).
    ctx.fillStyle = '#b09268';
    ctx.fillRect(0, 470, 1024, 84);
    ctx.fillStyle = '#a37f52';
    ctx.fillRect(0, 470, 1024, 6);
    ctx.fillRect(0, 548, 1024, 6);
    ctx.strokeStyle = 'rgba(90, 66, 38, 0.45)';
    ctx.lineWidth = 2;
    for (let x = 0; x < 1024; x += 46) {
      ctx.beginPath(); ctx.moveTo(x, 512); ctx.lineTo(x + 22, 512); ctx.stroke();
    }
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
      g.rotation.set(pitch, heading, roll);
    }
    const spin = sim.wheelSpin;
    // Spin around the axle (local Z): rotating around X flipped the
    // wheel out of its plane like a coin.
    wheelMeshes.current.forEach((mesh) => {
      mesh.rotation.z = spin;
    });
    hubMeshes.current.forEach((mesh) => {
      mesh.rotation.z = spin;
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
    // Drift speed follows the wind: calm days barely move the clouds,
    // gale days push them visibly across the sky.
    const windFactor = 0.3 + weather.windKmh * 0.06;
    refs.current.forEach((mesh, i) => {
      if (!mesh) return;
      mesh.position.x += seeds[i].speed * windFactor * dt;
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
  const textures = useMemo(
    () => ({
      wheat: [cropTextureFor('wheat', 'A'), cropTextureFor('wheat', 'B')],
      rice: [cropTextureFor('rice', 'A'), cropTextureFor('rice', 'B')],
      corn: [cropTextureFor('corn', 'A'), cropTextureFor('corn', 'B')],
    }),
    [],
  );
  const wind = useMemo(
    () => ({ uTime: { value: 0 }, uSway: { value: 0.15 }, uWindDir: { value: new THREE.Vector2(0.7, 0.7) }, uSnow: { value: 0 } }),
    [],
  );
  // One crossed-plane geometry shared by all plots (X-shape, 1.3 m tall
  // at scale 1; per-instance scale sets the real crop height).
  const geometry = useMemo(() => {
    const a = new THREE.PlaneGeometry(0.62, 1.3, 1, 3);
    const b = new THREE.PlaneGeometry(0.62, 1.3, 1, 3);
    b.rotateY(Math.PI / 2);
    const merged = mergeGeometries([a, b]);
    a.dispose();
    b.dispose();
    if (!merged) throw new Error('crop geometry merge failed');
    return merged;
  }, []);
  const plots = useMemo(() => {
    let seed = 4242;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    return CROP_PLOTS.map((plot) => {
      const [minX, minZ, maxX, maxZ] = plot.bounds;
      const height = cropHeight(plot.crop, plot.stage);
      const list: { x: number; z: number; rot: number; s: number; h: number }[] = [];
      for (let z = minZ; z <= maxZ; z += plot.spacing[1]) {
        for (let x = minX; x <= maxX; x += plot.spacing[0]) {
          if (rand() < 0.06) continue; // sparse patches
          list.push({
            x: x + (rand() - 0.5) * 0.3,
            z: z + (rand() - 0.5) * 0.5,
            rot: rand() * Math.PI,
            s: 0.85 + rand() * 0.4,
            h: height * (0.85 + rand() * 0.3),
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
    plots.forEach((entry, pi) => {
      const mesh = meshRefs.current[pi];
      if (!mesh) return;
      entry.list.forEach((inst, i) => {
        dummy.position.set(inst.x, (inst.h / 2) * 0.92, inst.z);
        dummy.rotation.set(0, inst.rot, 0);
        dummy.scale.set(inst.s, inst.h / 1.3, inst.s);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.count = entry.full;
    });
  }, [plots]);
  useFrame(({ clock, camera }) => {
    wind.uTime.value = clock.elapsedTime;
    wind.uSway.value = weather.sway;
    wind.uSnow.value = snow.value;
    const rad = ((weather.windDeg - 90) * Math.PI) / 180;
    wind.uWindDir.value.set(Math.cos(rad), Math.sin(rad));
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
  const cropMaterial = (pi: number, texture: THREE.Texture) => (
    <meshStandardMaterial
      ref={(el) => {
        matRefs.current[pi] = el;
      }}
      map={texture}
      side={THREE.DoubleSide}
      roughness={0.9}
      alphaTest={0.35}
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
            float swayH = pow(clamp(position.y / 1.3 + 0.5, 0.0, 1.0), 2.0);
            float phase = uTime * 1.7 + float(instanceMatrix[3][0]) * 0.45 + float(instanceMatrix[3][2]) * 0.3;
            vec2 bend = uWindDir * (sin(phase) * uSway * 0.38 * swayH);
            transformed.x += bend.x;
            transformed.z += bend.y;
            // Snow load: the top bends down and sags toward the wind.
            transformed.y *= 1.0 - uSnow * 0.22 * swayH;
            transformed.x += uWindDir.x * uSnow * 0.12 * swayH;
            transformed.z += uWindDir.y * uSnow * 0.12 * swayH;
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
          args={[geometry, undefined, entry.list.length]}
          frustumCulled={false}
          castShadow={false}
          receiveShadow
        >
          {cropMaterial(pi, textures[entry.plot.crop][pi % 2])}
        </instancedMesh>
      ))}
    </group>
  );
}

function Treeline({ weather }: { weather: BlendedWeather }) {
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
        <group key={i} position={[t.x, 0, t.z]} scale={t.s}>
          <mesh position={[0, 1, 0]} castShadow>
            <cylinderGeometry args={[0.22, 0.3, 2, 8]} />
            <meshStandardMaterial color="#6b4a2f" roughness={0.9} />
          </mesh>
          <mesh
            position={[0, 3.4, 0]}
            castShadow
            ref={(el) => {
              canopies.current[i] = el;
            }}
          >
            <coneGeometry args={[1.9, 4.6, 10]} />
            <meshStandardMaterial color="#2e6b34" roughness={0.9} />
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
    const driving = sim.mode === 'drive' && Math.abs(sim.tractor.speed) > 1.2;
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

function CameraRig({ sim, weather, onPosition, onAutopilotArrived }: { sim: SimState; weather: BlendedWeather; onPosition: (x: number, z: number, speedKmh: number, mode: string) => void; onAutopilotArrived: (zoneId: ZoneId) => void }) {
  const { camera, gl } = useThree();
  const velocity = useRef({ x: 0, z: 0 });
  const lastReport = useRef(0);
  const rapierRef = useRef<RapierVehicle | null>(null);
  const rapierTried = useRef(false);
  // Follow-camera state: a smoothed look target (so Rapier pose jitter
  // does not shake the view) and the previous mode (to snap the camera
  // onto the follow pose the moment the user boards).
  const lookTarget = useRef(new THREE.Vector3(0, 1.2, 0));
  const prevMode = useRef(sim.mode);
  const prevSpeed = useRef(0);
  const sunRef = useRef<THREE.DirectionalLight>(null);
  const hemiRef = useRef<THREE.HemisphereLight>(null);

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
    // A stale fly-to must never shadow drive mode: entering drive while
    // a fly-to was still running used to leave sim.flyTo set, and the
    // fly-to branch above the drive branch then swallowed every frame —
    // the tractor ignored all input, the camera stayed at the zone, and
    // the HUD still said "driving". Drive mode never flies, so drop it.
    if (sim.mode === 'drive') sim.flyTo = null;
    // Camera smoothing must use the REAL frame time: with clampedDt a
    // low frame rate made the follow camera lag seconds behind the
    // tractor (it visibly lost the tractor), and fly-ins crawled.
    const camDt = Math.min(Math.max(dt, 0.0001), 0.1);
    sim.elapsed += clampedDt;
    sim.radarAngle += clampedDt * 0.9;
    sim.diagPhase = (sim.elapsed / 4) % 3;
    const keys = sim.keys;
    const joy = sim.joystick;

    // --- fly-to tween ---
    if (sim.flyTo) {
      const goal = sim.flyTo;
      const k = 1 - Math.exp(-camDt * 2.2);
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
      const { forward, strafe } = keysToWalkInput(keys, joy);
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
      if (sim.driveView === 'cabin') {
        camera.position.set(next.x + Math.sin(heading) * 0.35, 1.95 + terrainHeight(next.x, next.z), next.z - Math.cos(heading) * 0.35);
        camera.lookAt(next.x + Math.sin(heading) * 12, 1.6 + pitchLook, next.z - Math.cos(heading) * 12);
      } else {
        // Speed pulls the chase camera back and widens the FOV a touch;
        // turns swing it slightly outward; accel/brake pitch the view.
        const dist = 7.5 + Math.min(3.5, speedAbs * 0.45);
        const height = 3.4 + Math.min(0.6, speedAbs * 0.06);
        const lateral = -next.steer * Math.min(0.9, speedAbs * 0.12);
        const bx = next.x - Math.sin(heading) * dist + Math.cos(heading) * lateral;
        const bz = next.z + Math.cos(heading) * dist + Math.sin(heading) * lateral;
        const desired = new THREE.Vector3(bx, height, bz);
        // Snap onto the follow pose the moment the user boards (or the
        // camera is ever far away): lerping from the walk position used
        // to leave the tractor out of frame for seconds. Otherwise lerp
        // with the real frame time so the camera keeps up at any FPS.
        const enteredDrive = prevMode.current !== 'drive';
        if (enteredDrive || camera.position.distanceTo(desired) > 12) {
          camera.position.copy(desired);
          lookTarget.current.set(next.x, 1.2, next.z);
        } else {
          camera.position.lerp(desired, 1 - Math.exp(-camDt * 3.5));
        }
        // Smooth the look target too: looking straight at the live pose
        // while the camera lagged behind made the view whip and shake
        // whenever the tractor turned or the Rapier pose jittered.
        lookTarget.current.lerp(new THREE.Vector3(next.x, 1.2 + pitchLook, next.z), 1 - Math.exp(-camDt * 8));
        camera.lookAt(lookTarget.current);
        const persp = camera as THREE.PerspectiveCamera;
        const targetFov = 55 + Math.min(8, speedAbs * 0.9);
        if (Math.abs(persp.fov - targetFov) > 0.1) {
          persp.fov += (targetFov - persp.fov) * Math.min(1, camDt * 3);
          persp.updateProjectionMatrix();
        }
      }
      prevMode.current = sim.mode;
    }
    if (sim.mode !== 'drive') prevMode.current = sim.mode;
    // Ease the FOV back to 55° when leaving drive mode.
    if (sim.mode !== 'drive') {
      const persp = camera as THREE.PerspectiveCamera;
      if (Math.abs(persp.fov - 55) > 0.1) {
        persp.fov += (55 - persp.fov) * Math.min(1, camDt * 3);
        persp.updateProjectionMatrix();
      }
    }

    if (sunRef.current) sunRef.current.intensity = 1.6 * weather.sun;
    // Outdoor fill: grey/rainy days get extra sky fill (there is no
    // ceiling in the open field — the fill is sky light).
    if (hemiRef.current) hemiRef.current.intensity = 0.45 + weather.lamps * 0.35;
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
  const farmGroundTex = useMemo(() => groundTexture(), []);
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
      <CameraRig sim={sim} weather={weather} onPosition={onPosition} onAutopilotArrived={onAutopilotArrived} />
      <SkyDome weather={weather} />
      <Clouds weather={weather} />
      <Precipitation weather={weather} quality={quality} />
      <CropField weather={weather} quality={quality} snow={snow} />
      <Treeline weather={weather} />
      <Puddles weather={weather} />
      <DustPuffs sim={sim} weather={weather} />
      {/* Farm ground: textured soil/grass with furrows + dirt track. */}
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[140, 100]} />
        <meshStandardMaterial ref={groundMat} map={farmGroundTex} roughness={1} metalness={0} />
      </mesh>
      {/* Snow cover over the whole field (opacity ramps with
          accumulation) — one uniform sheet. */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} material={snowCoverMaterial}>
        <planeGeometry args={[140, 100]} />
      </mesh>
      <GuideLine />
      {/* Guide light strip along the track edges */}
      {[-3.2, 3.2].map((z) => (
        <mesh key={z} position={[0, 0.015, z]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[40, 0.08]} />
          <meshBasicMaterial color="#7ad7ff" transparent opacity={0.8} />
        </mesh>
      ))}
      {/* Dirt patch under the T70 */}
      <mesh position={[0, 0.008, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[4.2, 40]} />
        <meshStandardMaterial color="#a98f63" roughness={1} />
      </mesh>
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
          <N8AO aoRadius={1.4} distanceFalloff={1} intensity={1.1} />
          <Bloom intensity={0.35} luminanceThreshold={0.85} luminanceSmoothing={0.2} mipmapBlur />
          {/* Snow softens the depth of field (bokeh 1.4 → 0.2 as snow
              builds): at full strength the flakes 20–40 m out were
              blurred to nothing, so a snow scene showed no falling
              snow at all. Other weathers keep bokeh 1.4 (snow = 0). */}
          <DepthOfField worldFocusDistance={9} worldFocusRange={7} bokehScale={1.4 - weather.snow * 1.2} />
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

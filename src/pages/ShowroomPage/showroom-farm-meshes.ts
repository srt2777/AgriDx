import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CROP_PLOTS, terrainHeight, type CropPlot } from './showroom-data';

export const GROUND_WIDTH = 140;
export const GROUND_DEPTH = 100;

export function farmGroundGeometry(): THREE.PlaneGeometry {
  const geometry = new THREE.PlaneGeometry(GROUND_WIDTH, GROUND_DEPTH, 140, 100);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    positions.setY(i, terrainHeight(positions.getX(i), positions.getZ(i)));
  }
  geometry.computeVertexNormals();
  return geometry;
}

export function paintFarmGround(ctx: CanvasRenderingContext2D) {
  const { width, height } = ctx.canvas;
  const px = (x: number) => (x / GROUND_WIDTH + 0.5) * width;
  const py = (z: number) => (z / GROUND_DEPTH + 0.5) * height;
  const image = ctx.createImageData(width, height);
  let seed = 1251;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let j = 0; j < height; j++) {
    const z = (j / height - 0.5) * GROUND_DEPTH;
    for (let i = 0; i < width; i++) {
      const x = (i / width - 0.5) * GROUND_WIDTH;
      const edge = 3.15 + 0.16 * Math.sin(x * 0.85) + 0.12 * Math.cos(x * 2.9);
      const road = Math.max(0, Math.min(1, (edge - Math.abs(z)) * 3));
      const track = Math.exp(-((Math.abs(z) - 0.97) ** 2) / 0.14);
      const broad = Math.sin(x * 0.36 + z * 0.22) * 5 + Math.cos(x * 0.93 - z * 0.65) * 3;
      const grit = (random() - 0.5) * 30 + broad;
      const at = (j * width + i) * 4;
      image.data[at] = 99 + road * (61 - track * 17) + grit;
      image.data[at + 1] = 125 + road * (0 - track * 13) + grit;
      image.data[at + 2] = 62 + road * (26 - track * 12) + grit * 0.7;
      image.data[at + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  for (const plot of CROP_PLOTS) {
    const [minX, minZ, maxX, maxZ] = plot.bounds;
    const rice = plot.crop === 'rice';
    const left = px(minX - 0.5);
    const top = py(minZ - 0.45);
    const w = px(maxX + 0.5) - left;
    const h = py(maxZ + 0.45) - top;
    ctx.fillStyle = rice ? 'rgba(52, 67, 49, 0.72)' : 'rgba(108, 76, 49, 0.78)';
    ctx.fillRect(left, top, w, h);
    for (let z = minZ; z <= maxZ; z += plot.spacing[1]) {
      const y = py(z);
      const ridge = ctx.createLinearGradient(0, y - 6, 0, y + 7);
      ridge.addColorStop(0, 'rgba(30, 26, 18, 0)');
      ridge.addColorStop(0.27, rice ? 'rgba(167, 183, 131, 0.42)' : 'rgba(187, 145, 101, 0.59)');
      ridge.addColorStop(0.65, 'rgba(44, 32, 20, 0.64)');
      ridge.addColorStop(1, 'rgba(30, 26, 18, 0)');
      ctx.fillStyle = ridge;
      ctx.fillRect(left, y - 6, w, 13);
    }
    for (let i = 0; i < 1700; i++) {
      ctx.fillStyle = random() > 0.6 ? 'rgba(231, 210, 160, 0.24)' : 'rgba(46, 36, 22, 0.22)';
      ctx.fillRect(left + random() * w, top + random() * h, 0.5 + random() * 3, 1 + random() * 2);
    }
  }
  for (let i = 0; i < 1700; i++) {
    const z = (random() - 0.5) * 6;
    ctx.fillStyle = random() > 0.5 ? 'rgba(238, 209, 158, 0.35)' : 'rgba(76, 52, 32, 0.27)';
    ctx.fillRect(random() * width, py(z), 0.6 + random() * 3.5, 0.6 + random() * 2);
  }
}

// A plant has a unit height so the same mesh can be scaled per instance.
export function cropGeometry(plot: CropPlot): THREE.BufferGeometry {
  const pieces: THREE.BufferGeometry[] = [];
  const add = (source: THREE.BufferGeometry, color: string) => {
    const geometry = source.index ? source.toNonIndexed() : source;
    geometry.deleteAttribute('uv');
    const value = new THREE.Color(color);
    const count = geometry.attributes.position.count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) value.toArray(colors, i * 3);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    pieces.push(geometry);
    if (geometry !== source) source.dispose();
  };
  const stem = (from: THREE.Vector3, to: THREE.Vector3, radius: number, color: string) => {
    const axis = to.clone().sub(from);
    const cylinder = new THREE.CylinderGeometry(radius * 0.56, radius, axis.length(), 5);
    cylinder.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize()));
    const center = from.clone().lerp(to, 0.5);
    cylinder.translate(center.x, center.y, center.z);
    add(cylinder, color);
  };
  const grain = (x: number, y: number, z: number, width: number, height: number, color: string) => {
    const geometry = new THREE.IcosahedronGeometry(1, 0);
    geometry.scale(width, height, width);
    geometry.translate(x, y, z);
    add(geometry, color);
  };
  const leaf = (x: number, y: number, z: number, angle: number, length: number, rise: number, width: number, color: string) => {
    const positions: number[] = [];
    const indices: number[] = [];
    const dx = Math.cos(angle), dz = Math.sin(angle);
    const segments = 5;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const spread = Math.max(0.02, Math.sin(Math.PI * t) ** 0.8) * width;
      const tipX = x + dx * length * t;
      const tipZ = z + dz * length * t;
      const tipY = y + rise * t + length * 0.62 * Math.sin(Math.PI * t);
      positions.push(tipX - dz * spread, tipY - spread * 0.27, tipZ + dx * spread,
        tipX, tipY + spread * 0.24, tipZ,
        tipX + dz * spread, tipY - spread * 0.27, tipZ - dx * spread);
      if (i < segments) {
        const a = i * 3;
        indices.push(a, a + 3, a + 1, a + 1, a + 3, a + 4,
          a + 1, a + 4, a + 2, a + 2, a + 4, a + 5);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    add(geometry, color);
  };

  if (plot.crop === 'corn') {
    stem(new THREE.Vector3(), new THREE.Vector3(0.02, 0.93, 0), 0.024, '#788e39');
    for (let i = 0; i < 7; i++) {
      leaf(0, 0.14 + i * 0.108, 0, i * 2.39, 0.35 - i * 0.022, -0.08, 0.068 - i * 0.004,
        i % 2 ? '#537a29' : '#65913a');
    }
    if (plot.stage >= 0.8) {
      grain(0.055, 0.56, 0, 0.047, 0.112, '#9eaa4b');
      grain(0.075, 0.665, 0.005, 0.024, 0.028, '#a9814a');
      for (let i = -2; i <= 2; i++) {
        stem(new THREE.Vector3(0.02, 0.91, 0), new THREE.Vector3(0.02 + i * 0.033, 1 - Math.abs(i) * 0.013, i * 0.008), 0.007, '#cfb779');
      }
    }
  } else {
    const rice = plot.crop === 'rice';
    const stems = rice ? 4 : 3;
    for (let i = 0; i < stems; i++) {
      const angle = i * 2.39;
      const x = Math.cos(angle) * 0.095, z = Math.sin(angle) * 0.095;
      const y = 0.87 - i * 0.055;
      stem(new THREE.Vector3(), new THREE.Vector3(x, y, z), rice ? 0.009 : 0.013, '#829345');
      for (let j = 0; j < 3; j++) {
        leaf(x * j * 0.24, 0.13 + j * 0.18, z * j * 0.24, angle + j * 1.7,
          rice ? 0.31 : 0.24, rice ? 0.23 : 0.17, rice ? 0.026 : 0.027,
          j % 2 ? '#75973b' : '#5b8431');
      }
      if (rice && plot.stage >= 0.6) {
        const tip = new THREE.Vector3(x + Math.cos(angle) * 0.16, y - 0.035, z + Math.sin(angle) * 0.16);
        const bend = new THREE.Vector3(x + Math.cos(angle) * 0.045, y + 0.072, z + Math.sin(angle) * 0.045);
        stem(new THREE.Vector3(x, y, z), bend, 0.008, '#a2a650');
        stem(bend, tip, 0.007, '#b0ad64');
        for (let k = 1; k <= 4; k++) {
          const point = bend.clone().lerp(tip, k / 4);
          grain(point.x, point.y - 0.016, point.z, 0.014, 0.031, '#bfba66');
        }
      } else if (!rice && plot.stage >= 0.7) {
        for (let k = 0; k < 4; k++) {
          const sign = k % 2 ? -1 : 1;
          grain(x + sign * 0.014, y + k * 0.025, z, 0.029, 0.036, k % 2 ? '#c9a458' : '#d7b66d');
        }
        stem(new THREE.Vector3(x, y + 0.05, z), new THREE.Vector3(x + 0.014, y + 0.17, z), 0.004, '#dfc783');
      }
    }
  }
  const result = mergeGeometries(pieces);
  pieces.forEach((piece) => piece.dispose());
  if (!result) throw new Error('Could not build crop geometry');
  return result;
}

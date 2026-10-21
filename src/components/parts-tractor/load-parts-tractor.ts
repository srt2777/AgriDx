import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import * as THREE from 'three';
import { catalogByName, type CatalogPart } from './parts-catalog';

export type CatalogLookup = (name: string) => { node: CatalogPart } | null;

export type PartRecord = {
  name: string;
  labelZh: string;
  partId: string;
  object: THREE.Object3D;
  base: THREE.Vector3;
  dir: THREE.Vector3;
  slots: MaterialSlot[];
  edges: THREE.LineSegments[];
};

type MaterialSlot = {
  material: THREE.Material;
  paint: THREE.MeshStandardMaterial | null;
  color: THREE.Color | null;
  emissive: THREE.Color | null;
  opacity: number;
  transparent: boolean;
  depthWrite: boolean;
  emissiveIntensity: number;
};

export type PreparedTractor = {
  root: THREE.Group;
  records: PartRecord[];
  dispose: () => void;
};

function makeEdgeMaterial() {
  return new THREE.LineBasicMaterial({ color: 0x7ad7ff, transparent: true, opacity: 0.95 });
}

function asVec3(value: unknown, fallback: [number, number, number]): [number, number, number] {
  if (!Array.isArray(value) || value.length < 3) return fallback;
  const next = [Number(value[0]), Number(value[1]), Number(value[2])];
  return next.every(Number.isFinite) ? [next[0], next[1], next[2]] : fallback;
}

function hasPartChild(object: THREE.Object3D): boolean {
  for (const child of object.children) {
    if (typeof child.userData?.part_id === 'string') return true;
    if (hasPartChild(child)) return true;
  }
  return false;
}

function slotFor(material: THREE.Material): MaterialSlot {
  const paint = (material as THREE.MeshStandardMaterial).isMeshStandardMaterial
    ? material as THREE.MeshStandardMaterial
    : null;
  return {
    material,
    paint,
    color: paint ? paint.color.clone() : null,
    emissive: paint ? paint.emissive.clone() : null,
    opacity: material.opacity,
    transparent: material.transparent,
    depthWrite: material.depthWrite,
    emissiveIntensity: paint ? paint.emissiveIntensity : 0,
  };
}

function prepareMesh(mesh: THREE.Mesh, originals: Set<THREE.Material>, edgesMaterial: THREE.Material): THREE.LineSegments | null {
  if (!mesh.geometry) return null;
  const source = mesh.material;
  const list = (Array.isArray(source) ? source : [source]).filter(Boolean);
  const clones = list.map(material => {
    originals.add(material);
    const clone = material.clone();
    // Hunyuan part splits wrote COLOR_0 over the photo albedo. Clones ignore vertex
    // colors so a returning attribute cannot repaint the shell; the texture stays in front.
    const paint = clone as THREE.MeshStandardMaterial;
    if (paint.isMeshStandardMaterial) paint.vertexColors = false;
    return clone;
  });
  mesh.material = Array.isArray(source) ? clones : clones[0];
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 28), edgesMaterial);
  edges.visible = false;
  edges.raycast = () => undefined;
  mesh.add(edges);
  return edges;
}

export function preparePartsRoot(root: THREE.Group, lookup: CatalogLookup = name => catalogByName(name)): PreparedTractor {
  const originals = new Set<THREE.Material>();
  const edgesMaterial = makeEdgeMaterial();
  const records: PartRecord[] = [];
  root.traverse(object => {
    const partId = object.userData?.part_id;
    if (typeof partId !== 'string' || hasPartChild(object)) return;
    const catalog = lookup(object.name);
    const dir = asVec3(object.userData.explode_dir, catalog?.node.explodeDir ?? [0, 0, 0]);
    const slots: MaterialSlot[] = [];
    const edges: THREE.LineSegments[] = [];
    object.traverse(child => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const line = prepareMesh(mesh, originals, edgesMaterial);
      if (line) edges.push(line);
      const mats = mesh.material;
      for (const material of (Array.isArray(mats) ? mats : [mats])) slots.push(slotFor(material));
    });
    records.push({
      name: object.name || partId,
      labelZh: typeof object.userData.label_zh === 'string' ? object.userData.label_zh : (catalog?.node.labelZh ?? partId),
      partId,
      object,
      base: object.position.clone(),
      dir: new THREE.Vector3(dir[0], dir[1], dir[2]),
      slots,
      edges,
    });
  });

  const dispose = () => {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>(originals);
    const textures = new Set<THREE.Texture>();
    root.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) geometries.add(mesh.geometry);
      const mats = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
      for (const material of mats) {
        if (!material) continue;
        materials.add(material);
        for (const value of Object.values(material)) {
          if (value && (value as THREE.Texture).isTexture) textures.add(value as THREE.Texture);
        }
      }
    });
    materials.add(edgesMaterial);
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
  };

  return { root, records, dispose };
}

/**
 * Meshopt-compressed GLB with WebP images and KHR_mesh_quantization.
 * GLTFLoader decodes EXT_texture_webp through the browser image decoder.
 * Node scale stays as exported; it undoes the quantization, so positions move in parent metres.
 * Honghu T70 uses the same rule: explode adds explode_dir to the node position and leaves scale alone.
 */
export async function loadPartsTractor(url: string, lookup?: CatalogLookup): Promise<PreparedTractor> {
  if (!MeshoptDecoder.supported) throw new Error('Meshopt decoder is unavailable');
  await MeshoptDecoder.ready;
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(url);
  return preparePartsRoot(gltf.scene, lookup ?? (name => catalogByName(name)));
}

export function partOwner(object: THREE.Object3D | null): THREE.Object3D | null {
  let current = object;
  while (current) {
    if (typeof current.userData?.part_id === 'string') return current;
    current = current.parent;
  }
  return null;
}

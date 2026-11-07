// Replace the lettering on the published diesel model while retaining its
// original mesh, texture data, nodes, metadata and Meshopt-compressed buffers.
// Usage: node tools/blender/update-tractor-brand.mjs original.glb decals.json output.glb
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const [input, decalFile, output] = process.argv.slice(2);
if (!input || !decalFile || !output || input === output) throw new Error('Pass distinct input, decal JSON, and output paths');
const bytes = fs.readFileSync(input);
const hash = createHash('sha256').update(bytes).digest('hex');
if (hash !== 'bf67a8ab275fa7622d595a128c2ed08bfacffc3a2b42304c0ba2bde981685131') {
  throw new Error('This targeted edit only applies to the verified original tractor model');
}
if (bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2) throw new Error('Expected glTF 2 GLB');
const jsonLength = bytes.readUInt32LE(12);
const model = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
const binOffset = 28 + jsonLength;
const originalBin = bytes.subarray(binOffset, binOffset + bytes.readUInt32LE(20 + jsonLength));
const hood = model.nodes.find(node => node.name === 'engine_hood');
const mesh = model.meshes[hood?.mesh];
const yellow = mesh?.primitives.find(primitive => model.materials[primitive.material]?.name === 'decal_yellow');
const whiteIndex = mesh?.primitives.findIndex(primitive => model.materials[primitive.material]?.name === 'decal_white');
if (!hood || !yellow || whiteIndex < 0 || !hood.translation || !hood.scale) throw new Error('Expected hood and decal materials');
await MeshoptDecoder.ready;

function decodeAccessor(index) {
  const accessor = model.accessors[index];
  const view = model.bufferViews[accessor.bufferView];
  const extension = view.extensions?.EXT_meshopt_compression;
  if (!extension || extension.buffer !== 0) throw new Error('Expected compressed original decal data');
  const decoded = new Uint8Array(extension.count * extension.byteStride);
  MeshoptDecoder.decodeGltfBuffer(decoded, extension.count, extension.byteStride,
    originalBin.subarray(extension.byteOffset, extension.byteOffset + extension.byteLength), extension.mode, extension.filter);
  return { accessor, extension, view: new DataView(decoded.buffer, decoded.byteOffset, decoded.byteLength) };
}

const positions = decodeAccessor(yellow.attributes.POSITION);
const indices = decodeAccessor(yellow.indices);
if (positions.accessor.componentType !== 5122 || indices.accessor.componentType !== 5123) throw new Error('Unexpected model encoding');
const retained = [];
for (let i = 0; i < indices.accessor.count; i += 3) {
  const triangle = [0, 1, 2].map(offset => indices.view.getUint16((i + offset) * indices.extension.byteStride + (indices.accessor.byteOffset ?? 0), true));
  const meanHeight = triangle.reduce((sum, vertex) => {
    const y = positions.view.getInt16(vertex * positions.extension.byteStride + (positions.accessor.byteOffset ?? 0) + 2, true) / 32767;
    return sum + y * hood.scale[1] + hood.translation[1];
  }, 0) / 3;
  // Both yellow stripes lie above 1.30 m; the old yellow lettering lies below.
  if (meanHeight > 1.30) retained.push(...triangle);
}
if (retained.length !== 1296 || indices.accessor.count !== 15024) throw new Error('Unexpected stripe/letter geometry');
const chunks = [originalBin];
let binLength = originalBin.length;
function append(data, target) {
  const padding = (4 - binLength % 4) % 4;
  if (padding) { chunks.push(Buffer.alloc(padding)); binLength += padding; }
  const view = model.bufferViews.push({ buffer: 0, byteOffset: binLength, byteLength: data.length, target }) - 1;
  chunks.push(data); binLength += data.length;
  return view;
}
function addAccessor(data, componentType, type, count, target, bounds = {}) {
  return model.accessors.push({ bufferView: append(data, target), byteOffset: 0, componentType, count, type, ...bounds }) - 1;
}
const stripeData = Buffer.alloc(retained.length * 2);
retained.forEach((index, i) => stripeData.writeUInt16LE(index, i * 2));
yellow.indices = addAccessor(stripeData, 5123, 'SCALAR', retained.length, 34963);
mesh.primitives.splice(whiteIndex, 1);

function addLettering(geometry, materialName) {
  const { positions: p, normals: n } = geometry;
  if (p.length !== n.length || p.length % 9 || !p.length) throw new Error('Invalid triangle data');
  const unique = new Map(), vertices = [], normals = [], idx = [];
  for (let i = 0; i < p.length; i += 3) {
    const vals = [...p.slice(i, i + 3), ...n.slice(i, i + 3)].map(Math.fround);
    const key = vals.join(',');
    let index = unique.get(key);
    if (index === undefined) {
      index = vertices.length / 3; unique.set(key, index);
      vertices.push(...vals.slice(0, 3)); normals.push(...vals.slice(3));
    }
    idx.push(index);
  }
  if (vertices.length / 3 >= 65536) throw new Error('Text geometry exceeds 16-bit indices');
  const pbuf = Buffer.alloc(vertices.length * 4), nbuf = Buffer.alloc(normals.length * 4), ibuf = Buffer.alloc(idx.length * 2);
  vertices.forEach((v, i) => pbuf.writeFloatLE(v, i * 4));
  normals.forEach((v, i) => nbuf.writeFloatLE(v, i * 4));
  idx.forEach((v, i) => ibuf.writeUInt16LE(v, i * 2));
  const min = [0, 1, 2].map(axis => Math.min(...vertices.filter((_, i) => i % 3 === axis)));
  const max = [0, 1, 2].map(axis => Math.max(...vertices.filter((_, i) => i % 3 === axis)));
  const material = model.materials.findIndex(m => m.name === materialName);
  if (material < 0) throw new Error('Missing material '+materialName);
  mesh.primitives.push({ attributes: {
    POSITION: addAccessor(pbuf, 5126, 'VEC3', vertices.length / 3, 34962, { min, max }),
    NORMAL: addAccessor(nbuf, 5126, 'VEC3', normals.length / 3, 34962),
  }, indices: addAccessor(ibuf, 5123, 'SCALAR', idx.length, 34963), material, mode: 4 });
}
const decals = JSON.parse(fs.readFileSync(decalFile, 'utf8'));
addLettering(decals.yellow, 'decal_yellow');
addLettering(decals.white, 'decal_white');
const pad = (4 - binLength % 4) % 4;
if (pad) { chunks.push(Buffer.alloc(pad)); binLength += pad; }
model.buffers[0].byteLength = binLength;
const json = Buffer.from(JSON.stringify(model));
const jsonPad = (4 - json.length % 4) % 4;
const jsonChunk = Buffer.concat([json, Buffer.alloc(jsonPad, 0x20)]);
const header = Buffer.alloc(20), binHeader = Buffer.alloc(8);
header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binLength, 8);
header.writeUInt32LE(jsonChunk.length, 12); header.write('JSON', 16);
binHeader.writeUInt32LE(binLength, 0); binHeader.writeUInt32LE(0x004e4942, 4);
fs.writeFileSync(output, Buffer.concat([header, jsonChunk, binHeader, ...chunks]));
console.log(`Replaced hood lettering; preserved ${retained.length / 3} stripe triangles and all non-decal model data.`);

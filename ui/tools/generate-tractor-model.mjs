import fs from 'node:fs/promises';
import * as T from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Original schematic model, generated locally. It does not represent a documented machine.
const scene = new T.Scene();
scene.name = 'AgriDx schematic tractor';
scene.userData = { schematic: true, creator: 'AgriDx-v2', source: 'ui/tools/generate-tractor-model.mjs' };
const parts = Object.fromEntries(['body', 'engine', 'drivetrain', 'hydraulics', 'electrical', 'wheels', 'cab'].map(id => {
  const group = new T.Group();
  group.name = id;
  group.userData.component = id;
  scene.add(group);
  return [id, group];
}));
const mat = {
  green: new T.MeshStandardMaterial({ color: '#27694b', roughness: .32, metalness: .35 }),
  lightGreen: new T.MeshStandardMaterial({ color: '#5e8d65', roughness: .42, metalness: .28 }),
  black: new T.MeshStandardMaterial({ color: '#17201e', roughness: .7, metalness: .15 }),
  rubber: new T.MeshStandardMaterial({ color: '#242827', roughness: .94 }),
  tread: new T.MeshStandardMaterial({ color: '#343937', roughness: .95 }),
  steel: new T.MeshStandardMaterial({ color: '#818d88', roughness: .35, metalness: .8 }),
  hub: new T.MeshStandardMaterial({ color: '#dce3d6', roughness: .35, metalness: .5 }),
  bronze: new T.MeshStandardMaterial({ color: '#b99a60', roughness: .36, metalness: .65 }),
  glass: new T.MeshStandardMaterial({ color: '#8ba6a0', roughness: .12, metalness: .15, transparent: true, opacity: .26, depthWrite: false, side: T.DoubleSide }),
  lamp: new T.MeshStandardMaterial({ color: '#f4efd4', roughness: .16, emissive: '#d5cca2', emissiveIntensity: .24 }),
  red: new T.MeshStandardMaterial({ color: '#b74533', roughness: .25, metalness: .25 }),
};
for (const [name, material] of Object.entries(mat)) material.name = name;
function mesh(part, geometry, material, position, rotation = [0, 0, 0]) {
  const obj = new T.Mesh(geometry, material);
  obj.position.set(...position);
  obj.rotation.set(...rotation);
  parts[part].add(obj);
  return obj;
}
function box(part, size, position, material = mat.black, radius = .035, rotation) {
  return mesh(part, radius ? new RoundedBoxGeometry(...size, 2, Math.min(radius, ...size.map(n => n / 3))) : new T.BoxGeometry(...size), material, position, rotation);
}
function cylinder(part, radius, height, position, material = mat.steel, rotation = [0, 0, Math.PI / 2], segments = 20) {
  return mesh(part, new T.CylinderGeometry(radius, radius, height, segments), material, position, rotation);
}
function rod(part, from, to, radius = .035, material = mat.steel) {
  const a = new T.Vector3(...from), b = new T.Vector3(...to);
  const obj = mesh(part, new T.CylinderGeometry(radius, radius, a.distanceTo(b), 12), material, a.clone().add(b).multiplyScalar(.5).toArray());
  obj.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), b.sub(a).normalize());
}

// Frame, engine, transmission and front axle.
box('drivetrain', [3.45, .24, .66], [-.05, .8, 0]);
box('engine', [1.24, .64, .71], [-1.12, 1.12, 0], mat.steel);
for (let i = 0; i < 7; i++) box('engine', [.045, .52, .76], [-1.62 + i * .17, 1.13, 0], mat.black, .012);
cylinder('engine', .14, .65, [-.78, 1.05, .45], mat.bronze);
box('drivetrain', [.76, .55, .62], [.35, .99, 0], mat.black);
cylinder('drivetrain', .12, 1.65, [1.03, .93, 0], mat.steel, [Math.PI / 2, 0, 0]);
cylinder('drivetrain', .09, 1.42, [-1.42, .65, 0], mat.steel, [Math.PI / 2, 0, 0]);
rod('drivetrain', [-1.55, .61, -.68], [-1.31, .61, .68], .032, mat.bronze);

// Sculpted hood, grille, fenders and cabin.
box('body', [1.65, .58, .99], [-1.2, 1.62, 0], mat.green, .12);
box('body', [1.46, .10, 1.02], [-1.26, 1.91, 0], mat.lightGreen, .035);
box('body', [.13, .52, .85], [-2.04, 1.6, 0], mat.black);
for (let i = 0; i < 13; i++) box('body', [.026, .35, .018], [-2.12, 1.58, -.35 + i * .058], mat.steel, .003);
box('body', [.24, .23, 1.15], [-2.2, 1.09, 0], mat.black);
for (const z of [-.4, .4]) {
  box('electrical', [.11, .17, .19], [-2.12, 1.79, z], mat.lamp);
  box('body', [1.35, .12, .52], [1.02, 1.94, z < 0 ? -1.02 : 1.02], mat.green);
  box('body', [.14, .28, .48], [1.66, 1.81, z < 0 ? -1.02 : 1.02], mat.green);
  box('electrical', [.055, .12, .13], [1.77, 1.86, z < 0 ? -1.02 : 1.02], mat.red);
}
box('cab', [1.31, .12, 1.10], [.46, 1.4, 0], mat.black);
box('cab', [1.43, .15, 1.31], [.46, 2.97, 0], mat.green);
box('cab', [1.34, .055, 1.22], [.46, 3.06, 0], mat.lightGreen);
for (const x of [-.17, 1.09]) for (const z of [-.55, .55]) {
  rod('cab', [x, 1.45, z], [x + (x < 0 ? .09 : -.02), 2.92, z], .043, mat.black);
}
for (const z of [-.565, .565]) {
  box('cab', [1.17, 1.33, .025], [.49, 2.23, z], mat.glass, 0);
  rod('cab', [.47, 1.47, z], [.47, 2.93, z], .025, mat.black);
  box('cab', [.16, .028, .028], [.68, 2.02, z * 1.065], mat.steel, .005);
  rod('cab', [-.07, 2.67, z], [-.27, 2.7, z * 1.6], .022);
  box('cab', [.09, .18, .07], [-.27, 2.67, z * 1.6], mat.black);
}
box('cab', [.025, 1.25, 1.06], [-.10, 2.24, 0], mat.glass, 0, [0, 0, -.055]);
box('cab', [.025, 1.25, 1.06], [1.09, 2.24, 0], mat.glass, 0);
rod('cab', [-.17, 2.05, .10], [-.19, 2.58, .18], .012, mat.black);
box('cab', [.47, .13, .5], [.62, 1.75, 0], mat.black);
box('cab', [.12, .56, .53], [.88, 1.99, 0], mat.black, .055, [0, 0, -.10]);
rod('cab', [.03, 1.62, 0], [-.10, 2.08, 0], .035);
mesh('cab', new T.TorusGeometry(.19, .018, 8, 24), mat.black, [-.1, 2.11, 0], [Math.PI / 2 - .35, 0, 0]);
box('electrical', [.32, .12, .5], [-.07, 1.97, 0], mat.black);
for (const z of [-.48, .48]) box('electrical', [.12, .065, .13], [-.1, 2.98, z], mat.lamp);

// Exhaust, access steps, fuel cap, hydraulic links and rear implement hitch.
cylinder('engine', .061, 1.18, [-.52, 2.08, .43], mat.black, [0, 0, 0]);
cylinder('engine', .084, .42, [-.52, 1.88, .43], mat.steel, [0, 0, 0]);
box('engine', [.19, .055, .14], [-.47, 2.7, .43], mat.black);
cylinder('body', .058, .046, [-.35, 1.96, -.31], mat.black, [0, 0, 0]);
for (const sign of [-1, 1]) {
  box('body', [.44, .065, .25], [.0, .82, sign * .67], mat.steel);
  box('body', [.38, .065, .22], [.03, 1.1, sign * .59], mat.steel);
  rod('body', [-.08, .77, sign * .58], [-.08, 1.37, sign * .58], .025, mat.black);
  rod('hydraulics', [1.2, .82, sign * .24], [2.17, .50, sign * .51], .052, mat.black);
  rod('hydraulics', [1.48, 1.25, sign * .22], [1.87, .61, sign * .42], .043, mat.steel);
  cylinder('hydraulics', .061, .10, [2.17, .5, sign * .51], mat.steel, [Math.PI / 2, 0, 0]);
}
rod('hydraulics', [1.27, 1.31, 0], [2.12, .98, 0], .035, mat.bronze);
box('hydraulics', [.16, .24, .49], [1.49, 1.23, 0], mat.black);
for (const z of [-.13, 0, .13]) cylinder('hydraulics', .034, .08, [1.59, 1.23, z], mat.bronze);

for (const [x, y, r, width, span] of [[1.03, 1.0, .92, .43, 1.05], [-1.43, .69, .64, .33, .87]]) {
  for (const sign of [-1, 1]) {
    const z = sign * span;
    cylinder('wheels', r, width, [x, y, z], mat.rubber, [Math.PI / 2, 0, 0], 48);
    mesh('wheels', new T.TorusGeometry(r * .69, r * .31, 10, 40), mat.rubber, [x, y, z]);
    for (let i = 0; i < 26; i++) {
      const angle = i / 26 * Math.PI * 2;
      for (const half of [-1, 1]) {
        box('wheels', [r * .25, .065, width * .59], [x + Math.cos(angle) * (r + .018), y + Math.sin(angle) * (r + .018), z + half * width * .17], mat.tread, 0, [0, half * .40, angle - Math.PI / 2]);
      }
    }
    cylinder('wheels', r * .52, width + .015, [x, y, z], mat.hub, [Math.PI / 2, 0, 0], 32);
    cylinder('wheels', r * .19, width + .06, [x, y, z], mat.steel, [Math.PI / 2, 0, 0]);
    for (let i = 0; i < 8; i++) {
      const angle = i / 8 * Math.PI * 2;
      cylinder('wheels', .022, .03, [x + Math.cos(angle) * r * .29, y + Math.sin(angle) * r * .29, z + sign * (width / 2 + .018)], mat.steel, [Math.PI / 2, 0, 0], 8);
    }
  }
}

// Merge geometry per component/material: fine details without hundreds of draw calls.
scene.updateMatrixWorld(true);
let triangles = 0, meshes = 0;
for (const group of Object.values(parts)) {
  const buckets = new Map();
  for (const obj of [...group.children]) {
    const key = obj.material.name;
    if (!buckets.has(key)) buckets.set(key, { material: obj.material, geometries: [] });
    const geometry = obj.geometry.index ? obj.geometry.toNonIndexed() : obj.geometry.clone();
    geometry.deleteAttribute('uv');
    geometry.applyMatrix4(obj.matrixWorld);
    buckets.get(key).geometries.push(geometry);
    group.remove(obj);
    obj.geometry.dispose();
  }
  for (const { material, geometries } of buckets.values()) {
    const combined = mergeGeometries(geometries);
    const geometry = mergeVertices(combined);
    combined.dispose();
    const obj = new T.Mesh(geometry, material);
    obj.name = `${group.name}-${material.name}`;
    group.add(obj);
    triangles += (geometry.index?.count ?? geometry.attributes.position.count) / 3;
    meshes++;
    geometries.forEach(geometry => geometry.dispose());
  }
}
globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.(); }); }
  readAsDataURL(blob) { blob.arrayBuffer().then(result => { this.result = `data:${blob.type};base64,${Buffer.from(result).toString('base64')}`; this.onloadend?.(); }); }
};
const buffer = await new GLTFExporter().parseAsync(scene, { binary: true, onlyVisible: true });
await fs.mkdir('ui/public/models', { recursive: true });
await fs.writeFile('ui/public/models/tractor-detailed-v1.glb', Buffer.from(buffer));
await fs.writeFile('ui/public/models/tractor-detailed-v1.json', JSON.stringify({ name: 'AgriDx schematic tractor', schematic: true, generator: 'ui/tools/generate-tractor-model.mjs', components: Object.keys(parts), meshes, triangles, bytes: buffer.byteLength }, null, 2) + '\n');
console.log(JSON.stringify({ file: 'ui/public/models/tractor-detailed-v1.glb', bytes: buffer.byteLength, triangles, meshes }));

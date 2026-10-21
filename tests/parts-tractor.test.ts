import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as THREE from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { catalogByName, catalogParts, hoverLabel, partTitle, selectionForPart, type CatalogPart } from '../src/components/parts-tractor/parts-catalog';
import { faultList, partExample } from '../src/components/parts-tractor/part-faults';
import { preparePartsRoot } from '../src/components/parts-tractor/load-parts-tractor';
import { DEFAULT_PARTS_MODEL, orderedParts } from '../src/components/parts-tractor/parts-models';
import { explodedPosition, partVisual, smoothstep, visualSets } from '../src/components/parts-tractor/parts-motion';

test('部件表里的组和子件使用各自的爆炸方向', () => {
  assert.equal(catalogParts().length, 23);
  for (const name of ['fenders', 'headlights'] as const) {
    const group = catalogByName(name);
    assert.ok(group);
    assert.equal(group.node.group, true);
    assert.ok(group.node.children.length >= 2);
    for (const child of group.node.children) {
      assert.equal(child.partId, name);
      assert.equal(child.explodeDir.length, 3);
      assert.notDeepEqual(child.explodeDir, [0, 0, 0]);
    }
  }
  assert.equal(selectionForPart('fenders'), 'group:fenders');
  assert.equal(selectionForPart('engine'), 'engine');
});

test('爆炸位移在两端贴合，中间按平滑步进', () => {
  assert.deepEqual(explodedPosition([1, 2, 3], [0, 4, -1], 0), [1, 2, 3]);
  assert.deepEqual(explodedPosition([1, 2, 3], [0, 4, -1], 1), [1, 6, 2]);
  const quarter = explodedPosition([0, 0, 0], [1, 0, 0], 0.25);
  assert.equal(smoothstep(0.25), 0.15625);
  assert.ok(quarter[0] < 0.25);
  assert.equal(quarter[0], 0.15625);
});

test('故障模式让内部件脉冲，外壳变成淡透视', () => {
  const engine = partVisual({ partId: 'engine', selected: true, hovered: false, hasSelection: true, presentation: 'solid', faultPartId: 'engine' });
  assert.equal(engine.pulse, true);
  assert.equal(engine.opacity, 1);
  const hood = partVisual({ partId: 'engine_hood', selected: false, hovered: false, hasSelection: true, presentation: 'solid', faultPartId: 'engine' });
  assert.equal(hood.opacity, 0.15);
  assert.equal(hood.depthWrite, false);
  const tyre = partVisual({ partId: 'wheel_rl', selected: false, hovered: false, hasSelection: true, presentation: 'solid', faultPartId: 'engine' });
  assert.equal(tyre.desaturate, 0.72);
  assert.equal(tyre.pulse, false);
  const xray = partVisual({ partId: 'cab', selected: false, hovered: false, hasSelection: true, presentation: 'xray', faultPartId: null });
  assert.equal(xray.opacity, 0.22);
});

test('示例故障按部件编号索引，并且都能在部件表里找到', () => {
  const ids = new Set(catalogParts().map(part => part.partId));
  assert.ok(faultList().includes('engine'));
  for (const id of faultList()) {
    assert.ok(ids.has(id), id);
    assert.ok(partExample(id).faults.length > 0);
  }
  assert.match(partExample('engine').faults[0].zh, /启动/);
});

test('部件表里的每个零件都能在模型里找到带缩放的网格', () => {
  const nodes = glbDocument().nodes as GltfNode[];
  const byName = new Map(nodes.map(node => [node.name, node]));
  const expectMesh = (part: CatalogPart) => {
    const node = byName.get(part.name);
    assert.ok(node, part.name);
    assert.equal(node.extras?.part_id, part.partId);
    assert.equal(node.extras?.label_zh, part.labelZh);
    if (part.group) {
      assert.equal(node.mesh, undefined);
      assert.ok((node.children?.length ?? 0) >= part.children.length);
      for (const child of part.children) expectMesh(child);
      return;
    }
    assert.equal(typeof node.mesh, 'number');
    assert.ok(Array.isArray(node.scale) && node.scale.length === 3 && node.scale.every(value => value > 0));
    assert.ok(Array.isArray(node.extras?.explode_dir) && node.extras.explode_dir.length === 3);
  };
  for (const part of catalogParts()) expectMesh(part);
  assert.equal(nodes.filter(node => typeof node.mesh === 'number').length, 26);
});

test('部件模型用 three 自带的 Meshopt 解码器', () => {
  assert.equal(MeshoptDecoder.supported, true);
  assert.equal(typeof MeshoptDecoder.decodeGltfBufferAsync, 'function');
});

test('鸿鹄 T70 是新版工坊的默认机型，14 个部件带中文名和爆炸方向', () => {
  assert.equal(DEFAULT_PARTS_MODEL, 't70');
  assert.equal(catalogParts('t70').length, 14);
  assert.deepEqual(orderedParts('t70').slice(0, 3).map(part => part.partId), ['body_shell', 'roof_cap', 'battery_box']);
  for (const part of catalogParts('t70')) {
    assert.equal(part.group, false);
    assert.notEqual(part.labelZh, '');
    assert.ok(part.explodeDir.some(value => value !== 0), part.partId);
  }
  const wheel = catalogByName('wheel_fl', 't70');
  const dieselWheel = catalogByName('wheel_fl');
  assert.ok(wheel && dieselWheel);
  assert.equal(partTitle(wheel.node, 'zh', 't70'), '左前轮');
  assert.equal(partTitle(dieselWheel.node, 'zh'), '轮胎 · 左前');
  assert.notDeepEqual(wheel.node.explodeDir, dieselWheel.node.explodeDir);
  assert.equal(hoverLabel('GPS天线', 'zh', 'gps_antenna', 't70'), 'GPS天线');
  assert.match(hoverLabel('GPS天线', 'en', 'gps_antenna', 't70'), /GPS antenna/);
  const ids = new Set(catalogParts('t70').map(part => part.partId));
  for (const id of faultList('t70')) {
    assert.ok(ids.has(id), id);
    assert.ok(partExample(id, 't70').faults.length > 0);
  }
  assert.ok(faultList('t70').includes('battery_box'));
  assert.match(partExample('battery_box', 't70').faults[0].zh, /电池舱/);
  assert.equal(partExample('engine', 't70').statusZh, '未标注');
});

test('鸿鹄 T70 故障示意点亮电池舱，并把车身外壳变成淡透视', () => {
  const sets = visualSets('t70');
  const battery = partVisual({ partId: 'battery_box', selected: true, hovered: false, hasSelection: true, presentation: 'solid', faultPartId: 'battery_box', ...sets });
  assert.equal(battery.pulse, true);
  const shell = partVisual({ partId: 'body_shell', selected: false, hovered: false, hasSelection: true, presentation: 'solid', faultPartId: 'battery_box', ...sets });
  assert.equal(shell.opacity, 0.15);
  assert.equal(shell.depthWrite, false);
  const tyre = partVisual({ partId: 'wheel_fl', selected: false, hovered: false, hasSelection: true, presentation: 'solid', faultPartId: 'battery_box', ...sets });
  assert.equal(tyre.desaturate, 0.72);
  assert.equal(tyre.pulse, false);
  const closed = partVisual({ partId: 'body_shell', selected: false, hovered: false, hasSelection: true, presentation: 'solid', faultPartId: 'wheel_fl', ...sets });
  assert.equal(closed.opacity, 0.42);
  const dieselDefault = partVisual({ partId: 'body_shell', selected: false, hovered: false, hasSelection: true, presentation: 'solid', faultPartId: 'battery_box' });
  assert.notEqual(dieselDefault.opacity, 0.15);
});

test('鸿鹄 T70 的 Meshopt 节点保留量化缩放，爆炸方向与部件表一致', () => {
  const nodes = glbDocument('../public/models/t70-parts/t70_parts_meshopt.glb').nodes;
  const meshes = nodes.filter(node => typeof node.mesh === 'number');
  assert.equal(meshes.length, 14);
  const byName = new Map(nodes.map(node => [node.name, node]));
  for (const part of catalogParts('t70')) {
    const node = byName.get(part.name);
    assert.ok(node, part.name);
    assert.equal(node.extras?.part_id, part.partId);
    assert.equal(node.extras?.label_zh, part.labelZh);
    assert.deepEqual(node.extras?.explode_dir, [...part.explodeDir]);
    assert.ok(Array.isArray(node.scale) && node.scale.length === 3);
    assert.ok(node.scale.every(value => value > 0));
    assert.ok(node.scale.some(value => Math.abs(value - 1) > 1e-3), part.name);
    assert.ok(Array.isArray(node.translation) && node.translation.length === 3);
  }
});

test('爆炸位移加在节点平移上，量化缩放保持不动', () => {
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  mesh.name = 'battery_box';
  mesh.position.set(-0.0183, 0.2898, 0.0006);
  mesh.scale.setScalar(0.2548);
  mesh.userData = { part_id: 'battery_box', label_zh: '电池舱', explode_dir: [0.1, 0.2, 0.3] };
  root.add(mesh);
  const prepared = preparePartsRoot(root, name => catalogByName(name, 't70'));
  const record = prepared.records.find(item => item.partId === 'battery_box');
  assert.ok(record);
  assert.equal(record.labelZh, '电池舱');
  assert.deepEqual([record.dir.x, record.dir.y, record.dir.z], [0.1, 0.2, 0.3]);
  assert.equal(record.object.scale.x, 0.2548);
  const moved = explodedPosition([record.base.x, record.base.y, record.base.z], [record.dir.x, record.dir.y, record.dir.z], 1);
  record.object.position.set(moved[0], moved[1], moved[2]);
  assert.ok(Math.abs(record.object.position.x - (-0.0183 + 0.1)) < 1e-4);
  assert.ok(Math.abs(record.object.position.y - (0.2898 + 0.2)) < 1e-4);
  assert.equal(record.object.scale.x, 0.2548);
  assert.equal(record.object.scale.y, 0.2548);
  assert.equal(record.object.scale.z, 0.2548);
  prepared.dispose();
});

type GltfNode = {
  name?: string;
  mesh?: number;
  children?: number[];
  scale?: number[];
  translation?: number[];
  extras?: { part_id?: string; label_zh?: string; explode_dir?: number[] };
};

function glbDocument(relative = '../public/models/tractor-parts/tractor_parts.glb'): { nodes: GltfNode[] } {
  const bytes = readFileSync(new URL(relative, import.meta.url));
  const length = bytes.readUInt32LE(12);
  return JSON.parse(bytes.subarray(20, 20 + length).toString('utf8')) as { nodes: GltfNode[] };
}

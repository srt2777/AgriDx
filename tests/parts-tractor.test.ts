import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { catalogByName, catalogParts, selectionForPart, type CatalogPart } from '../src/components/parts-tractor/parts-catalog';
import { faultList, partExample } from '../src/components/parts-tractor/part-faults';
import { explodedPosition, partVisual, smoothstep } from '../src/components/parts-tractor/parts-motion';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

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

type GltfNode = {
  name?: string;
  mesh?: number;
  children?: number[];
  scale?: number[];
  extras?: { part_id?: string; label_zh?: string; explode_dir?: number[] };
};

function glbDocument(): { nodes: GltfNode[] } {
  const bytes = readFileSync(new URL('../public/models/tractor-parts/tractor_parts.glb', import.meta.url));
  const length = bytes.readUInt32LE(12);
  return JSON.parse(bytes.subarray(20, 20 + length).toString('utf8')) as { nodes: GltfNode[] };
}

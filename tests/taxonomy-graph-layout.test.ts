import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadKnowledgeCatalog } from '../server/knowledge/catalog';
import { taxonomyNodes } from '../src/pages/KnowledgePage/knowledge-taxonomy-data';
import { graphPositions, palette, fluidPosition, diffusionParticle } from '../src/pages/KnowledgePage/taxonomy-graph-layout';

test('organic volume positions preserve all taxonomy identities, parents, order and evidence queries', () => {
  const nodes = taxonomyNodes(loadKnowledgeCatalog());
  const original = structuredClone(nodes);
  const positions = graphPositions(nodes);
  assert.deepEqual(nodes, original);
  assert.deepEqual([...positions.keys()], nodes.map(node => node.id));
  assert.equal(positions.size, nodes.length);
  const byId = new Map(nodes.map(node => [node.id, node]));
  for (const node of nodes) {
    const point = positions.get(node.id)!;
    assert.ok([point.x, point.y, point.z].every(Number.isFinite));
    assert.ok(Math.hypot(point.x, point.y, point.z) >= 1.16 && Math.hypot(point.x, point.y, point.z) <= 2.000001);
    if (node.parent) {
      assert.ok(byId.has(node.parent));
      assert.equal(point.color, positions.get(node.parent)!.color);
    }
  }
  assert.deepEqual([...graphPositions(nodes)], [...positions]);
  assert.equal(new Set([...positions.values()].map(point => [point.x, point.y, point.z].join(','))).size, nodes.length);
  assert.equal(graphPositions([]).size, 0);
  assert.equal(graphPositions([nodes[0]], ['#123456']).get(nodes[0].id)!.color, '#123456');
  assert.equal(graphPositions([nodes[0]], []).get(nodes[0].id)!.color, palette[0]);
});


test('flow drifts smoothly on three axes without integrating away or changing source positions', () => {
  const positions = graphPositions(taxonomyNodes(loadKnowledgeCatalog()));
  const point = [...positions.values()][20];
  const before = structuredClone(point);
  const start = fluidPosition(point, 0);
  const next = fluidPosition(point, .016);
  assert.ok(Math.hypot(next.x - start.x, next.y - start.y, next.z - start.z) < .02);
  const later = fluidPosition(point, 6);
  for (const axis of ['x','y','z'] as const) assert.notEqual(start[axis], later[axis]);
  for (const time of [0, 1, 60, 36000]) {
    const value = fluidPosition(point, time);
    assert.ok([value.x, value.y, value.z].every(Number.isFinite));
    assert.ok(Math.hypot(value.x, value.y, value.z) < 2.8);
  }
  assert.deepEqual(point, before);
  assert.deepEqual(fluidPosition(point, 6), later);
});

test('decorative particles stay bounded and fade independently of knowledge identities', () => {
  for (let index = 0; index < 400; index++) for (const time of [0, 9, 6000]) {
    const value = diffusionParticle(index, time);
    assert.ok(value.alpha >= 0 && value.alpha <= .5);
    assert.ok(Math.hypot(value.x, value.y, value.z) < 3.3);
    assert.ok(!('id' in value));
    assert.deepEqual(diffusionParticle(index, time), value);
  }
  assert.notDeepEqual(diffusionParticle(0, 0), diffusionParticle(0, 3));
});

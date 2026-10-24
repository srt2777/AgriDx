import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadKnowledgeCatalog } from '../server/knowledge/catalog';
import { taxonomyNodes } from '../src/pages/KnowledgePage/knowledge-taxonomy-data';
import { graphPositions, palette } from '../src/pages/KnowledgePage/taxonomy-graph-layout';

test('spherical positions preserve all taxonomy identities, parents, order and evidence queries', () => {
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
    assert.ok(Math.abs(Math.hypot(point.x, point.y, point.z) - 2) < 1e-10);
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

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadKnowledgeCatalog } from '../server/knowledge/catalog';
import { taxonomyNodes } from '../src/pages/KnowledgePage/knowledge-taxonomy-data';
import { graphPositions } from '../src/pages/KnowledgePage/taxonomy-graph-layout';

test('graph height follows real hierarchy and sibling x positions preserve catalog order', () => {
  const nodes = taxonomyNodes(loadKnowledgeCatalog());
  const positions = graphPositions(nodes);
  assert.equal(positions.size, nodes.length);
  for (const node of nodes) {
    const point = positions.get(node.id)!;
    assert.ok([point.x, point.y, point.z].every(Number.isFinite));
    if (node.parent) assert.equal(positions.get(node.parent)!.y - point.y, 1);
  }
  const parents = new Set(nodes.map(node => node.parent));
  for (const parent of parents) {
    const siblings = nodes.filter(node => node.parent === parent);
    for (let index = 1; index < siblings.length; index++) assert.ok(positions.get(siblings[index].id)!.x > positions.get(siblings[index - 1].id)!.x);
  }
  assert.deepEqual([...graphPositions(nodes)], [...positions]);
  assert.equal(graphPositions([]).size, 0);
});

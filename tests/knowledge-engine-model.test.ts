import assert from 'node:assert/strict';
import { test } from 'node:test';
import { catalogNetwork } from '../src/pages/KnowledgePage/knowledge-engine-model';
import { loadKnowledgeCatalog } from '../server/knowledge/catalog';
import { taxonomyNodes } from '../src/pages/KnowledgePage/knowledge-taxonomy-data';

test('real mode preserves every identity and only original parent edges, without mutating the catalog', () => {
  const nodes = taxonomyNodes(loadKnowledgeCatalog()), before = structuredClone(nodes);
  const network = catalogNetwork(nodes);
  assert.deepEqual(nodes, before);
  assert.deepEqual(network.nodes.map(node => node.id), nodes.map(node => node.id));
  assert.deepEqual(network.nodes.map(node => node.taxonomyId), nodes.map(node => node.id));
  assert.deepEqual(network.edges.map(edge => [network.nodes[edge.from].id, network.nodes[edge.to].id]), nodes.filter(node => node.parent).map(node => [node.parent, node.id]));
  assert.deepEqual(catalogNetwork([...nodes].reverse()).nodes.map(node => node.id), [...nodes].reverse().map(node => node.id));
  assert.ok(network.nodes.every(node => [node.x,node.y,node.z,node.radius].every(Number.isFinite)));
  assert.deepEqual(catalogNetwork([]), { nodes: [], edges: [], hubs: [] });
});

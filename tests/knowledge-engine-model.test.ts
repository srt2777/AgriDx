import assert from 'node:assert/strict';
import { test } from 'node:test';
import { referenceNetwork, catalogNetwork, referenceFrame } from '../src/pages/KnowledgePage/knowledge-engine-model';
import { loadKnowledgeCatalog } from '../server/knowledge/catalog';
import { taxonomyNodes } from '../src/pages/KnowledgePage/knowledge-taxonomy-data';

test('reference simulation is deterministic, complete, has no dangling or duplicate links', () => {
  const network = referenceNetwork();
  assert.equal(network.nodes.length, 3287);
  assert.equal(network.edges.length, 11663);
  assert.deepEqual(referenceNetwork(), network);
  const links = new Set<string>();
  for (const edge of network.edges) {
    assert.ok(network.nodes[edge.from] && network.nodes[edge.to]);
    assert.notEqual(edge.from, edge.to);
    assert.ok(edge.born >= network.nodes[edge.from].born && edge.born >= network.nodes[edge.to].born);
    links.add([edge.from, edge.to].sort((a,b) => a-b).join(':'));
  }
  assert.equal(links.size, network.edges.length);
  assert.equal(network.nodes.filter(node => node.born === 0).length, 2736);
  assert.ok(network.nodes.every(node => node.born <= 24 && !node.taxonomyId));
});
test('reference timeline exposes reading, writing, answer, checking, conflict and final review in order', () => {
  const frames = [0, 3, 9.5, 14, 17, 24].map(referenceFrame);
  assert.deepEqual(frames.map(frame => frame.phase), ['READER','LIBRARIAN','ANSWER','CHECKER','CHECKER','REVIEW']);
  assert.equal(frames[0].writes, 0);
  assert.equal(frames[2].writes, 12);
  assert.equal(frames[3].documents, 129);
  assert.equal(frames[3].conflict, false);
  assert.equal(frames[4].conflict, true);
  assert.equal(frames[5].scan, 129);
  assert.deepEqual(referenceFrame(-1), referenceFrame(0));
  assert.deepEqual(referenceFrame(40), referenceFrame(24));
});
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

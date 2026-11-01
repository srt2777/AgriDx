import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadKnowledgeCatalog } from '../server/knowledge/catalog';
import { taxonomyNodes, type TaxonomyNode } from '../src/pages/KnowledgePage/knowledge-taxonomy-data';
import { membershipPath } from '../src/pages/KnowledgePage/knowledge-graph-path';
import { buildGraphifyCatalog } from '../scripts/export-graphify';

const sample = (id: string, parent?: string): TaxonomyNode => ({ id, parent, label: id, level: 'part', order: 0, count: 1, query: {} });
test('catalog path joins branches through the nearest parent and never invents a cross-brand path', () => {
  const nodes = [sample('brand'), sample('model', 'brand'), sample('a', 'model'), sample('b', 'model'), sample('other')];
  assert.deepEqual(membershipPath(nodes, 'a', 'b')?.map(node => node.id), ['a', 'model', 'b']);
  assert.deepEqual(membershipPath(nodes, 'a', 'a')?.map(node => node.id), ['a']);
  assert.equal(membershipPath(nodes, 'a', 'other'), null);
  assert.equal(membershipPath(nodes, 'a', 'missing'), null);
  assert.equal(membershipPath([sample('x', 'y'), sample('y', 'x')], 'x', 'y'), null);
});

test('Graphify export preserves catalog identities, source metadata and Qianxun without exporting evidence bodies', () => {
  const catalog = loadKnowledgeCatalog(), original = taxonomyNodes(catalog);
  const graph = buildGraphifyCatalog();
  assert.equal(graph.graph.kb_version, catalog.kbVersion);
  const ids = new Set(graph.nodes.map(node => node.id));
  assert.equal(ids.size, graph.nodes.length);
  assert.ok(original.some(node => node.query.brand === '千寻位置'));
  assert.ok(original.every(node => ids.has(node.id)));
  assert.ok(ids.has(JSON.stringify(['learning', 'general'])));
  assert.ok(ids.has(JSON.stringify(['learning', 'terminology'])));
  assert.ok(graph.links.every(edge => ids.has(edge.source) && ids.has(edge.target)));
  assert.equal(new Set(graph.links.map(edge => JSON.stringify([edge.source, edge.target, edge.relation]))).size, graph.links.length);
  assert.ok(graph.nodes.some(node => node.node_type === 'evidence' && node.source_id && node.source_file && node.source_location));
  assert.ok(graph.nodes.filter(node => node.node_type === 'evidence').every(node => !Object.hasOwn(node, 'content')));
  assert.ok(graph.links.every(edge => edge.confidence === 'EXTRACTED'));
});

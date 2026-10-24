import assert from 'node:assert/strict';
import { test } from 'node:test';
import { indexEngineCatalog, selectEngineCatalog } from '../src/pages/KnowledgePage/knowledge-engine-catalog';
import type { TaxonomyNode } from '../src/pages/KnowledgePage/knowledge-taxonomy-data';

const node = (id: string, count: number, parent?: string): TaxonomyNode => ({ id, label: id, count, parent, level: parent ? 'model' : 'brand', order: 0, query: { brand: parent ?? id } });
test('engine directory keeps all children in catalog order and resolves leaf and parent paths', () => {
  const nodes = [node('brand', 60), ...Array.from({ length: 25 }, (_, i) => node(`model-${i}`, i, 'brand'))];
  const before = structuredClone(nodes), index = indexEngineCatalog(nodes);
  assert.deepEqual(selectEngineCatalog(index, 'brand').children.map(n => n.id), nodes.slice(1).map(n => n.id));
  const leaf = selectEngineCatalog(index, 'model-24');
  assert.deepEqual(leaf.path.map(n => n.id), ['brand', 'model-24']);
  assert.deepEqual(leaf.children, []);
  assert.deepEqual(leaf.coverage.map(n => n.id), ['model-24']);
  assert.deepEqual(selectEngineCatalog(index, 'missing').children.map(n => n.id), ['brand']);
  assert.deepEqual(nodes, before);
});
test('engine totals count brands once and graph bars use proportional real counts, including zero', () => {
  const index = indexEngineCatalog([node('a', 84), node('a-model', 84, 'a'), node('b', 42), node('gap', 0)]);
  assert.equal(index.entries, 126);
  assert.equal(index.models, 1);
  assert.deepEqual(index.distribution.map(n => n.percent), [100, 50, 0]);
  const empty = indexEngineCatalog([]);
  assert.equal(empty.entries, 0);
  assert.deepEqual(selectEngineCatalog(empty, '').coverage, []);
  assert.deepEqual(indexEngineCatalog([node('zero', 0)]).distribution.map(n => n.percent), [0]);
});

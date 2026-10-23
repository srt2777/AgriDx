import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadKnowledgeCatalog, getKnowledgeCatalog } from '../server/knowledge/catalog';
import { sphereNodes, sphereLevel, type SphereNode } from '../src/pages/KnowledgePage/knowledge-sphere-data';

const catalog = loadKnowledgeCatalog();
const nodes = sphereNodes(catalog);
test('sphere navigation resolves to actual catalog evidence without merging names across models', () => {
  assert.equal(new Set(nodes.map((node) => node.id)).size, nodes.length);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  assert.equal(nodes.filter((node) => node.kind === 'brand').length, catalog.brands.length);
  assert.equal(nodes.filter((node) => node.kind === 'model').length, catalog.totals.models);
  for (const node of nodes) {
    assert.ok(node.position.every(Number.isFinite));
    assert.ok(Math.abs(Math.hypot(...node.position) - 1) < 1e-10);
    if (node.kind === 'brand') continue;
    const parent = byId.get(node.parent!);
    assert.ok(parent, 'Every edge must resolve to an existing parent');
    assert.equal(parent.query.brand, node.query.brand);
    if (node.kind === 'component' || node.kind === 'part') assert.equal(parent.query.model, node.query.model);
    if (node.kind === 'part') assert.equal(parent.query.component, node.query.component);
  }
  const sample = nodes.find((node) => node.kind === 'component' && node.count > 0)!;
  const resolved = getKnowledgeCatalog(sample.query);
  assert.ok(resolved.selected?.entries.length, 'A component detail must resolve real archived evidence');
  assert.equal(resolved.selected?.component, sample.query.component);
  const part = nodes.find((node) => node.kind === 'part' && node.count > 0)!;
  assert.ok(part);
  const partDetail = getKnowledgeCatalog(part.query);
  assert.ok(partDetail.selected?.entries.length);
  assert.equal(partDetail.selected?.part, part.query.part);
});
test('empty catalogs produce an empty sphere without placeholder knowledge', () => {
  assert.deepEqual(sphereNodes({ ...catalog, brands: [] }), []);
});

test('galaxy scales reveal one sphere, then only the selected brand, model and component children', () => {
  const root: SphereNode = {
    id: 'universe',
    label: '知识星系',
    kind: 'root',
    count: catalog.totals.archivedEntries,
    query: {},
    position: [0, 0, 0],
  };
  assert.equal(sphereLevel(nodes, root, false).length, 1);
  const brands = sphereLevel(nodes, root, true);
  assert.equal(brands.length, catalog.brands.length + 1);
  assert.ok(brands.slice(1).every((node) => node.kind === 'brand'));
  const brand = nodes.find((node) => node.kind === 'brand')!;
  const models = sphereLevel(nodes, brand, true);
  assert.ok(models.slice(1).every((node) => node.parent === brand.id && node.kind === 'model'));
  assert.deepEqual(models[0].position, [0, 0, 0]);
  const component = nodes.find((node) => node.kind === 'component' && nodes.some((part) => part.parent === node.id))!;
  const parts = sphereLevel(nodes, component, true);
  assert.ok(parts.length > 1);
  assert.ok(parts.slice(1).every((node) => node.parent === component.id && node.kind === 'part'));
  assert.ok(parts.every((node) => node.query.brand === component.query.brand));
});

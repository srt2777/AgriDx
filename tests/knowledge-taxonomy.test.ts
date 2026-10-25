import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadKnowledgeCatalog, getKnowledgeCatalog } from '../server/knowledge/catalog';
import { taxonomyNodes, visibleTaxonomyNodes } from '../src/pages/KnowledgePage/knowledge-taxonomy-data';
const catalog = loadKnowledgeCatalog();
const nodes = taxonomyNodes(catalog);
test('taxonomy preserves catalog order, scoped identities and reviewed parent relationships', () => {
  assert.equal(new Set(nodes.map(node => node.id)).size, nodes.length);
  assert.deepEqual(nodes.filter(node => node.level === 'brand').map(node => node.query.brand), catalog.brands.map(brand => brand.id));
  const byId = new Map(nodes.map(node => [node.id, node]));
  for (const node of nodes) {
    if (node.parent) {
      const parent = byId.get(node.parent)!;
      assert.ok(parent);
      assert.equal(parent.query.brand, node.query.brand);
      if (node.level === 'component' || node.level === 'part') assert.equal(parent.query.model, node.query.model);
      if (node.level === 'part') assert.equal(parent.query.component, node.query.component);
    }
    assert.equal('position' in node, false);
  }
  for (const brand of catalog.brands) for (const model of brand.models) {
    const modelNode = nodes.find(node => node.level === 'model' && node.query.brand === brand.id && node.query.model === model.id)!;
    assert.deepEqual(nodes.filter(node => node.parent === modelNode.id).map(node => node.query.component), model.components.map(component => component.id));
  }
});
test('taxonomy evidence resolves actual component and part entries, including explicit gaps', () => {
  for (const level of ['component', 'part']) {
    const node = nodes.find(node => node.level === level && node.count > 0)!;
    const detail = getKnowledgeCatalog(node.query);
    assert.ok(detail.selected?.entries.length);
    assert.equal(detail.selected?.model, node.query.model);
    assert.equal(detail.selected?.component, node.query.component);
    if (level === 'part') assert.equal(detail.selected?.part, node.query.part);
  }
  assert.ok(nodes.some(node => node.level === 'component' && node.count === 0));
  assert.deepEqual(taxonomyNodes({ ...catalog, brands: [] }), []);
});
test('taxonomy filters retain matching reviewed metadata and their parent path', () => {
  const role = visibleTaxonomyNodes(nodes, { role: 'symptom' });
  assert.ok(role.length > 0);
  assert.ok(role.every(node => node.level === 'brand' || node.roleCoverage?.symptom || role.some(child => child.parent === node.id)));
  const type = visibleTaxonomyNodes(nodes, { entryType: '维护/故障知识' });
  assert.ok(type.length > 0);
  assert.ok(type.some(node => node.entryTypes?.includes('维护/故障知识')));
});

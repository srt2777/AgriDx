import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getKnowledgeCatalog, loadKnowledgeCatalog } from '../server/knowledge/catalog';
import { partKnowledgeCount, partKnowledgeLookup } from '../src/components/parts-tractor/part-knowledge';
import { catalogParts } from '../src/components/parts-tractor/parts-catalog';

const catalog = loadKnowledgeCatalog();

test('generic diesel illustration requires a user-chosen source scope and never defaults to a real model', () => {
  for (const [brand, model] of [['', ''], ['东方红', ''], ['未知', 'LF804S'], ['东方红', 'LF804S-extra'], ['华测', 'NX510']]) {
    assert.deepEqual(partKnowledgeLookup(catalog, 'diesel', 'engine', brand, model), { kind: 'choose' });
  }
});

test('indexed radiator lookup uses the existing valid hierarchy and preserves exact source scope', () => {
  const lookup = partKnowledgeLookup(catalog, 'diesel', 'radiator', '纽荷兰', 'WORKMASTER25');
  assert.equal(lookup.kind, 'query');
  if (lookup.kind !== 'query') return;
  assert.equal(lookup.level, 'part');
  assert.deepEqual(Object.fromEntries(new URLSearchParams(lookup.query)), { brand: '纽荷兰', model: 'WORKMASTER25', component: 'cooling', part: 'radiator' });
  const target = new URL(lookup.href, 'https://example.test');
  assert.equal(target.pathname, '/knowledge'); assert.equal(target.searchParams.get('view'), 'machine');
  const selected = getKnowledgeCatalog(Object.fromEntries(new URLSearchParams(lookup.query)));
  assert.ok(partKnowledgeCount(selected, lookup)! > 0);
  assert.equal(partKnowledgeCount(selected, lookup), selected.selected!.entries.length);
});

test('broad component lookup is explicitly identified, not labelled as part-specific knowledge', () => {
  const lookup = partKnowledgeLookup(catalog, 'diesel', 'engine', '东方红', 'LF804S');
  assert.equal(lookup.kind, 'query');
  if (lookup.kind !== 'query') return;
  assert.equal(lookup.level, 'component');
  assert.equal(lookup.part, undefined);
  assert.equal(new URLSearchParams(lookup.query).get('component'), 'engine');
});

test('T70 never borrows diesel electrical evidence and missing part links do not produce invalid part queries', () => {
  for (const part of catalogParts('t70')) {
    const lookup = partKnowledgeLookup(catalog, 't70', part.partId, '东方红', 'LF804S');
    assert.equal(lookup.kind, 'pending', part.partId);
    if (lookup.kind === 'choose') continue;
    assert.equal(lookup.brand, '鸿鹄'); assert.equal(lookup.model, 'T70');
    assert.equal(new URLSearchParams(lookup.query).has('part'), false);
    assert.equal(partKnowledgeCount(getKnowledgeCatalog({ brand: '鸿鹄', model: 'T70' }), lookup), null);
    assert.doesNotThrow(() => getKnowledgeCatalog(Object.fromEntries(new URLSearchParams(lookup.query))));
  }
  const unknown = partKnowledgeLookup(catalog, 'diesel', 'not-a-real-part', '东方红', 'LF804S');
  assert.equal(unknown.kind, 'pending');
});

test('every offered model and physical part has either a validated directory query or an explicit gap', () => {
  for (const brand of catalog.brands) for (const model of brand.models.filter(model => model.machineType === '拖拉机')) {
    for (const part of catalogParts('diesel')) {
      const lookup = partKnowledgeLookup(catalog, 'diesel', part.partId, brand.id, model.id);
      assert.notEqual(lookup.kind, 'choose');
      if (lookup.kind === 'choose') continue;
      const result = getKnowledgeCatalog(Object.fromEntries(new URLSearchParams(lookup.query)));
      if (lookup.kind === 'query') assert.equal(partKnowledgeCount(result, lookup), result.selected!.entries.length);
      else assert.equal(partKnowledgeCount(result, lookup), null);
    }
  }
});

test('counts reject stale model/component/part responses and only count unique selected entries', () => {
  const lookup = partKnowledgeLookup(catalog, 'diesel', 'battery', '东方红', 'LF804S');
  assert.equal(lookup.kind, 'query');
  if (lookup.kind !== 'query') return;
  const selected = structuredClone(getKnowledgeCatalog(Object.fromEntries(new URLSearchParams(lookup.query))));
  const count = partKnowledgeCount(selected, lookup);
  assert.ok(count! > 0);
  selected.selected!.entries.push(selected.selected!.entries[0]);
  assert.equal(partKnowledgeCount(selected, lookup), count);
  for (const field of ['brand', 'model', 'component', 'part'] as const) {
    const mismatched = structuredClone(selected); mismatched.selected![field] = 'different-scope';
    assert.equal(partKnowledgeCount(mismatched, lookup), null, field);
  }
  assert.equal(partKnowledgeCount(null, lookup), null);
  assert.equal(partKnowledgeCount(catalog, lookup), null);
});

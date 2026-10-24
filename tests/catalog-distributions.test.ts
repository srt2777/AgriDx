import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { KnowledgeCatalog, RoleCoverage, RiskCoverage } from '../shared/knowledge-catalog';
import { KNOWLEDGE_STAGES } from '../shared/common-knowledge';
import { buildKnowledgeCatalog } from '../server/knowledge/catalog-data';
import type { KnowledgeChunk } from '../server/knowledge/types';
import { loadKnowledgeCatalog } from '../server/knowledge/catalog';
import { catalogDistributions, isRiskCoverage, isRoleCoverage, roleFilterHref } from '../src/features/knowledge/catalog-distributions';
import { parseKnowledgeCatalog } from '../src/features/knowledge/catalog-api';
import CatalogDistributions from '../src/pages/KnowledgePage/CatalogDistributions';

const roles: RoleCoverage = { symptom: 2, cause: 2, check: 1, action: 1, retest: 0, tagged: 2, untagged: 2 };
const risk: RiskCoverage = { high: 1, medium: 0, low: 0, reviewed: 1, unreviewed: 3 };

function fixture(): KnowledgeCatalog {
  const counts = { entryCount: 4, faultCount: 4, sourceCount: 1, roleCoverage: { ...roles }, riskCoverage: { ...risk } };
  return {
    totals: { entries: 6004, archivedEntries: 4, learningEntries: 6000, sources: 1, brands: 1, models: 2, faultEntries: 4, mappedEntries: 4 },
    expansion: { targetLabel: '1w+', countingUnit: 'indexed-entry', status: 'planned' }, limitations: [],
    brands: [{ id: 'test', name: 'test', ...counts, models: ['A', 'B'].map(id => ({
      id, name: id, ...counts, scope: 'exact', machineType: '拖拉机',
      components: [{ id: 'engine', name: 'engine', ...counts, unresolvedPartCount: 0, parts: [{ id: 'part', name: 'part', ...counts }] }],
    })) }],
  };
}

test('distribution totals use brand partitions, never overlapping models or the 6000 learning notes', () => {
  const catalog = fixture(), original = structuredClone(catalog);
  assert.deepEqual(catalogDistributions(catalog), { roles, risk });
  assert.deepEqual(catalog, original);
  catalog.brands.push({ ...structuredClone(catalog.brands[0]), id: 'other', name: 'other' });
  catalog.totals.archivedEntries = 8;
  assert.equal(catalogDistributions(catalog).roles?.tagged, 4);
  assert.equal(catalogDistributions(catalog).risk?.reviewed, 2);
});

test('missing or inconsistent summaries cannot masquerade as complete or zero-risk coverage', () => {
  const missingRisk = fixture(); delete missingRisk.brands[0].riskCoverage;
  assert.deepEqual(catalogDistributions(missingRisk), { roles, risk: null });
  const badRoles = fixture(); badRoles.brands[0].roleCoverage.tagged = 5;
  assert.deepEqual(catalogDistributions(badRoles), { roles: null, risk });
  const incomplete = fixture(); incomplete.totals.archivedEntries++;
  assert.deepEqual(catalogDistributions(incomplete), { roles: null, risk: null });
  const duplicate = fixture(); duplicate.brands.push(duplicate.brands[0]); duplicate.totals.archivedEntries = 8;
  assert.deepEqual(catalogDistributions(duplicate), { roles: null, risk: null });
  assert.equal(isRoleCoverage({ ...roles, check: -1 }, 4), false);
  assert.equal(isRoleCoverage({ ...roles, cause: 1.5 }, 4), false);
  assert.equal(isRoleCoverage({ ...roles, symptom: Infinity }, 4), false);
  assert.equal(isRiskCoverage({ ...risk, high: 0 }, 4), false);
  assert.equal(isRiskCoverage({ ...risk, low: -1 }, 4), false);
  assert.equal(isRiskCoverage({ ...risk, reviewed: Number.MAX_SAFE_INTEGER + 1 }, Number.MAX_SAFE_INTEGER), false);
  const empty = fixture(); empty.brands = []; empty.totals.archivedEntries = 0;
  assert.equal(catalogDistributions(empty).risk?.low, 0);
});

test('catalog parser accepts legacy missing summaries and rejects malformed supplied counts at every level', () => {
  assert.equal(parseKnowledgeCatalog(fixture()).brands[0].riskCoverage?.high, 1);
  const legacy = JSON.parse(JSON.stringify(fixture()), (key, value) => ['roleCoverage', 'riskCoverage'].includes(key) ? undefined : value);
  assert.doesNotThrow(() => parseKnowledgeCatalog(legacy));
  assert.deepEqual(catalogDistributions(legacy), { roles: null, risk: null });
  for (const level of ['brand', 'model', 'component', 'part']) {
    const catalog = fixture(), brand = catalog.brands[0], model = brand.models[0], component = model.components[0];
    const node = { brand, model, component, part: component.parts[0] }[level]!;
    node.riskCoverage!.reviewed = 0;
    assert.throws(() => parseKnowledgeCatalog(catalog), /Invalid knowledge catalog/, level);
  }
});

test('role link preserves search text, uses the existing archive role filter, and clears incompatible scope and page', () => {
  const params = new URLSearchParams('view=graph&collection=learning&q=启动&page=8&brand=A&model=B&component=engine&part=p&symptom=s&configuration=CAB&driveConfiguration=4WD&emissionStage=国四');
  const before = params.toString(), target = new URL(roleFilterHref(params, 'retest'), 'https://example.test');
  assert.equal(target.pathname, '/knowledge');
  assert.deepEqual(Object.fromEntries(target.searchParams), { collection: 'archive', q: '启动', role: 'retest' });
  assert.equal(params.toString(), before);
  assert.equal(new URL(roleFilterHref(target.searchParams), target).searchParams.has('role'), false);
});

test('server risk counts require source annotations and deduplicate shared models, excluding indexes and learning', () => {
  const base: KnowledgeChunk = { source: 'fixture.md', heading: 'test', text: 'test', entryId: 'reviewed', sourceId: 'source', brand: 'test', models: ['A', 'B'], entryType: '维护/故障知识' };
  const chunks: KnowledgeChunk[] = [
    { ...base, riskLevel: 'high', riskBasis: 'fixture: reviewed source label' },
    { ...base, entryId: 'missing-basis', riskLevel: 'low' },
    { ...base, entryId: 'heuristic-only', diagnosticMetadata: { riskLevel: 'high', coverage: { symptom: true, causes: true, checks: true, repair: true } } },
    { ...base, entryId: 'index', entryType: '资料索引', riskLevel: 'low', riskBasis: 'excluded' },
    { ...base, entryId: 'general', diagnosticEvidence: false, riskLevel: 'low', riskBasis: 'excluded' },
  ];
  const hierarchy = { schema_version: 1, components: [{ id: 'engine', name: 'engine', parts: [] }],
    entries: chunks.map(chunk => ({ entry_id: chunk.entryId, components: [{ component_id: 'engine', part_ids: [] }] })) };
  const common = { schemaVersion: 1, purpose: 'test', questions: [], stages: KNOWLEDGE_STAGES.map(id => ({ id, name: id })),
    systems: [{ id: 'system', name: 'test', componentIds: ['engine'], configurationNotes: 'test', performanceTargets: [{ id: 'target', name: 'test' }] }],
    symptoms: [{ id: 'symptom', name: 'test', aliases: [], systemIds: ['system'], performanceIds: ['target'], questions: ['test'] }], links: [] };
  const getCatalog = buildKnowledgeCatalog(chunks, [{ source_id: 'source', model: 'A', document_type: 'manual', path: '', url: '', version: '', scope_boundary: '' }], hierarchy, common,
    [{ entryId: 'TK-test', title: 'test', collection: 'learning', entryType: '通识学习', topic: 'test', content: 'test', status: 'test', knowledgePath: '', diagnosticEvidence: false }]);
  const result = getCatalog(), expected = { high: 1, medium: 0, low: 0, reviewed: 1, unreviewed: 2 };
  assert.deepEqual(result.brands[0].riskCoverage, expected);
  assert.equal(result.brands[0].models.length, 2);
  for (const model of result.brands[0].models) {
    assert.deepEqual(model.riskCoverage, expected);
    assert.deepEqual(model.components[0].riskCoverage, expected);
  }
  assert.deepEqual(catalogDistributions(result).risk, expected);
});

function render(overrides: Partial<React.ComponentProps<typeof CatalogDistributions>> = {}) {
  return renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(CatalogDistributions, {
    roles, risk, loading: false, failed: false, retry: () => {}, lang: 'zh', params: new URLSearchParams(), ...overrides,
  })));
}

test('charts render separate loading, failure and empty states with text alternatives, without invented fill', () => {
  const loading = render({ loading: true });
  assert.equal((loading.match(/role="status"/g) ?? []).length, 2);
  assert.doesNotMatch(loading, /distribution-fill|<ul/);
  const failed = render({ failed: true });
  assert.equal((failed.match(/role="alert"/g) ?? []).length, 2);
  assert.match(failed, /<button[^>]*>重新加载<\/button>/);
  assert.doesNotMatch(failed, /distribution-fill|<ul/);
  const empty = render({ roles: null, risk: null });
  assert.match(empty, /待补资料/);
  assert.match(empty, /不能推定低风险或已覆盖/);
  assert.doesNotMatch(empty, /distribution-fill/);
  assert.equal((empty.match(/data-gap="true"/g) ?? []).length, 8);
  const annotated = render({ params: new URLSearchParams('role=check') });
  assert.match(annotated, /已标注 2 条；未标注 2 条/);
  assert.match(annotated, /aria-current="true"[^>]*>/);
  assert.match(annotated, /role=retest/);
  assert.match(annotated, /未标注 3 条（待核实），不等于低风险/);
  assert.equal((annotated.match(/distribution-fill/g) ?? []).length, 5);
  assert.match(render({ lang: 'en', roles: null, risk: null }), /Evidence needed/);
  assert.match(render({ lang: 'en', failed: true }), /Could not load risk distribution/);
});

test('current archive has no reviewed risk or retest labels; frontend parser and distribution stay truthful', () => {
  const catalog = loadKnowledgeCatalog();
  assert.doesNotThrow(() => parseKnowledgeCatalog(catalog));
  const distribution = catalogDistributions(catalog);
  assert.equal(distribution.roles?.retest, 0);
  assert.ok(distribution.roles!.tagged > 0);
  assert.equal(distribution.risk?.reviewed, 0);
  assert.equal(distribution.risk?.low, 0);
  assert.ok(distribution.risk!.unreviewed > 0);
  const html = render(distribution);
  assert.match(html, /暂无已核对风险标注/);
  assert.equal((html.match(/distribution-fill/g) ?? []).length, 4);
});

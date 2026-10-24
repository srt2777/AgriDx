import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { before, test } from 'node:test';
import { DiagnosisRouter } from '../server/diagnosis/router';
import { referenceVerification } from '../server/knowledge/evidence';
import {
  clearRetrievalCache,
  loadKnowledgeBase,
  retrieve,
  retrieveWithDiagnostics,
  retrievalStats,
  type KnowledgeChunk,
} from '../server/knowledge/retriever';
import { loadKnowledgeSnapshot, reloadKnowledgeSnapshot } from '../server/knowledge/snapshot';

const lf = { machineType: '拖拉机', brand: '东方红', model: 'LF1504' };
const lfSource = 'SRC-YTO-LF1504-SMLF150449010';
const archive = (chunks: KnowledgeChunk[]) => chunks.filter(chunk => chunk.sourceId);

before(() => loadKnowledgeBase());

test('LF1504 overheating recalls its cooling safety reference without borrowing another LF manual', () => {
  const found = retrieve('东方红 LF1504 水温过高', 12, lf);
  const cooling = found.find(chunk => chunk.entryId === 'KB2000-20261015-YTOLF1504-010');
  assert.ok(cooling, 'the existing hot-coolant-cap safety card is a component reference');
  assert.equal(cooling.sourceId, lfSource);
  assert.equal(cooling.retrieval?.tier, 'component');
  assert.equal(cooling.retrieval.referenceOnly, true);
  assert.ok(cooling.retrieval.basis.length > 0);
  assert.ok(archive(found).every(chunk => chunk.sourceId === lfSource));
  assert.ok(found.every(chunk => !chunk.retrieval || chunk.retrieval.tier !== 'general' || chunk.retrieval.referenceOnly));
});

test('series retrieval requires explicit manual model coverage and retains emission boundaries', () => {
  const found = retrieve('不能起动应先区分起动机是否转动', 12, {
    machineType: '拖拉机', brand: '约翰迪尔', model: '6E-1204(G4)',
  });
  const manual = found.find(chunk => chunk.entryId === 'KB-JD-6E-G4-OMTR115296-004');
  assert.ok(manual);
  assert.ok(manual.models?.some(model => model.replace(/\s/g, '') === '6E-1204(G4)'));
  assert.equal(manual.retrieval?.tier, 'series');
  for (const model of ['6E-1604(G4)', '6E-1204(G3)', '6E-1204-X(G4)']) {
    const incompatible = retrieve('不能起动应先区分起动机是否转动', 20, {
      machineType: '拖拉机', brand: '约翰迪尔', model,
    });
    assert.ok(!archive(incompatible).some(chunk => chunk.sourceId === manual.sourceId), model);
  }
  const nationalFour = retrieve('东方红 LF1504 国四 水温过高', 20, lf);
  assert.ok(!archive(nationalFour).some(chunk => chunk.sourceId === lfSource));
});

test('diagnostics distinguish a known manual with no topic result from an unavailable model manual', () => {
  const known = retrieveWithDiagnostics('量子纠缠', 6, lf);
  assert.equal(known.manualAvailable, true);
  assert.equal(known.outcome, 'no_results');
  assert.deepEqual(known.chunks, []);
  const absent = retrieveWithDiagnostics('量子纠缠', 6, { ...lf, model: 'LF99999' });
  assert.equal(absent.manualAvailable, false);
  assert.equal(absent.outcome, 'no_manual');
  assert.deepEqual(archive(absent.chunks), []);
});

test('component and general candidates never become direct repair evidence through a high score', () => {
  const reviewed: KnowledgeChunk = {
    source: 'fixture.md', heading: 'TEST-TIER-001｜起动困难', text: '合成接口测试，不是维修资料。',
    entryId: 'TEST-TIER-001', sourceId: 'SOURCE-TIER-001',
    indexedReference: { entryId: 'TEST-TIER-001', sourceId: 'SOURCE-TIER-001' },
    brand: '东方红', model: 'LF904S', entryType: '维护/故障知识', applicability: 'matched',
    locator: '合成PDF第1页', version: '合成版', scopeBoundary: '仅用于合成LF904S测试', status: '已核验',
    relevance: { score: 100, method: 'keyword-weighted-overlap', calibrated: false },
    diagnosticMetadata: { coverage: { symptom: true, causes: true, checks: true, repair: true }, riskLevel: 'low' },
  };
  for (const tier of ['component', 'general'] as const) {
    const result = DiagnosisRouter.decide({
      query: '起动困难怎么办', currentQuery: '起动困难怎么办',
      scope: { brand: '东方红', model: 'LF904S' }, clarificationNeeded: false, llmConfigured: true,
      retrieved: [{ ...reviewed, retrieval: { tier, basis: ['合成层级限制'], referenceOnly: true } }],
    });
    assert.equal(result.candidates?.[0].directEligible, false, tier);
    assert.notEqual(result.reason, 'direct_reference', tier);
    assert.notEqual(result.evidenceLevel, 'direct_reference', tier);
  }
});

test('retrieval cache deeply clones tier explanations and reload invalidates the same generation', () => {
  clearRetrievalCache();
  const first = retrieve('东方红 LF1504 水温过高', 12, lf);
  const expected = structuredClone(first);
  assert.ok(first.some(chunk => chunk.retrieval?.basis.length));
  first.find(chunk => chunk.retrieval)!.retrieval!.basis.push('must not enter cache');
  assert.deepEqual(retrieve('东方红 LF1504 水温过高', 12, lf), expected);
  const generation = retrievalStats().generation;
  reloadKnowledgeSnapshot();
  assert.deepEqual(retrieve('东方红 LF1504 水温过高', 12, lf), expected);
  assert.equal(retrievalStats().generation, generation + 1);
});

test('failed highest-ranked references are removed before top-k selection', t => {
  const query = '东方红 LF1504 起动机不转';
  const originalFirst = retrieve(query, 1, lf)[0];
  assert.ok(originalFirst?.entryId && originalFirst.sourceId === lfSource);
  const entriesPath = path.resolve('知识库/整理后的知识库/农用拖拉机知识库/entries.jsonl');
  const read = fs.readFileSync;
  const mock = t.mock.method(fs, 'readFileSync', (...args: Parameters<typeof fs.readFileSync>) => {
    const data = read(...args);
    if (String(args[0]) !== entriesPath) return data;
    return String(data).split(/\r?\n/).map(line => {
      if (!line.trim()) return line;
      const entry = JSON.parse(line) as { entry_id: string; status: string };
      return entry.entry_id === originalFirst.entryId
        ? JSON.stringify({ ...entry, status: '核验失败；已核验' }) : line;
    }).join('\n');
  });
  t.after(() => { mock.mock.restore(); reloadKnowledgeSnapshot(); });
  reloadKnowledgeSnapshot();
  assert.equal(referenceVerification(loadKnowledgeSnapshot().chunks.find(chunk => chunk.entryId === originalFirst.entryId)!.status), 'failed');
  const found = retrieve(query, 1, lf);
  assert.equal(found.length, 1, 'an admissible candidate should fill the vacated slot');
  assert.notEqual(found[0].entryId, originalFirst.entryId);
  assert.ok(found.every(chunk => referenceVerification(chunk.status) !== 'failed'));
});

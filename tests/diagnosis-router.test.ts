import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DiagnosisRouter, DEFAULT_ROUTER_CONFIG, requiredDiagnosticCoverage, type DiagnosisRouterInput } from '../server/diagnosis/router';
import { referenceVerification } from '../server/knowledge/evidence';
import { coordinationConfig, decideCoordination } from '../server/knowledge/coordination';
import type { KnowledgeChunk } from '../server/knowledge/retriever';

// Synthetic source metadata tests the router contract, not a real repair fact.
const reviewed: KnowledgeChunk = {
  source: 'fixture.md', heading: 'TEST-001｜起动困难', text: '测试资料，不用于实车维修。',
  entryId: 'TEST-001', sourceId: 'SOURCE-001', indexedReference: { entryId: 'TEST-001', sourceId: 'SOURCE-001' },
  brand: '东方红', model: 'LF904S', entryType: '维护/故障知识', applicability: 'matched',
  locator: '测试PDF第1页', version: '测试版', scopeBoundary: '仅用于测试型号LF904S',
  status: '已核对引用页原文文字；未全书审校、厂家复核或实车验证。',
  relevance: { score: 12, method: 'keyword-weighted-overlap', calibrated: false },
  diagnosticMetadata: { coverage: { symptom: true, causes: true, checks: true, repair: true }, riskLevel: 'low' },
};
const base: DiagnosisRouterInput = {
  query: '起动困难怎么办', currentQuery: '起动困难怎么办', scope: { brand: '东方红', model: 'LF904S' },
  retrieved: [reviewed], clarificationNeeded: false, llmConfigured: true,
};
const decide = (input: Partial<DiagnosisRouterInput> = {}, changes: Partial<KnowledgeChunk> = {}) =>
  DiagnosisRouter.decide({ ...base, retrieved: [{ ...reviewed, ...changes }], ...input });

test('complete high raw-overlap reviewed evidence answers locally without equating review to repair validation', () => {
  const decision = decide();
  assert.equal(decision.route, 'local');
  assert.equal(decision.reason, 'direct_reference');
  assert.equal(decision.aiRequired, false);
  assert.deepEqual(decision.knowledgeIds, ['TEST-001']);
  assert.equal(decision.candidates?.[0].verificationBasis, 'document-review');
  assert.equal(decision.candidates?.[0].relevance.score, 12);
  assert.equal(decision.candidates?.[0].relevance.calibrated, false);
});

test('coverage follows the question and never invents missing diagnostic fields', () => {
  const partial = { diagnosticMetadata: { coverage: { symptom: true, causes: true, checks: false, repair: false }, riskLevel: 'low' as const } };
  assert.equal(decide({}, partial).route, 'ai');
  assert.equal(decide({ query: '为什么起动困难', currentQuery: '为什么起动困难' }, partial).route, 'local');
  assert.deepEqual(requiredDiagnosticCoverage('如何排查起动困难'), ['symptom', 'checks']);
  assert.equal(decide({}, { diagnosticMetadata: undefined }).route, 'ai');
});

test('raw score thresholds are configurable; absent and fractional raw scores are never percentages', () => {
  for (const score of [0.95, 2, 6]) {
    const decision = decide({}, { relevance: { score, method: 'keyword-weighted-overlap', calibrated: false } });
    assert.notEqual(decision.reason, 'direct_reference');
    assert.equal(decision.candidates?.[0].relevance.score, score);
  }
  assert.notEqual(decide({}, { relevance: undefined }).reason, 'direct_reference');
  assert.equal(DiagnosisRouter.decide(base, { ...DEFAULT_ROUTER_CONFIG, highRelevanceThreshold: 13 }).route, 'ai');
  assert.equal(DiagnosisRouter.decide(base, { ...DEFAULT_ROUTER_CONFIG, highRelevanceThreshold: NaN }).reason, 'invalid_config');
  for (const score of [0, -1, NaN, Infinity]) {
    assert.equal(decide({}, { relevance: { score, method: 'keyword-weighted-overlap', calibrated: false } }).candidates?.[0].excluded, true);
  }
});

test('model, engine and fault-code conflicts exclude evidence from both direct answers and AI context', () => {
  const cases: [Partial<DiagnosisRouterInput>, Partial<KnowledgeChunk>][] = [
    [{}, { model: 'LX1004' }],
    [{ scope: { ...base.scope, engineModel: 'TEST-A' } }, { engineModel: 'TEST-B' }],
    [{ scope: { ...base.scope, faultCodes: ['P1234'] } }, { faultCodes: ['P5678'] }],
    [{ scope: { ...base.scope, engineModel: 'TESTA' } }, { engineModel: 'TEST-A' }],
    [{ scope: { ...base.scope, faultCodes: ['P1234'] } }, { faultCodes: ['P-1234'] }],
    [{ scope: { ...base.scope, faultCodes: ['1234'] } }, { faultCodes: ['12/34'] }],
  ];
  for (const [input, changes] of cases) {
    const decision = decide(input, changes);
    assert.equal(decision.candidates?.[0].modelMatch, 'conflict');
    assert.equal(decision.candidates?.[0].excluded, true);
    assert.deepEqual(decision.knowledgeIds, []);
    assert.deepEqual(decision.excludedKnowledgeIds, ['TEST-001']);
    assert.notEqual(decision.reason, 'direct_reference');
  }
});

test('unknown configurations and pending reference reviews are reference-only', () => {
  for (const changes of [
    { configuration: 'CAB' as const }, { applicability: 'pending' as const },
    { status: '待核验；已核验' }, { scopeBoundary: '市场待核实' },
  ]) {
    const decision = decide({}, changes);
    assert.equal(decision.route, 'ai');
    assert.equal(decision.candidates?.[0].directEligible, false);
    assert.deepEqual(decision.referenceOnlyIds, ['TEST-001']);
  }
});

test('failed references override affirmative review clauses and are excluded', () => {
  for (const status of ['核验失败', '已核验；核验失败', '验证失败；已核对引用页原文文字', '与原文不符', 'FAILED', 'VERIFICATION_FAILED', '已核验；review-failed']) {
    assert.equal(referenceVerification(status), 'failed');
    const decision = decide({}, { status });
    assert.equal(decision.candidates?.[0].excluded, true);
    assert.deepEqual(decision.knowledgeIds, []);
    assert.equal(decision.evidenceLevel, 'none');
  }
  for (const status of ['沿用既有原文核对条目', '计划已核验', '已核验？', '仅封面已核验', '原文未核对；已核对引用页原文文字', '未验证；已核验']) {
    assert.notEqual(referenceVerification(status), 'verified');
  }
});

test('high-risk queries return restricted safety replies before all modes, identity checks or AI credentials', () => {
  for (const currentQuery of ['刹车不灵', '方向盘很重', '高压液压油管漏油怎么拆', 'PTO有异响', '运转中拆传动轴', '短接起动联锁', '发动机飞车', '液压油喷射', 'brakes failed', 'steering fault', 'high-pressure hydraulic line leak', 'hydraulic hose spraying oil', '油管爆裂', '热车拧水箱盖']) {
    for (const requestedMode of ['auto', 'knowledge_only', 'ai_assisted'] as const) {
      const decision = decide({ currentQuery, query: currentQuery, requestedMode, scope: {}, retrieved: [] });
      assert.equal(decision.route, 'safe', `${requestedMode}:${currentQuery}`);
      assert.equal(decision.aiRequired, false);
      assert.equal(decision.riskLevel, 'high');
      assert.equal(decision.reason, 'high_risk_insufficient_evidence');
    }
  }
  assert.equal(decide({ currentQuery: '转向故障' }).reason, 'high_risk_restricted');
  assert.equal(decide({ query: '制动失灵；下一步呢', currentQuery: '下一步呢', retrieved: [] }).route, 'safe');
  assert.equal(decide({}, { diagnosticMetadata: { ...reviewed.diagnosticMetadata!, riskLevel: 'high' } }).route, 'safe');
});

test('unknown operation risk remains conservative while ordinary missing-identity symptoms may use AI', () => {
  assert.equal(decide({ retrieved: [], currentQuery: '怎么拆卸这个零件' }).reason, 'unknown_operation_risk');
  assert.equal(decide({ retrieved: [], currentQuery: '坏了怎么办' }).route, 'ai');
  const general = decide({ query: '热车后没劲', currentQuery: '热车后没劲', scope: {}, retrieved: [] });
  assert.equal(general.route, 'ai');
  assert.equal(general.riskLevel, 'unknown');
  assert.equal(decide({ query: '故障码是什么意思', currentQuery: '故障码是什么意思', scope: {}, retrieved: [] }).route, 'clarify');
});

test('a generic collection template mentioning PTO does not override necessary code identity clarification', () => {
  const collection: KnowledgeChunk = { source: 'fixture.md', heading: '信息采集', text: '测试模板：补充机型、发动机型号、PTO状态。',
    diagnosticMetadata: { coverage: { symptom: false, causes: false, checks: false, repair: false }, riskLevel: 'high' },
    relevance: { score: 12, method: 'keyword-weighted-overlap', calibrated: false } };
  const decision = decide({ query: '故障码是什么意思', currentQuery: '故障码是什么意思', scope: {}, retrieved: [collection] });
  assert.equal(decision.route, 'clarify');
  assert.equal(decision.reason, 'identity_required');
  assert.equal(decision.aiRequired, false);
});

test('mode choices and server restrictions never bypass safety or call AI in local-only mode', () => {
  assert.equal(decide({ requestedMode: 'knowledge_only' }).aiRequired, false);
  assert.equal(decide({ requestedMode: 'ai_assisted' }).reason, 'ai_requested');
  assert.equal(decide({ requestedMode: 'ai_assisted', llmConfigured: false }).reason, 'llm_not_configured');
  assert.equal(decide({ llmConfigValid: false, retrieved: [], query: '起动困难原因', currentQuery: '起动困难原因' }).reason, 'llm_config_invalid');
  assert.equal(DiagnosisRouter.decide({ ...base, requestedMode: 'ai_assisted' }, { ...DEFAULT_ROUTER_CONFIG, allowExternalAi: false }).aiRequired, false);
});

test('explicit evidence conflicts require clarification and the stateless router does not modify its input', () => {
  const snapshot = JSON.stringify(base);
  assert.equal(decide({ evidenceConflict: true }).reason, 'knowledge_conflict');
  const conflicting = decide({ query: '为什么起动困难', currentQuery: '为什么起动困难', retrieved: [reviewed, { ...reviewed, sourceId: 'SOURCE-002', indexedReference: { entryId: 'TEST-001', sourceId: 'SOURCE-002' } }] });
  assert.equal(conflicting.reason, 'knowledge_conflict');
  assert.ok(conflicting.candidates?.every(candidate => candidate.excluded));
  assert.deepEqual(conflicting.knowledgeIds, []);
  assert.equal(decide({ currentQuery: '综合分析这些故障' }).route, 'ai');
  const first = DiagnosisRouter.decide(base);
  assert.deepEqual(DiagnosisRouter.decide(base), first);
  assert.equal(JSON.stringify(base), snapshot);
});

test('multiple complete references require synthesis rather than assuming different manuals agree', () => {
  const another: KnowledgeChunk = { ...reviewed, entryId: 'TEST-002', heading: 'TEST-002｜起动困难', sourceId: 'SOURCE-002',
    indexedReference: { entryId: 'TEST-002', sourceId: 'SOURCE-002' }, version: '另一测试版' };
  const decision = decide({ retrieved: [reviewed, another] });
  assert.equal(decision.evidenceLevel, 'partial');
  assert.equal(decision.route, 'ai');
  assert.equal(decision.reason, 'synthesis_requested');
});

test('retrieval outcomes distinguish source absence, a topic miss and incomplete usable content', () => {
  assert.equal(decide({ retrieved: [], manualAvailable: false }).retrievalOutcome, 'no_manual');
  assert.equal(decide({ retrieved: [], manualAvailable: true }).retrievalOutcome, 'no_results');
  assert.equal(decide({ manualAvailable: true }, { diagnosticMetadata: {
    coverage: { symptom: true, causes: false, checks: false, repair: false }, riskLevel: 'low',
  } }).retrievalOutcome, 'insufficient_evidence');
  assert.equal(decide({ manualAvailable: true }).retrievalOutcome, 'sufficient');
  assert.equal(decide({ manualAvailable: true, requestedMode: 'ai_assisted' }).retrievalOutcome, 'sufficient');
  assert.equal(decide({ manualAvailable: true, evidenceConflict: true }).retrievalOutcome, 'insufficient_evidence');
  // Injected stores need not pretend that a missing search hit means a missing manual.
  assert.equal(decide({ retrieved: [] }).retrievalOutcome, 'no_results');
});

test('zero lexical score can retain a structural component reference without authorizing direct repairs', () => {
  const decision = decide({}, { retrieval: { tier: 'component', basis: ['合成组件关联'], referenceOnly: true },
    relevance: { score: 0, method: 'keyword-weighted-overlap', calibrated: false } });
  assert.equal(decision.candidates?.[0].excluded, false);
  assert.equal(decision.candidates?.[0].relevance.score, 0);
  assert.equal(decision.candidates?.[0].directEligible, false);
  assert.equal(decision.retrievalOutcome, 'insufficient_evidence');
  assert.deepEqual(decision.referenceOnlyIds, ['TEST-001']);
});

test('environment raw threshold configuration fails closed for malformed or reversed values', () => {
  const fields = ['DIAGNOSIS_MODE', 'ALLOW_EXTERNAL_AI', 'DIAGNOSIS_RAW_HIGH_THRESHOLD', 'DIAGNOSIS_RAW_MEDIUM_THRESHOLD'] as const;
  const previous = fields.map(field => process.env[field]);
  try {
    process.env.DIAGNOSIS_MODE = 'auto';
    process.env.ALLOW_EXTERNAL_AI = 'true';
    for (const [high, medium] of [['NaN', '3'], ['8', '0'], ['8', 'Infinity'], ['2', '3']]) {
      process.env.DIAGNOSIS_RAW_HIGH_THRESHOLD = high;
      process.env.DIAGNOSIS_RAW_MEDIUM_THRESHOLD = medium;
      assert.equal(coordinationConfig().configValid, false);
      assert.equal(decideCoordination(base).reason, 'invalid_config');
      assert.equal(decideCoordination(base).aiRequired, false);
    }
    process.env.DIAGNOSIS_RAW_HIGH_THRESHOLD = '12.5';
    process.env.DIAGNOSIS_RAW_MEDIUM_THRESHOLD = '3.5';
    assert.equal(coordinationConfig().configValid, true);
  } finally {
    fields.forEach((field, index) => {
      if (previous[index] === undefined) delete process.env[field];
      else process.env[field] = previous[index];
    });
  }
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDiagnosticReply, renderDiagnosticReply, hasReliableManualEvidence } from '../server/diagnosis/reply';
import type { CoordinationDecision } from '../shared/diagnosis';
import type { KnowledgeChunk } from '../server/knowledge/types';

const route: CoordinationDecision = { requestedMode: 'knowledge_only', effectiveMode: 'knowledge_only', route: 'local', reason: 'local_requested', evidenceLevel: 'partial', llmConfigured: false };
const manual: KnowledgeChunk = {
  source: 'synthetic.md', entryId: 'TEST-001', sourceId: 'SRC-TEST-001', heading: 'TEST-001｜合成故障',
  indexedReference: { entryId: 'TEST-001', sourceId: 'SRC-TEST-001' }, entryType: '维护/故障知识',
  status: '已核验', applicability: 'matched', scopeBoundary: '合成测试机型',
  text: '- 故障现象：合成灯光不亮。\n- 可能原因：合成接头松动；合成灯泡损坏\n- 诊断步骤：观察合成灯光状态；记录报警原文\n- 安全提醒：不要短接安全联锁。',
};
const plan = (chunks: KnowledgeChunk[] = [], progress = '') => buildDiagnosticReply({ query: '灯光不亮', chunks, scope: { brand: '合成品牌', model: 'M1' }, coordination: route, progress });

test('local reply cites only actual matched reviewed candidates and preserves uncertain status', () => {
  const before = JSON.stringify(manual);
  const reply = plan([manual]);
  assert.equal(reply.supportLevel, 'manual');
  assert.equal(reply.causes.length, 2);
  assert.ok(reply.causes.every(cause => cause.evidenceIds[0] === 'TEST-001' && cause.basis === 'source_candidate'));
  const rendered = renderDiagnosticReply(reply);
  assert.doesNotMatch(rendered, /【服务状态】|未调用外部|kb-rag|当前未启用/);
  assert.match(rendered, /待验证/);
  assert.equal(JSON.stringify(manual), before);
  for (const changes of [{ status: '待核验' }, { status: '核验失败' }, { applicability: 'pending' as const }]) {
    const pending = plan([{ ...manual, ...changes }]);
    assert.equal(pending.causes.length, 0);
    assert.notEqual(pending.supportLevel, 'manual');
  }
});

test('component evidence retains a real prohibition without acquiring diagnostic or parameter authority', () => {
  const component = { ...manual, retrieval: { tier: 'component' as const, basis: ['匹配部件'], referenceOnly: true } };
  const reply = plan([component]);
  assert.equal(reply.supportLevel, 'reference_only');
  assert.equal(reply.causes.length, 0);
  assert.ok(reply.suggestions.some(suggestion => suggestion.text.includes('不要短接')));
  assert.equal(hasReliableManualEvidence([component]), false);
});

test('no-hit and unverified inputs do not invent causes; follow-ups stay brief and avoid known identity', () => {
  const reply = plan();
  assert.equal(reply.supportLevel, 'none');
  assert.deepEqual(reply.causes, []);
  assert.ok(reply.questions.length >= 1 && reply.questions.length <= 2);
  assert.ok(reply.questions.every(question => !/品牌|完整型号|照片/.test(question.text)));
  assert.match(reply.sourceNote, /没有/);
  assert.ok(reply.suggestions.every(suggestion => !/拆检|试车/.test(suggestion.text) || /不必/.test(suggestion.text)));
});

test('completed observations are not automatically reissued as a next check', () => {
  const reply = plan([manual], '已观察合成灯光状态，结果正常。');
  assert.ok(reply.suggestions.every(suggestion => suggestion.text !== '观察合成灯光状态'));
});

test('safety and identity branches preserve boundaries, natural wording and at most two questions', () => {
  const safe = buildDiagnosticReply({ query: '热车水箱温度过高', chunks: [manual], scope: {}, coordination: { ...route, route: 'safe', reason: 'high_risk_restricted' } });
  assert.match(safe.understanding, /停机/);
  assert.deepEqual(safe.causes, []);
  assert.ok(safe.questions.length <= 2);
  const clarify = buildDiagnosticReply({ query: '型号冲突', chunks: [manual], scope: {}, coordination: { ...route, route: 'clarify', reason: 'identity_conflict' } });
  assert.deepEqual(clarify.causes, []);
  assert.match(clarify.questions[0].text, /确认/);
});

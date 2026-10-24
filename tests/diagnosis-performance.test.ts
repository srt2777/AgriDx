import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { createDiagnosticService, type DiagnosticProvider } from '../server/diagnosis/service';
import type { DiagnosticRequest } from '../server/diagnosis/request';
import type { KnowledgeChunk } from '../server/knowledge/retriever';
import { ProviderError, type ChatMessage } from '../server/llm/types';

const savedEnvironment = { mode: process.env.DIAGNOSIS_MODE, external: process.env.ALLOW_EXTERNAL_AI };
beforeEach(() => { process.env.DIAGNOSIS_MODE = 'auto'; process.env.ALLOW_EXTERNAL_AI = 'true'; });
afterEach(() => {
  if (savedEnvironment.mode === undefined) delete process.env.DIAGNOSIS_MODE; else process.env.DIAGNOSIS_MODE = savedEnvironment.mode;
  if (savedEnvironment.external === undefined) delete process.env.ALLOW_EXTERNAL_AI; else process.env.ALLOW_EXTERNAL_AI = savedEnvironment.external;
});

// Synthetic evidence tests call budgets and source propagation, never real repair validity.
const fixture: KnowledgeChunk = {
  source: 'performance-fixture.md', heading: 'PERF-001｜起动困难', text: '- 故障现象：测试现象。\n- 可能原因：测试候选。\n- 诊断步骤：测试检查。\n- 维修建议：测试建议。\n适用限制：仅测试，不用于实车维修。',
  entryId: 'PERF-001', sourceId: 'SOURCE-PERF', indexedReference: { entryId: 'PERF-001', sourceId: 'SOURCE-PERF' },
  brand: '东方红', model: 'LF904S', entryType: '维护/故障知识', applicability: 'matched',
  locator: '测试页1', version: '测试版', scopeBoundary: '仅测试型号LF904S，不用于实车维修',
  status: '已核对引用页原文文字；未全书审校、厂家复核或实车验证。',
  relevance: { score: 12, method: 'keyword-weighted-overlap', calibrated: false },
  diagnosticMetadata: { coverage: { symptom: true, causes: true, checks: true, repair: true }, riskLevel: 'low' },
};
function request(mode: DiagnosticRequest['diagnosisMode'] = 'auto', question = '起动困难怎么办'): DiagnosticRequest {
  return { history: [{ role: 'user', content: question }], machineType: '拖拉机', brand: '东方红', model: 'LF904S', diagnosisMode: mode };
}
function instrumentedProvider(fail = false) {
  let generations = 0;
  let sent: ChatMessage[] = [];
  const provider: DiagnosticProvider = {
    hasAnyConfigured: () => true,
    async chat(messages) {
      generations++; sent = messages;
      if (fail) throw new ProviderError('deepseek', 'timeout');
      return { result: { content: '测试模拟回答，不用于维修。', provider: 'deepseek', model: 'performance-stub' }, primary: 'deepseek', fellBack: false };
    },
  };
  return { provider, generations: () => generations, sent: () => sent };
}

test('all three modes use one retrieval and at most one successful generation, including safety and clarification', async () => {
  const cases: [DiagnosticRequest, string, number][] = [
    [request(), 'local', 0],
    [request('knowledge_only'), 'local', 0],
    [request('ai_assisted'), 'ai', 1],
    [request('auto', '制动失灵怎么办'), 'safe', 0],
    [request('ai_assisted', '制动失灵怎么办'), 'safe', 0],
    [{ ...request('auto', '故障码是什么意思'), brand: undefined, model: undefined }, 'clarify', 0],
  ];
  for (const [input, expectedRoute, expectedGenerations] of cases) {
    const mock = instrumentedProvider();
    let retrievals = 0;
    const diagnose = createDiagnosticService(mock.provider, {
      retrieve: () => { retrievals++; return [fixture]; }, config: { logDecisions: false },
    });
    const response = await diagnose(input);
    assert.equal(retrievals, 1, `${expectedRoute}: actual retrieval calls`);
    assert.equal(response.coordination?.route, expectedRoute);
    assert.ok(response.diagnosticReply?.understanding);
    assert.ok(response.diagnosticReply &&
      response.diagnosticReply.suggestions.length + response.diagnosticReply.questions.length > 0);
    assert.equal(mock.generations(), expectedGenerations);
    assert.equal(response.diagnosisTrace?.retrievalCount, retrievals);
    assert.equal(response.diagnosisTrace?.aiSuccesses, expectedGenerations);
    assert.equal(response.diagnosisTrace?.aiAttempts, expectedGenerations);
    if (expectedRoute === 'ai') {
      assert.ok(mock.sent()[0].content.includes('PERF-001'));
      assert.ok(mock.sent()[0].content.includes('仅测试，不用于实车维修。'));
      assert.deepEqual(response.diagnosisTrace?.sentKnowledgeIds, ['PERF-001']);
      assert.equal(response.diagnosticReply?.aiSupplement, '测试模拟回答，不用于维修。');
      assert.ok(response.choices[0].message.content.includes(response.diagnosticReply.aiSupplement));
      assert.notEqual(response.choices[0].message.content, response.diagnosticReply.aiSupplement);
    }
    for (const duration of Object.values(response.diagnosisTrace!.timings)) assert.ok(Number.isFinite(duration) && duration >= 0);
  }
});

test('partial evidence goes through the same single retrieval before one AI generation', async () => {
  const mock = instrumentedProvider();
  let retrievals = 0;
  const diagnose = createDiagnosticService(mock.provider, {
    retrieve: () => { retrievals++; return [{ ...fixture, diagnosticMetadata: { ...fixture.diagnosticMetadata!, coverage: { symptom: true, causes: true, checks: false, repair: false } } }]; },
    config: { logDecisions: false },
  });
  const response = await diagnose(request());
  assert.equal(response.coordination?.route, 'ai');
  assert.equal(retrievals, 1);
  assert.equal(mock.generations(), 1);
  assert.equal(response.knowledgeSources?.[0].entryId, 'PERF-001');
  assert.equal(response.coordination?.candidates?.[0].coverageSufficient, false);
});

test('provider failure does not repeat retrieval or claim a successful generation', async () => {
  const mock = instrumentedProvider(true);
  let retrievals = 0;
  const diagnose = createDiagnosticService(mock.provider, {
    retrieve: () => { retrievals++; return [fixture]; }, config: { logDecisions: false },
  });
  const response = await diagnose(request('ai_assisted'));
  assert.equal(retrievals, 1);
  assert.equal(mock.generations(), 1);
  assert.equal(response.provider, 'knowledge-base');
  assert.equal(response.coordination?.reason, 'provider_unavailable');
  assert.equal(response.diagnosisTrace?.aiAttempts, 1);
  assert.equal(response.diagnosisTrace?.aiSuccesses, 0);
  assert.equal(response.diagnosisTrace?.aiProvider, null);
  assert.equal(response.knowledgeSources?.[0].entryId, 'PERF-001');
});

test('a pending routing log promise does not block returning the diagnosis', async () => {
  const mock = instrumentedProvider();
  let logs = 0;
  const diagnose = createDiagnosticService(mock.provider, {
    retrieve: () => [fixture], config: { logDecisions: false },
    onDecision: () => { logs++; return new Promise<void>(() => {}); },
  });
  const response = await diagnose(request());
  assert.equal(response.coordination?.route, 'local');
  assert.equal(logs, 0, 'routing logs start after the diagnosis promise resolves');
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(logs, 1);
  assert.equal(mock.generations(), 0);
});

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { createDiagnosticService, type DiagnosticProvider } from '../server/diagnosis/service';
import type { DiagnosticRequest } from '../server/diagnosis/request';
import type { KnowledgeChunk } from '../server/knowledge/retriever';
import { ProviderError } from '../server/llm/types';

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

test('onDelta receives the supplement chunks and the final answer still passes the guard', async () => {
  const deltas: string[] = [];
  let streamCalls = 0;
  let chatCalls = 0;
  const provider: DiagnosticProvider = {
    hasAnyConfigured: () => true,
    chat: async () => { chatCalls++; throw new Error('streaming path must use chatStream, not chat'); },
    chatStream: async (_messages, onDelta) => {
      streamCalls++;
      onDelta('测试模拟回答，');
      onDelta('不用于维修。');
      return { result: { content: '测试模拟回答，不用于维修。', provider: 'deepseek', model: 'stream-stub' }, primary: 'deepseek', fellBack: false, attempts: 1 };
    },
  };
  const diagnose = createDiagnosticService(provider, {
    retrieve: () => [fixture], config: { logDecisions: false },
  });
  const response = await diagnose(request('ai_assisted'), undefined, undefined, (text) => { deltas.push(text); });
  assert.deepEqual(deltas, ['测试模拟回答，', '不用于维修。']);
  assert.equal(streamCalls, 1);
  assert.equal(chatCalls, 0);
  assert.equal(response.diagnosticReply?.aiSupplement, '测试模拟回答，不用于维修。');
  assert.equal(response.provider, 'deepseek');
  assert.equal(response.diagnosisTrace?.aiAttempts, 1);
  assert.equal(response.diagnosisTrace?.aiSuccesses, 1);
});

test('without onDelta the service uses the plain chat path and never streams', async () => {
  let streamCalls = 0;
  let chatCalls = 0;
  const provider: DiagnosticProvider = {
    hasAnyConfigured: () => true,
    chat: async () => {
      chatCalls++;
      return { result: { content: '测试模拟回答，不用于维修。', provider: 'deepseek', model: 'plain-stub' }, primary: 'deepseek', fellBack: false, attempts: 1 };
    },
    chatStream: async () => { streamCalls++; throw new Error('must not stream without onDelta'); },
  };
  const diagnose = createDiagnosticService(provider, {
    retrieve: () => [fixture], config: { logDecisions: false },
  });
  const response = await diagnose(request('ai_assisted'));
  assert.equal(chatCalls, 1);
  assert.equal(streamCalls, 0);
  assert.equal(response.diagnosticReply?.aiSupplement, '测试模拟回答，不用于维修。');
});

test('a streaming provider without chatStream falls back to one plain chat call', async () => {
  let chatCalls = 0;
  const provider: DiagnosticProvider = {
    hasAnyConfigured: () => true,
    chat: async () => {
      chatCalls++;
      return { result: { content: '测试模拟回答，不用于维修。', provider: 'deepseek', model: 'plain-stub' }, primary: 'deepseek', fellBack: false, attempts: 1 };
    },
  };
  const diagnose = createDiagnosticService(provider, {
    retrieve: () => [fixture], config: { logDecisions: false },
  });
  const deltas: string[] = [];
  const response = await diagnose(request('ai_assisted'), undefined, undefined, (text) => { deltas.push(text); });
  assert.equal(chatCalls, 1);
  assert.deepEqual(deltas, [], 'no chatStream means no deltas; the answer still arrives whole');
  assert.equal(response.diagnosticReply?.aiSupplement, '测试模拟回答，不用于维修。');
});

test('a failed stream returns the local fallback; streamed preview text is not the answer', async () => {
  const deltas: string[] = [];
  const provider: DiagnosticProvider = {
    hasAnyConfigured: () => true,
    chat: async () => { throw new Error('streaming path must use chatStream, not chat'); },
    chatStream: async (_messages, onDelta) => {
      onDelta('半截预览，');
      throw new ProviderError('deepseek', 'timeout');
    },
  };
  const diagnose = createDiagnosticService(provider, {
    retrieve: () => [fixture], config: { logDecisions: false },
  });
  const response = await diagnose(request('ai_assisted'), undefined, undefined, (text) => { deltas.push(text); });
  assert.deepEqual(deltas, ['半截预览，']);
  assert.equal(response.provider, 'knowledge-base');
  assert.equal(response.coordination?.reason, 'provider_unavailable');
  assert.equal(response.diagnosticReply?.aiSupplement, undefined);
  assert.doesNotMatch(response.choices[0].message.content, /半截预览/);
});

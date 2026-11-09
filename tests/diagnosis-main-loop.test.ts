import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import type { DiagnosisMode } from '../shared/diagnosis';
import type { ChatResponse } from '../shared/chat';
import { createDiagnosticService, type DiagnosticDependencies, type DiagnosticMemory, type DiagnosticProvider } from '../server/diagnosis/service';
import type { DiagnosticRequest } from '../server/diagnosis/request';
import type { KnowledgeChunk } from '../server/knowledge/retriever';
import type { ChatMessage, Provider, ToolChatOptions } from '../server/llm/types';

const environmentKeys = ['DIAGNOSIS_MODE', 'ALLOW_EXTERNAL_AI', 'DIAGNOSIS_RAW_HIGH_THRESHOLD', 'DIAGNOSIS_RAW_MEDIUM_THRESHOLD', 'AGENT_LOOP'];
const savedEnvironment = new Map<string, string | undefined>();
beforeEach(() => {
  for (const key of environmentKeys) { savedEnvironment.set(key, process.env[key]); delete process.env[key]; }
});
afterEach(() => {
  for (const key of environmentKeys) {
    const value = savedEnvironment.get(key);
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
const identity = { machineType: '拖拉机', brand: '东方红', model: 'LF904S' };
const question = '指示灯间歇闪烁怎么办';
function document(overrides: Partial<KnowledgeChunk> = {}): KnowledgeChunk {
  return {
    source: 'test-fixtures/indicator.md', heading: 'TEST-MAINLOOP-001｜试验台指示灯间歇闪烁',
    text: '- 故障现象：合成试验台指示灯间歇闪烁。\n- 可能原因：合成接触状态异常，实际原因尚未确认。\n- 诊断步骤：只核对已有离线观察记录。\n- 维修建议：由试验台维护人员处理。\n- 验证状态：原文已核验；未实车验证。\n末尾限制：测试数据不得用于真实维修。',
    entryId: 'TEST-MAINLOOP-001', sourceId: 'SRC-TEST-MAINLOOP', indexedReference: { entryId: 'TEST-MAINLOOP-001', sourceId: 'SRC-TEST-MAINLOOP' },
    brand: identity.brand, model: identity.model, models: [identity.model], entryType: '维护/故障知识', applicability: 'matched',
    locator: '合成资料PDF第3页；印刷页2', version: '合成测试版1', status: '原文已核验；未厂家复核、未实车验证。',
    scopeBoundary: '仅限合成测试台LF904S；不能用于真实车辆。',
    diagnosticMetadata: { coverage: { symptom: true, causes: true, checks: false, repair: false }, riskLevel: 'low' },
    relevance: { score: 12, method: 'keyword-weighted-overlap', calibrated: false }, ...overrides,
  };
}
function completeDocument(): KnowledgeChunk {
  return document({ diagnosticMetadata: { coverage: { symptom: true, causes: true, checks: true, repair: true }, riskLevel: 'low' } });
}
interface Harness {
  diagnose: ReturnType<typeof createDiagnosticService>;
  generations: ChatMessage[][];
  toolCalls: ToolChatOptions[];
  singleAnswer: string;
}
function harness(options: {
  docs: KnowledgeChunk[];
  agentLoop?: 'off' | 'shadow' | 'main';
  toolProvider?: Provider | null;
  singleAnswer?: string;
} = { docs: [document()] }): Harness {
  const generations: ChatMessage[][] = [];
  const toolCalls: ToolChatOptions[] = [];
  const singleAnswer = options.singleAnswer ?? '单次模型回复；未确诊。';
  // The awaited main loop was removed 2026-11-10 (latency): any call into
  // chatWithTools from the answer path is a regression, so the stub fails
  // loudly instead of answering. The shadow loop (AGENT_LOOP=shadow) still
  // uses runAgent, but only after the ordinary answer is final.
  const toolProvider: Provider = {
    name: 'deepseek', model: 'fixture-tool-model', isConfigured: () => true,
    chat: async () => { throw new Error('tool provider chat must not be used by the loop'); },
    chatWithTools: async (_messages, toolOptions) => {
      toolCalls.push(toolOptions);
      throw new Error('tool loop must not run in the answer path');
    },
  };
  const provider: DiagnosticProvider = {
    hasAnyConfigured: () => true,
    chat: async messages => {
      generations.push(messages.map(message => ({ ...message })));
      return { result: { content: singleAnswer, model: 'fixture-model', provider: 'deepseek' }, primary: 'deepseek', fellBack: false, attempts: 1 };
    },
    toolProvider: () => (options.toolProvider === undefined ? toolProvider : options.toolProvider),
  };
  const dependencies: DiagnosticDependencies = {
    config: { logDecisions: false, agentLoop: options.agentLoop ?? 'main' },
    retrieve: () => options.docs,
  };
  return { diagnose: createDiagnosticService(provider, dependencies), generations, toolCalls, singleAnswer };
}
function request(diagnosisMode: DiagnosisMode = 'auto', content = question, overrides: Partial<DiagnosticRequest> = {}): DiagnosticRequest {
  return { ...identity, diagnosisMode, history: [{ role: 'user', content }], ...overrides };
}
function memory(progress = '', deviceId = 'device-mainloop', extra: Partial<DiagnosticMemory> = {}): DiagnosticMemory {
  return {
    session: {
      id: `session-${deviceId}`, deviceId, title: '合成诊断', progress, summary: '', revision: 0,
      updatedAt: '2026-10-13T00:00:00Z', messages: [], device: { id: deviceId, ...identity, name: '合成设备', hours: null, notes: '', updatedAt: '2026-10-13T00:00:00Z' },
    }, priorReports: [], ...extra,
  };
}
function reply(response: ChatResponse) { return response.choices[0].message.content; }

// Awaited main loop removed 2026-11-10: production traces showed it hitting
// its 8 s deadline in 5 of 6 turns (two sequential generations need ~8-9 s),
// burning ~8 s before the single call ran again (server total ~16 s).
// The answer now comes from the single llm.chat() call, exactly the path
// those turns fell back to; only one generation runs per turn.
test('AGENT_LOOP=main 不再阻塞回答：答案走单次 llm.chat()，chatWithTools 不被调用', async () => {
  const h = harness({ docs: [document()] });
  const response = await h.diagnose(request());
  assert.equal(response.coordination?.route, 'ai');
  assert.equal(response.diagnosticReply?.aiSupplement, h.singleAnswer);
  assert.match(reply(response), /单次模型回复/);
  assert.equal(h.generations.length, 1);
  assert.equal(h.toolCalls.length, 0);
  assert.equal(response.provider, 'deepseek');
  assert.equal(response.model, 'fixture-model');
  assert.equal(response.diagnosisTrace?.mainLoop?.enabled, false);
  assert.equal(response.diagnosisTrace?.mainLoop?.ran, false);
  assert.equal(response.diagnosisTrace?.mainLoop?.status, null);
  assert.equal(response.diagnosisTrace?.mainLoop?.reason, null);
  assert.equal(response.diagnosisTrace?.mainLoop?.toolSteps, 0);
  assert.deepEqual(response.diagnosisTrace?.mainLoop?.toolEvents, []);
});

test('主循环关闭 off → 行为与 main 一致，单次路径回答，工具不被调用', async () => {
  const h = harness({ docs: [document()], agentLoop: 'off' });
  const response = await h.diagnose(request());
  assert.equal(response.diagnosisTrace?.mainLoop?.enabled, false);
  assert.equal(response.diagnosisTrace?.mainLoop?.ran, false);
  assert.equal(h.toolCalls.length, 0);
  assert.equal(h.generations.length, 1);
  assert.equal(response.diagnosticReply?.aiSupplement, h.singleAnswer);
});

test('shadow 模式下答案仍走单次路径，主循环 trace 保持未运行', async () => {
  const h = harness({ docs: [document()], agentLoop: 'shadow', toolProvider: null });
  const response = await h.diagnose(request());
  assert.equal(response.diagnosisTrace?.mainLoop?.enabled, false);
  assert.equal(response.diagnosisTrace?.mainLoop?.ran, false);
  assert.equal(h.toolCalls.length, 0);
  assert.equal(h.generations.length, 1);
  assert.equal(response.diagnosticReply?.aiSupplement, h.singleAnswer);
});

test('路由 local → 不调用工具供应商，也不走单次路径', async () => {
  const h = harness({ docs: [completeDocument()] });
  const response = await h.diagnose(request());
  assert.equal(response.coordination?.route, 'local');
  assert.equal(response.provider, 'knowledge-base');
  assert.equal(h.toolCalls.length, 0);
  assert.equal(h.generations.length, 0);
  assert.equal(response.diagnosisTrace?.mainLoop?.ran, false);
});

test('路由 clarify（无机型时的参数询问）→ 不调用工具供应商', async () => {
  const h = harness({ docs: [document()] });
  const response = await h.diagnose(request('auto', '变速箱齿轮间隙标准是多少', { machineType: '', brand: '', model: '' }));
  assert.equal(response.coordination?.route, 'clarify');
  assert.equal(h.toolCalls.length, 0);
  assert.equal(h.generations.length, 0);
  assert.equal(response.diagnosisTrace?.mainLoop?.ran, false);
});

test('路由 safe（制动 + 拆检请求）→ 不调用工具供应商', async () => {
  const h = harness({ docs: [document()] });
  const response = await h.diagnose(request('auto', '刹车失灵怎么办，怎么拆刹车'));
  assert.equal(response.coordination?.route, 'safe');
  assert.equal(h.toolCalls.length, 0);
  assert.equal(h.generations.length, 0);
  assert.equal(response.diagnosisTrace?.mainLoop?.ran, false);
});

test('knowledge_only → 不调用工具供应商', async () => {
  const h = harness({ docs: [document()] });
  const response = await h.diagnose(request('knowledge_only'));
  assert.equal(response.coordination?.route, 'local');
  assert.equal(h.toolCalls.length, 0);
  assert.equal(h.generations.length, 0);
  assert.equal(response.diagnosisTrace?.mainLoop?.ran, false);
});

test('请求信号已 abort → 不走单次路径，直接走本地回退', async () => {
  const h = harness({ docs: [document()] });
  const controller = new AbortController();
  controller.abort();
  const response = await h.diagnose(request(), undefined, controller.signal);
  assert.equal(response.diagnosisTrace?.mainLoop?.status, null);
  assert.equal(response.provider, 'knowledge-base');
  assert.equal(response.coordination?.route, 'local');
  assert.equal(h.generations.length, 0);
  assert.equal(h.toolCalls.length, 0);
});

test('本轮已有 Planner 追问 → 单次路径仍优先 Planner 追问，不调用工具', async () => {
  const h = harness({ docs: [document()] });
  const plannerMemory = memory('', 'device-planner', { plannerSessionSeed: '0123456789abcdef0123456789abcdef' });
  const response = await h.diagnose(request('auto', '水温过高怎么办'), plannerMemory);
  assert.equal(response.coordination?.route, 'ai');
  assert.equal(h.toolCalls.length, 0);
  assert.equal(h.generations.length, 1);
  assert.ok((response.diagnosticReply?.questions ?? []).some(item => item.text.includes('冷却液泄漏已有检查结果')));
});

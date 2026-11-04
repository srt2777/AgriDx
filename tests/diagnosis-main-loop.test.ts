import assert from 'node:assert/strict';
import { afterEach, beforeEach, test} from 'node:test';
import type { DiagnosisMode} from '../shared/diagnosis';
import type { ChatResponse} from '../shared/chat';
import { createDiagnosticService, mainLoopAllowedTools, type DiagnosticDependencies, type DiagnosticMemory, type DiagnosticProvider} from '../server/diagnosis/service';
import type { DiagnosticRequest} from '../server/diagnosis/request';
import type { KnowledgeChunk} from '../server/knowledge/retriever';
import type { ChatMessage, Provider, ToolChatOptions, ToolChatResult} from '../server/llm/types';
const environmentKeys = ['DIAGNOSIS_MODE', 'ALLOW_EXTERNAL_AI', 'DIAGNOSIS_RAW_HIGH_THRESHOLD', 'DIAGNOSIS_RAW_MEDIUM_THRESHOLD', 'AGENT_LOOP'];
const savedEnvironment = new Map<string, string | undefined>();
beforeEach(() => {
    for (const key of environmentKeys) { savedEnvironment.set(key, process.env[key]); delete process.env[key];}
});
afterEach(() => {
    for (const key of environmentKeys) {
      const value = savedEnvironment.get(key);
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
});
const identity = { machineType: '拖拉机', brand: '东方红', model: 'LF904S'};
const question = '指示灯间歇闪烁怎么办';
function document(overrides: Partial<KnowledgeChunk> = {}): KnowledgeChunk {
  return {
    source: 'test-fixtures/indicator.md', heading: 'TEST-MAINLOOP-001｜试验台指示灯间歇闪烁',
    text: '- 故障现象：合成试验台指示灯间歇闪烁。\n- 可能原因：合成接触状态异常，实际原因尚未确认。\n- 诊断步骤：只核对已有离线观察记录。\n- 维修建议：由试验台维护人员处理。\n- 验证状态：原文已核验；未实车验证。\n末尾限制：测试数据不得用于真实维修。',
    entryId: 'TEST-MAINLOOP-001', sourceId: 'SRC-TEST-MAINLOOP', indexedReference: { entryId: 'TEST-MAINLOOP-001', sourceId: 'SRC-TEST-MAINLOOP'},
    brand: identity.brand, model: identity.model, models: [identity.model], entryType: '维护/故障知识', applicability: 'matched',
    locator: '合成资料PDF第3页；印刷页2', version: '合成测试版1', status: '原文已核验；未厂家复核、未实车验证。',
    scopeBoundary: '仅限合成测试台LF904S；不能用于真实车辆。',
    diagnosticMetadata: { coverage: { symptom: true, causes: true, checks: false, repair: false}, riskLevel: 'low'},
    relevance: { score: 12, method: 'keyword-weighted-overlap', calibrated: false},...overrides,
  };
}
function completeDocument(): KnowledgeChunk {
  return document({ diagnosticMetadata: { coverage: { symptom: true, causes: true, checks: true, repair: true}, riskLevel: 'low'}});
}
type ToolScript = 'answer' | 'question' | 'throw' | 'disallowed' | 'unsafe' | 'hang' | 'dsml' | 'dsml-prose';
const DSML_BLOCK = `<｜DSML｜tool_calls>
<｜DSML｜invoke name="search_knowledge">
<｜DSML｜parameter name="brand" string="true">东方红</｜DSML｜parameter>
<｜DSML｜parameter name="model" string="true">LX2204</｜DSML｜parameter>
<｜DSML｜parameter name="query" string="true">水温表 冷却水温度 过高</｜DSML｜parameter>
</｜DSML｜invoke>
</｜DSML｜tool_calls>`;
interface Harness {
  diagnose: ReturnType<typeof createDiagnosticService>;
  generations: ChatMessage[][];
  toolCalls: ToolChatOptions[];
  singleAnswer: string;
  mainLoopAnswer: string;
}
function harness(options: {
    docs: KnowledgeChunk[];
    agentLoop?: 'off' | 'shadow' | 'main';
    script?: ToolScript;
    toolProvider?: Provider | null;
    mainLoopTimeoutMs?: number;
    singleAnswer?: string;
  } = { docs: [document()]}): Harness {
  const generations: ChatMessage[][] = [];
  const toolCalls: ToolChatOptions[] = [];
  const singleAnswer = options.singleAnswer?? '单次模型回复；未确诊。';
  const mainLoopAnswer = '主循环模型回复，可能原因尚待检查验证。';
  const script = options.script?? 'answer';
  const toolProvider: Provider = {
    name: 'deepseek', model: 'fixture-tool-model', isConfigured: () => true,
    chat: async () => { throw new Error('tool provider chat must not be used by the loop');},
    chatWithTools: async (_messages, toolOptions) => {
      toolCalls.push(toolOptions);
      if (script === 'throw') throw new Error('synthetic tool provider failure');
      if (script === 'hang') return new Promise<ToolChatResult>(() => {});
      const callNumber = toolCalls.length;
      if (script === 'answer') {
        if (callNumber === 1) return { content: '', stopReason: 'tool_calls', toolCalls: [{ id: 't1', name: 'search_knowledge', input: { query: '指示灯间歇闪烁'}}]};
        return { content: mainLoopAnswer, stopReason: 'stop', toolCalls: []};
      }
      if (script === 'dsml') return { content: DSML_BLOCK, stopReason: 'stop', toolCalls: []};
      if (script === 'dsml-prose') return { content: `${mainLoopAnswer}\n\n${DSML_BLOCK}`, stopReason: 'stop', toolCalls: []};
      if (script === 'question') return { content: '', stopReason: 'tool_calls', toolCalls: [{ id: 'q1', name: 'ask_user_for_info', input: { question: '请确认已有检查结果？'}}]};
      if (script === 'disallowed') return { content: '', stopReason: 'tool_calls', toolCalls: [{ id: 'd1', name: 'forbidden', input: {}}]};
      if (script === 'unsafe') return { content: '请拆卸高压油管检查。', stopReason: 'stop', toolCalls: []};
      throw new Error('unknown tool script');
    },
  };
  const provider: DiagnosticProvider = {
    hasAnyConfigured: () => true,
    chat: async messages => {
      generations.push(messages.map(message => ({...message})));
      return { result: { content: singleAnswer, model: 'fixture-model', provider: 'deepseek'}, primary: 'deepseek', fellBack: false, attempts: 1};
    },
    toolProvider: () => (options.toolProvider === undefined? toolProvider: options.toolProvider),
  };
  const dependencies: DiagnosticDependencies = {
    config: { logDecisions: false, agentLoop: options.agentLoop?? 'main'},
    retrieve: () => options.docs,
    ...(options.mainLoopTimeoutMs!== undefined? { mainLoopTimeoutMs: options.mainLoopTimeoutMs}: {}),
  };
  return { diagnose: createDiagnosticService(provider, dependencies), generations, toolCalls, singleAnswer, mainLoopAnswer};
}
function request(diagnosisMode: DiagnosisMode = 'auto', content = question, overrides: Partial<DiagnosticRequest> = {}): DiagnosticRequest {
  return {...identity, diagnosisMode, history: [{ role: 'user', content}],...overrides};
}
function memory(progress = '', deviceId = 'device-mainloop', extra: Partial<DiagnosticMemory> = {}): DiagnosticMemory {
  return { session: { id: `session-${deviceId}`, deviceId, title: '合成诊断', progress, summary: '', revision: 0,
      updatedAt: '2026-10-13T00:00:00Z', messages: [], device: { id: deviceId,...identity, name: '合成设备', hours: null, notes: '', updatedAt: '2026-10-13T00:00:00Z'}}, priorReports: [],...extra};
}
function reply(response: ChatResponse) { return response.choices[0].message.content;}
test('mainLoopAllowedTools removes ask_user_for_info only when the Planner already asked', () => {
    assert.ok(mainLoopAllowedTools(false).includes('ask_user_for_info'));
    assert.ok(!mainLoopAllowedTools(true).includes('ask_user_for_info'));
    assert.ok(mainLoopAllowedTools(true).includes('resolve_machine_scope'));
    assert.ok(mainLoopAllowedTools(true).includes('search_knowledge'));
});
test('主循环开启 + 路由 ai + stub 工具供应商返回 answered → 答案含主循环 aiSupplement 且 trace 含脱敏 toolEvents', async () => {
    const h = harness({ docs: [document()]});
    const response = await h.diagnose(request());
    assert.equal(response.coordination?.route, 'ai');
    assert.equal(response.diagnosticReply?.aiSupplement, h.mainLoopAnswer);
    assert.match(reply(response), /主循环模型回复/);
    assert.equal(h.generations.length, 0);
    assert.equal(response.provider, 'deepseek');
    assert.equal(response.model, 'fixture-tool-model');
    assert.equal(response.diagnosisTrace?.mainLoop?.enabled, true);
    assert.equal(response.diagnosisTrace?.mainLoop?.ran, true);
    assert.equal(response.diagnosisTrace?.mainLoop?.status, 'answered');
    assert.ok((response.diagnosisTrace?.mainLoop?.toolSteps?? 0) >= 2);
    const events = response.diagnosisTrace?.mainLoop?.toolEvents?? [];
    assert.ok(events.some(event => event.tool === 'resolve_machine_scope'));
    assert.ok(events.some(event => event.tool === 'search_knowledge'));
    for (const event of events) assert.ok(!('args' in event), 'trace tool events must not carry arguments');
    assert.doesNotMatch(JSON.stringify(response.diagnosisTrace?.mainLoop), /指示灯间歇闪烁怎么办/);
});
test('主循环返回 question 且无 Planner 追问 → 该问题成为本轮追问，本地事实段落不变', async () => {
    const h = harness({ docs: [document()], script: 'question'});
    const response = await h.diagnose(request());
    assert.equal(response.diagnosisTrace?.mainLoop?.status, 'question');
    assert.deepEqual(response.diagnosticReply?.questions, [{ text: '请确认已有检查结果？'}]);
    assert.equal(response.diagnosticReply?.aiSupplement, undefined);
    assert.equal(h.generations.length, 0);
    assert.ok((response.diagnosticReply?.causes?? []).length > 0 || (response.diagnosticReply?.suggestions?? []).length > 0);
});
test('主循环返回 fallback（供应商抛错）→ 走单次 llm.chat() 路径，答案与原来一致', async () => {
    const h = harness({ docs: [document()], script: 'throw'});
    const response = await h.diagnose(request());
    assert.equal(response.diagnosisTrace?.mainLoop?.status, 'fallback');
    assert.equal(h.generations.length, 1);
    assert.equal(response.diagnosticReply?.aiSupplement, h.singleAnswer);
    assert.equal(response.model, 'fixture-model');
});
test('主循环返回 fallback（越权工具）→ 走单次路径，不抛错', async () => {
    const h = harness({ docs: [document()], script: 'disallowed'});
    const response = await h.diagnose(request());
    assert.equal(response.diagnosisTrace?.mainLoop?.status, 'fallback');
    assert.equal(h.generations.length, 1);
    assert.equal(response.diagnosticReply?.aiSupplement, h.singleAnswer);
});
test('主循环返回 guard 否决内容 → 走单次路径，不返回未过滤内容', async () => {
    const h = harness({ docs: [document()], script: 'unsafe'});
    const response = await h.diagnose(request());
    assert.equal(response.diagnosisTrace?.mainLoop?.status, 'fallback');
    assert.equal(h.generations.length, 1);
    assert.doesNotMatch(reply(response), /拆卸高压油管/);
    assert.equal(response.diagnosticReply?.aiSupplement, h.singleAnswer);
});
test('主循环超时（未 abort）→ 按 fallback 处理，走单次路径', async () => {
    const h = harness({ docs: [document()], script: 'hang', mainLoopTimeoutMs: 100});
    const response = await h.diagnose(request());
    assert.equal(response.diagnosisTrace?.mainLoop?.status, 'fallback');
    assert.equal(h.generations.length, 1);
    assert.equal(response.diagnosticReply?.aiSupplement, h.singleAnswer);
});
test('主循环关闭 off → 行为与原来一致，工具供应商的 chatWithTools 不被调用', async () => {
    const h = harness({ docs: [document()], agentLoop: 'off'});
    const response = await h.diagnose(request());
    assert.equal(response.diagnosisTrace?.mainLoop?.enabled, false);
    assert.equal(response.diagnosisTrace?.mainLoop?.ran, false);
    assert.equal(h.toolCalls.length, 0);
    assert.equal(h.generations.length, 1);
    assert.equal(response.diagnosticReply?.aiSupplement, h.singleAnswer);
});
test('shadow 模式下主循环不运行，答案仍走单次路径', async () => {
    const h = harness({ docs: [document()], agentLoop: 'shadow', toolProvider: null});
    const response = await h.diagnose(request());
    assert.equal(response.diagnosisTrace?.mainLoop?.enabled, false);
    assert.equal(response.diagnosisTrace?.mainLoop?.ran, false);
    assert.equal(h.toolCalls.length, 0);
    assert.equal(h.generations.length, 1);
    assert.equal(response.diagnosticReply?.aiSupplement, h.singleAnswer);
});
test('路由 local → 主循环不运行，工具供应商不被调用', async () => {
    const h = harness({ docs: [completeDocument()]});
    const response = await h.diagnose(request());
    assert.equal(response.coordination?.route, 'local');
    assert.equal(response.provider, 'knowledge-base');
    assert.equal(h.toolCalls.length, 0);
    assert.equal(h.generations.length, 0);
    assert.equal(response.diagnosisTrace?.mainLoop?.ran, false);
});
test('路由 clarify（无机型时的参数询问）→ 主循环不运行', async () => {
    const h = harness({ docs: [document()]});
    const response = await h.diagnose(request('auto', '变速箱齿轮间隙标准是多少', { machineType: '', brand: '', model: ''}));
    assert.equal(response.coordination?.route, 'clarify');
    assert.equal(h.toolCalls.length, 0);
    assert.equal(h.generations.length, 0);
    assert.equal(response.diagnosisTrace?.mainLoop?.ran, false);
});
test('路由 safe（制动 + 拆检请求）→ 主循环不运行', async () => {
    const h = harness({ docs: [document()]});
    const response = await h.diagnose(request('auto', '刹车失灵怎么办，怎么拆刹车'));
    assert.equal(response.coordination?.route, 'safe');
    assert.equal(h.toolCalls.length, 0);
    assert.equal(h.generations.length, 0);
    assert.equal(response.diagnosisTrace?.mainLoop?.ran, false);
});
test('knowledge_only → 主循环不运行，工具供应商不被调用', async () => {
    const h = harness({ docs: [document()]});
    const response = await h.diagnose(request('knowledge_only'));
    assert.equal(response.coordination?.route, 'local');
    assert.equal(h.toolCalls.length, 0);
    assert.equal(h.generations.length, 0);
    assert.equal(response.diagnosisTrace?.mainLoop?.ran, false);
});
test('请求信号已 abort 且主循环 cancelled → 不走单次路径，直接走本地回退', async () => {
    const h = harness({ docs: [document()]});
    const controller = new AbortController();
    controller.abort();
    const response = await h.diagnose(request(), undefined, controller.signal);
    assert.equal(response.diagnosisTrace?.mainLoop?.status, 'cancelled');
    assert.equal(response.provider, 'knowledge-base');
    assert.equal(response.coordination?.route, 'local');
    assert.equal(h.generations.length, 0);
    assert.equal(h.toolCalls.length, 0);
});
test('本轮已有 Planner 追问 → 主循环工具定义不含 ask_user_for_info，且 Planner 追问优先', async () => {
    const h = harness({ docs: [document()]});
    const plannerMemory = memory('', 'device-planner', { plannerSessionSeed: '0123456789abcdef0123456789abcdef'});
    const response = await h.diagnose(request('auto', '水温过高怎么办'), plannerMemory);
    assert.equal(response.coordination?.route, 'ai');
    assert.ok(h.toolCalls.length >= 1, 'main loop must have called the tool provider');
    assert.ok(!h.toolCalls[0].tools.some(tool => tool.name === 'ask_user_for_info'), 'ask_user_for_info must be excluded when Planner already asked');
    assert.ok(h.toolCalls[0].tools.some(tool => tool.name === 'search_knowledge'));
    assert.equal(h.generations.length, 0);
    assert.ok((response.diagnosticReply?.questions?? []).some(item => item.text.includes('冷却液泄漏已有检查结果')));
});
test('主循环最终答案含 DSML 标记 → 定稿后正文不再含 DSML，纯 DSML 则回退单次路径', async () => {
    const prose = harness({ docs: [document()], script: 'dsml-prose'});
    const proseResponse = await prose.diagnose(request());
    assert.equal(proseResponse.diagnosisTrace?.mainLoop?.status, 'answered');
    assert.match(proseResponse.diagnosticReply?.aiSupplement ?? '', /主循环模型回复/);
    assert.doesNotMatch(reply(proseResponse), /DSML|search_knowledge|LX2204/);
    const pure = harness({ docs: [document()], script: 'dsml'});
    const pureResponse = await pure.diagnose(request());
    assert.equal(pureResponse.diagnosisTrace?.mainLoop?.status, 'fallback');
    assert.equal(pureResponse.diagnosisTrace?.mainLoop?.reason, 'answer_rejected');
    assert.equal(pureResponse.diagnosticReply?.aiSupplement, pure.singleAnswer);
    assert.doesNotMatch(reply(pureResponse), /DSML|search_knowledge/);
});
test('主循环回退 trace 携带脱敏 reason，供生产日志区分回退触发点', async () => {
    const h = harness({ docs: [document()], script: 'throw'});
    const response = await h.diagnose(request());
    assert.equal(response.diagnosisTrace?.mainLoop?.status, 'fallback');
    assert.equal(response.diagnosisTrace?.mainLoop?.reason, 'provider_or_tool_error');
    assert.doesNotMatch(JSON.stringify(response.diagnosisTrace?.mainLoop), /指示灯间歇闪烁怎么办/);
});

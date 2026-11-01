import assert from 'node:assert/strict';
import { afterEach, beforeEach, test} from 'node:test';
import type { DiagnosisMode} from '../shared/diagnosis';
import type { ChatResponse} from '../shared/chat';
import { createDiagnosticService, type DiagnosticDependencies, type DiagnosticMemory, type DiagnosticProvider} from '../server/diagnosis/service';
import type { DiagnosticRequest} from '../server/diagnosis/request';
import type { KnowledgeChunk} from '../server/knowledge/retriever';
import type { ChatMessage, Provider} from '../server/llm/types';
import type { ShadowReviewRecord} from '../agent/shadow-review';

const environmentKeys = ['DIAGNOSIS_MODE', 'ALLOW_EXTERNAL_AI'];
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
function document(): KnowledgeChunk {
return {
source: 'test-fixtures/indicator.md', heading: 'TEST-GATE-001｜试验台指示灯间歇闪烁',
text: '- 故障现象：合成试验台指示灯间歇闪烁。\n- 可能原因：合成接触状态异常，实际原因尚未确认。\n- 诊断步骤：只核对已有离线观察记录。\n- 维修建议：由试验台维护人员处理。\n- 验证状态：原文已核验；未实车验证。\n末尾限制：测试数据不得用于真实维修。',
entryId: 'TEST-GATE-001', sourceId: 'SRC-TEST-GATE', indexedReference: { entryId: 'TEST-GATE-001', sourceId: 'SRC-TEST-GATE'},
brand: identity.brand, model: identity.model, models: [identity.model], entryType: '维护/故障知识', applicability: 'matched',
locator: '合成资料PDF第3页；印刷页2', version: '合成测试版1', status: '原文已核验；未厂家复核、未实车验证。',
scopeBoundary: '仅限合成测试台LF904S；不能用于真实车辆。',
// Incomplete coverage forces the AI route in auto mode, so the shadow
// call site is reachable there and must be gated in the other modes.
diagnosticMetadata: { coverage: { symptom: true, causes: true, checks: false, repair: false}, riskLevel: 'low'},
relevance: { score: 12, method: 'keyword-weighted-overlap', calibrated: false},
};
}
function request(diagnosisMode: DiagnosisMode): DiagnosticRequest {
return {...identity, diagnosisMode, history: [{ role: 'user', content: question}]};
}
function memory(): DiagnosticMemory {
return { session: { id: 'session-gate-1', deviceId: 'device-gate-1', title: '合成诊断', progress: '', summary: '', revision: 0,
updatedAt: '2026-10-13T00:00:00Z', messages: [], device: { id: 'device-gate-1',...identity, name: '合成设备', hours: null, notes: '', updatedAt: '2026-10-13T00:00:00Z'}}, priorReports: []};
}
function fakeToolProvider(chatWithTools: NonNullable<Provider['chatWithTools']>): Provider {
return { name: 'deepseek', model: 'fake', isConfigured: () => true, chat: async () => { throw Error('unused');}, chatWithTools};
}
interface GateHarness {
diagnose: ReturnType<typeof createDiagnosticService>;
records: ShadowReviewRecord[];
reports: Parameters<NonNullable<DiagnosticDependencies['onShadowResult']>>[0][];
nextRecord: () => Promise<ShadowReviewRecord>;
shadowCalls: () => number;
}
function gateHarness(): GateHarness {
let shadowCalls = 0;
const tool = fakeToolProvider(async () => shadowCalls++ === 0
? { content: '', stopReason: 'tool_calls', toolCalls: [{ id: 'x', name: 'calculator', input: { expression: '2+2'}}]}
: { content: '合成影子答复。', stopReason: 'stop', toolCalls: []});
const records: ShadowReviewRecord[] = [];
const reports: GateHarness['reports'] = [];
let notify: (() => void) | undefined;
const provider: DiagnosticProvider = { hasAnyConfigured: () => true, toolProvider: () => tool,
chat: async () => ({ result: { content: '合成模型回复；未确诊。', model: 'fixture-model', provider: 'deepseek'}, primary: 'deepseek', fellBack: false, attempts: 1})};
const diagnose = createDiagnosticService(provider, {
config: { logDecisions: false, agentLoop: 'shadow'},
retrieve: () => [document()],
onShadowResult: (report) => { reports.push(report);},
onShadowReview: (record) => { records.push(record); notify?.();},
});
const nextRecord = () => new Promise<ShadowReviewRecord>((resolve) => {
const count = records.length;
notify = () => { if (records.length > count) resolve(records.at(-1)!);};
});
return { diagnose, records, reports, nextRecord, shadowCalls: () => shadowCalls};
}
function reply(response: ChatResponse) { return response.choices[0].message.content;}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('knowledge_only: service returns a local answer and produces no shadow review record', async () => {
const h = gateHarness();
const response = await h.diagnose(request('knowledge_only'), memory());
await sleep(20);
assert.equal(response.provider, 'knowledge-base');
assert.equal(response.coordination?.route, 'local');
assert.equal(response.coordination?.reason, 'local_requested');
assert.equal(h.shadowCalls(), 0);
assert.equal(h.reports.length, 0);
assert.equal(h.records.length, 0);
assert.doesNotMatch(JSON.stringify(response), /calculator|合成影子答复/);
});

test('allowExternal denied (ALLOW_EXTERNAL_AI=false): service returns a local answer and produces no shadow review record', async () => {
process.env.ALLOW_EXTERNAL_AI = 'false';
try {
const h = gateHarness();
const response = await h.diagnose(request('auto'), memory());
await sleep(20);
assert.equal(response.provider, 'knowledge-base');
assert.equal(response.coordination?.route, 'local');
assert.equal(response.coordination?.reason, 'server_local_only');
assert.equal(h.shadowCalls(), 0);
assert.equal(h.reports.length, 0);
assert.equal(h.records.length, 0);
} finally { delete process.env.ALLOW_EXTERNAL_AI;}
});

test('positive control: the same harness in auto mode does produce a review-only record, outside the answer', async () => {
const h = gateHarness();
const pending = h.nextRecord();
const response = await h.diagnose(request('auto'), memory());
const record = await pending;
assert.equal(record.reviewOnly, true);
assert.equal(record.sessionId, 'session-gate-1');
assert.equal(record.mainRoute, 'ai');
assert.equal(record.safety, 'ok');
assert.doesNotMatch(reply(response), /calculator|合成影子答复/);
assert.equal(JSON.stringify(response).includes('calculator'), false);
});

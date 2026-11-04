import assert from 'node:assert/strict';
import { afterEach, beforeEach, test} from 'node:test';
import type { DiagnosisMode} from '../shared/diagnosis';
import { createDiagnosticService, type DiagnosticDecisionLog, type DiagnosticDependencies} from '../server/diagnosis/service';
import type { DiagnosticRequest} from '../server/diagnosis/request';
import type { KnowledgeChunk} from '../server/knowledge/retriever';

// Synthetic offline fixture: this is not a new tractor repair fact or a claim of vehicle validation.
const environmentKeys = ['DIAGNOSIS_MODE', 'ALLOW_EXTERNAL_AI', 'DIAGNOSIS_RAW_HIGH_THRESHOLD', 'DIAGNOSIS_RAW_MEDIUM_THRESHOLD'];
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
function document(overrides: Partial<KnowledgeChunk> = {}): KnowledgeChunk {
return {
source: 'test-fixtures/indicator.md', heading: 'TEST-LOG-001｜试验台指示灯间歇闪烁',
text: '- 故障现象：合成试验台指示灯间歇闪烁。\n- 可能原因：合成接触状态异常，实际原因尚未确认。\n- 诊断步骤：只核对已有离线观察记录。\n- 维修建议：由试验台维护人员处理。\n- 验证状态：原文已核验；未实车验证。\n末尾限制：测试数据不得用于真实维修。',
entryId: 'TEST-LOG-001', sourceId: 'SRC-TEST-LOG', indexedReference: { entryId: 'TEST-LOG-001', sourceId: 'SRC-TEST-LOG'},
brand: identity.brand, model: identity.model, models: [identity.model], entryType: '维护/故障知识', applicability: 'matched',
locator: '合成资料PDF第3页；印刷页2', version: '合成测试版1', status: '原文已核验；未厂家复核、未实车验证。',
scopeBoundary: '仅限合成测试台LF904S；不能用于真实车辆。',
diagnosticMetadata: { coverage: { symptom: true, causes: true, checks: true, repair: true}, riskLevel: 'low'},
relevance: { score: 12, method: 'keyword-weighted-overlap', calibrated: false},...overrides,
};
}
function request(diagnosisMode: DiagnosisMode = 'auto'): DiagnosticRequest {
return {...identity, diagnosisMode, history: [{ role: 'user', content: '指示灯间歇闪烁怎么办'}]};
}
function harness(docs: KnowledgeChunk[], options: { answer?: string; dependencies?: DiagnosticDependencies} = {}) {
const events: DiagnosticDecisionLog[] = [];
const diagnose = createDiagnosticService({
hasAnyConfigured: () => true,
chat: async () => ({ result: { content: options.answer?? '合成模型回复；未确诊。', model: 'fixture-model', provider: 'deepseek'}, primary: 'deepseek', fellBack: false, attempts: 1}),
}, {
...options.dependencies,
config: { logDecisions: false,...options.dependencies?.config},
onDecision: event => { events.push(event);},
retrieve: () => docs,
});
return { diagnose, events};
}
const flushDecisionLogs = () => new Promise<void>(resolve => setImmediate(resolve));

test('decision log carries guard rule codes when the AI supplement is fully rejected', async () => {
const incomplete = document({ diagnosticMetadata: { coverage: { symptom: true, causes: true, checks: false, repair: false}, riskLevel: 'low'}});
const h = harness([incomplete], { answer: ''});
const response = await h.diagnose(request());
await flushDecisionLogs();
assert.equal(response.coordination?.route, 'local');
assert.equal(response.coordination?.reason, 'output_rejected');
assert.deepEqual(response.coordination?.outputIssues, ['answer_length']);
assert.equal(h.events.length, 1);
assert.equal(h.events[0].route, 'local');
assert.equal(h.events[0].reason, 'output_rejected');
assert.deepEqual(h.events[0].outputIssues, ['answer_length']);
});

test('decision log reports null outputIssues when nothing was rejected', async () => {
const h = harness([document()]);
const response = await h.diagnose(request());
await flushDecisionLogs();
assert.equal(response.coordination?.route, 'local');
assert.equal(h.events.length, 1);
assert.equal(h.events[0].outputIssues, null);
});

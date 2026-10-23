import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import type { DiagnosisMode } from '../shared/diagnosis';
import type { ChatResponse } from '../shared/chat';
import { createDiagnosticService, type DiagnosticDependencies, type DiagnosticMemory, type DiagnosticProvider } from '../server/diagnosis/service';
import { DiagnosticInputError, parseDiagnosticRequest, type DiagnosticRequest } from '../server/diagnosis/request';
import type { KnowledgeChunk } from '../server/knowledge/retriever';
import type { ChatMessage } from '../server/llm/types';
import { ProviderError } from '../server/llm/types';

const environmentKeys = ['DIAGNOSIS_MODE', 'ALLOW_EXTERNAL_AI', 'DIAGNOSIS_RAW_HIGH_THRESHOLD', 'DIAGNOSIS_RAW_MEDIUM_THRESHOLD'];
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
const modes: DiagnosisMode[] = ['auto', 'knowledge_only', 'ai_assisted'];
const question = '指示灯间歇闪烁怎么办';
// Synthetic offline fixture: this is not a new tractor repair fact or a claim of vehicle validation.
function document(overrides: Partial<KnowledgeChunk> = {}): KnowledgeChunk {
  return {
    source: 'test-fixtures/indicator.md', heading: 'TEST-ROUTER-001｜试验台指示灯间歇闪烁',
    text: '- 故障现象：合成试验台指示灯间歇闪烁。\n- 可能原因：合成接触状态异常，实际原因尚未确认。\n- 诊断步骤：只核对已有离线观察记录。\n- 维修建议：由试验台维护人员处理。\n- 验证状态：原文已核验；未实车验证。\n末尾限制：测试数据不得用于真实维修。',
    entryId: 'TEST-ROUTER-001', sourceId: 'SRC-TEST-ROUTER', indexedReference: { entryId: 'TEST-ROUTER-001', sourceId: 'SRC-TEST-ROUTER' },
    brand: identity.brand, model: identity.model, models: [identity.model], entryType: '维护/故障知识', applicability: 'matched',
    locator: '合成资料PDF第3页；印刷页2', version: '合成测试版1', status: '原文已核验；未厂家复核、未实车验证。',
    scopeBoundary: '仅限合成测试台LF904S；不能用于真实车辆。',
    diagnosticMetadata: { coverage: { symptom: true, causes: true, checks: true, repair: true }, riskLevel: 'low' },
    relevance: { score: 12, method: 'keyword-weighted-overlap', calibrated: false }, ...overrides,
  };
}
function request(diagnosisMode: DiagnosisMode = 'auto', content = question, overrides: Partial<DiagnosticRequest> = {}): DiagnosticRequest {
  return { ...identity, diagnosisMode, history: [{ role: 'user', content }], ...overrides };
}
function harness(docs: KnowledgeChunk[], options: { configured?: boolean; failure?: ProviderError; answer?: string; dependencies?: DiagnosticDependencies } = {}) {
  const searches: { query: string; topK: number | undefined; scope: unknown }[] = [];
  const generations: ChatMessage[][] = [];
  const configured = options.configured ?? true;
  const provider: DiagnosticProvider = {
    hasAnyConfigured: () => configured,
    chat: async messages => {
      generations.push(messages.map(message => ({ ...message })));
      if (options.failure) throw options.failure;
      return { result: { content: options.answer ?? '【通用分析（待验证）】合成模型回复；未确诊。', model: 'fixture-model', provider: 'deepseek' }, primary: 'deepseek', fellBack: false, attempts: 1 };
    },
  };
  const diagnose = createDiagnosticService(provider, {
    ...options.dependencies,
    config: { logDecisions: false, ...options.dependencies?.config },
    retrieve: (query, topK, scope) => { searches.push({ query, topK, scope }); return docs; },
  });
  return { diagnose, searches, generations };
}
function reply(response: ChatResponse) { return response.choices[0].message.content; }
function assertOneRetrieval(response: ChatResponse, h: ReturnType<typeof harness>) {
  assert.equal(h.searches.length, 1);
  assert.equal(response.diagnosisTrace?.retrievalCount, 1);
  const sourceIds = new Set(response.knowledgeSources.flatMap(source => source.entryId ? [source.entryId] : []));
  for (const item of [...(response.diagnosticReply?.causes ?? []), ...(response.diagnosticReply?.suggestions ?? [])]) {
    for (const entryId of item.evidenceIds) assert.ok(sourceIds.has(entryId), `answer evidence must be displayed: ${entryId}`);
  }
}
function memory(progress: string, deviceId: string): DiagnosticMemory {
  return { session: { id: `session-${deviceId}`, deviceId, title: '合成诊断', progress, summary: '', revision: 0,
    updatedAt: '2026-10-13T00:00:00Z', messages: [], device: { id: deviceId, ...identity, name: '合成设备', hours: null, notes: '', updatedAt: '2026-10-13T00:00:00Z' } }, priorReports: [] };
}

test('高原始相关分、完整且适用的文献直接回复；一次检索、零AI且评分不冒充概率', async () => {
  const h = harness([document()]);
  const response = await h.diagnose(request());
  assertOneRetrieval(response, h);
  assert.equal(response.provider, 'knowledge-base');
  assert.equal(response.coordination?.route, 'local');
  assert.equal(h.generations.length, 0);
  assert.equal(response.diagnosisTrace?.aiAttempts, 0);
  const candidate = response.coordination?.candidates?.[0];
  assert.equal(candidate?.relevance.score, 12);
  assert.equal(candidate?.relevance.calibrated, false);
  assert.equal(candidate?.verificationBasis, 'document-review');
  assert.equal(response.knowledgeSources[0].entryId, 'TEST-ROUTER-001');
  assert.equal(response.diagnosticReply?.supportLevel, 'manual');
  assert.ok(response.diagnosticReply?.causes.some(cause => cause.evidenceIds.includes('TEST-ROUTER-001')));
  assert.ok(response.diagnosticReply?.suggestions.length);
  assert.match(response.knowledgeSources[0].status ?? '', /未实车验证/);
  assert.doesNotMatch(reply(response), /TEST-ROUTER-001|【手册依据】/);
});

test('高相关但检查和维修内容缺失时使用同一次检索上下文，仅生成一次', async () => {
  const doc = document({ diagnosticMetadata: { coverage: { symptom: true, causes: true, checks: false, repair: false }, riskLevel: 'low' } });
  const h = harness([doc]);
  const response = await h.diagnose(request());
  assertOneRetrieval(response, h);
  assert.equal(response.coordination?.route, 'ai');
  assert.equal(h.generations.length, 1);
  assert.match(h.generations[0][0].content, /TEST-ROUTER-001/);
  assert.equal(response.diagnosisTrace?.aiSuccesses, 1);
  assert.equal(response.diagnosisTrace?.aiProvider, 'deepseek');
  assert.equal(response.coordination?.candidates?.[0].coverageSufficient, false);
});

test('问题只询问原因时不强迫具备维修字段，也不重复要求已经提供的车型', async () => {
  const h = harness([document({ diagnosticMetadata: { coverage: { symptom: true, causes: true, checks: false, repair: false }, riskLevel: 'low' } })]);
  const response = await h.diagnose(request('auto', '指示灯间歇闪烁可能是什么原因'));
  assert.equal(response.provider, 'knowledge-base');
  assert.equal(h.generations.length, 0);
  assert.deepEqual(response.coordination?.requiredCoverage, ['symptom', 'causes']);
});

test('候选中只有后一条覆盖充分时，本地回答使用该充分证据而非首条不完整片段', async () => {
  const incomplete = document({ text: 'TOP-CANDIDATE-INCOMPLETE',
    diagnosticMetadata: { coverage: { symptom: true, causes: true, checks: false, repair: false }, riskLevel: 'low' } });
  const complete = document({ entryId: 'TEST-ROUTER-002', heading: 'TEST-ROUTER-002｜试验台完整指示灯故障条目',
    indexedReference: { entryId: 'TEST-ROUTER-002', sourceId: 'SRC-TEST-ROUTER' }, text: 'SUFFICIENT-SECOND-CANDIDATE',
    relevance: { score: 10, method: 'keyword-weighted-overlap', calibrated: false } });
  const h = harness([incomplete, complete]);
  const response = await h.diagnose(request());
  assertOneRetrieval(response, h);
  assert.equal(response.coordination?.route, 'local');
  assert.equal(h.generations.length, 0);
  assert.deepEqual(response.knowledgeSources.map(source => source.entryId), ['TEST-ROUTER-002']);
  assert.equal(response.diagnosticReply?.supportLevel, 'manual');
  assert.doesNotMatch(reply(response), /TOP-CANDIDATE-INCOMPLETE/);
});

test('明确车型冲突的文献不进入AI上下文或实际来源', async () => {
  const h = harness([document({ model: 'LF954S', models: ['LF954S'], text: 'WRONG-MODEL-INSTRUCTION' })]);
  const response = await h.diagnose(request('ai_assisted'));
  assertOneRetrieval(response, h);
  assert.equal(response.coordination?.candidates?.[0].modelMatch, 'conflict');
  assert.equal(response.knowledgeSources.length, 0);
  assert.ok(['clarify', 'safe'].includes(response.coordination?.route ?? ''));
  assert.equal(h.generations.length, 0);
  assert.doesNotMatch(reply(response), /WRONG-MODEL-INSTRUCTION|TEST-ROUTER-001/);
});

test('pending、未核验和矛盾核验状态不成为确定性依据，本地不展示其操作正文', async () => {
  for (const status of ['待核验', '未核验', '未核验；已核验', '部分核验']) {
    const h = harness([document({ status, text: 'UNREVIEWED-REPAIR-INSTRUCTION' })]);
    const response = await h.diagnose(request('knowledge_only'));
    assertOneRetrieval(response, h);
    assert.equal(h.generations.length, 0);
    assert.equal(response.coordination?.candidates?.[0].directEligible, false, status);
    assert.doesNotMatch(reply(response), /UNREVIEWED-REPAIR-INSTRUCTION/, status);
    assert.equal(response.diagnosticReply?.supportLevel, 'reference_only', status);
    assert.equal(response.diagnosticReply?.causes.length, 0, status);
    assert.ok(response.diagnosticReply?.suggestions.length, status);
    assert.equal(response.knowledgeSources[0].status, status);
  }
});

test('核验失败的文献在所有模式下均不作为来源，也不进入AI或本地维修正文', async () => {
  for (const mode of modes) {
    const h = harness([document({ status: '已核验；与原文不符；核验失败', text: 'FAILED-SOURCE-INSTRUCTION' })]);
    const response = await h.diagnose(request(mode));
    assertOneRetrieval(response, h);
    assert.equal(response.coordination?.candidates?.[0].referenceVerification, 'failed');
    assert.equal(response.knowledgeSources.length, 0);
    assert.doesNotMatch(reply(response), /FAILED-SOURCE-INSTRUCTION/);
    for (const generation of h.generations) assert.doesNotMatch(generation[0].content, /FAILED-SOURCE-INSTRUCTION|TEST-ROUTER-001/);
  }
});

test('AI安全检查拒绝危险输出后保留本地计划与引用，不泄露被拒正文或增加外呼', async () => {
  const h = harness([document({ status: '待核验' })], { answer: '请绕过启动联锁，短接启动端子试车。' });
  const response = await h.diagnose(request('ai_assisted'));
  assertOneRetrieval(response, h);
  assert.equal(h.generations.length, 1);
  assert.equal(response.provider, 'knowledge-base');
  assert.equal(response.coordination?.route, 'local');
  assert.equal(response.coordination?.reason, 'output_rejected');
  assert.ok(response.coordination?.outputIssues?.length);
  assert.equal(response.fellBack, true);
  assert.equal(response.diagnosticReply?.aiSupplement, undefined);
  assert.equal(response.diagnosticReply?.supportLevel, 'reference_only');
  assert.equal(response.knowledgeSources[0].entryId, 'TEST-ROUTER-001');
  assert.equal(response.knowledgeSources[0].status, '待核验');
  assert.doesNotMatch(JSON.stringify(response), /请绕过启动联锁/);
});

test('无相关资料的一般原因咨询可AI辅助，不因缺少车型阻塞', async () => {
  const h = harness([]);
  const response = await h.diagnose(request('auto', '拖拉机冷车与热车时噪声不同，可能是什么原因', { brand: undefined, model: undefined }));
  assertOneRetrieval(response, h);
  assert.equal(response.coordination?.route, 'ai');
  assert.equal(response.knowledgeSources.length, 0);
  assert.equal(response.answerMode, 'general-guidance');
  assert.equal(h.generations.length, 1);
});

test('制动、转向、PTO和高压液压资料不足时所有模式均安全降级、零AI', async () => {
  for (const content of ['制动失灵是什么原因', '转向突然失效是什么原因', 'PTO动力输出轴卡住怎么处理', '高压液压油管向外喷油是什么原因']) {
    for (const mode of modes) {
      const h = harness([]);
      const response = await h.diagnose(request(mode, content));
      assertOneRetrieval(response, h);
      assert.equal(response.coordination?.route, 'safe', `${mode}: ${content}`);
      assert.equal(response.coordination?.riskLevel, 'high');
      assert.equal(h.generations.length, 0);
      assert.match(reply(response), /停止危险作业/);
      assert.match(reply(response), /不提供拆解、调压或试操作步骤/);
    }
  }
});

test('英文高风险问题和多轮简短追问不能丢掉风险约束', async () => {
  for (const content of ['brakes failed', 'steering failed', 'high-pressure hydraulic oil spraying']) {
    const h = harness([]);
    assert.equal((await h.diagnose(request('ai_assisted', content))).coordination?.route, 'safe');
    assert.equal(h.generations.length, 0);
  }
  const h = harness([]);
  const response = await h.diagnose(request('auto', '还有什么可能原因', { history: [
    { role: 'user', content: '这台拖拉机制动失灵' }, { role: 'assistant', content: '请安全停机。' }, { role: 'user', content: '还有什么可能原因' },
  ] }));
  assertOneRetrieval(response, h);
  assert.equal(response.coordination?.route, 'safe');
  assert.equal(h.generations.length, 0);
});

test('知识metadata的高风险标签不能被无风险词的追问或已核验状态覆盖', async () => {
  const h = harness([document({ text: 'DANGEROUS-PROCEDURE', diagnosticMetadata: { coverage: { symptom: true, causes: true, checks: true, repair: true }, riskLevel: 'high' } })]);
  const response = await h.diagnose(request('ai_assisted', '还有什么表现'));
  assert.equal(response.coordination?.route, 'safe');
  assert.equal(h.generations.length, 0);
  assert.doesNotMatch(reply(response), /DANGEROUS-PROCEDURE/);
  assert.ok(response.knowledgeSources.some(source => source.entryId === 'TEST-ROUTER-001'));
});

test('外部provider失败回退保留正确来源，并记录尝试但不记录成功', async t => {
  t.mock.method(console, 'warn', () => {});
  const failure = new ProviderError('deepseek', 'timeout', 'DO-NOT-EXPOSE-UPSTREAM-DETAIL');
  failure.attempts = 2;
  const h = harness([document()], { failure });
  const response = await h.diagnose(request('ai_assisted'));
  assertOneRetrieval(response, h);
  assert.equal(h.generations.length, 1);
  assert.equal(response.provider, 'knowledge-base');
  assert.equal(response.coordination?.route, 'local');
  assert.equal(response.coordination?.aiRequired, false);
  assert.equal(response.fallbackReason, 'provider_unavailable');
  assert.equal(response.diagnosisTrace?.aiAttempts, 2);
  assert.equal(response.diagnosisTrace?.aiSuccesses, 0);
  assert.equal(response.diagnosisTrace?.aiProvider, null);
  assert.equal(response.knowledgeSources[0].sourceId, 'SRC-TEST-ROUTER');
  assert.doesNotMatch(JSON.stringify(response), /DO-NOT-EXPOSE-UPSTREAM-DETAIL/);
});

test('仅知识库模式禁止外部生成；AI模式保留来源和预算内上下文', async () => {
  for (const mode of modes) {
    const h = harness([document()]);
    const response = await h.diagnose(request(mode));
    assertOneRetrieval(response, h);
    assert.equal(h.generations.length, mode === 'ai_assisted' ? 1 : 0);
    assert.deepEqual(response.knowledgeSources.map(source => [source.entryId, source.sourceId, source.locator, source.version, source.referenceVerification]),
      [['TEST-ROUTER-001', 'SRC-TEST-ROUTER', '合成资料PDF第3页；印刷页2', '合成测试版1', 'verified']]);
    assert.equal(response.knowledgeSources[0].scopeBoundary, '仅限合成测试台LF904S；不能用于真实车辆。');
    assert.deepEqual(response.knowledgeSources[0].models, ['LF904S']);
    if (mode === 'ai_assisted') assert.deepEqual(response.diagnosisTrace?.sentKnowledgeIds, ['TEST-ROUTER-001']);
  }
});

test('发动机与故障码metadata明确冲突时即使相同车型也排除全文和来源', async () => {
  for (const mismatch of [
    { doc: { engineModel: 'ENGINE-A' }, req: { engineModel: 'ENGINE-B' } },
    { doc: { faultCodes: ['E001'] }, req: { faultCodes: ['E002'] } },
  ]) {
    const h = harness([document({ ...mismatch.doc, text: 'INCOMPATIBLE-ENGINE-OR-CODE' })]);
    const response = await h.diagnose(request('ai_assisted', question, mismatch.req));
    assert.equal(response.coordination?.candidates?.[0].modelMatch, 'conflict');
    assert.equal(response.knowledgeSources.length, 0);
    assert.ok(['clarify', 'safe'].includes(response.coordination?.route ?? ''));
    assert.equal(h.generations.length, 0);
    assert.doesNotMatch(reply(response), /INCOMPATIBLE-ENGINE-OR-CODE|TEST-ROUTER-001/);
  }
});

test('结构化发动机与故障码输入参与匹配并传入一次AI生成的当前设备上下文', async () => {
  const h = harness([document({ engineModel: 'ENGINE-A', faultCodes: ['E001'] })]);
  const response = await h.diagnose(request('ai_assisted', question, { engineModel: 'ENGINE-A', faultCodes: ['E001'] }));
  assertOneRetrieval(response, h);
  assert.equal(response.coordination?.candidates?.[0].modelMatch, 'exact');
  assert.equal(response.knowledgeSources[0].engineModel, 'ENGINE-A');
  assert.deepEqual(response.knowledgeSources[0].faultCodes, ['E001']);
  assert.equal(h.generations.length, 1);
  assert.match(h.generations[0][0].content, /发动机[^\n]*ENGINE-A/);
  assert.match(h.generations[0][0].content, /故障码[^\n]*E001/);
});

test('已提供发动机信息但证据适配未知时，本地只显示来源参考而非维修正文', async () => {
  const h = harness([document({ text: 'UNKNOWN-ENGINE-APPLICABILITY-INSTRUCTION' })]);
  const response = await h.diagnose(request('knowledge_only', question, { engineModel: 'ENGINE-UNKNOWN' }));
  assert.equal(response.coordination?.candidates?.[0].modelMatch, 'unknown');
  assert.doesNotMatch(reply(response), /UNKNOWN-ENGINE-APPLICABILITY-INSTRUCTION/);
  assert.equal(response.diagnosticReply?.supportLevel, 'reference_only');
  assert.equal(response.diagnosticReply?.causes.length, 0);
});

test('发动机适配未知的已核验片段不能授权AI把片段数值作为本机参数', async () => {
  const h = harness([document({ text: '合成试验台参考温度标准为37 ℃；不得用于真实车辆。' })],
    { answer: '本机温度标准为37 ℃。' });
  const response = await h.diagnose(request('ai_assisted', question, { engineModel: 'ENGINE-UNKNOWN' }));
  assertOneRetrieval(response, h);
  assert.equal(h.generations.length, 1);
  assert.equal(response.coordination?.candidates?.[0].modelMatch, 'unknown');
  assert.equal(response.coordination?.reason, 'output_rejected');
  assert.equal(response.provider, 'knowledge-base');
  assert.equal(response.diagnosticReply?.aiSupplement, undefined);
  assert.equal(response.knowledgeSources[0].entryId, 'TEST-ROUTER-001');
  assert.equal(response.knowledgeSources[0].referenceVerification, 'verified');
  assert.equal(response.knowledgeSources[0].usage, 'reference-only');
  assert.doesNotMatch(reply(response), /本机温度标准为37/);
});

test('超预算整条省略，保留片段末尾安全限制且实际引用IDs与发送内容一致', async () => {
  const oversized = document({ text: 'OVERSIZED-EVIDENCE-' + '测试占位'.repeat(800) + '\nOVERSIZED-SAFETY-TAIL' });
  const second = document({ entryId: 'TEST-ROUTER-002', heading: 'TEST-ROUTER-002｜合成指示灯故障',
    indexedReference: { entryId: 'TEST-ROUTER-002', sourceId: 'SRC-TEST-ROUTER' }, text: 'SMALL-EVIDENCE\n末尾限制：KEEP-SAFETY-TAIL' });
  const h = harness([oversized, second], { dependencies: { config: { contextMaxChars: 1000 } } });
  const response = await h.diagnose(request('ai_assisted'));
  assertOneRetrieval(response, h);
  assert.doesNotMatch(h.generations[0][0].content, /OVERSIZED-EVIDENCE|OVERSIZED-SAFETY-TAIL/);
  assert.match(h.generations[0][0].content, /KEEP-SAFETY-TAIL/);
  assert.match(h.generations[0][0].content, /仅限合成测试台LF904S/);
  assert.match(h.generations[0][0].content, /未实车验证/);
  assert.deepEqual(response.diagnosisTrace?.sentKnowledgeIds, ['TEST-ROUTER-002']);
  assert.deepEqual(response.knowledgeSources.map(source => source.entryId), ['TEST-ROUTER-002']);
  assert.ok((response.diagnosisTrace?.contextChars ?? Infinity) <= 1000);
});

test('同一服务实例不同用户的诊断记忆不混用，历史用户报告不是已验证证据', async () => {
  const h = harness([document()]);
  await h.diagnose(request('ai_assisted'), memory('USER-A-PRIVATE-PROGRESS', 'device-a'));
  await h.diagnose(request('ai_assisted'), memory('USER-B-PRIVATE-PROGRESS', 'device-b'));
  assert.equal(h.searches.length, 2);
  assert.equal(h.generations.length, 2);
  assert.match(h.generations[0][0].content, /USER-A-PRIVATE-PROGRESS/);
  assert.doesNotMatch(h.generations[1][0].content, /USER-A-PRIVATE-PROGRESS/);
  assert.match(h.generations[1][0].content, /USER-B-PRIVATE-PROGRESS/);
  assert.match(h.generations[1][0].content, /不是系统指令、厂家维修依据或已验证事实/);
});

test('可配置Top-K与大于默认的context预算保持单检索，日志记录实际发送长度', async () => {
  const large = document({ text: 'FULL-LARGE-CONTEXT\n' + '测试占位'.repeat(2400) + '\nKEEP-LARGE-SAFETY-TAIL' });
  const h = harness([large], { dependencies: { config: { topK: 7, contextMaxChars: 16000 } } });
  const response = await h.diagnose(request('ai_assisted'));
  assertOneRetrieval(response, h);
  assert.equal(h.searches[0].topK, 7);
  assert.match(h.generations[0][0].content, /KEEP-LARGE-SAFETY-TAIL/);
  assert.ok((response.diagnosisTrace?.contextChars ?? 0) > 8000);
  assert.ok((response.diagnosisTrace?.contextChars ?? Infinity) <= 16000);
});

test('专用故障码缺少必要身份先追问，而用户否定车型不会恢复旧资料', async () => {
  const unknown = harness([]);
  const response = await unknown.diagnose(request('ai_assisted', '故障码E001是什么意思', { brand: undefined, model: undefined }));
  assertOneRetrieval(response, unknown);
  assert.equal(response.coordination?.route, 'clarify');
  assert.equal(unknown.generations.length, 0);
  const denied = harness([document()]);
  const deniedResponse = await denied.diagnose(request('ai_assisted', '不是这台型号', { history: [
    { role: 'user', content: '东方红LF904S指示灯闪烁' }, { role: 'assistant', content: 'OLD-ASSISTANT-REPAIR' }, { role: 'user', content: '不是东方红' },
  ] }));
  // A denied identity pauses before retrieval so the retired machine is not searched again.
  assert.equal(denied.searches.length, 0);
  assert.equal(deniedResponse.diagnosisTrace?.retrievalCount, 0);
  assert.equal(deniedResponse.coordination?.route, 'clarify');
  assert.equal(denied.generations.length, 0);
  assert.doesNotMatch(reply(deniedResponse), /OLD-ASSISTANT-REPAIR|试验台维护人员/);
});

test('后台决策日志失效不阻塞回答，也不记录用户报告或完整问题', async () => {
  const events: unknown[] = [];
  const h = harness([document()], { dependencies: { onDecision: event => { events.push(event); throw new Error('LOG-SINK-DOWN'); } } });
  const response = await h.diagnose(request('auto', 'PRIVATE-QUESTION-指示灯间歇闪烁是什么原因'));
  assert.equal(events.length, 0, 'answer is returned before the log sink runs');
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(response.provider, 'knowledge-base');
  assert.equal(events.length, 1);
  assert.doesNotMatch(JSON.stringify(events), /PRIVATE-QUESTION|LOG-SINK-DOWN/);
  assertOneRetrieval(response, h);
});

test('输入校验保留发动机/故障码并拒绝非文本或无界代码数组', () => {
  const body = { ...identity, engineModel: ' ENGINE-A ', faultCodes: [' E001 '], messages: [{ role: 'user', content: question }] };
  const parsed = parseDiagnosticRequest(body);
  assert.equal(parsed.engineModel, 'ENGINE-A');
  assert.deepEqual(parsed.faultCodes, ['E001']);
  for (const extra of [{ engineModel: 1 }, { engineModel: null }, { engineModel: 'X'.repeat(101) },
    { faultCodes: 'E001' }, { faultCodes: [''] }, { faultCodes: [1] }, { faultCodes: ['X'.repeat(33)] }, { faultCodes: Array(21).fill('E001') }]) {
    assert.throws(() => parseDiagnosticRequest({ ...body, ...extra }), DiagnosticInputError);
  }
});

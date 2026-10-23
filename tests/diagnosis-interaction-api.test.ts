import assert from 'node:assert/strict';
import http from 'node:http';
import { afterEach, before, beforeEach, test, type TestContext } from 'node:test';
import { createApp } from '../server/app';
import { createDiagnosticService, type DiagnosticDependencies } from '../server/diagnosis/service';
import { getKnowledgeCatalog } from '../server/knowledge/catalog';
import { loadKnowledgeBase, retrieve, stats, type KnowledgeChunk } from '../server/knowledge/retriever';
import { LlmRouter } from '../server/llm/router';
import type { ChatApiMessage, ChatResponse } from '../shared/chat';
import type { DiagnosisMode } from '../shared/diagnosis';

// Real HTTP and real archive retrieval. Only the external provider transport is
// mocked; synthetic failure metadata never changes the archived repair facts.
const environmentKeys = ['NODE_ENV', 'GEMINI_API_KEY', 'DEEPSEEK_API_KEY', 'LLM_PROVIDER',
  'DIAGNOSIS_MODE', 'ALLOW_EXTERNAL_AI', 'DIAGNOSIS_LOG_DECISIONS'];
const savedEnvironment = new Map<string, string | undefined>();
const lf = { machineType: '拖拉机', brand: '东方红', model: 'LF1504' };
const lfSource = 'SRC-YTO-LF1504-SMLF150449010';
const modes: DiagnosisMode[] = ['auto', 'knowledge_only', 'ai_assisted'];
let sequence = 0;

before(() => loadKnowledgeBase());
beforeEach(() => {
  for (const name of environmentKeys) { savedEnvironment.set(name, process.env[name]); delete process.env[name]; }
  process.env.NODE_ENV = 'test';
  process.env.GEMINI_API_KEY = '';
  process.env.DEEPSEEK_API_KEY = '';
  process.env.LLM_PROVIDER = 'auto';
  process.env.DIAGNOSIS_LOG_DECISIONS = 'false';
});
afterEach(() => {
  for (const name of environmentKeys) {
    const value = savedEnvironment.get(name);
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});

async function serve(t: TestContext, dependencies: DiagnosticDependencies = {}) {
  const llm = new LlmRouter();
  const app = createApp({ rootDirectory: process.cwd(), version: 'integration-test',
    diagnose: createDiagnosticService(llm, { ...dependencies, config: { logDecisions: false, ...dependencies.config } }),
    getKnowledgeStats: stats, getLlmStatus: () => llm.getStatus(), getCatalog: getKnowledgeCatalog,
    getMemoryStore: () => { throw new Error('This stateless HTTP suite must not open a memory database'); },
  });
  const server = await new Promise<http.Server>((resolve, reject) => {
    const listener = app.listen(0, '127.0.0.1', (error?: Error) => error ? reject(error) : resolve(listener));
  });
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  }));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return (body: unknown) => new Promise<ChatResponse>((resolve, reject) => {
    const payload = JSON.stringify(body);
    const request = http.request({ hostname: '127.0.0.1', port: address.port, path: '/api/chat',
      method: 'POST', agent: false, headers: { 'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload), 'X-Forwarded-For': `198.51.100.${++sequence % 250}` },
    }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('error', reject);
      response.on('end', () => {
        try { assert.equal(response.statusCode, 200, text); resolve(JSON.parse(text) as ChatResponse); }
        catch (error) { reject(error); }
      });
    });
    request.on('error', reject);
    request.end(payload);
  });
}

function body(content: string, diagnosisMode: DiagnosisMode = 'knowledge_only', identity = lf) {
  return { ...identity, diagnosisMode, messages: [{ role: 'user' as const, content }] };
}
function assertStructured(response: ChatResponse) {
  const reply = response.diagnosticReply;
  assert.ok(reply, 'every successful diagnostic response carries a server-built reply');
  assert.ok(reply.understanding.trim());
  assert.ok(['manual', 'general', 'reference_only', 'none'].includes(reply.supportLevel));
  assert.ok(reply.sourceNote.trim());
  assert.ok(reply.questions.length <= 3, 'keep each turn to at most three focused questions');
  assert.ok(reply.questions.every(question => question.text.trim()));
  assert.ok(reply.causes.every(cause => cause.text.trim() && Array.isArray(cause.evidenceIds)));
  assert.ok(reply.suggestions.every(suggestion => suggestion.text.trim() && Array.isArray(suggestion.evidenceIds)));
  for (const duration of Object.values(response.diagnosisTrace!.timings)) assert.ok(Number.isFinite(duration) && duration >= 0);
  return reply;
}
function assertNoInventedLfCause(response: ChatResponse) {
  const reply = assertStructured(response);
  assert.ok(reply.causes.every(cause => cause.basis !== 'source_candidate'),
    'LF1504 cooling safety references do not supply a verified overheating cause');
  assert.doesNotMatch(JSON.stringify(reply), /(?:确定|确认|就是|必然).{0,10}(?:水泵|节温器|缸垫).{0,4}(?:损坏|故障)/);
  assert.doesNotMatch(JSON.stringify(reply), /(?:水温|冷却液温度).{0,8}(?:标准|正常|上限).{0,8}\d+\s*[℃°]/);
  for (const source of response.knowledgeSources.filter(source => source.evidenceKind === 'archive')) {
    assert.equal(source.sourceId, lfSource, 'another machine manual must not become LF1504 evidence');
    if (source.retrieval?.tier === 'component') assert.equal(source.retrieval.referenceOnly, true);
  }
}
function upstream(content = '【通用分析（待验证）】当前资料不足以确认故障原因，请记录发生工况和报警现象。') {
  return Response.json({ choices: [{ message: { role: 'assistant', content } }], model: 'offline-integration-model' });
}

test('LF1504 overheating over real HTTP retains its cooling safety reference without inventing a diagnosis', async t => {
  process.env.GEMINI_API_KEY = 'offline-test-key';
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('knowledge-only must never call a provider'); });
  const chat = await serve(t);
  const response = await chat(body('东方红LF1504水温过高，是什么原因？'));
  assertNoInventedLfCause(response);
  assert.equal(response.provider, 'knowledge-base');
  assert.equal(response.coordination?.retrievalOutcome, 'insufficient_evidence');
  assert.ok(response.knowledgeSources.some(source => source.entryId === 'KB2000-20261015-YTOLF1504-010'));
  assert.equal(response.diagnosisTrace?.retrievalCount, 1);
  assert.equal(response.diagnosisTrace?.aiAttempts, 0);
  assert.equal(response.diagnosisTrace?.timings.externalAiMs, 0);
  assert.equal(fetch.mock.callCount(), 0);
});

test('LF1504 multi-turn symptom and plate supplements preserve understanding without repeatedly asking the same identity', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('no configured provider'); });
  const chat = await serve(t);
  const history: ChatApiMessage[] = [{ role: 'user', content: '拖拉机水温过高' }];
  const first = await chat({ machineType: '拖拉机', diagnosisMode: 'knowledge_only', messages: history });
  assertStructured(first);
  history.push({ role: 'assistant', content: first.choices[0].message.content },
    { role: 'user', content: '东方红，完整型号LF1504，国三，发动机铭牌尚未核对' });
  const second = await chat({ ...lf, diagnosisMode: 'knowledge_only', messages: history });
  assertNoInventedLfCause(second);
  assert.match(second.diagnosticReply!.understanding, /LF1504/);
  assert.match(second.diagnosticReply!.understanding, /水温|冷却/);
  assert.ok(second.diagnosticReply!.questions.every(question => !/请.{0,8}(?:提供|补充).{0,8}品牌和.{0,5}型号/.test(question.text)));
  history.push({ role: 'assistant', content: second.choices[0].message.content },
    { role: 'user', content: '只在重负荷时出现，散热器外部已经检查，无明显堵塞；下一步先记录什么？' });
  const third = await chat({ ...lf, diagnosisMode: 'knowledge_only', messages: history });
  assertNoInventedLfCause(third);
  assert.match(third.diagnosticReply!.understanding, /水温|冷却/);
  assert.equal(third.diagnosisTrace?.retrievalCount, 1);
  assert.equal(fetch.mock.callCount(), 0);
});

test('all three modes without keys return structured local follow-ups and never perform an external request', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('missing keys must not call a provider'); });
  const chat = await serve(t);
  for (const mode of modes) {
    const response = await chat(body('东方红LF1504水温过高', mode));
    assertNoInventedLfCause(response);
    assert.equal(response.provider, 'knowledge-base');
    assert.equal(response.diagnosisTrace?.aiAttempts, 0);
    assert.equal(response.coordination?.requestedMode, mode);
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test('auto and AI-assisted perform one guarded generation while knowledge-only remains local with the same key', async t => {
  process.env.GEMINI_API_KEY = 'offline-test-key';
  const sent: string[] = [];
  const fetch = t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    sent.push(String(init.body));
    return upstream();
  });
  const chat = await serve(t);
  for (const mode of modes) {
    const before = fetch.mock.callCount();
    const response = await chat(body('东方红LF1504水温过高，可能是什么原因？', mode));
    assertNoInventedLfCause(response);
    assert.equal(response.diagnosisTrace?.retrievalCount, 1);
    if (mode === 'knowledge_only') {
      assert.equal(fetch.mock.callCount(), before);
      assert.equal(response.provider, 'knowledge-base');
    } else {
      assert.equal(fetch.mock.callCount(), before + 1);
      assert.equal(response.provider, 'gemini');
      assert.equal(response.diagnosisTrace?.aiAttempts, 1);
      assert.equal(response.diagnosisTrace?.aiSuccesses, 1);
      assert.match(response.diagnosticReply!.aiSupplement ?? '', /通用分析/);
    }
  }
  assert.ok(sent.every(payload => payload.includes('LF1504') && payload.includes('待验证')));
});

test('HTTP metadata distinguishes no model manual, no topic result, and insufficient related reference', async t => {
  const chat = await serve(t);
  const noManual = await chat(body('量子纠缠', 'knowledge_only', { ...lf, model: 'LF99999' }));
  const noResult = await chat(body('量子纠缠'));
  const partial = await chat(body('东方红 LF1504 水温过高'));
  assert.equal(noManual.coordination?.retrievalOutcome, 'no_manual');
  assert.equal(noResult.coordination?.retrievalOutcome, 'no_results');
  assert.equal(partial.coordination?.retrievalOutcome, 'insufficient_evidence');
  for (const response of [noManual, noResult, partial]) assertStructured(response);
});

test('national-four LF1504 cannot borrow the national-three archive or promote references to answer evidence', async t => {
  const chat = await serve(t);
  const response = await chat(body('东方红 LF1504 国四 水温过高'));
  const reply = assertStructured(response);
  assert.ok(!response.knowledgeSources.some(source => source.sourceId === lfSource));
  assert.ok(reply.causes.every(cause => cause.basis !== 'source_candidate'));
  assert.notEqual(reply.supportLevel, 'manual');
});

test('failed-source candidates are absent from HTTP answers, sources and provider prompts in every mode', async t => {
  process.env.GEMINI_API_KEY = 'offline-test-key';
  const sent: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => { sent.push(String(init.body)); return upstream(); });
  const original = retrieve('东方红 LF1504 水温过高', 12, lf).find(chunk => chunk.entryId)!;
  assert.ok(original);
  const broken: KnowledgeChunk = { ...original, status: '已核验；核验失败；与原文不符', text: 'FAILED-SOURCE-MUST-NOT-BE-DISPLAYED' };
  const chat = await serve(t, { retrieve: () => [broken] });
  for (const mode of modes) {
    const response = await chat(body('东方红 LF1504 水温过高，可能是什么原因？', mode));
    assertStructured(response);
    assert.deepEqual(response.knowledgeSources, []);
    assert.doesNotMatch(response.choices[0].message.content, /FAILED-SOURCE-MUST-NOT-BE-DISPLAYED/);
    assert.ok(response.diagnosticReply!.causes.every(cause => !cause.evidenceIds.includes(original.entryId!)));
  }
  assert.ok(sent.every(payload => !payload.includes('FAILED-SOURCE-MUST-NOT-BE-DISPLAYED') && !payload.includes(original.entryId!)));
});

test('high-risk hot-cap, brake and pressure queries and short follow-ups make zero external requests in all modes', async t => {
  process.env.GEMINI_API_KEY = 'offline-test-key';
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('high-risk operation must not call provider'); });
  const chat = await serve(t);
  for (const mode of modes) {
    for (const query of ['热车能否马上拧开水箱盖？', '刹车失灵还可以继续开吗？', '高压液压油管向外喷油怎么拆？']) {
      const response = await chat(body(query, mode));
      assertStructured(response);
      assert.equal(response.coordination?.route, 'safe');
      assert.equal(response.diagnosisTrace?.aiAttempts, 0);
      assert.match(response.choices[0].message.content, /停机|停止/);
    }
    const followup = await chat({ ...lf, diagnosisMode: mode, messages: [
      { role: 'user', content: '发动机热车时我想打开水箱盖' },
      { role: 'assistant', content: '请先停止危险操作。' }, { role: 'user', content: '下一步呢？' },
    ] });
    assert.equal(followup.coordination?.route, 'safe');
    assert.equal(followup.diagnosisTrace?.aiAttempts, 0);
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test('dangerous or fabricated model output is rejected over HTTP and cannot enter the structured plan', async t => {
  process.env.GEMINI_API_KEY = 'offline-test-key';
  t.mock.method(globalThis, 'fetch', async () => upstream('热车直接打开水箱盖，然后短接安全联锁继续运行。LF1504正常水温标准为123℃。'));
  const chat = await serve(t);
  const response = await chat(body('东方红 LF1504 水温过高，可能是什么原因？', 'ai_assisted'));
  assertNoInventedLfCause(response);
  assert.equal(response.provider, 'knowledge-base');
  assert.equal(response.coordination?.reason, 'output_rejected');
  assert.ok(response.coordination?.outputIssues?.length);
  assert.equal(response.diagnosticReply!.aiSupplement, undefined);
  assert.doesNotMatch(response.choices[0].message.content, /123℃|短接安全联锁继续运行|热车直接打开水箱盖/);
});

test('invalid provider configuration fails closed over HTTP without hiding the source follow-up plan', async t => {
  process.env.GEMINI_API_KEY = 'offline-test-key';
  process.env.LLM_PROVIDER = 'invalid-provider-must-not-leak';
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('invalid provider configuration'); });
  const chat = await serve(t);
  const response = await chat(body('东方红 LF1504 水温过高', 'ai_assisted'));
  assertNoInventedLfCause(response);
  assert.equal(response.provider, 'knowledge-base');
  assert.equal(response.coordination?.reason, 'llm_config_invalid');
  assert.equal(fetch.mock.callCount(), 0);
  assert.doesNotMatch(JSON.stringify(response), /offline-test-key|invalid-provider-must-not-leak/);
});

test('provider header timeout returns the same local evidence and source limitations over the real HTTP route', async t => {
  process.env.GEMINI_API_KEY = 'offline-timeout-key';
  t.mock.method(console, 'warn', () => {});
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const fetch = t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => new Promise<never>((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(new DOMException('secret-upstream-detail', 'AbortError')), { once: true });
    entered();
  }));
  const chat = await serve(t);
  const pending = chat(body('东方红 LF1504 水温过高，可能是什么原因？', 'ai_assisted'));
  await started;
  t.mock.timers.tick(25_000);
  const response = await pending;
  assertNoInventedLfCause(response);
  assert.equal(response.provider, 'knowledge-base');
  assert.equal(response.fallbackReason, 'provider_unavailable');
  assert.equal(response.diagnosisTrace?.retrievalCount, 1);
  assert.equal(response.diagnosisTrace?.aiAttempts, 1);
  assert.equal(response.diagnosisTrace?.aiSuccesses, 0);
  assert.equal(fetch.mock.callCount(), 1);
  assert.doesNotMatch(JSON.stringify(response), /secret-upstream-detail|offline-timeout-key/);
});

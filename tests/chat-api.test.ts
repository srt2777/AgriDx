import assert from 'node:assert/strict';
import http from 'node:http';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import type { LlmStatus } from '../server/llm/router';
import type { ChatResponse as DiagnosticChatResponse } from '../shared/chat';

// Keep this suite local even when the developer has configured model credentials.
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = '';
process.env.DEEPSEEK_API_KEY = '';
process.env.LLM_PROVIDER = 'auto';

const { default: app } = await import('../server/index');
let server: http.Server;
let port: number;

type ChatResponse = Partial<DiagnosticChatResponse> & { code?: string };

const identity = { machineType: '拖拉机', brand: '纽荷兰', model: 'WORKMASTER25' };
const messages = [{ role: 'user', content: '钥匙在 START，启动电机不转' }];

// Tests opt into fake provider credentials individually; no real provider is called.
beforeEach(() => {
  process.env.GEMINI_API_KEY = '';
  process.env.DEEPSEEK_API_KEY = '';
  process.env.LLM_PROVIDER = 'auto';
  delete process.env.DIAGNOSIS_MODE;
  delete process.env.ALLOW_EXTERNAL_AI;
});
afterEach(() => {
  process.env.GEMINI_API_KEY = '';
  process.env.DEEPSEEK_API_KEY = '';
  process.env.LLM_PROVIDER = 'auto';
  delete process.env.DIAGNOSIS_MODE;
  delete process.env.ALLOW_EXTERNAL_AI;
});

before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  port = address.port;
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

function requestJson<T>(requestPath: string, body?: unknown, forwardedFor?: string): Promise<{ status: number; body: T }> {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: '127.0.0.1',
      port,
      path: requestPath,
      method: payload === undefined ? 'GET' : 'POST',
      agent: false,
      headers: {
        ...(payload === undefined ? {} : {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        }),
        ...(forwardedFor ? { 'X-Forwarded-For': forwardedFor } : {}),
      },
    }, (response) => {
      let output = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => { output += chunk; });
      response.on('error', reject);
      response.on('end', () => {
        try {
          resolve({ status: response.statusCode ?? 0, body: JSON.parse(output) as T });
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on('error', reject);
    request.end(payload);
  });
}

function chat(body: unknown, forwardedFor?: string): Promise<{ status: number; body: ChatResponse }> {
  return requestJson('/api/chat', body, forwardedFor);
}

function upstreamAnswer(content: string, model = 'integration-test-model'): Response {
  return Response.json({ choices: [{ message: { role: 'assistant', content } }], model });
}

interface UpstreamRequest {
  messages: { role: string; content: string }[];
}

test('rejects malformed optional machine identity fields as bad requests', async () => {
  for (const field of ['machineType', 'brand', 'model']) {
    for (const value of [123, null, {}, 'x'.repeat(101)]) {
      const response = await chat({ messages, ...identity, [field]: value });
      assert.equal(response.status, 400, `${field}: ${JSON.stringify(value)}`);
      assert.equal(response.body.code, 'bad_request');
    }
  }
});

test('rejects non-object JSON bodies with a JSON bad-request response', async () => {
  for (const body of [null, [], 123, 'request']) {
    const response = await chat(body);
    assert.equal(response.status, 400);
    assert.equal(response.body.code, 'bad_request');
  }
});

test('the chat API returns uncertain references with source IDs, pages and applicability limits without repair instructions', async () => {
  const response = await chat({ messages, ...identity });
  assert.equal(response.status, 200);
  assert.equal(response.body.provider, 'knowledge-base');
  assert.ok(response.body.localSummary && response.body.localSummary.length < 1000);
  assert.ok(response.body.knowledgeChunks && response.body.knowledgeChunks > 0);
  const reply = response.body.choices?.[0]?.message.content;
  assert.ok(reply);
  const source = response.body.knowledgeSources?.find(item => item.entryId === 'NH-WM25-003');
  assert.equal(source?.sourceId, 'SRC-NH-WM25-92157408');
  assert.match(source?.locator ?? '', /175/);
  assert.match(source?.scopeBoundary ?? '', /不适用于.*25S/);
  assert.equal(source?.referenceVerification, 'unspecified');
  assert.equal(response.body.diagnosticReply?.supportLevel, 'reference_only');
  assert.ok(response.body.diagnosticReply?.suggestions.length);
  assert.ok(response.body.diagnosticReply?.questions.length);
  assert.doesNotMatch(reply, /SRC-NH-|PDF 第 175 页|【手册依据】|【通用分析/);
  assert.doesNotMatch(reply, /启动联锁条件未满足/);
});

test('source-rich local replies remain usable as assistant history in the next turn', async () => {
  const query = '已记录日常工况。'.repeat(150) + '请查看保养周期';
  assert.ok(query.length < 2000);
  const first = await chat({ ...identity, messages: [{ role: 'user', content: query }] });
  assert.equal(first.status, 200);
  const reply = first.body.choices?.[0]?.message.content;
  assert.ok(reply && reply.length > 0 && reply.length <= 16_000);
  assert.ok(first.body.diagnosticReply?.understanding);
  assert.ok((first.body.knowledgeSources?.length ?? 0) > 0);

  const next = await chat({
    ...identity,
    messages: [
      { role: 'user', content: query },
      { role: 'assistant', content: reply },
      ...messages,
    ],
  });
  assert.equal(next.status, 200);
  assert.ok(next.body.knowledgeSources?.some(source => source.entryId === 'NH-WM25-003'));
  assert.ok(next.body.diagnosticReply?.suggestions.length);
});

test('user and system messages keep their 2000-character limit and assistant history remains bounded', async () => {
  for (const role of ['user', 'system']) {
    const response = await chat({ messages: [{ role, content: 'x'.repeat(2001) }] });
    assert.equal(response.status, 400);
    assert.equal(response.body.code, 'too_long');
  }
  const response = await chat({ messages: [{ role: 'assistant', content: 'x'.repeat(16_001) }, ...messages] });
  assert.equal(response.status, 400);
  assert.equal(response.body.code, 'too_long');
});

test('questions without applicable evidence still call the LLM with general-guidance boundaries', async (t) => {
  process.env.GEMINI_API_KEY = 'integration-gemini-secret';
  const query = '拖拉机尾部咔嗒异响';
  let sent: UpstreamRequest | undefined;
  const fetch = t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    sent = JSON.parse(init.body as string) as UpstreamRequest;
    return upstreamAnswer('【通用分析（待验证）】先区分空载与负载时的声音。');
  });
  const response = await chat({
    machineType: '拖拉机', brand: '常发', model: 'CFX9999',
    messages: [{ role: 'user', content: query }],
  }, '198.51.100.1');
  assert.equal(response.status, 200);
  assert.equal(response.body.provider, 'gemini');
  assert.equal(response.body.answerMode, 'general-guidance');
  // 2026-10-22: a named (unknown) model searches its archive only; TK is not used.
  assert.equal(response.body.knowledgeChunks, 0);
  assert.ok(!response.body.knowledgeSources?.some(source => source.entryType === '通识学习'));
  assert.equal(response.body.fellBack, false);
  assert.match(response.body.choices?.[0]?.message.content ?? '', /通用分析/);
  assert.equal(fetch.mock.callCount(), 1);
  assert.ok(sent);
  assert.equal(sent.messages[0].role, 'system');
  assert.match(sent.messages[0].content, /当前没有可直接支持维修结论的归档技术资料/);
  assert.match(sent.messages[0].content, /通用分析（待验证）/);
  assert.match(sent.messages[0].content, /禁止编造参数/);
  assert.match(sent.messages[0].content, /常发/);
  assert.equal(sent.messages.at(-1)?.content, query);
});

test('denied identity pauses retrieval and diagnosis even when stale form fields remain', async (t) => {
  const body = {
    ...identity,
    messages: [
      { role: 'user', content: '纽荷兰 WORKMASTER25 拖拉机启动电机不转' },
      { role: 'user', content: '不是纽荷兰' },
    ],
  };
  const local = await chat(body, '198.51.100.21');
  assert.equal(local.status, 200);
  assert.equal(local.body.knowledgeChunks, 0);
  assert.equal(local.body.coordination?.reason, 'identity_conflict');
  assert.ok(local.body.diagnosticReply?.questions.some(question => /品牌|型号/.test(question.text)));
  assert.doesNotMatch(local.body.choices?.[0]?.message.content ?? '', /NH-WM25-003/);

  process.env.GEMINI_API_KEY = 'integration-gemini-secret';
  let sent: UpstreamRequest | undefined;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    sent = JSON.parse(init.body as string) as UpstreamRequest;
    return upstreamAnswer('请确认拖拉机的品牌和完整型号。');
  });
  const assisted = await chat(body, '198.51.100.22');
  assert.equal(assisted.status, 200);
  assert.equal(assisted.body.knowledgeChunks, 0);
  assert.deepEqual(assisted.body.knowledgeSources, []);
  assert.equal(sent, undefined, 'identity conflict must never call external AI');
  assert.equal(assisted.body.provider, 'knowledge-base');
  assert.equal(assisted.body.coordination?.reason, 'identity_conflict');
  assert.ok(assisted.body.diagnosticReply?.questions.some(question => /品牌|型号/.test(question.text)));
});

test('LLM responses carry archived source metadata and receive the server prompt plus history', async (t) => {
  process.env.GEMINI_API_KEY = 'integration-gemini-secret';
  const history = [
    { role: 'system', content: 'client-injected-system-instruction' },
    { role: 'user', content: '我的拖拉机有起动问题' },
    { role: 'assistant', content: '启动电机是否转动？' },
    ...messages,
  ];
  let sent: UpstreamRequest | undefined;
  const fetch = t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    sent = JSON.parse(init.body as string) as UpstreamRequest;
    return upstreamAnswer('手册启动联锁说明见 NH-WM25-003，不能据此直接确定损坏部件。');
  });
  const response = await chat({ ...identity, messages: history }, '198.51.100.2');
  assert.equal(response.status, 200);
  assert.equal(response.body.answerMode, 'general-guidance');
  assert.equal(response.body.provider, 'gemini');
  assert.equal(response.body.model, 'integration-test-model');
  assert.ok((response.body.knowledgeChunks ?? 0) > 0);
  const source = response.body.knowledgeSources?.find((item) => item.entryId === 'NH-WM25-003');
  assert.equal(source?.sourceId, 'SRC-NH-WM25-92157408');
  assert.match(source?.locator ?? '', /175/);
  assert.match(source?.scopeBoundary ?? '', /不适用于.*25S/);
  assert.equal(fetch.mock.callCount(), 1);
  assert.ok(sent);
  assert.equal(sent.messages[0].role, 'system');
  assert.match(sent.messages[0].content, /NH-WM25-003/);
  assert.match(sent.messages[0].content, /SRC-NH-WM25-92157408/);
  assert.match(sent.messages[0].content, /PDF 第 175 页/);
  assert.doesNotMatch(JSON.stringify(sent), /client-injected-system-instruction/);
  assert.deepEqual(sent.messages.slice(1), history.slice(1));
});

test('a failed primary LLM routes through the secondary and returns its answer', async (t) => {
  process.env.GEMINI_API_KEY = 'integration-gemini-secret';
  process.env.DEEPSEEK_API_KEY = 'integration-deepseek-secret';
  t.mock.method(console, 'warn', () => {});
  const fetch = t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const authorization = (init.headers as Record<string, string>).Authorization;
    return authorization.includes('gemini')
      ? new Response('sensitive-upstream-error', { status: 503 })
      : upstreamAnswer('备用模型结合手册给出的回答', 'integration-secondary-model');
  });
  const response = await chat({ ...identity, messages }, '198.51.100.3');
  assert.equal(response.status, 200);
  assert.equal(response.body.provider, 'deepseek');
  assert.equal(response.body.model, 'integration-secondary-model');
  assert.equal(response.body.fellBack, true);
  assert.equal(response.body.answerMode, 'general-guidance');
  assert.equal(response.body.diagnosticReply?.aiSupplement, '备用模型结合手册给出的回答');
  assert.ok(response.body.diagnosticReply?.suggestions.length);
  assert.match(response.body.choices?.[0]?.message.content ?? '', /备用模型结合手册给出的回答/);
  assert.notEqual(response.body.choices?.[0]?.message.content, response.body.diagnosticReply?.aiSupplement);
  assert.equal(fetch.mock.callCount(), 2);
  assert.doesNotMatch(JSON.stringify(response.body), /sensitive-upstream-error|integration-.*-secret/);
});

test('two unavailable LLMs return a source-grounded local response with an explicit fallback reason', async (t) => {
  process.env.GEMINI_API_KEY = 'integration-gemini-secret';
  process.env.DEEPSEEK_API_KEY = 'integration-deepseek-secret';
  t.mock.method(console, 'warn', () => {});
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response('sensitive-upstream-error', { status: 503 }));
  const response = await chat({ ...identity, messages }, '198.51.100.4');
  assert.equal(response.status, 200);
  assert.equal(response.body.provider, 'knowledge-base');
  assert.equal(response.body.answerMode, 'local-evidence');
  assert.equal(response.body.fellBack, true);
  assert.equal(response.body.fallbackReason, 'provider_unavailable');
  assert.equal(response.body.coordination?.route, 'local');
  assert.equal(response.body.coordination?.reason, 'provider_unavailable');
  assert.ok((response.body.knowledgeChunks ?? 0) > 0);
  assert.ok(response.body.knowledgeSources?.some(source => source.entryId === 'NH-WM25-003'));
  assert.ok(response.body.diagnosticReply?.suggestions.length);
  assert.ok(response.body.knowledgeSources?.some((source) => source.sourceId === 'SRC-NH-WM25-92157408'));
  assert.equal(fetch.mock.callCount(), 2);
  assert.doesNotMatch(JSON.stringify(response.body), /sensitive-upstream-error|integration-.*-secret/);
});

test('brand and model supplements retrieve the original fault across multiple conversation turns', async (t) => {
  process.env.GEMINI_API_KEY = 'integration-gemini-secret';
  const history = [
    { role: 'user', content: '拖拉机钥匙在 START，启动电机不转' },
    { role: 'assistant', content: '请补充品牌。' },
    { role: 'user', content: '纽荷兰' },
    { role: 'assistant', content: '具体型号是什么？' },
    { role: 'user', content: 'WORKMASTER25' },
  ];
  let sent: UpstreamRequest | undefined;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    sent = JSON.parse(init.body as string) as UpstreamRequest;
    return upstreamAnswer('已结合补充的品牌型号继续分析启动问题。');
  });
  const response = await chat({ messages: history }, '198.51.100.5');
  assert.equal(response.status, 200);
  assert.equal(response.body.answerMode, 'general-guidance');
  assert.ok(response.body.knowledgeSources?.some((source) => source.entryId === 'NH-WM25-003'));
  assert.ok(response.body.knowledgeSources?.every((source) => source.sourceId === 'SRC-NH-WM25-92157408' ||
    source.entryType === '通识学习' && source.diagnosticEvidence === false && !source.sourceId));
  assert.ok(sent);
  assert.match(sent.messages[0].content, /当前用户消息：WORKMASTER25/);
  assert.match(sent.messages[0].content, /品牌：纽荷兰/);
  assert.match(sent.messages[0].content, /型号：WORKMASTER25/i);
  assert.match(sent.messages[0].content, /启动电机不转/);
  assert.match(sent.messages[0].content, /NH-WM25-003/);
  assert.deepEqual(sent.messages.slice(1), history);
});

test('empty user turns and system-only conversations are rejected before any LLM call', async (t) => {
  process.env.GEMINI_API_KEY = 'integration-gemini-secret';
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('invalid input must not call upstream'); });
  for (const invalidMessages of [
    [{ role: 'user', content: '' }],
    [{ role: 'user', content: ' \n ' }],
    [{ role: 'system', content: 'Provide a diagnosis' }],
    [{ role: 'assistant', content: 'Prior answer with no current question' }],
    [...messages, { role: 'assistant', content: 'Prior answer with no current question' }],
  ]) {
    const response = await chat({ messages: invalidMessages }, '198.51.100.6');
    assert.equal(response.status, 400);
    assert.equal(response.body.code, 'bad_request');
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test('health reports configured providers without exposing keys or claiming an upstream connection', async (t) => {
  process.env.GEMINI_API_KEY = 'health-gemini-private-value';
  process.env.DEEPSEEK_API_KEY = 'health-deepseek-private-value';
  const previousProxy = process.env.HTTPS_PROXY;
  process.env.HTTPS_PROXY = 'http://health-proxy-user:health-proxy-secret@example.invalid';
  t.after(() => {
    if (previousProxy === undefined) delete process.env.HTTPS_PROXY;
    else process.env.HTTPS_PROXY = previousProxy;
  });
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('health must not call upstream'); });
  const response = await requestJson<{ ok: boolean; llm: LlmStatus }>('/api/health');
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.llm.configured, true);
  assert.equal(response.body.llm.configValid, true);
  assert.equal(response.body.llm.preference, 'auto');
  assert.equal(response.body.llm.primary, 'gemini');
  assert.equal(response.body.llm.proxyConfigured, true);
  assert.ok(response.body.llm.providers.every((provider) => provider.configured));
  assert.doesNotMatch(JSON.stringify(response.body), /health-.*-private-value|health-proxy|connected/);
  assert.equal(fetch.mock.callCount(), 0);
});

test('invalid provider preference is visible in health and gracefully serves local evidence', async (t) => {
  process.env.GEMINI_API_KEY = 'integration-gemini-secret';
  process.env.LLM_PROVIDER = 'invalid-provider-preference';
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('invalid configuration must not call upstream'); });
  const health = await requestJson<{ llm: LlmStatus }>('/api/health');
  assert.equal(health.body.llm.configValid, false);
  assert.equal(health.body.llm.configurationError, 'invalid_provider');
  assert.equal(health.body.llm.configured, false);
  const response = await chat({ ...identity, messages }, '198.51.100.7');
  assert.equal(response.status, 200);
  assert.equal(response.body.provider, 'knowledge-base');
  assert.equal(response.body.answerMode, 'local-evidence');
  assert.ok(response.body.knowledgeSources?.some(source => source.entryId === 'NH-WM25-003'));
  assert.ok(response.body.diagnosticReply?.suggestions.length);
  assert.equal(fetch.mock.callCount(), 0);
});

test('mode validation and knowledge-only produce zero external requests even with a key', async (t) => {
  process.env.GEMINI_API_KEY = 'integration-fake';
  const spy = t.mock.method(globalThis, 'fetch', async () => { throw new Error('External request forbidden'); });
  for (const diagnosisMode of [null, 'invalid', {}, 1]) {
    assert.equal((await chat({ messages, ...identity, diagnosisMode }, '198.51.100.81')).status, 400);
  }
  const result = await chat({ messages, ...identity, diagnosisMode: 'knowledge_only' }, '198.51.100.82');
  assert.equal(result.body.coordination?.reason, 'local_requested');
  assert.equal(result.body.provider, 'knowledge-base');
  assert.equal(result.body.fellBack, false);
  assert.equal(result.body.fallbackReason, undefined);
  assert.doesNotMatch(result.body.localSummary ?? '', /连接失败|未启用大模型/);
  assert.equal(spy.mock.callCount(), 0);
});

test('server external-AI disable overrides explicit AI-assisted requests', async (t) => {
  process.env.GEMINI_API_KEY = 'integration-fake';
  process.env.ALLOW_EXTERNAL_AI = 'false';
  const spy = t.mock.method(globalThis, 'fetch', async () => { throw new Error('External request forbidden'); });
  const result = await chat({ messages, ...identity, diagnosisMode: 'ai_assisted' }, '198.51.100.83');
  assert.equal(result.body.coordination?.effectiveMode, 'knowledge_only');
  assert.equal(result.body.coordination?.reason, 'server_local_only');
  assert.equal(spy.mock.callCount(), 0);
});

test('AI-assisted without a key safely returns local evidence with an explicit reason', async (t) => {
  const spy = t.mock.method(globalThis, 'fetch', async () => { throw new Error('No key should not call upstream'); });
  const result = await chat({ messages, ...identity, diagnosisMode: 'ai_assisted' }, '198.51.100.84');
  assert.equal(result.body.coordination?.reason, 'llm_not_configured');
  assert.equal(result.body.fallbackReason, 'not_configured');
  assert.equal(result.body.fellBack, true);
  assert.equal(spy.mock.callCount(), 0);
});

test('AI-assisted sends retrieved evidence to a mock model and returns the decision', async (t) => {
  process.env.GEMINI_API_KEY = 'integration-fake';
  const spy = t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const sent = JSON.parse(init.body as string) as UpstreamRequest;
    assert.match(sent.messages[0].content, /NH-WM25-003/);
    assert.match(sent.messages[0].content, /通用分析（待验证）/);
    return upstreamAnswer('【手册依据】引用资料。\n【通用分析（待验证）】等待补充。');
  });
  const result = await chat({ messages, ...identity, diagnosisMode: 'ai_assisted' }, '198.51.100.85');
  assert.equal(result.body.coordination?.route, 'ai');
  assert.equal(result.body.coordination?.reason, 'ai_requested');
  assert.equal(result.body.provider, 'gemini');
  assert.equal(spy.mock.callCount(), 1);
});

for (const phase of ['headers', 'body'] as const) {
  test(`API ${phase} timeout returns local evidence without exposing upstream details`, async t => {
    process.env.GEMINI_API_KEY = 'integration-timeout-secret';
    t.mock.method(console, 'warn', () => {});
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let started!: () => void;
    const pending = new Promise<void>(resolve => { started = resolve; });
    const spy = t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
      const stall = () => new Promise<never>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('sensitive-timeout-detail', 'AbortError')), { once: true });
        started();
      });
      if (phase === 'headers') return stall();
      return { ok: true, json: stall } as unknown as Response;
    });
    const request = chat({ ...identity, messages, diagnosisMode: 'ai_assisted' }, phase === 'headers' ? '198.51.100.90' : '198.51.100.91');
    await pending;
    t.mock.timers.tick(25_000);
    const response = await request;
    assert.equal(response.status, 200);
    assert.equal(response.body.provider, 'knowledge-base');
    assert.equal(response.body.fallbackReason, 'provider_unavailable');
    assert.equal(response.body.coordination?.route, 'local');
    assert.equal(response.body.coordination?.reason, 'provider_unavailable');
    assert.ok(response.body.knowledgeSources?.some(x => x.entryId === 'NH-WM25-003'));
    assert.equal(spy.mock.callCount(), 1);
    assert.doesNotMatch(JSON.stringify(response.body), /sensitive-timeout-detail|integration-timeout-secret/);
  });
}

const failures = [
  { name: 'authentication', respond: () => new Response('sensitive-upstream-detail', { status: 401 }) },
  { name: 'rate limit', respond: () => new Response('sensitive-upstream-detail', { status: 429 }) },
  { name: 'server failure', respond: () => new Response('sensitive-upstream-detail', { status: 503 }) },
  { name: 'network', respond: () => { throw new Error('sensitive-upstream-detail'); } },
  { name: 'malformed JSON', respond: () => new Response('sensitive-upstream-detail') },
  { name: 'empty answer', respond: () => upstreamAnswer(' ') },
];
for (const [index, failure] of failures.entries()) {
  test(`API ${failure.name} failure with no backup preserves local citations`, async t => {
    process.env.GEMINI_API_KEY = 'integration-failure-secret';
    const warnings: string[] = [];
    t.mock.method(console, 'warn', (...values: unknown[]) => { warnings.push(values.join(' ')); });
    const spy = t.mock.method(globalThis, 'fetch', async () => failure.respond());
    const response = await chat({ ...identity, messages, diagnosisMode: 'auto' }, `198.51.100.${100 + index}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.provider, 'knowledge-base');
    assert.equal(response.body.fellBack, true);
    assert.equal(response.body.fallbackReason, 'provider_unavailable');
    assert.equal(response.body.coordination?.reason, 'provider_unavailable');
    assert.equal(response.body.answerMode, 'local-evidence');
    assert.ok(response.body.knowledgeSources?.some(source => source.sourceId === 'SRC-NH-WM25-92157408'));
    assert.ok(response.body.diagnosticReply?.suggestions.length);
    assert.ok(response.body.localSummary);
    assert.equal(spy.mock.callCount(), 1);
    assert.doesNotMatch(JSON.stringify(response.body) + warnings.join(' '), /sensitive-upstream-detail|integration-failure-secret/);
  });
}

test('API whitespace credentials in every mode avoid upstream calls and preserve source review metadata', async t => {
  process.env.GEMINI_API_KEY = ' \n ';
  process.env.DEEPSEEK_API_KEY = ' ';
  const spy = t.mock.method(globalThis, 'fetch', async () => { throw new Error('No upstream calls allowed'); });
  for (const diagnosisMode of ['auto', 'knowledge_only', 'ai_assisted']) {
    const response = await chat({ ...identity, messages, diagnosisMode }, '198.51.100.110');
    assert.equal(response.status, 200);
    assert.equal(response.body.coordination?.route, 'local');
    assert.equal(response.body.coordination?.reason, diagnosisMode === 'knowledge_only' ? 'local_requested' : 'llm_not_configured');
    const sources = response.body.knowledgeSources as { sourceIndexed: boolean; status: string; referenceVerification: string; entryType?: string; diagnosticEvidence?: false }[];
    assert.ok(sources.length > 0);
    assert.ok(sources.every(x => x.status && x.referenceVerification && (x.sourceIndexed ||
      x.entryType === '通识学习' && x.diagnosticEvidence === false && x.referenceVerification === 'unverified')));
  }
  assert.equal(spy.mock.callCount(), 0);
});

test('API configuration health and server defaults cannot be bypassed by client mode', async t => {
  process.env.GEMINI_API_KEY = 'integration-config-secret';
  const spy = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Invalid configuration must not call AI'); });
  for (const value of ['knowledge_only', 'invalid']) {
    process.env.DIAGNOSIS_MODE = value;
    const health = await requestJson<{ coordination: { defaultMode: string; configValid: boolean; allowExternalAi: boolean } }>('/api/health');
    assert.equal(health.body.coordination.allowExternalAi, false);
    assert.equal(health.body.coordination.defaultMode, 'knowledge_only');
    assert.equal(health.body.coordination.configValid, value === 'knowledge_only');
    const response = await chat({ ...identity, messages, diagnosisMode: 'ai_assisted' }, '198.51.100.111');
    assert.equal(response.status, 200);
    assert.equal(response.body.coordination?.effectiveMode, 'knowledge_only');
    assert.equal(response.body.coordination?.reason, value === 'knowledge_only' ? 'server_local_only' : 'invalid_config');
  }
  assert.equal(spy.mock.callCount(), 0);
});

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { LlmRouter } from '../server/llm/router';
import { createOpenAICompatibleProvider } from '../server/llm/openai-compatible';
import { ProviderError, type ChatMessage, type ProviderErrorKind } from '../server/llm/types';

const envNames = [
  'LLM_PROVIDER', 'GEMINI_API_KEY', 'GEMINI_MODEL', 'DEEPSEEK_API_KEY',
  'DEEPSEEK_MODEL', 'DEEPSEEK_BASE_URL', 'HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy',
] as const;
const originalEnv = new Map(envNames.map((name) => [name, process.env[name]]));
const messages: ChatMessage[] = [
  { role: 'system', content: 'Use retrieved evidence and mark unsupported inferences.' },
  { role: 'user', content: '拖拉机尾部异响' },
];

beforeEach(() => {
  for (const name of envNames) delete process.env[name];
});
afterEach(() => {
  for (const [name, value] of originalEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function providerError(kind: ProviderErrorKind) {
  return (error: unknown) => error instanceof ProviderError && error.kind === kind;
}

/** Minimal OpenAI-compatible SSE body: two content chunks, then DONE. */
function sseBody(chunks: string[], model = 'stream-test-model'): string {
  return chunks.map((text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }], model })}\n\n`).join('') + 'data: [DONE]\n\n';
}
function sseResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/event-stream' } });
}

test('chatStream emits deltas in order and resolves with the full trimmed content', async (t) => {
  process.env.DEEPSEEK_API_KEY = 'stream-secret';
  const provider = createOpenAICompatibleProvider({
    name: 'deepseek', model: 'stream-test-model', apiUrl: 'https://example.invalid/v1/chat/completions', apiKeyEnv: 'DEEPSEEK_API_KEY',
  });
  let sent: Record<string, unknown> | undefined;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    sent = JSON.parse(init.body as string) as Record<string, unknown>;
    return sseResponse(sseBody(['先区分', '空载与负载时的声音。']));
  });
  const deltas: string[] = [];
  const result = await provider.chatStream!(messages, (text) => { deltas.push(text); });
  assert.deepEqual(deltas, ['先区分', '空载与负载时的声音。']);
  assert.equal(result.content, '先区分空载与负载时的声音。');
  assert.equal(result.provider, 'deepseek');
  assert.equal(result.model, 'stream-test-model');
  assert.equal(sent?.stream, true);
  assert.equal(sent?.model, 'stream-test-model');
});

test('chatStream skips malformed chunk lines but still completes', async (t) => {
  process.env.DEEPSEEK_API_KEY = 'stream-secret';
  const provider = createOpenAICompatibleProvider({
    name: 'deepseek', model: 'stream-test-model', apiUrl: 'https://example.invalid/v1/chat/completions', apiKeyEnv: 'DEEPSEEK_API_KEY',
  });
  t.mock.method(globalThis, 'fetch', async () => sseResponse(
    'data: {not json}\n\n: ping\n\ndata: {"choices":[{"delta":{"content":"可用"}}]}\n\ndata: [DONE]\n\n',
  ));
  const deltas: string[] = [];
  const result = await provider.chatStream!(messages, (text) => { deltas.push(text); });
  assert.deepEqual(deltas, ['可用']);
  assert.equal(result.content, '可用');
});

test('chatStream maps HTTP errors the same way chat does', async (t) => {
  process.env.DEEPSEEK_API_KEY = 'stream-secret';
  const provider = createOpenAICompatibleProvider({
    name: 'deepseek', model: 'stream-test-model', apiUrl: 'https://example.invalid/v1/chat/completions', apiKeyEnv: 'DEEPSEEK_API_KEY',
  });
  t.mock.method(globalThis, 'fetch', async () => new Response('nope', { status: 401 }));
  await assert.rejects(provider.chatStream!(messages, () => {}), providerError('auth'));
});

test('chatStream rejects an empty stream and a stream without DONE', async (t) => {
  process.env.DEEPSEEK_API_KEY = 'stream-secret';
  const provider = createOpenAICompatibleProvider({
    name: 'deepseek', model: 'stream-test-model', apiUrl: 'https://example.invalid/v1/chat/completions', apiKeyEnv: 'DEEPSEEK_API_KEY',
  });
  const fetch = t.mock.method(globalThis, 'fetch', async () => sseResponse('data: [DONE]\n\n'));
  await assert.rejects(provider.chatStream!(messages, () => {}), providerError('invalid_response'));
  fetch.mock.resetCalls();
  t.mock.method(globalThis, 'fetch', async () => sseResponse(
    `data: ${JSON.stringify({ choices: [{ delta: { content: '半截' } }] })}\n\n`,
  ));
  await assert.rejects(provider.chatStream!(messages, () => {}), providerError('invalid_response'));
});

test('chatStream honours an aborted signal as cancelled', async (t) => {
  process.env.DEEPSEEK_API_KEY = 'stream-secret';
  const provider = createOpenAICompatibleProvider({
    name: 'deepseek', model: 'stream-test-model', apiUrl: 'https://example.invalid/v1/chat/completions', apiKeyEnv: 'DEEPSEEK_API_KEY',
  });
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    return sseResponse(sseBody(['x']));
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(provider.chatStream!(messages, () => {}, { signal: controller.signal }), providerError('cancelled'));
});

function streamingRouter() {
  process.env.LLM_PROVIDER = 'deepseek';
  process.env.GEMINI_API_KEY = 'router-gemini-secret';
  process.env.DEEPSEEK_API_KEY = 'router-deepseek-secret';
  process.env.DEEPSEEK_BASE_URL = 'https://deepseek.invalid/v1/';
  return new LlmRouter();
}

test('router chatStream uses the primary stream and reports one attempt', async (t) => {
  const router = streamingRouter();
  t.mock.method(globalThis, 'fetch', async (url: unknown) => {
    assert.match(String(url), /deepseek\.invalid/);
    return sseResponse(sseBody(['主选流式']));
  });
  const deltas: string[] = [];
  const outcome = await router.chatStream(messages, (text) => { deltas.push(text); });
  assert.deepEqual(deltas, ['主选流式']);
  assert.equal(outcome.result.content, '主选流式');
  assert.equal(outcome.primary, 'deepseek');
  assert.equal(outcome.fellBack, false);
  assert.equal(outcome.attempts, 1);
});

test('router chatStream falls back to the secondary stream when the primary fails before any delta', async (t) => {
  const router = streamingRouter();
  t.mock.method(console, 'warn', () => {});
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: unknown) => {
    calls.push(String(url));
    return String(url).includes('deepseek.invalid')
      ? new Response('bad', { status: 503 })
      : sseResponse(sseBody(['备用流式']));
  });
  const deltas: string[] = [];
  const outcome = await router.chatStream(messages, (text) => { deltas.push(text); });
  assert.deepEqual(deltas, ['备用流式']);
  assert.equal(outcome.result.provider, 'gemini');
  assert.equal(outcome.fellBack, true);
  assert.equal(outcome.fallbackReason, 'server_error');
  assert.equal(outcome.attempts, 2);
  assert.equal(calls.length, 2);
});

test('router chatStream never splices a secondary answer onto a partial primary stream', async (t) => {
  const router = streamingRouter();
  t.mock.method(console, 'warn', () => {});
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: unknown) => {
    calls.push(String(url));
    if (String(url).includes('deepseek.invalid')) {
      // First chunk arrives, then the stream dies: the router must not
      // ask the secondary provider, whose text would append to garbage.
      // pull() enqueues the chunk on the first read and errors on the
      // second, so the chunk is delivered before the failure (erroring
      // inside start() would discard the queued chunk instead).
      let pulls = 0;
      const stream = new ReadableStream({
        pull(controller) {
          pulls++;
          if (pulls === 1) controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: '半截' } }] })}\n\n`));
          else controller.error(new Error('upstream died mid-stream'));
        },
      });
      return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
    }
    return sseResponse(sseBody(['备用完整回答']));
  });
  const deltas: string[] = [];
  await assert.rejects(router.chatStream(messages, (text) => { deltas.push(text); }), providerError('network'));
  assert.deepEqual(deltas, ['半截']);
  assert.equal(calls.length, 1, 'secondary must not be called after deltas were emitted');
});

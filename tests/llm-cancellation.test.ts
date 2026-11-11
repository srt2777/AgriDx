import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { createOpenAICompatibleProvider } from '../server/llm/openai-compatible';
import { LlmRouter } from '../server/llm/router';
import { ProviderError, type ChatMessage, type ChatResult } from '../server/llm/types';

const envNames = ['LLM_PROVIDER', 'GEMINI_API_KEY', 'DEEPSEEK_API_KEY', 'DEEPSEEK_BASE_URL'] as const;
const originalEnv = new Map(envNames.map(name => [name, process.env[name]]));
const messages: ChatMessage[] = [{ role: 'user', content: '拖拉机尾部异响' }];

beforeEach(() => {
  process.env.LLM_PROVIDER = 'deepseek';
  process.env.GEMINI_API_KEY = 'fake-test-key';
  process.env.DEEPSEEK_API_KEY = 'fake-test-key';
  process.env.DEEPSEEK_BASE_URL = 'https://deepseek.invalid/v1';
});
afterEach(() => {
  for (const [name, value] of originalEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function cancelled(attempts?: number) {
  return (error: unknown) => {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.kind, 'cancelled');
    if (attempts !== undefined) assert.equal(error.attempts, attempts);
    assert.doesNotMatch(JSON.stringify(error), /sensitive-upstream-detail/);
    return true;
  };
}

function provider() {
  return createOpenAICompatibleProvider({
    name: 'deepseek', model: 'test-model', apiKeyEnv: 'DEEPSEEK_API_KEY',
    apiUrl: 'https://deepseek.invalid/chat/completions', timeoutMs: 1000,
  });
}

function result(): ChatResult {
  return { content: '迟到的回答', provider: 'deepseek', model: 'test-model' };
}

for (const streaming of [false, true]) {
  const label = streaming ? 'streaming' : 'ordinary';

  test(`${label} provider and router reject a pre-aborted request without fetch`, async t => {
    const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('must not fetch'); });
    const controller = new AbortController();
    controller.abort();
    const options = { signal: controller.signal };
    const model = provider();
    const router = new LlmRouter();
    await assert.rejects(streaming ? model.chatStream!(messages, () => {}, options) : model.chat(messages, options), cancelled());
    await assert.rejects(streaming ? router.chatStream(messages, () => {}, options) : router.chat(messages, options), cancelled(0));
    assert.equal(fetch.mock.callCount(), 0);
  });

  test(`${label} router propagates cancellation to fetch and never starts its secondary`, async t => {
    const controller = new AbortController();
    let upstreamSignal: AbortSignal | undefined;
    const fetch = t.mock.method(globalThis, 'fetch', (_url: unknown, init: RequestInit) => {
      upstreamSignal = init.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('sensitive-upstream-detail', 'AbortError')), { once: true });
        controller.abort();
      });
    });
    const router = new LlmRouter();
    await assert.rejects(streaming
      ? router.chatStream(messages, () => assert.fail('no delta after abort'), { signal: controller.signal })
      : router.chat(messages, { signal: controller.signal }), cancelled(1));
    assert.equal(upstreamSignal?.aborted, true);
    assert.equal(fetch.mock.callCount(), 1);
  });

  test(`${label} router does not retry a provider-classified cancellation without a caller signal`, async t => {
    const router = new LlmRouter();
    const primary = router.toolProvider()!;
    const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('secondary must not fetch'); });
    t.mock.method(console, 'warn', () => {});
    t.mock.method(primary, streaming ? 'chatStream' : 'chat', async () => {
      throw new ProviderError('deepseek', 'cancelled', 'request cancelled');
    });
    await assert.rejects(streaming ? router.chatStream(messages, () => {}) : router.chat(messages), cancelled(1));
    assert.equal(fetch.mock.callCount(), 0);
  });

  test(`${label} router rejects late success from a provider that ignores its signal`, async t => {
    const router = new LlmRouter();
    const primary = router.toolProvider()!;
    const controller = new AbortController();
    const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('secondary must not fetch'); });
    t.mock.method(primary, streaming ? 'chatStream' : 'chat', async () => {
      controller.abort();
      return result();
    });
    await assert.rejects(streaming
      ? router.chatStream(messages, () => assert.fail('late success must not be emitted'), { signal: controller.signal })
      : router.chat(messages, { signal: controller.signal }), cancelled(1));
    assert.equal(fetch.mock.callCount(), 0);
  });

  for (const kind of ['timeout', 'server_error'] as const) {
    test(`${label} router still falls back after an uncancelled ${kind}`, async t => {
      const router = new LlmRouter();
      const primary = router.toolProvider()!;
      t.mock.method(console, 'warn', () => {});
      t.mock.method(primary, streaming ? 'chatStream' : 'chat', async () => {
        throw new ProviderError('deepseek', kind, 'request failed');
      });
      const fetch = t.mock.method(globalThis, 'fetch', async (url: unknown) => {
        assert.match(String(url), /googleapis\.com/);
        return streaming
          ? new Response('data: {"choices":[{"delta":{"content":"备用回答"}}]}\n\ndata: [DONE]\n\n')
          : Response.json({ choices: [{ message: { content: '备用回答' } }] });
      });
      const outcome = streaming ? await router.chatStream(messages, () => {}) : await router.chat(messages);
      assert.equal(outcome.result.content, '备用回答');
      assert.equal(outcome.fallbackReason, kind);
      assert.equal(outcome.attempts, 2);
      assert.equal(fetch.mock.callCount(), 1);
    });
  }
}

test('ordinary cancellation still reaches upstream after response headers arrive', async t => {
  const controller = new AbortController();
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => ({
    ok: true,
    json: () => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('sensitive-upstream-detail', 'AbortError')), { once: true });
      controller.abort();
    }),
  } as Response));
  await assert.rejects(provider().chat(messages, { signal: controller.signal }), cancelled());
});

test('ordinary provider rejects a late body that ignored cancellation', async t => {
  const controller = new AbortController();
  t.mock.method(globalThis, 'fetch', async () => {
    controller.abort();
    return Response.json({ choices: [{ message: { content: '迟到的回答' } }] });
  });
  await assert.rejects(provider().chat(messages, { signal: controller.signal }), cancelled());
});

test('streaming provider stops delivery when the first delta cancels buffered later deltas', async t => {
  const controller = new AbortController();
  t.mock.method(globalThis, 'fetch', async () => new Response(
    'data: {"choices":[{"delta":{"content":"第一段"}}]}\n\ndata: {"choices":[{"delta":{"content":"第二段"}}]}\n\ndata: [DONE]\n\n',
  ));
  const deltas: string[] = [];
  await assert.rejects(provider().chatStream!(messages, text => {
    deltas.push(text);
    controller.abort();
  }, { signal: controller.signal }), cancelled());
  assert.deepEqual(deltas, ['第一段']);
});

test('streaming router passes cancellation to a chat-only provider and emits no late fallback delta', async t => {
  const router = new LlmRouter();
  const primary = router.toolProvider()!;
  delete primary.chatStream;
  const controller = new AbortController();
  t.mock.method(primary, 'chat', async (_messages, options) => {
    assert.equal(options?.signal, controller.signal);
    controller.abort();
    return result();
  });
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('secondary must not fetch'); });
  await assert.rejects(router.chatStream(messages, () => assert.fail('late delta'), { signal: controller.signal }), cancelled(1));
  assert.equal(fetch.mock.callCount(), 0);
});

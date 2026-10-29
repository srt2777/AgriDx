import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { LlmRouter } from '../server/llm/router';
import { createGeminiProvider } from '../server/llm/gemini';
import { createDeepSeekProvider } from '../server/llm/deepseek';
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

function success(content = '通用排查建议', model?: string): Response {
  return Response.json({ choices: [{ message: { content } }], model });
}

function providerError(kind: ProviderErrorKind) {
  return (error: unknown) => error instanceof ProviderError && error.kind === kind;
}

test('models and optional DeepSeek endpoint are read when factories run, after module imports', async (t) => {
  process.env.GEMINI_MODEL = 'test-gemini-after-dotenv';
  process.env.DEEPSEEK_MODEL = 'test-deepseek-after-dotenv';
  process.env.DEEPSEEK_BASE_URL = 'https://example.invalid/model-api/v1/';
  process.env.DEEPSEEK_API_KEY = ' test-key ';
  assert.equal(createGeminiProvider().model, 'test-gemini-after-dotenv');
  const deepseek = createDeepSeekProvider();
  assert.equal(deepseek.model, 'test-deepseek-after-dotenv');
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init: RequestInit) => {
    assert.equal(String(url), 'https://example.invalid/model-api/v1/chat/completions');
    assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer test-key');
    const request = JSON.parse(init.body as string);
    assert.equal(request.model, 'test-deepseek-after-dotenv');
    return success();
  });
  assert.equal((await deepseek.chat(messages)).model, 'test-deepseek-after-dotenv');
});

test('blank model values use existing defaults and status exposes no keys or proxy URLs', (t) => {
  process.env.GEMINI_MODEL = ' ';
  process.env.DEEPSEEK_MODEL = ' ';
  process.env.GEMINI_API_KEY = 'secret-gemini-value';
  process.env.DEEPSEEK_API_KEY = 'secret-deepseek-value';
  process.env.HTTPS_PROXY = 'http://secret-proxy-user:secret-proxy-pass@example.invalid';
  const router = new LlmRouter();
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('health must be local'); });
  const status = router.getStatus();
  assert.equal(status.configured, true);
  assert.equal(status.configValid, true);
  assert.equal(status.primary, 'gemini');
  assert.equal(status.proxyConfigured, true);
  assert.deepEqual(status.providers, [
    { provider: 'gemini', model: 'gemini-3.8-flash', configured: true },
    { provider: 'deepseek', model: 'deepseek-v4-flash', configured: true },
  ]);
  assert.doesNotMatch(JSON.stringify(status), /secret-|connected/);
  assert.equal(fetch.mock.callCount(), 0);
});

test('auto preserves Gemini priority and forwards grounded prompt and conversation without mutation', async (t) => {
  process.env.GEMINI_API_KEY = 'gemini-test-key';
  process.env.DEEPSEEK_API_KEY = 'deepseek-test-key';
  const originalMessages = structuredClone(messages);
  const fetch = t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init: RequestInit) => {
    assert.match(String(url), /generativelanguage.googleapis.com/);
    const request = JSON.parse(init.body as string);
    assert.ok(request.messages[0].content.startsWith(messages[0].content));
    assert.match(request.messages[0].content, /配置的模型名称/);
    assert.deepEqual(request.messages[1], messages[1]);
    assert.equal(request.stream, false);
    return success('根据已有资料回答', 'actual-gemini-model');
  });
  const outcome = await new LlmRouter().chat(messages);
  assert.equal(outcome.result.provider, 'gemini');
  assert.equal(outcome.result.model, 'actual-gemini-model');
  assert.equal(outcome.fellBack, false);
  assert.equal(outcome.fallbackReason, undefined);
  assert.equal(outcome.attempts, 1);
  assert.equal(fetch.mock.callCount(), 1);
  assert.deepEqual(messages, originalMessages);
});

test('explicit DeepSeek preference overrides Gemini priority while keeping dual-provider fallback', async (t) => {
  process.env.LLM_PROVIDER = 'deepseek';
  process.env.GEMINI_API_KEY = 'gemini-test-key';
  process.env.DEEPSEEK_API_KEY = 'deepseek-test-key';
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
    assert.match(String(url), /api.deepseek.com/);
    return success();
  });
  const outcome = await new LlmRouter().chat(messages);
  assert.equal(outcome.primary, 'deepseek');
  assert.equal(outcome.result.provider, 'deepseek');
  assert.equal(outcome.fellBack, false);
});

test('a missing preferred key routes directly to the other configured provider', async (t) => {
  process.env.LLM_PROVIDER = 'gemini';
  process.env.DEEPSEEK_API_KEY = 'deepseek-test-key';
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
    assert.match(String(url), /api.deepseek.com/);
    return success();
  });
  const router = new LlmRouter();
  assert.equal(router.getStatus().primary, 'deepseek');
  const outcome = await router.chat(messages);
  assert.equal(outcome.primary, 'deepseek');
  assert.equal(outcome.result.provider, 'deepseek');
  assert.equal(outcome.fellBack, false);
});

test('primary auth failure uses secondary provider and never logs upstream response secrets', async (t) => {
  process.env.GEMINI_API_KEY = 'gemini-test-key';
  process.env.DEEPSEEK_API_KEY = 'deepseek-test-key';
  const warnings: string[] = [];
  t.mock.method(console, 'warn', (...values: unknown[]) => { warnings.push(values.join(' ')); });
  const fetch = t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) =>
    String(url).includes('googleapis.com')
      ? new Response('echoed-secret-key and user prompt', { status: 401 })
      : success('备用模型回答'));
  const outcome = await new LlmRouter().chat(messages);
  assert.equal(outcome.primary, 'gemini');
  assert.equal(outcome.result.provider, 'deepseek');
  assert.equal(outcome.fellBack, true);
  assert.equal(outcome.fallbackReason, 'auth');
  assert.equal(outcome.attempts, 2);
  assert.equal(fetch.mock.callCount(), 2);
  assert.match(warnings.join(' '), /auth/);
  assert.doesNotMatch(warnings.join(' '), /echoed-secret|user prompt|test-key/);
});

test('malformed JSON is an invalid response and triggers the real secondary provider', async (t) => {
  process.env.GEMINI_API_KEY = 'gemini-test-key';
  process.env.DEEPSEEK_API_KEY = 'deepseek-test-key';
  t.mock.method(console, 'warn', () => {});
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) =>
    String(url).includes('googleapis.com')
      ? new Response('<html>invalid model response</html>')
      : success());
  const outcome = await new LlmRouter().chat(messages);
  assert.equal(outcome.result.provider, 'deepseek');
  assert.equal(outcome.fallbackReason, 'invalid_response');
});

test('two failed providers return a safe classified error for local knowledge fallback', async (t) => {
  process.env.GEMINI_API_KEY = 'gemini-test-key';
  process.env.DEEPSEEK_API_KEY = 'deepseek-test-key';
  t.mock.method(console, 'warn', () => {});
  const fetch = t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) =>
    new Response('upstream-secret-response', { status: String(url).includes('googleapis.com') ? 503 : 429 }));
  await assert.rejects(new LlmRouter().chat(messages), (error: unknown) => {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.provider, 'deepseek');
    assert.equal(error.kind, 'rate_limit');
    assert.equal(error.detail, 'HTTP 429');
    return true;
  });
  assert.equal(fetch.mock.callCount(), 2);
});

test('a failure with no secondary key preserves the actual primary failure kind', async (t) => {
  process.env.DEEPSEEK_API_KEY = 'deepseek-test-key';
  t.mock.method(console, 'warn', () => {});
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response('no access', { status: 403 }));
  await assert.rejects(new LlmRouter().chat(messages), providerError('auth'));
  assert.equal(fetch.mock.callCount(), 1);
});

test('missing or whitespace-only keys report local mode and make no upstream request', async (t) => {
  process.env.GEMINI_API_KEY = ' \n ';
  process.env.DEEPSEEK_API_KEY = ' ';
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('must not call'); });
  const router = new LlmRouter();
  assert.equal(router.hasAnyConfigured(), false);
  assert.equal(router.getStatus().primary, null);
  assert.ok(router.getStatus().providers.every((provider) => !provider.configured));
  await assert.rejects(router.chat(messages), providerError('configuration'));
  assert.equal(fetch.mock.callCount(), 0);
});

test('invalid provider setting is safely reported and disables calls even with existing keys', async (t) => {
  process.env.LLM_PROVIDER = 'mistyped-provider-secret';
  process.env.GEMINI_API_KEY = 'gemini-test-key';
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('must not call'); });
  const router = new LlmRouter();
  assert.equal(router.hasAnyConfigured(), false);
  const status = router.getStatus();
  assert.equal(status.configValid, false);
  assert.equal(status.configurationError, 'invalid_provider');
  assert.equal(status.preference, null);
  assert.equal(status.primary, null);
  assert.doesNotMatch(JSON.stringify(status), /mistyped-provider-secret|test-key/);
  await assert.rejects(router.chat(messages), providerError('configuration'));
  assert.equal(fetch.mock.callCount(), 0);
});

test('invalid or empty assistant content is consistently classified for local fallback', async (t) => {
  process.env.DEEPSEEK_API_KEY = 'deepseek-test-key';
  for (const body of [null, {}, { choices: [] }, { choices: [{ message: { content: 123 } }] },
    { choices: [{ message: { content: '  ' } }] }]) {
    t.mock.method(globalThis, 'fetch', async () => Response.json(body));
    await assert.rejects(createDeepSeekProvider().chat(messages), providerError('invalid_response'));
  }
});

test('network errors do not propagate URL or credential-bearing messages', async (t) => {
  process.env.DEEPSEEK_API_KEY = 'deepseek-test-key';
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('https://user:secret@example.invalid'); });
  await assert.rejects(createDeepSeekProvider().chat(messages), (error: unknown) => {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.kind, 'network');
    assert.equal(error.detail, 'request failed');
    assert.doesNotMatch(JSON.stringify(error), /secret/);
    return true;
  });
});

test('request timeout remains active while the upstream response body is still generating', async (t) => {
  process.env.DEEPSEEK_API_KEY = 'deepseek-test-key';
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => ({
    ok: true,
    json: () => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        reject(new DOMException('aborted with sensitive detail', 'AbortError'));
      });
    }),
  } as Response));
  const provider = createOpenAICompatibleProvider({
    name: 'deepseek', model: 'test-model', apiKeyEnv: 'DEEPSEEK_API_KEY',
    apiUrl: 'https://example.invalid/chat/completions', timeoutMs: 15,
  });
  await assert.rejects(provider.chat(messages), providerError('timeout'));
});

test('shadow tool provider prefers a tool-capable provider without changing ordinary routing', () => {
  process.env.GEMINI_API_KEY = 'gemini-test-key';
  process.env.DEEPSEEK_API_KEY = 'deepseek-test-key';
  const both = new LlmRouter();
  assert.equal(both.getStatus().primary, 'gemini');
  assert.equal(both.toolProvider()?.name, 'deepseek');
  process.env.LLM_PROVIDER = 'gemini';
  assert.equal(new LlmRouter().toolProvider()?.name, 'deepseek');
  delete process.env.LLM_PROVIDER;
  delete process.env.DEEPSEEK_API_KEY;
  const geminiOnly = new LlmRouter();
  assert.equal(geminiOnly.getStatus().primary, 'gemini');
  assert.equal(geminiOnly.toolProvider(), null);
  delete process.env.GEMINI_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'deepseek-test-key';
  assert.equal(new LlmRouter().toolProvider()?.name, 'deepseek');
  process.env.LLM_PROVIDER = 'invalid';
  assert.equal(new LlmRouter().toolProvider(), null);
});

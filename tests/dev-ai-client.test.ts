import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProviderError } from '../server/llm/types';
import { previewAiProvider, readPreviewAiStatus } from '../src/dev-preview/ai-gateway';

test('browser proxy sends only bounded messages to same-origin endpoints and accepts compatible providers', async t => {
  let payload: any;
  t.mock.method(globalThis, 'fetch', async (url: string, options?: RequestInit) => {
    assert.equal(url, '/api/dev-ai/chat'); payload = JSON.parse(String(options?.body));
    assert.equal(options?.credentials, 'same-origin'); assert.equal(new Headers(options?.headers).has('Authorization'), false);
    return Response.json({ provider: 'openai', model: 'test-model', content: 'General diagnosis guidance.' });
  });
  const proxy = previewAiProvider({ enabled: true, provider: 'openai', model: 'test-model' });
  assert.equal(proxy.hasAnyConfigured(), true);
  const result = await proxy.chat([{ role: 'system', content: 'Indexed references' }, ...Array.from({ length: 30 }, () => ({ role: 'assistant' as const, content: 'x'.repeat(16000) })), { role: 'user', content: '拖拉机发动机过热' }]);
  assert.equal(result.result.provider, 'openai'); assert.deepEqual(Object.keys(payload), ['messages']); assert.ok(payload.messages.length <= 11);
  assert.ok(payload.messages.every((m: any) => m.content.length <= (m.role === 'system' ? 12000 : 2000)));
  assert.equal(payload.messages.at(-1).content, '拖拉机发动机过热');
});

test('browser proxy does not turn rate limits or malformed model responses into successful answers', async t => {
  const proxy = previewAiProvider({ enabled: true, provider: 'deepseek', model: 'test-model' });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'Quota exceeded' }, { status: 429 }));
  await assert.rejects(proxy.chat([{ role: 'user', content: 'test' }]), error => error instanceof ProviderError);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ content: 'OK', provider: 'unknown', model: 'test' }));
  await assert.rejects(proxy.chat([{ role: 'user', content: 'test' }]));
});

test('non-browser local diagnosis never probes external AI status', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Must not request'); });
  assert.deepEqual(await readPreviewAiStatus(), { enabled: false, provider: null, model: null });
});

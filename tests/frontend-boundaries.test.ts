import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ApiError, requestJson, type FetchImplementation } from '../src/lib/api-client';
import { parseChatResponse, parseLlmHealth, requestChat } from '../src/features/chat/api';
import {
  createChatRequest, loadChatSession, META_KEY, parseHistory, saveHistory, saveMachineContext, STORAGE_KEY,
} from '../src/features/chat/session';
import { parseKnowledgeCatalog } from '../src/features/knowledge/catalog-api';

const layoutSource = readFileSync(new URL('../src/components/Layout.tsx', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../src/app.tsx', import.meta.url), 'utf8');
const newShellSource = readFileSync(new URL('../src/ui/WorkspaceShell.tsx', import.meta.url), 'utf8');

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

const answer = { choices: [{ message: { role: 'assistant', content: '参考资料答复' } }] };
const context = { machineType: '拖拉机', brand: '品牌', model: '型号' };

test('恢复损坏或不可用的浏览器存储仍能得到空会话', () => {
  const broken = memoryStorage({ [STORAGE_KEY]: '{', [META_KEY]: 'null' });
  assert.deepEqual(loadChatSession(null, broken), {
    messages: [], context: { machineType: '', brand: '', model: '' }, draft: '',
  });
  const blocked = {
    getItem: () => { throw new Error('Storage blocked'); },
    setItem: () => { throw new Error('Storage full'); },
    removeItem: () => { throw new Error('Storage blocked'); },
  };
  assert.equal(loadChatSession(null, blocked).messages.length, 0);
  assert.doesNotThrow(() => saveHistory([], blocked));
  assert.doesNotThrow(() => saveMachineContext(context, blocked));
});

test('历史不恢复占位、system或非法元数据，只保留最后100条真实对话', () => {
  const messages = Array.from({ length: 103 }, (_, index) => ({ id: String(index), role: 'user', content: String(index) }));
  const loaded = parseHistory([
    null, { role: 'loading', id: 'wait', content: '' }, { role: 'error', id: 'error', content: '失败' },
    { role: 'system', id: 'system', content: '不能带入' }, ...messages,
    { id: 'answer', role: 'assistant', content: '答复', provider: 'malicious', model: {},
      knowledgeChunks: -1, answerMode: 'confirmed', fallbackReason: 'unknown' },
  ]);
  assert.equal(loaded.length, 100);
  assert.equal(loaded[0].id, '4');
  assert.equal(loaded.at(-1)?.provider, undefined);
  assert.equal(loaded.at(-1)?.knowledgeChunks, undefined);
  assert.equal(loaded.at(-1)?.answerMode, undefined);
  assert.equal(loaded.at(-1)?.model, undefined);
});

test('诊断预填保持草稿，兼容旧英文类型并限制外部传入文本长度', () => {
  const stored = memoryStorage({ [META_KEY]: JSON.stringify({ machineType: 'Tractor', brand: '原品牌', model: '原型号' }) });
  assert.equal(loadChatSession(null, stored).context.machineType, '拖拉机');
  const imported = loadChatSession({ brand: 'a'.repeat(150), model: '', question: 'q'.repeat(2100) }, stored);
  assert.equal(imported.context.machineType, '拖拉机');
  assert.equal(imported.context.brand.length, 100);
  assert.equal(imported.context.model, '');
  assert.equal(imported.draft.length, 2000);
  assert.equal(imported.messages.length, 0);
});

test('保存真实对话不把失败消息或等待状态写回历史；清空会移除存储', () => {
  const storage = memoryStorage();
  saveHistory([
    { id: 'user', role: 'user', content: '问题' },
    { id: 'loading', role: 'loading', content: '' },
    { id: 'error', role: 'error', content: '请求未完成' },
  ], storage);
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEY) || 'null').map((message: { role: string }) => message.role), ['user']);
  saveHistory([], storage);
  assert.equal(storage.getItem(STORAGE_KEY), null);
});

test('API只发送最近20条真实历史和新问题，不发送本地元信息及占位', () => {
  const messages = parseHistory(Array.from({ length: 30 }, (_, index) => ({
    id: String(index), role: index % 2 ? 'assistant' : 'user', content: String(index), provider: 'gemini',
  })));
  messages.push({ id: 'pending', role: 'loading', content: '' });
  const request = createChatRequest(messages, '当前问题', context);
  assert.equal(request.messages.length, 21);
  assert.deepEqual(request.messages[0], { role: 'user', content: '10' });
  assert.deepEqual(request.messages.at(-1), { role: 'user', content: '当前问题' });
  assert.equal(request.machineType, '拖拉机');
});

test('LLM和本地fallback元数据保留，未知元数据丢弃，空或非文本答复拒绝', () => {
  const reply = parseChatResponse({ ...answer, provider: 'knowledge-base', model: '本地引擎',
    answerMode: 'local-evidence', fallbackReason: 'provider_unavailable', knowledgeChunks: 4 });
  assert.equal(reply.role, 'assistant');
  assert.equal(reply.fallbackReason, 'provider_unavailable');
  assert.equal(reply.knowledgeChunks, 4);
  const invalidMetadata = parseChatResponse({ ...answer, provider: 123, knowledgeChunks: Infinity });
  assert.equal(invalidMetadata.provider, undefined);
  assert.equal(invalidMetadata.knowledgeChunks, undefined);
  for (const value of [null, [], { choices: {} }, { choices: [null] },
    { choices: [{ message: { content: ' ' } }] }, { choices: [{ message: { content: {} } }] }]) {
    assert.throws(() => parseChatResponse(value));
  }
});

test('HTTP错误保留后端友好文本，非JSON或畸形错误体使用调用方文案', async () => {
  for (const [body, expected] of [
    [JSON.stringify({ error: '服务暂不可用' }), '服务暂不可用'],
    ['Gateway unavailable', '请重试'],
    [JSON.stringify({ error: { message: '不能渲染对象' } }), '请重试'],
  ]) {
    const fakeFetch: FetchImplementation = async () => new Response(body, { status: 502 });
    const reply = await requestChat({ messages: [{ role: 'user', content: '问题' }] }, new AbortController().signal, '请重试', fakeFetch);
    assert.deepEqual(reply, { role: 'error', content: expected });
  }
  const fakeFetch: FetchImplementation = async () => new Response('not json', { status: 200 });
  await assert.rejects(requestJson('/api/chat', {}, fakeFetch), SyntaxError);
});

test('取消在请求前或读取响应期间发生，都不接受迟到的答复', async () => {
  const cancelled = new AbortController();
  cancelled.abort();
  let called = false;
  const notCalled: FetchImplementation = async () => { called = true; return new Response('{}'); };
  await assert.rejects(requestJson('/api/chat', { signal: cancelled.signal }, notCalled), { name: 'AbortError' });
  assert.equal(called, false);

  const duringBody = new AbortController();
  const delayed: FetchImplementation = async () => ({ ok: true, json: async () => {
    duringBody.abort();
    return answer;
  } }) as Response;
  await assert.rejects(requestChat({ messages: [] }, duringBody.signal, '请重试', delayed), { name: 'AbortError' });
});

test('通用客户端保留HTTP状态并传递原AbortSignal', async () => {
  const controller = new AbortController();
  const fakeFetch: FetchImplementation = async (path, options) => {
    const url = new URL(String(path), 'https://agridx.test');
    assert.equal(url.pathname, '/api/knowledge/catalog');
    assert.equal(url.searchParams.get('brand'), 'test');
    assert.match(url.searchParams.get('__agridx_check') ?? '', /^\d+$/);
    assert.equal(options?.signal, controller.signal);
    assert.equal(options?.cache, 'no-store');
    return new Response('{}', { status: 403 });
  };
  await assert.rejects(requestJson('/api/knowledge/catalog?brand=test', { signal: controller.signal }, fakeFetch),
    (error: unknown) => error instanceof ApiError && error.status === 403);
});

test('健康状态配置标志必须是boolean，不能把未知模型当成已知首选', () => {
  assert.deepEqual(parseLlmHealth({ llm: { configured: false, primary: 'unexpected' } }), { configured: false, primary: null });
  assert.deepEqual(parseLlmHealth({ llm: { configured: true, primary: 'gemini' } }), { configured: true, primary: 'gemini' });
  assert.throws(() => parseLlmHealth({ llm: { configured: 'false' } }));
});

const catalog = {
  totals: { entries: 0, archivedEntries: 0, learningEntries: 0, sources: 0, brands: 1, models: 1, faultEntries: 0, mappedEntries: 0 },
  expansion: { targetLabel: '1w+', countingUnit: 'indexed-entry', status: 'planned' },
  limitations: ['适用范围仍需核对'],
  brands: [{ id: 'brand', name: '品牌', entryCount: 0, faultCount: 0, sourceCount: 0,
    models: [{ id: 'model', name: '型号', scope: 'exact', machineType: '拖拉机', entryCount: 0, faultCount: 0, sourceCount: 0,
      components: [{ id: 'component', name: '组件', entryCount: 0, faultCount: 0, sourceCount: 0, unresolvedPartCount: 0,
        parts: [{ id: 'part', name: '零件', entryCount: 0, faultCount: 0, sourceCount: 0 }] }] }] }],
};

test('四级目录拒绝畸形嵌套数组与选择结果，不让成功HTTP造成页面渲染崩溃', () => {
  assert.equal(parseKnowledgeCatalog(catalog), catalog);
  const broken = structuredClone(catalog);
  (broken.brands[0].models[0].components[0] as unknown as { parts: unknown }).parts = null;
  assert.throws(() => parseKnowledgeCatalog(broken));
  assert.throws(() => parseKnowledgeCatalog({ ...catalog, selected: { brand: 'brand', model: 'model', entries: {}, gaps: [] } }));
  assert.throws(() => parseKnowledgeCatalog({ ...catalog, limitations: [123] }));
  assert.throws(() => parseKnowledgeCatalog({ ...catalog, totals: { ...catalog.totals, sources: -1 } }));
});

test('新版首页与功能路由统一进入工作空间 shell，并标记为新版', () => {
  for (const route of ['/knowledge', '/chat', '/models', '/hall', '/version-history']) {
    assert.match(appSource, new RegExp(`path="${route.slice(1)}"`), `missing secondary route ${route}`);
    assert.ok(newShellSource.includes(route), `new shell does not link ${route}`);
  }
  assert.match(layoutSource, /if \(uiVersion === 'new'\) return <NewVersionShell \/>/);
  assert.match(layoutSource, /<NewVersionShell \/>/);
  assert.match(newShellSource, /data-ui-version="new"/);
  assert.match(newShellSource, /<Outlet \/>/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Registry, type Definition } from '../agent/runtime/registry';
const def: Definition = { name: 'save_record', description: '保存记录', parameters: { type:'object', properties:{ text:{type:'string'} }, required:['text'], additionalProperties:false }, returns:'记录', side_effect:'write', timeout_ms: 100, retryable:false, requires_confirmation:true, cache_ttl:0, tags:['record'], version:'1', execute: () => 'saved' };
test('写入验证权限、参数和可信确认', async () => {
  const r = new Registry(); r.register(def);
  assert.equal((await r.execute('save_record', {text:'x'}, {allowed:['read']})).error?.code, 'PERMISSION_DENIED');
  assert.equal((await r.execute('save_record', {}, {allowed:['write']})).error?.code, 'INVALID_ARGS');
  assert.equal((await r.execute('save_record', {text:'x'}, {allowed:['write']})).error?.code, 'NEEDS_CONFIRMATION');
  assert.equal((await r.execute('save_record', {text:'x'}, {allowed:['write'], confirmed:true, audit: () => {}})).ok, true);
  assert.equal(r.schemas().length, 1);
});
test('写工具不能省略确认，超时可取消信号', async () => {
  const r = new Registry(); assert.throws(() => r.register({...def, requires_confirmation:false}));
  let aborted = false; r.register({...def, name:'read_wait', side_effect:'read', requires_confirmation:false, timeout_ms:10, execute: (_, signal) => new Promise(resolve => signal.addEventListener('abort', () => { aborted = true; resolve(null); })) });
  assert.equal((await r.execute('read_wait', {text:'x'}, {allowed:['read']})).error?.code, 'TIMEOUT'); assert.equal(aborted, true);
});

test('缓存隔离、过期和返回值副本', async () => {
  let now = 0, calls = 0;
  const registry = new Registry(100, () => now);
  registry.register({ ...def, name: 'read_value', side_effect: 'read', requires_confirmation: false, cache_ttl: 10, execute: () => ({ count: ++calls }) });
  const first = await registry.execute('read_value', { text: 'a' }, { allowed: ['read'], cacheScope: 'A' });
  (first.data as { count: number }).count = 999;
  const cached = await registry.execute('read_value', { text: 'a' }, { allowed: ['read'], cacheScope: 'A' });
  assert.equal(cached.meta.cached, true); assert.deepEqual(cached.data, { count: 1 });
  await registry.execute('read_value', { text: 'a' }, { allowed: ['read'], cacheScope: 'B' }); assert.equal(calls, 2);
  now = 11; await registry.execute('read_value', { text: 'a' }, { allowed: ['read'], cacheScope: 'A' }); assert.equal(calls, 3);
});
test('大结果分页可重组且游标不能跨任务读取', async () => {
  const registry = new Registry(100); const text = '字'.repeat(350);
  registry.register({ ...def, name: 'read_large', side_effect: 'read', requires_confirmation: false, execute: () => text });
  const response = await registry.execute('read_large', { text: 'a' }, { allowed: ['read'], cacheScope: 'A' });
  assert.equal(response.meta.truncated, true);
  let { preview: serialized, next_cursor: cursor } = response.data as { preview: string; next_cursor: string | null };
  assert.equal(registry.readPage(cursor!, 'B'), undefined);
  while (cursor) { const page = registry.readPage(cursor, 'A')!; serialized += page.text; cursor = page.next_cursor; }
  assert.equal(JSON.parse(serialized), text);
});
test('审计失败不能触发写操作或抛出凭据', async () => {
  let calls = 0; const r = new Registry(); r.register({ ...def, execute: () => { calls++; } });
  const result = await r.execute('save_record', { text: 'x' }, { allowed: ['write'], confirmed: true, audit: () => { throw new Error('secret'); } });
  assert.equal(result.ok, false); assert.equal(calls, 0); assert.ok(!JSON.stringify(result).includes('secret'));
});
test('取消等待不依赖工具是否配合 AbortSignal', async () => {
  const r = new Registry(); const controller = new AbortController();
  r.register({ ...def, name: 'read_hang', side_effect: 'read', requires_confirmation: false, execute: () => new Promise(() => {}) });
  const pending = r.execute('read_hang', {text:'x'}, {allowed:['read'], signal:controller.signal}); controller.abort();
  assert.equal((await pending).error?.code, 'CANCELLED');
});

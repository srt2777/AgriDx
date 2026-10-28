import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Registry, type Definition } from '../agent/runtime/registry';
const def: Definition = { name: 'save_record', description: '保存记录', parameters: { type:'object', properties:{ text:{type:'string'} }, required:['text'], additionalProperties:false }, returns:'记录', side_effect:'write', timeout_ms: 100, retryable:false, requires_confirmation:true, cache_ttl:0, tags:['record'], version:'1', execute: () => 'saved' };
test('写入验证权限、参数和可信确认', async () => {
  const r = new Registry(); r.register(def);
  assert.equal((await r.execute('save_record', {text:'x'}, {allowed:['read']})).error?.code, 'PERMISSION_DENIED');
  assert.equal((await r.execute('save_record', {}, {allowed:['write']})).error?.code, 'INVALID_ARGS');
  assert.equal((await r.execute('save_record', {text:'x'}, {allowed:['write']})).error?.code, 'NEEDS_CONFIRMATION');
  assert.equal((await r.execute('save_record', {text:'x'}, {allowed:['write'], confirmed:true})).ok, true);
  assert.equal(r.schemas().length, 1);
});
test('写工具不能省略确认，超时可取消信号', async () => {
  const r = new Registry(); assert.throws(() => r.register({...def, requires_confirmation:false}));
  let aborted = false; r.register({...def, name:'read_wait', side_effect:'read', requires_confirmation:false, timeout_ms:10, execute: (_, signal) => new Promise(resolve => signal.addEventListener('abort', () => { aborted = true; resolve(null); })) });
  assert.equal((await r.execute('read_wait', {text:'x'}, {allowed:['read']})).error?.code, 'TIMEOUT'); assert.equal(aborted, true);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Registry, type Definition } from '../agent/runtime/registry';
import { runLoop, type AgentProvider } from '../agent/core/loop';
const definition: Definition = { name: 'read_value', description: '读取', parameters: { type: 'object' }, returns: '值', side_effect: 'read', requires_confirmation: false, cache_ttl: 0, retryable: false, timeout_ms: 100, tags: [], version: '1', execute: args => args };
const registry = () => { const r = new Registry(); r.register(definition); return r; };
test('独立读取并行，调用结果保留原顺序', async () => {
  let active = 0, peak = 0; const r = new Registry();
  r.register({...definition, execute: async args => { peak = Math.max(peak, ++active); await new Promise(resolve=>setTimeout(resolve,10)); active--; return args; }});
  const provider: AgentProvider = {name:'test',next:async ({step})=>step ? {done:true} : {calls:[1,2,3].map(n=>({id:String(n),name:'read_value',args:{n}}))}};
  const result = await runLoop(r, provider, {concurrency:2});
  assert.equal(result.reason,'complete'); assert.equal(peak,2); assert.deepEqual(result.observations.map(o=>o.call.id),['1','2','3']);
});
test('重复调用、无进展和预算能结束循环', async () => {
  const repeat: AgentProvider = {name:'test',next:async ({step})=>({calls:[{id:String(step),name:'read_value',args:{a:1}}]})};
  assert.equal((await runLoop(registry(),repeat)).reason,'repeated_call');
  const fail: AgentProvider = {name:'test',next:async ({step})=>({calls:[{id:String(step),name:'missing',args:{step}}]})};
  assert.equal((await runLoop(registry(),fail)).reason,'no_progress');
  assert.equal((await runLoop(registry(),repeat,{maxSteps:1})).reason,'step_budget');
  assert.equal((await runLoop(registry(),repeat,{maxContextChars:10})).reason,'context_budget');
  assert.equal((await runLoop(registry(),{name:'x',next:async()=>({calls:[1,2].map(n=>({id:String(n),name:'read_value',args:{}}))})},{maxCalls:1})).reason,'call_budget');
});
test('提供器挂起、失败和用户取消均可收敛', async () => {
  const hanging: AgentProvider = {name:'test',next:async()=>new Promise(()=>{})};
  assert.equal((await runLoop(registry(),hanging,{timeoutMs:10})).reason,'timeout');
  const controller = new AbortController(); const pending = runLoop(registry(),hanging,{signal:controller.signal}); controller.abort();
  assert.equal((await pending).reason,'cancelled');
  assert.equal((await runLoop(registry(),{name:'test',next:async()=>{throw new Error('secret')}})).reason,'provider_error');
});

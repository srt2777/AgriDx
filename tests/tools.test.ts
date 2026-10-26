import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ToolRegistry, build_default_registry } from '../agent/tools';
import { MAX_TOOL_OUTPUT } from '../agent/config';

const input = { type: 'object', properties: { value: { type: 'integer' } }, required: ['value'], additionalProperties: false } as const;
function registry() {
  const reg = new ToolRegistry();
  reg.register('double', 'Double a number for testing.', { ...input, required: ['value'] }, ({ value }) => ({ result: value * 2 }));
  return reg;
}

test('normal invocation serializes objects and strings', async () => {
  const reg = registry();
  assert.deepEqual(JSON.parse(await reg.call('double', { value: 7 })), { result: 14 });
  const fn = ({ text }: { text: string }) => text;
  assert.equal(reg.tool('echo', 'Echo text.', { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] })(fn), fn);
  assert.equal(await reg.call('echo', { text: '中文' }), '中文');
});
test('unknown tool returns ERROR including available names', async () => {
  const result = await registry().call('missing', {});
  assert.match(result, /^ERROR:/); assert.match(result, /double/);
});
test('missing, null, primitive, extra and mistyped args do not execute', async () => {
  const reg = registry();
  for (const args of [{}, null, undefined, [], 'bad', 4, { value: '2' }, { value: false }, { value: 1.5 }, { value: NaN }, { value: 1, extra: 2 }]) {
    assert.match(await reg.call('double', args), /^ERROR:/);
  }
});
test('nested schema validation rejects malformed context and ranges', async () => {
  const reg = build_default_registry();
  for (const args of [{ query: '' }, { query: '故障', limit: 0 }, { query: '故障', limit: 6 }, { query: '故障', context: { model: 3 } }, { query: '故障', context: { faultCodes: [42] } }]) {
    assert.match(await reg.call('search_knowledge', args), /^ERROR:/);
  }
  assert.match(await reg.call('browse_knowledge', { collection: 'invalid' }), /^ERROR:/);
});
test('synchronous and asynchronous internal exceptions return sanitized ERROR', async () => {
  const reg = registry();
  for (const [name, fn] of [
    ['sync', () => { throw new Error('private-token'); }],
    ['async', async () => { throw new TypeError('private-token'); }],
  ] as const) {
    reg.register(name, 'Fail for testing.', { type: 'object' }, fn);
    const result = await reg.call(name, {});
    assert.match(result, /^ERROR:/); assert.ok(!result.includes('private-token'));
  }
});
test('serialization failures never escape', async () => {
  const reg = registry();
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
  for (const [name, value] of [['cyclic', cyclic], ['bigint', 1n]] as const) {
    reg.register(name, 'Serialization test.', { type: 'object' }, () => value);
    assert.match(await reg.call(name), /^ERROR:/);
  }
});
test('output truncation respects 4000 Unicode characters, with visible marker', async () => {
  const reg = registry();
  reg.register('long', 'Long output.', { type: 'object' }, () => '🌾'.repeat(5000));
  const text = await reg.call('long');
  assert.equal(Array.from(text).length, MAX_TOOL_OUTPUT);
  assert.ok(text.endsWith('[TRUNCATED]')); assert.ok(!text.includes('\uFFFD'));
  reg.register('exact', 'Exact output.', { type: 'object' }, () => '中'.repeat(MAX_TOOL_OUTPUT));
  assert.equal(await reg.call('exact'), '中'.repeat(MAX_TOOL_OUTPUT));
});
test('schemas expose only Anthropic tool fields and are isolated copies', () => {
  const reg = registry(); const schemas = reg.schemas();
  assert.deepEqual(Object.keys(schemas[0]).sort(), ['description', 'input_schema', 'name']);
  schemas[0].input_schema.properties!.value.type = 'string';
  assert.equal(reg.schemas()[0].input_schema.properties!.value.type, 'integer');
  assert.deepEqual(reg.names(), ['double']); assert.match(reg.describe(), /- double: Double/);
  assert.throws(() => reg.register('bad', 'Bad.', { type: 'object', pattern: '.' } as any, () => 1));
});
test('default registry has five documented tools and returns real time', async () => {
  const reg = build_default_registry(); assert.equal(reg.names().length, 5);
  assert.ok(reg.schemas().every(t => t.description.length > 20));
  const result = JSON.parse(await reg.call('get_current_time'));
  assert.equal(result.timezone, 'Asia/Shanghai'); assert.ok(Number.isFinite(Date.parse(result.iso)));
});
test('default adapters read actual repository knowledge and preserve source boundaries', async () => {
  const reg = build_default_registry();
  const stats = JSON.parse(await reg.call('knowledge_stats'));
  assert.ok(stats.archivedEntries > 0); assert.ok(stats.totalEntries >= stats.archivedEntries);
  const scope = await reg.call('resolve_machine_scope', { query: '东方红LF1504启动困难', context: { brand: '久保田', model: 'LX2620' } });
  assert.ok(!scope.startsWith('ERROR:')); assert.ok(JSON.parse(scope).identityConflict);
  const result = await reg.call('search_knowledge', { query: '久保田LX2620启动困难', limit: 1 });
  assert.ok(!result.startsWith('ERROR:')); assert.match(result, /source/); assert.match(result, /entryId/);
  const catalog = await reg.call('browse_knowledge', { brand: '久保田', model: 'LX2620', page: 1 });
  assert.ok(!catalog.startsWith('ERROR:')); assert.match(catalog, /久保田/);
});

test('asynchronous calls have a bounded wait and no retries', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const reg = registry(); let calls = 0;
  reg.register('never', 'Pending operation.', { type: 'object' }, () => { calls++; return new Promise(() => {}); });
  const pending = reg.call('never');
  await Promise.resolve(); t.mock.timers.tick(10_001);
  assert.match(await pending, /^ERROR:/); assert.equal(calls, 1);
  t.mock.timers.reset();
});

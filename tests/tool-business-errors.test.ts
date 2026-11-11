import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ToolExecutionError, ToolExecutor, ToolRegistry } from '../agent/tools';
import { runAgent } from '../agent/runner';
import type { Provider } from '../server/llm/types';

test('explicit business failures reach the model and trace as failures; ordinary error fields stay data', async () => {
  const registry = new ToolRegistry();
  registry.register('missing', 'test', { type: 'object' }, () => { throw new ToolExecutionError('NOT_FOUND', '没有找到该条目。'); });
  registry.register('data', 'test', { type: 'object' }, () => ({ error: 'field from a document', value: 42 }));
  const executor = new ToolExecutor(registry);
  const results = await executor.execute_tool_uses([
    { type: 'tool_use', id: 'missing-1', name: 'missing', input: {} },
    { type: 'tool_use', id: 'data-1', name: 'data', input: {} },
  ]);
  assert.equal(results[0].is_error, true);
  assert.match(String(results[0].content), /ERROR\[NOT_FOUND\]/);
  assert.equal(executor.trace[0].ok, false);
  assert.equal(executor.trace[0].error_type, 'NOT_FOUND');
  assert.equal(results[1].is_error, undefined);
  assert.equal(JSON.parse(String(results[1].content)).value, 42);
});

test('runner observes business failure, retries it, then caches only the successful observation', async () => {
  const registry = new ToolRegistry();
  registry.register('resolve_machine_scope', 'scope', { type: 'object' }, () => ({}));
  let executions = 0;
  registry.register('read', 'read', { type: 'object' }, () => {
    if (++executions === 1) throw new ToolExecutionError('NOT_FOUND', '合成条目暂时缺失。');
    return { source: 'synthetic fixture', value: 'available' };
  });
  let rounds = 0;
  const observations: string[] = [];
  const provider: Provider = {
    name: 'deepseek', model: 'offline-fixture', isConfigured: () => true,
    chat: async () => { throw new Error('unused'); },
    chatWithTools: async messages => {
      if (messages.at(-1)?.role === 'tool') observations.push(messages.at(-1)!.content);
      rounds++;
      return rounds <= 3
        ? { content: '', stopReason: 'tool_calls', toolCalls: [{ id: `read-${rounds}`, name: 'read', input: {} }] }
        : { content: '合成测试结束。', stopReason: 'stop', toolCalls: [] };
    },
  };
  const result = await runAgent({ provider, registry, messages: [{ role: 'user', content: 'fixture' }], query: 'fixture',
    allowedTools: ['resolve_machine_scope', 'read'], allowExternal: true, maxSteps: 4, guard: text => text });
  assert.equal(result.status, 'answered');
  assert.equal(executions, 2, 'failure must not be cached; subsequent success may be reused');
  assert.match(observations[0], /ERROR\[NOT_FOUND\]/);
  assert.equal(JSON.parse(observations[1]).value, 'available');
  assert.equal(observations[2], observations[1]);
  assert.deepEqual(result.toolEvents.filter(event => event.tool === 'read').map(event => [event.ok, event.error_type]),
    [[false, 'NOT_FOUND'], [true, null]]);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAgent } from '../agent/runner';
import { ToolRegistry } from '../agent/tools';
import type { Provider, ToolChatResult } from '../server/llm/types';

const DSML = `<｜DSML｜tool_calls>
<｜DSML｜invoke name="search_knowledge">
<｜DSML｜parameter name="brand" string="true">东方红</｜DSML｜parameter>
<｜DSML｜parameter name="query" string="true">水温过高</｜DSML｜parameter>
</｜DSML｜invoke>
</｜DSML｜tool_calls>`;

function setup(replies: ToolChatResult[]) {
  const registry = new ToolRegistry();
  registry.register('resolve_machine_scope', 'scope', { type: 'object' }, () => ({ brand: 'test' }));
  registry.register('search_knowledge', 'search', { type: 'object' }, () => ({ source: 'manual', value: 1 }));
  let n = 0;
  const provider: Provider = {
    name: 'deepseek', model: 'fake', isConfigured: () => true,
    chat: async () => { throw new Error('unused'); },
    chatWithTools: async () => replies[n++]!,
  };
  return { registry, provider };
}

/** The runner layer must hold even for a provider that does not translate DSML itself. */
test('runner: a reply that is only a DSML tool call is rejected, never answered to the user', async () => {
  const env = setup([{ content: DSML, stopReason: 'stop', toolCalls: [] }]);
  const result = await runAgent({
    ...env, messages: [{ role: 'user', content: 'question' }], query: 'question',
    allowedTools: ['resolve_machine_scope', 'search_knowledge'], allowExternal: true, guard: (s: string) => s,
  });
  assert.equal(result.status, 'fallback');
  assert.equal(result.reason, 'answer_rejected');
  assert.doesNotMatch(JSON.stringify(result), /DSML|search_knowledge/);
});

test('runner: prose around a DSML block survives, the markup itself does not', async () => {
  const env = setup([{ content: `可能原因尚待检查验证。\n\n${DSML}`, stopReason: 'stop', toolCalls: [] }]);
  const result = await runAgent({
    ...env, messages: [{ role: 'user', content: 'question' }], query: 'question',
    allowedTools: ['resolve_machine_scope', 'search_knowledge'], allowExternal: true, guard: (s: string) => s,
  });
  assert.equal(result.status, 'answered');
  assert.match(result.content, /可能原因尚待检查验证/);
  assert.doesNotMatch(result.content, /DSML|search_knowledge|东方红/);
});

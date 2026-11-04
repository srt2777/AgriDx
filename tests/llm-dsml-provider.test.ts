import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOpenAICompatibleProvider } from '../server/llm/openai-compatible';

const DSML = `<｜DSML｜tool_calls>
<｜DSML｜invoke name="search_knowledge">
<｜DSML｜parameter name="brand" string="true">东方红</｜DSML｜parameter>
<｜DSML｜parameter name="model" string="true">LX2204</｜DSML｜parameter>
<｜DSML｜parameter name="query" string="true">水温表 冷却水温度 过高</｜DSML｜parameter>
</｜DSML｜invoke>
</｜DSML｜tool_calls>`;

async function providerWith(body: unknown) {
  const oldFetch = globalThis.fetch, oldKey = process.env.TEST_TOOL_PROVIDER_KEY;
  process.env.TEST_TOOL_PROVIDER_KEY = 'synthetic-test-key';
  globalThis.fetch = async () => new Response(JSON.stringify(body), { status: 200 });
  const provider = createOpenAICompatibleProvider({ name: 'deepseek', model: 'test', apiUrl: 'https://example.invalid/chat', apiKeyEnv: 'TEST_TOOL_PROVIDER_KEY' });
  return { provider, restore: () => { globalThis.fetch = oldFetch; if (oldKey === undefined) delete process.env.TEST_TOOL_PROVIDER_KEY; else process.env.TEST_TOOL_PROVIDER_KEY = oldKey; } };
}

test('provider: a DSML tool-call block is translated into structured tool calls, not leaked as content', async () => {
  const { provider, restore } = await providerWith({ choices: [{ finish_reason: 'stop', message: { content: DSML, tool_calls: undefined } }] });
  try {
    const result = await provider.chatWithTools!([{ role: 'user', content: 'x' }], { tools: [] });
    assert.equal(result.stopReason, 'tool_calls');
    assert.deepEqual(result.toolCalls, [{ id: 'dsml-1', name: 'search_knowledge', input: { brand: '东方红', model: 'LX2204', query: '水温表 冷却水温度 过高' } }]);
    assert.equal(result.content, '');
    assert.doesNotMatch(result.content, /DSML/);
  } finally { restore(); }
});

test('provider: DSML with finish tool_calls no longer fails as an invalid response', async () => {
  const { provider, restore } = await providerWith({ choices: [{ finish_reason: 'tool_calls', message: { content: DSML, tool_calls: undefined } }] });
  try {
    const result = await provider.chatWithTools!([{ role: 'user', content: 'x' }], { tools: [] });
    assert.equal(result.toolCalls.length, 1);
    assert.equal(result.toolCalls[0].name, 'search_knowledge');
  } finally { restore(); }
});

test('provider: malformed DSML is stripped from a final answer instead of leaking', async () => {
  const { provider, restore } = await providerWith({ choices: [{ finish_reason: 'stop', message: { content: `可能原因尚待检查验证。\n\n<｜DSML｜tool_calls><｜DSML｜invoke name="search_knowledge">`, tool_calls: undefined } }] });
  try {
    const result = await provider.chatWithTools!([{ role: 'user', content: 'x' }], { tools: [] });
    assert.equal(result.toolCalls.length, 0);
    assert.equal(result.stopReason, 'stop');
    assert.match(result.content, /可能原因尚待检查验证/);
    assert.doesNotMatch(result.content, /DSML|search_knowledge/);
  } finally { restore(); }
});

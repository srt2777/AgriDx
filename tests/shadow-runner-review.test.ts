import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAgent } from '../agent/runner';
import { ToolRegistry } from '../agent/tool-registry';
import type { Provider, ToolChatResult } from '../server/llm/types';

function setup() {
  const registry = new ToolRegistry();
  registry.register('resolve_machine_scope', 'scope', { type: 'object' }, () => ({ brand: 'test' }));
  registry.register('search_knowledge', 'search', { type: 'object' }, () => ({ chunks: [{ entryId: 'KB-002', text: 'x' }] }));
  const provider: Provider = {
    name: 'deepseek',
    model: 'fake',
    isConfigured: () => true,
    chat: async () => { throw new Error('unused'); },
    chatWithTools: async (_messages, options) => {
      // First call: one read tool call. Second call: final answer.
      const seen = (options.tools ?? []).map((tool) => tool.function.name);
      assert.ok(seen.includes('search_knowledge'));
      return { content: '', stopReason: 'tool_calls', toolCalls: [{ id: 'a', name: 'search_knowledge', input: {} }] } as ToolChatResult;
    },
  };
  return { registry, provider };
}

test('a shadow run builds a review-only record without changing its answer', async () => {
  const env = setup();
  let calls = 0;
  env.provider.chatWithTools = async () => {
    calls += 1;
    if (calls === 1) return { content: '', stopReason: 'tool_calls', toolCalls: [{ id: 'a', name: 'search_knowledge', input: {} }] } as ToolChatResult;
    return { content: 'supported answer', stopReason: 'stop', toolCalls: [] } as ToolChatResult;
  };
  const result = await runAgent({
    ...env,
    messages: [{ role: 'user' as const, content: 'question' }],
    query: 'question',
    allowedTools: ['resolve_machine_scope', 'search_knowledge'],
    allowExternal: true,
    guard: (s: string) => s,
    review: { sessionId: 'session-1', mainEvidenceIds: ['KB-001'], highRisk: false, mainRoute: 'ai' },
  });
  assert.equal(result.status, 'answered');
  if (result.status !== 'answered') throw new Error('expected answered');
  assert.equal(result.content, 'supported answer');
  assert.ok(result.reviewRecord);
  assert.equal(result.reviewRecord?.reviewOnly, true);
  assert.equal(result.reviewRecord?.sessionId, 'session-1');
  // The shadow tool result carries an entry id not in the main evidence.
  assert.equal(result.reviewRecord?.comparison, 'new_evidence');
  // The record is alongside the answer, never inside it.
  assert.equal(result.content.includes('KB-002'), false);
});

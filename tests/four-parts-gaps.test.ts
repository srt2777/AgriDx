import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runAgent } from '../agent/runner';
import { build_default_registry } from '../agent/default-tools';
import { ToolRegistry } from '../agent/tools';
import type { Provider, ToolChatResult } from '../server/llm/types';
import type { PlannerContext } from '../agent/planner/ports';
import { createDiagnosticPlan, identifyPlannerTopic, identifyPlannerTopics, plannerAmbiguityQuestion, plannerTopicLabel } from '../server/diagnosis/plannerPlans';
import { planDiagnosticTurn } from '../server/diagnosis/plannerIntegration';
import type { PlannerCheckpoint } from '../server/memory/store';
import { MemoryStore } from '../server/memory/store';
import { loadKnowledgeBase } from '../server/knowledge/retriever';
import { PreviewMemoryStore } from '../src/dev-preview/memory';

// Item 1 — same-device recall hardening. Long-term persistence itself
// stays deferred (see the gaps doc): these tests pin only that a weak
// single-bigram overlap no longer surfaces another session's report.

const profile = { name: '1号拖拉机', machineType: '拖拉机', brand: '纽荷兰', model: 'WORKMASTER25', hours: 260, notes: '' };

test('priorReports needs two distinct term matches for a multi-term query', () => {
  const store = new MemoryStore(':memory:');
  try {
    const device = store.saveDevice('a', profile);
    const weak = store.createSession('a', device.id);
    store.appendTurn('a', weak.id, 0, '水温正常', { content: '继续排查' });
    store.updateProgress('a', weak.id, 1, '水温已检查正常');
    const current = store.createSession('a', device.id);
    // Query terms include 水温/温过/过高: the weak report shares only 水温.
    assert.deepEqual(store.priorReports('a', device.id, current.id, '水温过高怎么办'), []);
    const strong = store.createSession('a', device.id);
    store.appendTurn('a', strong.id, 0, '水温过高检查', { content: '继续排查' });
    store.updateProgress('a', strong.id, 1, '已检查');
    const later = store.createSession('a', device.id);
    // Shares exactly two terms (水温, 过高) and must still be recalled.
    const reports = store.priorReports('a', device.id, later.id, '水温过高');
    assert.equal(reports.length, 1);
    assert.equal(reports[0].sessionId, strong.id);
  } finally { store.close(); }
});

test('preview priorReports applies the same two-match rule', () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const store = new PreviewMemoryStore(storage);
  const device = store.saveDevice({ name: '1号车', machineType: '拖拉机', brand: '纽荷兰', model: 'WORKMASTER25', hours: 120, notes: '' });
  const weak = store.createSession(device.id);
  const reply = store.appendTurn(weak.id, 0, '水温正常', { content: '继续排查' }, []);
  store.update(weak.id, reply.revision, '水温已检查正常');
  const current = store.createSession(device.id);
  assert.deepEqual(store.priorReports(device.id, current.id, '水温过高怎么办'), []);
});

// Item 2 — multi-system ambiguity: name the candidates, invent nothing.

test('identifyPlannerTopics lists every matched system and ambiguity question carries no evidence IDs', () => {
  const text = '拖拉机水温过高而且挂挡困难';
  assert.deepEqual(identifyPlannerTopics(text), ['overheat', 'transmission']);
  assert.equal(identifyPlannerTopic(text), undefined);
  const question = plannerAmbiguityQuestion(text);
  assert.ok(question);
  assert.ok(question.includes(plannerTopicLabel('overheat')));
  assert.ok(question.includes(plannerTopicLabel('transmission')));
  assert.doesNotMatch(question, /KB-[A-Z0-9-]+/);
  assert.doesNotMatch(question, /SRC-[A-Z0-9-]+/);
  assert.match(question, /只选一个/);
  assert.match(question, /没有据此作出故障结论/);
  assert.equal(plannerAmbiguityQuestion('水温过高'), undefined);
  assert.equal(plannerAmbiguityQuestion('今天天气怎么样'), undefined);
});

const plannerContext = (scope: { machineType: string; brand: string; model: string }) => ({
  routerInput: { query: 'x', currentQuery: 'x', scope, retrieved: [], clarificationNeeded: false, llmConfigured: false },
} as unknown as PlannerContext);

test('planDiagnosticTurn asks the candidate-system question for an ambiguous new fault', () => {
  const turn = planDiagnosticTurn({ sessionId: 's', sessionSeed: 'ab'.repeat(16), deviceId: 'd', revision: 0,
    topicRoot: '拖拉机水温过高而且挂挡困难', currentQuery: '拖拉机水温过高而且挂挡困难',
    scope: { machineType: '拖拉机', brand: '东方红', model: 'LF1504' }, context: plannerContext({ machineType: '拖拉机', brand: '东方红', model: 'LF1504' }) });
  assert.equal(turn.commit.checkpoint, null);
  assert.equal(turn.questions?.length, 1);
  assert.ok(turn.questions![0].text.includes(plannerTopicLabel('overheat')));
  assert.ok(turn.questions![0].text.includes(plannerTopicLabel('transmission')));
  assert.doesNotMatch(turn.questions![0].text, /KB-[A-Z0-9-]+/);
});

test('planDiagnosticTurn keeps an ambiguous follow-up on the live episode as topicPending with the specific question', () => {
  const scope = { machineType: '拖拉机', brand: '东方红', model: 'LF1504' };
  const state = createDiagnosticPlan({ topic: 'overheat', scope, sessionSeed: 'cd'.repeat(16), revision: 0 });
  const prior: PlannerCheckpoint = { sessionId: 's', deviceId: 'd', topicKey: 'overheat', topicRoot: '水温过高', state };
  const turn = planDiagnosticTurn({ sessionId: 's', sessionSeed: 'cd'.repeat(16), deviceId: 'd', revision: 0,
    topicRoot: '拖拉机水温过高而且挂挡困难', currentQuery: '拖拉机水温过高而且挂挡困难',
    scope, checkpoint: prior, context: plannerContext(scope) });
  assert.equal(turn.commit.checkpoint?.topicPending, 'topic');
  assert.equal(turn.commit.checkpoint?.topicKey, 'overheat');
  assert.equal(turn.questions?.length, 1);
  assert.ok(turn.questions![0].text.includes(plannerTopicLabel('transmission')));
});

test('a single-system clarification reply resolves to that topic instead of staying ambiguous', () => {
  const scope = { machineType: '拖拉机', brand: '东方红', model: 'LF1504' };
  const turn = planDiagnosticTurn({ sessionId: 's', sessionSeed: 'ef'.repeat(16), deviceId: 'd', revision: 0,
    topicRoot: '水温过高', currentQuery: '水温过高', scope, context: plannerContext(scope) });
  assert.equal(turn.commit.checkpoint?.topicKey, 'overheat');
  assert.ok(turn.commit.checkpoint?.state.steps.length);
});

test('unknown non-ambiguous wording keeps the old behaviour: no invented question', () => {
  const turn = planDiagnosticTurn({ sessionId: 's', sessionSeed: 'ab'.repeat(16), deviceId: 'd', revision: 0,
    topicRoot: '今天天气怎么样', currentQuery: '今天天气怎么样',
    scope: { machineType: '拖拉机', brand: '东方红', model: 'LF1504' },
    context: plannerContext({ machineType: '拖拉机', brand: '东方红', model: 'LF1504' }) });
  assert.equal(turn.commit.checkpoint, null);
  assert.equal(turn.questions, undefined);
});

test('fault_chain names ambiguous candidate systems without evidence IDs', async () => {
  loadKnowledgeBase();
  const registry = build_default_registry();
  const result = JSON.parse(await registry.call('fault_chain', { symptom: '拖拉机水温过高而且挂挡困难' })) as { error?: string; note?: string };
  assert.equal(result.error, 'TOPIC_NOT_IDENTIFIED');
  assert.ok(result.note?.includes(plannerTopicLabel('overheat')));
  assert.ok(result.note?.includes(plannerTopicLabel('transmission')));
  assert.doesNotMatch(result.note ?? '', /KB-[A-Z0-9-]+/);
});

// Item 3 — cross-step reuse inside one run: same bound call, later step.

function runnerSetup(replies: ToolChatResult[], toolImpl: () => unknown) {
  const registry = new ToolRegistry();
  registry.register('resolve_machine_scope', 'scope', { type: 'object' }, () => ({ brand: 'test' }));
  let executions = 0;
  registry.register('search_knowledge', 'search', { type: 'object' }, () => { executions++; return toolImpl(); });
  const seenMessages: { role: string; tool_call_id?: string; content?: string }[][] = [];
  let calls = 0;
  const provider: Provider = { name: 'deepseek', model: 'fake', isConfigured: () => true,
    chat: async () => { throw new Error('unused'); },
    chatWithTools: async (messages): Promise<ToolChatResult> => {
      seenMessages.push(messages.map(m => ({ role: m.role, tool_call_id: (m as { tool_call_id?: string }).tool_call_id, content: typeof m.content === 'string' ? m.content : undefined })));
      return replies[calls++]!;
    } };
  return { registry, provider, seenMessages, executions: () => executions };
}

const sameCall = (id: string): ToolChatResult => ({ content: '', stopReason: 'tool_calls', toolCalls: [{ id, name: 'search_knowledge', input: { query: '燃油滤清器' } }] });
const answer: ToolChatResult = { content: 'supported answer', stopReason: 'stop', toolCalls: [] };

test('runner reuses a successful earlier-step result instead of executing again', async () => {
  const env = runnerSetup([sameCall('a'), sameCall('b'), answer], () => ({ chunks: ['燃油滤清器检查'] }));
  const result = await runAgent({ provider: env.provider, registry: env.registry,
    messages: [{ role: 'user', content: '燃油滤清器堵塞怎么办' }], query: '燃油滤清器堵塞怎么办',
    allowedTools: ['resolve_machine_scope', 'search_knowledge'], allowExternal: true, guard: (s: string) => s, timeoutMs: 5000 });
  assert.equal(result.status, 'answered');
  assert.equal(env.executions(), 1, 'the identical later-step call must not execute again');
  const firstTools = env.seenMessages[1].filter(m => m.role === 'tool');
  assert.equal(firstTools.length, 1);
  // History accumulates, so the third provider call carries both tool
  // messages; the step-2 message (id 'b') must carry the cached content.
  const reused = env.seenMessages[2].filter(m => m.role === 'tool').find(m => m.tool_call_id === 'b');
  assert.ok(reused);
  assert.equal(reused.content, firstTools[0].content, 'the later step must receive the cached content verbatim');
  assert.equal(result.toolEvents.filter(e => e.tool === 'search_knowledge').length, 1);
});

test('runner never caches a failed result: the retry still executes', async () => {
  let attempts = 0;
  const env = runnerSetup([sameCall('a'), sameCall('b'), answer], () => {
    attempts++;
    if (attempts === 1) throw new Error('synthetic failure');
    return { chunks: ['ok'] };
  });
  const result = await runAgent({ provider: env.provider, registry: env.registry,
    messages: [{ role: 'user', content: '燃油滤清器堵塞怎么办' }], query: '燃油滤清器堵塞怎么办',
    allowedTools: ['resolve_machine_scope', 'search_knowledge'], allowExternal: true, guard: (s: string) => s, timeoutMs: 5000 });
  assert.equal(result.status, 'answered');
  assert.equal(env.executions(), 2, 'a failed result must not be cached');
});

test('cross-step cache does not leak into a second run', async () => {
  const env = runnerSetup([sameCall('a'), answer, sameCall('c'), answer], () => ({ chunks: ['x'] }));
  const common = { registry: env.registry, messages: [{ role: 'user', content: '燃油滤清器堵塞怎么办' }], query: '燃油滤清器堵塞怎么办',
    allowedTools: ['resolve_machine_scope', 'search_knowledge'], allowExternal: true, guard: (s: string) => s, timeoutMs: 5000 } as const;
  assert.equal((await runAgent({ provider: env.provider, ...common })).status, 'answered');
  assert.equal(env.executions(), 1);
  assert.equal((await runAgent({ provider: env.provider, ...common })).status, 'answered');
  assert.equal(env.executions(), 2, 'a new run must execute again, not reuse the previous run');
});

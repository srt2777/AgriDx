import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PlannerToolPort } from '../agent/planner/tool-port';
import { ToolRegistry } from '../agent/tool-registry';
import { ToolExecutor } from '../agent/tool-executor';

const lease = { episodeId: 'episode', scopeKey: 'scope', planVersion: 1, revision: 1 };
function fixture(func: () => unknown, risk: 'read' | 'write' | 'dangerous' = 'read') {
  const registry = new ToolRegistry();
  registry.register('resolve_machine_scope', 'test', { type: 'object', additionalProperties: false }, func, { risk });
  const port = new PlannerToolPort(new ToolExecutor(registry), registry);
  return { port, run: (extra = {}) => port.execute({ callId: 'one', stepId: 'scope', tool: 'resolve_machine_scope', args: {}, lease, isCurrent: () => true, ...extra }) };
}
test('tool success retains unverified provenance; duplicate call is rejected', async () => {
  const f = fixture(() => ({ scope: 'reported' }));
  const result = await f.run();
  assert.equal(result.outcome, 'success'); assert.equal(result.verification, 'unverified');
  await assert.rejects(f.run(), /duplicate/);
});
test('write and dangerous tools cannot execute', async () => {
  for (const risk of ['write', 'dangerous'] as const) {
    let calls = 0; const f = fixture(() => { calls++; }, risk);
    await assert.rejects(f.run(), /authorized/); assert.equal(calls, 0);
  }
});
test('tool failure and empty result remain distinct from success', async () => {
  assert.equal((await fixture(() => { throw new Error('fixture'); }).run()).outcome, 'failure');
  assert.equal((await fixture(() => '').run()).outcome, 'empty');
});
test('timeout discards late completion without claiming the tool has stopped', async () => {
  let release!: () => void;
  const f = fixture(() => new Promise(resolve => { release = () => resolve('late'); }));
  const result = await f.run({ timeoutMs: 5 });
  assert.equal(result.outcome, 'timeout'); release(); assert.equal(result.outcome, 'timeout');
});
test('cancellation and stale revisions do not become observations of success', async () => {
  const controller = new AbortController(); controller.abort();
  assert.equal((await fixture(() => 'unused').run({ signal: controller.signal })).outcome, 'cancelled');
  assert.equal((await fixture(() => 'unused').run({ isCurrent: () => false })).outcome, 'stale');
  let current = true;
  assert.equal((await fixture(() => { current = false; return 'late'; }).run({ isCurrent: () => current })).outcome, 'stale');
});

test('reserved calls and outcomes survive serialization and failures cannot complete a step', async () => {
  const { createPlan, reducePlan } = await import('../agent/planner/reducer');
  const plan = createPlan({ planId: 'plan', episodeId: 'episode', scope: {}, steps: [{ key: 'scope', title: '只读范围解析', kind: 'read_tool', tool: 'resolve_machine_scope', dependsOn: [], preconditions: [], expectedObservation: { slot: 'scope', label: '范围解析结果' }, evidenceIds: [], discriminationValue: 1, cost: 1 }] });
  const { advancePlan } = await import('../agent/planner');
  const proposed = advancePlan(plan, { routerInput: { query: '已有记录', currentQuery: '已有记录', scope: {}, retrieved: [], clarificationNeeded: false, requestedMode: 'knowledge_only', llmConfigured: false } });
  assert.equal(proposed.decision.action?.tool, 'resolve_machine_scope');
  const started = reducePlan(proposed.state, { type: 'tool_started', id: 'start', episodeId: 'episode', stepKey: 'scope', callId: 'call' });
  const restored = JSON.parse(JSON.stringify(started));
  assert.deepEqual(restored.toolCalls, started.toolCalls);
  const finished = reducePlan(restored, { type: 'tool_finished', id: 'finish', episodeId: 'episode', stepKey: 'scope', callId: 'call', outcome: 'failure', value: 'not a verified fact' });
  assert.equal(finished.observations.scope.value, null);
  assert.equal(finished.observations.scope.verification, 'unverified');
  assert.equal(finished.status, 'paused');
  assert.equal(reducePlan(finished, { type: 'tool_finished', id: 'finish', episodeId: 'episode', stepKey: 'scope', callId: 'call', outcome: 'failure', value: 'not a verified fact' }), finished);
});

test('Router safety and scope stop tool selection in every mode', async () => {
  const { createPlan, advancePlan } = await import('../agent/planner');
  const scope = { brand: '东方红', model: 'LF1504' };
  const plan = createPlan({ planId: 'p', episodeId: 'e', scope, steps: [{ key: 's', title: '查询范围', kind: 'read_tool', tool: 'resolve_machine_scope', dependsOn: [], preconditions: [], expectedObservation: { slot: 's', label: '范围' }, evidenceIds: [], discriminationValue: 1, cost: 1 }] });
  for (const mode of ['auto', 'knowledge_only', 'ai_assisted'] as const) {
    const context = { routerInput: { query: '刹车失灵', currentQuery: '刹车失灵', scope, retrieved: [], clarificationNeeded: false, requestedMode: mode, llmConfigured: true } };
    const decision = advancePlan(plan, context).decision;
    assert.equal(decision.status, 'escalated'); assert.equal(decision.action, undefined);
    const changed = advancePlan(plan, { routerInput: { ...context.routerInput, query: '启动困难', currentQuery: '启动困难', scope: { ...scope, model: 'LF904' } } }).decision;
    assert.equal(changed.reason, 'scope_mismatch'); assert.equal(changed.action, undefined);
  }
});

test('tool result conversion and successful replan retain unverified provenance', async () => {
  const { createPlan, advancePlan, reducePlan } = await import('../agent/planner');
  const { plannerToolEvent } = await import('../agent/planner/tool-port');
  const scope = {};
  const plan = createPlan({ planId: 'p', episodeId: 'episode', scope, steps: [
    { key: 's', title: '查询范围', kind: 'read_tool', tool: 'resolve_machine_scope', dependsOn: [], preconditions: [], expectedObservation: { slot: 's', label: '范围' }, evidenceIds: [], discriminationValue: 2, cost: 1 },
    { key: 'q', title: '已有记录', kind: 'ask_user', dependsOn: ['s'], preconditions: [], expectedObservation: { slot: 'q', label: '已有表现' }, evidenceIds: [], discriminationValue: 1, cost: 1 },
  ] });
  const context = { routerInput: { query: '已有记录', currentQuery: '已有记录', scope, retrieved: [], clarificationNeeded: false, requestedMode: 'knowledge_only' as const, llmConfigured: false } };
  const selected = advancePlan(plan, context); assert.equal(selected.decision.action?.tool, 'resolve_machine_scope');
  const started = reducePlan(selected.state, { type: 'tool_started', id: 'start', episodeId: 'episode', stepKey: 's', callId: 'one' });
  assert.equal(advancePlan(started, context).decision.action, undefined);
  const result = await fixture(() => ({ source: 'synthetic' })).run();
  const event = plannerToolEvent(result, 's');
  const updated = advancePlan(started, context, event);
  assert.equal(updated.state.observations.s.source, 'tool_result'); assert.equal(updated.state.observations.s.verification, 'unverified');
  assert.equal(updated.state.observations.s.toolName, 'resolve_machine_scope'); assert.equal(updated.state.observations.s.toolCallId, 'one');
  assert.equal(updated.decision.action?.stepKey, 'q');
  assert.throws(() => plannerToolEvent({ ...result, outcome: 'stale' }, 's'), /Stale/);
  if (event.type === 'tool_finished') assert.throws(() => reducePlan(started, { ...event, value: '确诊' }), /availability/);
  const laterVersion = reducePlan(started, { type: 'continue', id: 'later', episodeId: 'episode' });
  assert.throws(() => reducePlan(laterVersion, event), /Stale/);
  const cancelled = reducePlan(started, { type: 'cancel', id: 'cancel', episodeId: 'episode' });
  assert.equal(reducePlan(cancelled, event), cancelled);
  const changed = reducePlan(started, { type: 'scope_changed', id: 'scope-change', episodeId: 'episode', scope: { model: 'LF1504' } });
  assert.throws(() => reducePlan(changed, event), /Stale/);
});

test('unknown or missing tool is denied and missing knowledge is not success', async () => {
  const registry = new ToolRegistry(); let calls = 0;
  registry.register('unsafe_other', 'test', { type: 'object' }, () => { calls++; }, { risk: 'read' });
  registry.register('get_knowledge_entry', 'test', { type: 'object' }, () => ({ error: 'NOT_FOUND' }), { risk: 'read' });
  const port = new PlannerToolPort(new ToolExecutor(registry), registry);
  const args = { callId: 'c', stepId: 's', args: {}, lease, isCurrent: () => true };
  await assert.rejects(port.execute({ ...args, tool: 'unsafe_other' as 'get_knowledge_entry' }), /authorized/);
  assert.equal(calls, 0);
  assert.equal((await port.execute({ ...args, tool: 'get_knowledge_entry' })).outcome, 'empty');
});

test('failed, timed out, cancelled and empty tool observations normalize without repair facts', async () => {
  const { plannerToolEvent } = await import('../agent/planner/tool-port');
  for (const outcome of ['failure', 'timeout', 'cancelled', 'empty'] as const) {
    const event = plannerToolEvent({ callId: 'x', stepId: 's', lease, source: 'tool_result', verification: 'unverified', outcome }, 's');
    assert.equal(event.type, 'tool_finished');
    if (event.type === 'tool_finished') { assert.equal(event.outcome, outcome); assert.equal(event.value, null); }
  }
});

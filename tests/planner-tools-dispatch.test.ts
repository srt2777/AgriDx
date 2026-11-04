import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { test, type TestContext } from 'node:test';
import express from 'express';
import { advancePlan, createPlan } from '../agent/planner';
import { ToolRegistry } from '../agent/tool-registry';
import { MemoryStore } from '../server/memory/store';
import { createChatRoutes } from '../server/routes/chat';
import { createDiagnosticService } from '../server/diagnosis/service';
import { dispatchPlannerTool } from '../server/diagnosis/plannerTools';

async function fixture(t: TestContext, run: () => unknown, mainLoopRan = false) {
  const token = 'a'.repeat(64), owner = createHash('sha256').update(token).digest('hex');
  const store = new MemoryStore(':memory:');
  const profile = { name: '测试', machineType: '拖拉机', brand: '东方红', model: 'LF1504', hours: null, notes: '' };
  const device = store.saveDevice(owner, profile), session = store.createSession(owner, device.id);
  const scope = { machineType: profile.machineType, brand: profile.brand, model: profile.model, conditions: [] };
  const context = { routerInput: { query: '水温过高', currentQuery: '水温过高', scope, retrieved: [], clarificationNeeded: false, requestedMode: 'knowledge_only' as const, llmConfigured: false } };
  const state = advancePlan(createPlan({ planId: 'p', episodeId: 'e', scope, steps: [
    { key: 'scope', title: '范围查询', kind: 'read_tool', tool: 'resolve_machine_scope', dependsOn: [], preconditions: [], expectedObservation: { slot: 'scope', label: '范围查询' }, evidenceIds: [], discriminationValue: 2, cost: 1 },
    { key: 'q', title: '已有记录', kind: 'ask_user', dependsOn: ['scope'], preconditions: [], expectedObservation: { slot: 'q', label: '已有表现' }, evidenceIds: [], discriminationValue: 1, cost: 1 },
  ] }), context).state;
  store.appendTurn(owner, session.id, 0, '水温过高', { content: '已记录' }, [], { previous: null, checkpoint: { sessionId: session.id, deviceId: device.id, topicKey: 'overheat', topicRoot: '水温过高', state } });
  const registry = new ToolRegistry(); let calls = 0;
  registry.register('resolve_machine_scope', '模拟范围查询', { type: 'object', properties: { query: { type: 'string' }, context: { type: 'object' } }, additionalProperties: false }, () => { calls++; return run(); }, { risk: 'read', timeout_s: .02 });
  const diagnose = createDiagnosticService({ hasAnyConfigured: () => false, chat: async () => { throw new Error('Must not call AI'); } }, { retrieve: () => [], config: { logDecisions: false } });
  const wrapped: typeof diagnose = async (...args) => {
    const response = await diagnose(...args);
    if (mainLoopRan && response.diagnosisTrace?.mainLoop) response.diagnosisTrace.mainLoop.ran = true;
    return response;
  };
  const app = express(); app.use(express.json()); app.use('/api', createChatRoutes(wrapped, () => store, () => registry));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); store.close(); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const chat = async (revision: number, content = '水温过高', mode = 'knowledge_only') => {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: `agridx_memory=${token}` }, body: JSON.stringify({ sessionId: session.id, revision, diagnosisMode: mode, messages: [{ role: 'user', content }] }) });
    return { status: response.status, body: await response.json() };
  };
  const dispatch = (signal?: AbortSignal) => dispatchPlannerTool({ store, owner, sessionId: session.id, revision: store.session(owner, session.id).revision, registry, context, signal });
  return { store, owner, session, device, profile, registry, context, chat, dispatch, calls: () => calls };
}

test('real chat dispatches a persisted read step and refresh does not repeat it', async t => {
  const f = await fixture(t, () => ({ sourceId: 'SRC-TEST', status: '待核验' }));
  const response = await f.chat(1); assert.equal(response.status, 200); assert.equal(f.calls(), 1);
  const saved = f.store.plannerCheckpoint(f.owner, f.session.id)!;
  assert.equal(saved.state.observations.scope.toolOutcome, 'success'); assert.equal(saved.state.observations.scope.verification, 'unverified');
  assert.equal(response.body.memory.revision, f.store.session(f.owner, f.session.id).revision);
  assert.equal((await f.chat(response.body.memory.revision)).status, 200); assert.equal(f.calls(), 1);
});

test('failed, empty and timed out tools persist a paused result without changing the answer provider', async t => {
  for (const [run, outcome] of [[() => { throw new Error('fixture'); }, 'failure'], [() => '', 'empty'], [() => new Promise(() => {}), 'timeout']] as const) {
    const f = await fixture(t, run); const result = await f.chat(1);
    assert.equal(result.status, 200); assert.equal(result.body.provider, 'knowledge-base');
    assert.equal(f.store.plannerCheckpoint(f.owner, f.session.id)?.state.observations.scope.toolOutcome, outcome);
  }
});

test('cancellation before dispatch does not reserve or execute', async t => {
  const f = await fixture(t, () => 'unused'), controller = new AbortController(); controller.abort();
  assert.equal((await f.dispatch(controller.signal)).status, 'cancelled'); assert.equal(f.calls(), 0);
});

test('revision changes during execution discard late output', async t => {
  let release!: () => void;
  const f = await fixture(t, () => new Promise(resolve => { release = () => resolve('late'); }));
  const pending = f.dispatch();
  while (!release) await new Promise(resolve => setImmediate(resolve));
  const revision = f.store.session(f.owner, f.session.id).revision;
  f.store.updateProgress(f.owner, f.session.id, revision, '并发更新'); release();
  assert.equal((await pending).status, 'stale');
  assert.equal(f.store.plannerCheckpoint(f.owner, f.session.id)?.state.observations.scope, undefined);
});

test('a recovered pending reservation is not executed a second time', async t => {
  const f = await fixture(t, () => 'unused'), checkpoint = f.store.plannerCheckpoint(f.owner, f.session.id)!;
  f.store.applyPlannerToolEvent(f.owner, { sessionId: f.session.id, deviceId: f.device.id, episodeId: 'e', scopeKey: checkpoint.state.scopeKey, planVersion: checkpoint.state.planVersion, revision: 1 }, { type: 'tool_started', id: 'prior-start', episodeId: 'e', stepKey: 'scope', callId: 'prior' });
  assert.equal((await f.dispatch()).status, 'pending'); assert.equal(f.calls(), 0);
});

test('all modes retain high-risk Router stop and execute no tools', async t => {
  for (const mode of ['auto', 'knowledge_only', 'ai_assisted']) {
    const f = await fixture(t, () => 'unused'); const result = await f.chat(1, '热车拧水箱盖', mode);
    assert.equal(result.status, 200); assert.equal(result.body.coordination.route, 'safe'); assert.equal(f.calls(), 0);
  }
});

test('cancellation during execution records cancelled, never success', async t => {
  const controller = new AbortController(); let entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const f = await fixture(t, () => { entered(); return new Promise(() => {}); });
  const pending = f.dispatch(controller.signal); await ready; controller.abort();
  const result = await pending; assert.equal(result.status, 'completed');
  assert.equal(f.store.plannerCheckpoint(f.owner, f.session.id)?.state.observations.scope.toolOutcome, 'cancelled');
});

test('timeout output cannot overwrite the stored timeout after late resolution', async t => {
  let release!: () => void;
  const f = await fixture(t, () => new Promise(resolve => { release = () => resolve('late-success'); }));
  const result = await f.dispatch(); assert.equal(result.status, 'completed'); release();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.store.plannerCheckpoint(f.owner, f.session.id)?.state.observations.scope.toolOutcome, 'timeout');
});

test('successful dispatch returns the dependent next action without repeating the tool', async t => {
  const f = await fixture(t, () => ({ scope: 'synthetic' }));
  const result = await f.dispatch(); assert.equal(result.status, 'completed');
  if (result.status === 'completed') assert.equal(result.next.action?.stepKey, 'q');
  await f.dispatch(); assert.equal(f.calls(), 1);
});


test('chat does not append Planner dispatch when the existing main loop already ran', async t => {
  const f = await fixture(t, () => 'must-not-execute', true);
  const result = await f.chat(1);
  assert.equal(result.status, 200); assert.equal(f.calls(), 0);
});

test('revoked evidence cannot authorize a previously proposed knowledge read', async t => {
  const { recordDecision } = await import('../agent/planner/reducer');
  const f = await fixture(t, () => 'scope-only');
  const prior = f.store.plannerCheckpoint(f.owner, f.session.id)!;
  let state = createPlan({ planId: 'new-plan', episodeId: 'new-episode', scope: prior.state.scope,
    evidence: [{ entryId: 'TEST-REVOKED', sourceId: 'SRC-REVOKED' }], steps: [
      { key: 'old-entry', title: '原资料', kind: 'read_tool', tool: 'get_knowledge_entry', dependsOn: [], preconditions: [], expectedObservation: { slot: 'old-entry', label: '原资料' }, evidenceIds: ['TEST-REVOKED'], discriminationValue: 10, cost: 1 },
      { ...prior.state.steps[0], key: 'scope', expectedObservation: { slot: 'scope', label: '范围查询' } },
    ] });
  for (const step of state.steps) state = recordDecision(state, { status: 'active', action: { kind: 'read_tool', stepId: step.id, stepKey: step.key, observationSlot: step.expectedObservation.slot, tool: step.tool, text: 'previous proposal', evidenceIds: step.evidenceIds } });
  f.store.appendTurn(f.owner, f.session.id, 1, '原资料已撤回', { content: 'fixture' }, [], { previous: { episodeId: prior.state.episodeId, planVersion: prior.state.planVersion }, checkpoint: { ...prior, state } });
  let read = false;
  f.registry.register('get_knowledge_entry', 'read', { type: 'object' }, () => { read = true; return 'unsafe-reference'; }, { risk: 'read' });
  const result = await f.dispatch(); assert.equal(result.status, 'completed');
  assert.equal(read, false); assert.equal(f.calls(), 1);
});

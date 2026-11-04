import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { advancePlan, createPlan } from '../agent/planner';
import { MemoryError, MemoryStore } from '../server/memory/store';

const profile = { name: '测试车', machineType: '拖拉机', brand: '东方红', model: 'LF1504', hours: null, notes: '' };
function setup(filename = ':memory:', clock: () => number = () => 1000) {
  const store = new MemoryStore(filename, clock), device = store.saveDevice('owner', profile), session = store.createSession('owner', device.id);
  const scope = { machineType: profile.machineType, brand: profile.brand, model: profile.model };
  const initial = createPlan({ planId: 'plan', episodeId: 'episode', scope, steps: [{ key: 'scope', title: '查询范围', kind: 'read_tool', tool: 'resolve_machine_scope', dependsOn: [], preconditions: [], expectedObservation: { slot: 'scope', label: '范围' }, evidenceIds: [], discriminationValue: 1, cost: 1 }] });
  const state = advancePlan(initial, { routerInput: { query: '已有记录', currentQuery: '已有记录', scope, retrieved: [], clarificationNeeded: false, requestedMode: 'knowledge_only', llmConfigured: false } }).state;
  store.appendTurn('owner', session.id, 0, '问题', { content: '记录' }, [], { previous: null, checkpoint: { sessionId: session.id, deviceId: device.id, topicKey: '测试', state } });
  const lease = { sessionId: session.id, deviceId: device.id, episodeId: state.episodeId, scopeKey: state.scopeKey, planVersion: state.planVersion, revision: 1 };
  return { store, device, session, lease };
}
const started = { type: 'tool_started' as const, id: 'start', episodeId: 'episode', stepKey: 'scope', callId: 'call' };
const finished = { type: 'tool_finished' as const, id: 'finish', episodeId: 'episode', stepKey: 'scope', callId: 'call', outcome: 'success' as const, value: 'available' };
const nextLease = (lease: ReturnType<typeof setup>['lease'], result: ReturnType<MemoryStore['applyPlannerToolEvent']>) => ({ ...lease, revision: result.revision, planVersion: result.checkpoint.state.planVersion });

test('tool reservation and outcome survive SQLite close/reopen with private unverified provenance', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'planner-tool-memory-')), file = path.join(dir, 'memory.sqlite');
  let { store, lease } = setup(file);
  try {
    const reserved = store.applyPlannerToolEvent('owner', lease, started, 1000);
    lease = nextLease(lease, reserved); store.close(); store = new MemoryStore(file, () => 1100);
    assert.equal(store.plannerCheckpoint('owner', lease.sessionId)?.state.toolCalls?.call.deadlineMs, 2000);
    const result = store.applyPlannerToolEvent('owner', lease, finished);
    assert.equal(result.checkpoint.state.observations.scope.verification, 'unverified');
    assert.equal(result.checkpoint.state.observations.scope.toolName, 'resolve_machine_scope');
    assert.equal(result.checkpoint.state.toolCalls?.call.outcome, 'success');
    assert.doesNotMatch(JSON.stringify(store.session('owner', lease.sessionId)), /toolCalls|_plannerCheckpoint/);
    store.close(); store = new MemoryStore(file, () => 1100);
    assert.equal(store.plannerCheckpoint('owner', lease.sessionId)?.state.toolCalls?.call.outcome, 'success');
  } finally { store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('duplicate events are idempotent and competing revisions cannot overwrite the plan', () => {
  const { store, lease } = setup();
  try {
    const reserved = store.applyPlannerToolEvent('owner', lease, started);
    assert.throws(() => store.applyPlannerToolEvent('owner', lease, started), /已更新/);
    const current = nextLease(lease, reserved), replay = store.applyPlannerToolEvent('owner', current, started);
    assert.equal(replay.revision, reserved.revision);
    const complete = store.applyPlannerToolEvent('owner', current, finished);
    assert.equal(store.applyPlannerToolEvent('owner', nextLease(lease, complete), finished).revision, complete.revision);
    assert.throws(() => store.applyPlannerToolEvent('owner', current, finished), /已更新/);
  } finally { store.close(); }
});

test('expired success is rejected and timeout cannot later be replaced by success', () => {
  let now = 1000; const { store, lease } = setup(':memory:', () => now);
  try {
    const reserved = store.applyPlannerToolEvent('owner', lease, started, 10), current = nextLease(lease, reserved); now = 1010;
    assert.throws(() => store.applyPlannerToolEvent('owner', current, finished), /过期/);
    const timeout = store.applyPlannerToolEvent('owner', current, { ...finished, outcome: 'timeout', value: null });
    assert.equal(timeout.checkpoint.state.observations.scope.value, null);
    assert.throws(() => store.applyPlannerToolEvent('owner', nextLease(lease, timeout), { ...finished, id: 'late' }), /过期|重复|变化/);
  } finally { store.close(); }
});

test('cancellation, clear and device changes invalidate old leases', () => {
  const { store, lease, device } = setup();
  try {
    const reserved = store.applyPlannerToolEvent('owner', lease, started), current = nextLease(lease, reserved);
    const cancelled = store.applyPlannerToolEvent('owner', current, { type: 'cancel', id: 'cancel', episodeId: 'episode' });
    assert.throws(() => store.applyPlannerToolEvent('owner', current, finished), /已更新/);
    const ignored = store.applyPlannerToolEvent('owner', nextLease(lease, cancelled), finished);
    assert.equal(ignored.checkpoint.state.status, 'cancelled');
    store.saveDevice('owner', { ...profile, model: 'LF904' }, device.id);
    const revision = store.session('owner', lease.sessionId).revision;
    assert.throws(() => store.applyPlannerToolEvent('owner', { ...nextLease(lease, cancelled), revision }, finished), /设备信息/);
    store.clearSession('owner', lease.sessionId, revision);
    assert.throws(() => store.applyPlannerToolEvent('owner', { ...nextLease(lease, cancelled), revision: revision + 1 }, finished), /变化/);
  } finally { store.close(); }
});

test('session ownership, episode and scope are checked before committing', () => {
  const { store, lease } = setup();
  try {
    assert.throws(() => store.applyPlannerToolEvent('other', lease, started), (error) => error instanceof MemoryError && error.status === 404);
    assert.throws(() => store.applyPlannerToolEvent('owner', { ...lease, episodeId: 'other' }, started), /变化/);
    assert.throws(() => store.applyPlannerToolEvent('owner', { ...lease, scopeKey: 'other' }, started), /变化/);
    assert.throws(() => store.applyPlannerToolEvent('owner', { ...lease, planVersion: lease.planVersion + 1 }, started), /变化/);
  } finally { store.close(); }
});

test('ordinary chat cannot reset tool budget or forge tool observations', () => {
  const { store, lease } = setup();
  try {
    const reservation = store.applyPlannerToolEvent('owner', lease, started);
    const previous = { episodeId: lease.episodeId, planVersion: reservation.checkpoint.state.planVersion };
    const reset = structuredClone(reservation.checkpoint); reset.state.planVersion++; delete reset.state.toolCalls;
    assert.throws(() => store.appendTurn('owner', lease.sessionId, reservation.revision, '问题', { content: '回答' }, [], { previous, checkpoint: reset }), /版本无效/);
    const forged = structuredClone(reservation.checkpoint); forged.state.planVersion++;
    forged.state.observations.scope = { eventId: 'forged', stepId: forged.state.steps[0].id, slot: 'scope', value: 'available', source: 'tool_result', verification: 'unverified', scopeKey: forged.state.scopeKey, basisKey: 'forged' };
    assert.throws(() => store.appendTurn('owner', lease.sessionId, reservation.revision, '问题', { content: '回答' }, [], { previous, checkpoint: forged }), /版本无效/);
    assert.deepEqual(store.plannerCheckpoint('owner', lease.sessionId), JSON.parse(JSON.stringify(reservation.checkpoint)));
  } finally { store.close(); }
});

test('real ToolExecutor result is normalized and atomically committed with the reserved lease', async () => {
  const { ToolRegistry } = await import('../agent/tool-registry');
  const { ToolExecutor } = await import('../agent/tool-executor');
  const { PlannerToolPort, plannerToolEvent } = await import('../agent/planner/tool-port');
  const { store, lease } = setup();
  try {
    const reserved = store.applyPlannerToolEvent('owner', lease, started), current = nextLease(lease, reserved);
    const registry = new ToolRegistry();
    registry.register('resolve_machine_scope', '模拟只读范围', { type: 'object', additionalProperties: false }, () => ({ sourceId: 'SRC-SYNTHETIC', entryId: 'KB-SYNTHETIC', status: '待核验', model: 'LF1504' }), { risk: 'read' });
    const port = new PlannerToolPort(new ToolExecutor(registry), registry);
    const result = await port.execute({ callId: 'call', stepId: reserved.checkpoint.state.steps[0].id, tool: 'resolve_machine_scope', args: {}, lease: current,
      isCurrent: candidate => { const state = store.plannerCheckpoint('owner', lease.sessionId); return store.session('owner', lease.sessionId).revision === candidate.revision && state?.state.planVersion === candidate.planVersion && state.state.scopeKey === candidate.scopeKey && state.state.episodeId === candidate.episodeId; } });
    const outcome = store.applyPlannerToolEvent('owner', current, plannerToolEvent(result, 'scope') as typeof finished);
    assert.equal(outcome.checkpoint.state.observations.scope.value, 'available');
    assert.equal(outcome.checkpoint.state.observations.scope.verification, 'unverified');
    assert.equal(outcome.checkpoint.state.observations.scope.toolCallId, 'call');
    assert.deepEqual(outcome.checkpoint.state.observations.scope.toolProvenance, { sourceId: 'SRC-SYNTHETIC', entryId: 'KB-SYNTHETIC', sourceStatus: '待核验' });
    assert.deepEqual(store.plannerCheckpoint('owner', lease.sessionId)?.state.observations.scope.toolProvenance, outcome.checkpoint.state.observations.scope.toolProvenance);
  } finally { store.close(); }
});

test('a new episode rejects results from the previous episode', () => {
  const { store, lease } = setup();
  try {
    const reserved = store.applyPlannerToolEvent('owner', lease, started), current = nextLease(lease, reserved);
    const replacement = structuredClone(reserved.checkpoint);
    replacement.state = createPlan({ planId: 'other-plan', episodeId: 'other-episode', scope: replacement.state.scope, steps: [] });
    store.appendTurn('owner', lease.sessionId, current.revision, '新故障', { content: '继续' }, [], { previous: { episodeId: lease.episodeId, planVersion: current.planVersion }, checkpoint: replacement });
    assert.throws(() => store.applyPlannerToolEvent('owner', { ...current, revision: current.revision + 1 }, finished), /变化/);
  } finally { store.close(); }
});

test('separate SQLite connections reject competing reservations', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'planner-concurrent-')), file = path.join(dir, 'memory.sqlite');
  const { store, lease } = setup(file), second = new MemoryStore(file, () => 1000);
  try {
    const first = store.applyPlannerToolEvent('owner', lease, started);
    assert.throws(() => second.applyPlannerToolEvent('owner', lease, { ...started, id: 'other-start', callId: 'other-call' }), /已更新/);
    assert.equal(second.plannerCheckpoint('owner', lease.sessionId)?.state.toolCalls?.call.outcome, 'pending');
    assert.equal(second.session('owner', lease.sessionId).revision, first.revision);
  } finally { second.close(); store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('failure, empty and cancelled outcomes are persisted without a verified result', () => {
  for (const outcome of ['failure', 'empty', 'cancelled'] as const) {
    const { store, lease } = setup();
    try {
      const reservation = store.applyPlannerToolEvent('owner', lease, started);
      const result = store.applyPlannerToolEvent('owner', nextLease(lease, reservation), { ...finished, outcome, value: null });
      const observed = store.plannerCheckpoint('owner', lease.sessionId)?.state.observations.scope;
      assert.equal(observed?.toolOutcome, outcome); assert.equal(observed?.value, null);
      assert.equal(observed?.verification, 'unverified'); assert.equal(result.checkpoint.state.status, 'paused');
    } finally { store.close(); }
  }
});

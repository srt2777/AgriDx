import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPlan, advancePlan, reducePlan, decideNextAction, type PlannerEvent, type PlannerState } from '../agent/planner';
import { plan, step, context, scope, manual } from './fixtures/planner';

const observation = (id: string, stepKey: string, value: string | boolean | number | null, corrects?: string): PlannerEvent => ({
  type: 'observation', id, episodeId: 'episode-1', stepKey, value, source: 'user_report', ...(corrects ? { corrects } : {}),
});
const control = (id: string, type: 'cancel' | 'pause' | 'resume' | 'resolved_reported' | 'continue'): PlannerEvent => ({ id, episodeId: 'episode-1', type });
function frozen<T>(value: T): T { if (value && typeof value === 'object') { Object.values(value).forEach(frozen); Object.freeze(value); } return value; }

test('stable plan and step identifiers, explicit expectations, provenance and budgets', () => {
  const a = plan(), b = plan(); assert.deepEqual(a, b);
  assert.equal(a.planVersion, 1); assert.equal(a.steps[0].id, 'test-plan/episode-1/load');
  assert.deepEqual(a.steps[1].dependsOn, ['load']); assert.equal(a.budget.issuedActions, 0);
});

test('multi-turn proposals wait for feedback, then select the dependent next step', () => {
  const first = advancePlan(plan(), context()); assert.equal(first.decision.action?.stepKey, 'load');
  assert.equal(first.state.status, 'awaiting_user'); assert.equal(first.state.budget.issuedActions, 1);
  assert.ok(first.decision.questions.length <= 2); assert.match(first.decision.action!.text, /已经观察或记录/);
  const waiting = advancePlan(first.state, context()); assert.equal(waiting.decision.action, undefined);
  assert.deepEqual(waiting.state, first.state);
  const next = advancePlan(first.state, context(), observation('feedback-1', 'load', '持续作业时出现'));
  assert.equal(next.decision.action?.stepKey, 'alarm'); assert.equal(next.state.steps[0].status, 'reported');
  assert.equal(next.state.observations.load.verification, 'unverified');
  assert.equal(next.state.audit.at(-1)?.stepId, next.state.steps[1].id);
});

test('identical original input and cloned input produce identical results without mutation', () => {
  const state = frozen(plan()), input = frozen(context()), event = frozen(observation('feedback-1', 'load', false));
  const before = JSON.stringify({ state, input, event });
  const a = advancePlan(state, input, event), b = advancePlan(structuredClone(state), structuredClone(input), structuredClone(event));
  assert.deepEqual(a, b); assert.equal(JSON.stringify({ state, input, event }), before);
});

test('replayed events are idempotent, while same-ID changed content is rejected', () => {
  const event = observation('event-1', 'load', true);
  const first = advancePlan(plan(), context(), event);
  const repeated = advancePlan(first.state, context(), { source: 'user_report', value: true, stepKey: 'load', episodeId: 'episode-1', id: 'event-1', type: 'observation' });
  assert.equal(repeated.decision.action, undefined); assert.deepEqual(repeated.state, first.state);
  assert.throws(() => reducePlan(first.state, observation('event-1', 'load', false)), /different content/);
});

test('explicit user corrections replace current observations without rewriting earlier audit', () => {
  const first = reducePlan(plan(), observation('e1', 'load', true));
  assert.throws(() => reducePlan(first, observation('e2', 'load', false)), /explicit correction/);
  const corrected = reducePlan(first, observation('e2', 'load', false, 'e1'));
  assert.equal(corrected.observations.load.value, false); assert.equal(corrected.observations.load.corrects, 'e1');
  assert.equal(corrected.observations.load.verification, 'unverified');
  assert.deepEqual(corrected.audit[0], first.audit[0]); assert.equal(first.observations.load.value, true);
  assert.throws(() => reducePlan(corrected, observation('e3', 'load', true, 'e1')), /latest observation/);
});

test('corrections invalidate dependent observations transitively and reopen only their new context', () => {
  let state = plan([step('a'), step('b', { dependsOn: ['a'] }), step('c', { dependsOn: ['b'] })]);
  for (const key of ['a', 'b', 'c']) state = reducePlan(state, observation(`e-${key}`, key, true));
  assert.deepEqual(state.steps.map(s => s.status), ['reported', 'reported', 'reported']);
  state = reducePlan(state, observation('correct-a', 'a', false, 'e-a'));
  assert.deepEqual(state.steps.map(s => s.status), ['reported', 'pending', 'pending']);
  assert.equal(advancePlan(state, context()).decision.action?.stepKey, 'b');
});

test('preconditions select the appropriate branch, not the most expensive/highest score blocked step', () => {
  const state = reducePlan(plan([step('a'), step('b', { preconditions: [{ slot: 'a', equals: true }], discriminationValue: 100 }), step('c', { preconditions: [{ slot: 'a', equals: false }] })]), observation('e1', 'a', false));
  assert.equal(advancePlan(state, context()).decision.action?.stepKey, 'c');
});

test('ranking uses discrimination, then cost, then stable ID independently of definition order', () => {
  const steps = [step('z', { discriminationValue: 20, cost: 3 }), step('b', { discriminationValue: 20 }), step('a', { discriminationValue: 20 }), step('cheap', { cost: 1 })];
  assert.equal(decideNextAction(plan(steps), context()).action?.stepKey, 'a');
  assert.equal(decideNextAction(plan(steps.toReversed()), context()).action?.stepKey, 'a');
});

test('scope change invalidates old steps and observations without moving them to another vehicle', () => {
  const before = advancePlan(plan(), context(), observation('e1', 'load', true)).state;
  const changed = reducePlan(before, { type: 'scope_changed', id: 'scope-1', episodeId: 'episode-1', scope: { ...scope, model: 'LF1504' } });
  assert.equal(changed.stopReason, 'scope_changed'); assert.ok(changed.steps.every(s => s.status === 'invalidated'));
  assert.equal(changed.observations.load.scopeKey, before.scopeKey);
  assert.equal(advancePlan(changed, context('auto', { scope: changed.scope })).decision.action, undefined);
  assert.throws(() => reducePlan(changed, observation('e2', 'load', false, 'e1')), /invalidated step/);
});

test('host scope mismatch pauses instead of silently reusing a plan', () => {
  const result = advancePlan(plan(), context('auto', { scope: { ...scope, engineModel: 'OTHER' } }));
  assert.equal(result.decision.reason, 'scope_mismatch'); assert.equal(result.decision.action, undefined);
});

test('scope comparisons preserve engine/code punctuation, normalize ordering and whitespace', () => {
  const initial = createPlan({ planId: 'P', episodeId: 'E', scope: { ...scope, faultCodes: ['E-01', 'A2'] }, steps: [] });
  assert.notEqual(advancePlan(initial, context('auto', { scope: { ...scope, faultCodes: ['E01', 'A2'] } })).decision.reason, 'prerequisites_unmet');
  assert.equal(advancePlan(initial, context('auto', { scope: { ...scope, faultCodes: ['A2', ' E-01 '] } })).decision.reason, 'prerequisites_unmet');
});

test('all modes retain Router high-risk restrictions, including resolved and budget-limited plans', () => {
  for (const mode of ['auto', 'knowledge_only', 'ai_assisted'] as const) {
    const ctx = context(mode, { query: '制动失灵怎么办', currentQuery: '制动失灵怎么办' });
    const result = advancePlan(plan(), ctx); assert.equal(result.decision.routing.route, 'safe');
    assert.equal(result.state.status, 'escalated'); assert.equal(result.decision.action, undefined);
    const resolution = advancePlan(plan(), ctx, control('done', 'resolved_reported'));
    assert.equal(resolution.state.status, 'escalated');
  }
});

test('rule text and answer options are checked by the existing safety gate', () => {
  for (const changes of [{ title: '热机直接打开水箱盖' }, { expectedObservation: { slot: 'load', label: '短接安全联锁' } }, { expectedObservation: { slot: 'load', label: '已有报警', options: ['短接安全联锁'] } }]) {
    const result = advancePlan(plan([step('load', changes)]), context());
    assert.equal(result.decision.reason, 'unsafe_step'); assert.equal(result.decision.action, undefined);
  }
});

test('Planner preserves Router mode decisions and never requests a tool/LLM execution', () => {
  for (const mode of ['auto', 'knowledge_only', 'ai_assisted'] as const) {
    const result = advancePlan(plan(), context(mode));
    assert.equal(result.decision.routing.effectiveMode, mode);
    assert.ok(['ask_user', 'review_evidence'].includes(result.decision.action!.kind));
    assert.ok(!('execute' in result.decision));
  }
});

test('only applicable indexed reviewed evidence can support evidence-dependent steps', () => {
  const initial = plan([step('read', { kind: 'review_evidence', evidenceIds: [manual.entryId!] })]);
  for (const retrieved of [[], [{ ...manual, status: '核验失败' }], [{ ...manual, status: '待核验' }], [{ ...manual, engineModel: 'ENGINE-A' }]]) {
    const ctx = context('knowledge_only', { retrieved, ...(retrieved[0]?.engineModel ? { scope: { ...scope, engineModel: 'ENGINE-B' } } : {}) });
    const result = advancePlan(initial, ctx); assert.equal(result.decision.action, undefined);
  }
  assert.equal(advancePlan(initial, context()).decision.action?.kind, 'review_evidence');
});

test('no evidence permits an existing-observation question but never invents a repair action', () => {
  const result = advancePlan(plan(), context('knowledge_only', { retrieved: [] }));
  assert.equal(result.decision.action?.kind, 'ask_user'); assert.deepEqual(result.decision.action.evidenceIds, []);
  assert.equal(advancePlan(plan([step('read', { kind: 'review_evidence', evidenceIds: [manual.entryId!] })]), context('auto', { retrieved: [] })).decision.reason, 'no_evidence');
});

test('withdrawn evidence cannot continue an outstanding reviewed step', () => {
  const initial = advancePlan(plan([step('read', { kind: 'review_evidence', evidenceIds: [manual.entryId!] })]), context()).state;
  const result = advancePlan(initial, context('auto', { retrieved: [{ ...manual, status: '核验失败' }] }));
  assert.equal(result.decision.reason, 'no_evidence'); assert.equal(result.decision.action, undefined);
});

test('a proposal does not complete a check; tool observations also remain unverified repair data', () => {
  const requested = advancePlan(plan(), context()).state;
  assert.equal(requested.steps[0].status, 'awaiting_user'); assert.deepEqual(requested.observations, {});
  const observed = reducePlan(requested, { ...observation('tool-1', 'load', true), source: 'tool_result' });
  assert.equal(observed.steps[0].status, 'observed'); assert.equal(observed.observations.load.verification, 'unverified');
});

test('simulated observations cannot satisfy real diagnostic dependencies', () => {
  const state = reducePlan(plan(), { ...observation('sim-1', 'load', true), source: 'simulated' });
  assert.equal(state.steps[0].status, 'pending');
  assert.notEqual(advancePlan(state, context()).decision.action?.stepKey, 'alarm');
});

test('cancel is sticky; late observations, resume and continue do not revive it', () => {
  const state = advancePlan(plan(), context(), control('cancel-1', 'cancel')).state;
  for (const event of [observation('late-1', 'load', true), control('resume-1', 'resume'), control('continue-1', 'continue')]) {
    assert.deepEqual(advancePlan(state, context(), event).state, state);
  }
});

test('user pause needs explicit resume; resume does not reset budgets', () => {
  const initial = advancePlan(plan(), context()).state;
  const paused = advancePlan(initial, context(), control('pause-1', 'pause')).state;
  assert.equal(paused.status, 'paused'); assert.equal(advancePlan(paused, context()).decision.action, undefined);
  const resumed = advancePlan(paused, context(), control('resume-1', 'resume')).state;
  assert.equal(resumed.status, 'awaiting_user'); assert.equal(resumed.budget.issuedActions, 1);
});

test('budget exhaustion stops new proposals without granting reset on resume', () => {
  const first = advancePlan(plan(undefined, 1), context()).state;
  const result = advancePlan(first, context(), observation('e1', 'load', true));
  assert.equal(result.state.status, 'exhausted'); assert.equal(result.decision.reason, 'action_budget_exhausted');
  assert.equal(result.decision.action, undefined);
  assert.deepEqual(advancePlan(result.state, context(), control('resume-1', 'resume')).state, result.state);
});

test('repeated continue/unknown feedback reaches no-progress pause without repeated questions', () => {
  let state = advancePlan(plan(), context()).state;
  for (const id of ['again-1', 'again-2']) {
    const next = advancePlan(state, context(), control(id, 'continue')); assert.equal(next.decision.action, undefined); state = next.state;
  }
  assert.equal(state.stopReason, 'no_progress'); assert.equal(advancePlan(state, context(), control('resume', 'resume')).state.stopReason, 'no_progress');
  const progressed = advancePlan(state, context(), observation('new', 'load', '新工况')); assert.equal(progressed.decision.action?.stepKey, 'alarm');
});

test('all observations pause for review instead of falsely declaring repair completion', () => {
  let state = reducePlan(plan(), observation('e1', 'load', true)); state = reducePlan(state, observation('e2', 'alarm', '无报警'));
  assert.equal(advancePlan(state, context()).decision.reason, 'plan_review_complete');
  const resolved = advancePlan(state, context(), control('resolved', 'resolved_reported'));
  assert.equal(resolved.state.status, 'resolved_reported'); assert.equal(resolved.state.observations.load.verification, 'unverified');
});

test('identity clarification stays with Router without unbudgeted or repeated Planner questions', () => {
  const ctx = context('auto', { clarificationNeeded: true });
  const first = advancePlan(plan(), ctx); assert.equal(first.decision.reason, 'identity_required'); assert.equal(first.decision.questions.length, 0);
  assert.equal(advancePlan(first.state, ctx).decision.questions.length, 0);
});

test('reject cross-episode events, invalid IDs, unsafe data sizes, invalid graphs and physical execution kinds', () => {
  assert.throws(() => reducePlan(plan(), { ...control('x', 'cancel'), episodeId: 'other' }), /another episode/);
  assert.throws(() => reducePlan(plan(), control('planner:reserved', 'cancel')), /Reserved/);
  for (const steps of [[step('a', { dependsOn: ['missing'] })], [step('a', { dependsOn: ['b'] }), step('b', { dependsOn: ['a'] })],
    [step('a', { preconditions: [{ slot: 'a', equals: true }] })], [step('__proto__')], [step('same'), step('same')]]) assert.throws(() => plan(steps));
  assert.throws(() => createPlan({ planId: 'P', episodeId: 'E', scope, steps: [step('a')], budget: { maxActions: -1 } }));
  assert.throws(() => reducePlan(plan(), observation('invalid', 'load', Infinity)));
  assert.throws(() => plan([step('x', { kind: 'execute_repair' as 'ask_user' })]));
  assert.throws(() => createPlan({ planId: 'P', episodeId: 'E', scope, steps: Array.from({ length: 33 }, (_, i) => step(`s${i}`)) }));
});

test('a dense bounded dependency DAG remains deterministic', () => {
  let state: PlannerState = plan(Array.from({ length: 24 }, (_, i) => step(`s${i}`, { dependsOn: Array.from({ length: i }, (_, j) => `s${j}`) })));
  for (let i = 0; i < 24; i++) state = reducePlan(state, observation(`e${i}`, `s${i}`, i));
  assert.equal(advancePlan(state, context()).decision.reason, 'plan_review_complete');
});

test('bounded event journal exhausts without looping, but cancellation still works', () => {
  let state = plan();
  for (let i = 0; i < 256; i++) state = reducePlan(state, control(`continue-${i}`, 'continue'));
  state = advancePlan(state, context(), control('overflow', 'continue')).state;
  assert.equal(state.status, 'exhausted'); assert.equal(state.stopReason, 'event_limit');
  const cancelled = advancePlan(state, context(), control('cancel-final', 'cancel')).state;
  assert.equal(cancelled.status, 'cancelled'); assert.equal(Object.keys(cancelled.acceptedEvents).length, 256);
});

test('an existing unknown report does not satisfy prerequisites or cause repeated requests', () => {
  const initial = advancePlan(plan(), context()).state;
  const result = advancePlan(initial, context(), observation('unknown', 'load', null));
  assert.equal(result.decision.action, undefined); assert.equal(result.state.status, 'awaiting_user');
  assert.notEqual(result.state.steps[0].status, 'reported');
});

test('LF1504 overheating feedback updates the next observation without repeating supplied facts', () => {
  const lf = { ...scope, model: 'LF1504' };
  const ctx = context('auto', { scope: lf, retrieved: [], query: '东方红LF1504旋耕时水温过高', currentQuery: '旋耕时水温过高' });
  let state = createPlan({ planId: 'cooling', episodeId: 'episode-1', scope: lf, steps: [
    step('workload', { discriminationValue: 30, expectedObservation: { slot: 'workload', label: '水温异常发生的已有工况' } }),
    step('debris', { dependsOn: ['workload'], discriminationValue: 20, expectedObservation: { slot: 'debris', label: '散热器外表已经看到的遮挡' } }),
    step('alarm', { dependsOn: ['workload'], expectedObservation: { slot: 'alarm', label: '已经看到的报警原文' } }),
  ] });
  state = advancePlan(state, ctx, observation('load-report', 'workload', '冷车正常，旋耕后升温')).state;
  const result = advancePlan(state, ctx, observation('debris-report', 'debris', true));
  assert.equal(result.decision.action?.stepKey, 'alarm'); assert.doesNotMatch(result.decision.action!.text, /品牌|型号|遮挡|冷车/);
  const dangerous = advancePlan(result.state, { ...ctx, routerInput: { ...ctx.routerInput, currentQuery: '现在热机打开水箱盖看看？' } });
  assert.equal(dangerous.state.status, 'escalated'); assert.equal(dangerous.decision.action, undefined);
});

test('server local-only and invalid routing settings cannot be overridden by Planner', () => {
  const input = context('ai_assisted');
  for (const config of [
    { defaultMode: 'auto' as const, configValid: true, allowExternalAi: false, highRelevanceThreshold: 8, mediumRelevanceThreshold: 3 },
    { defaultMode: 'auto' as const, configValid: false, allowExternalAi: true, highRelevanceThreshold: 8, mediumRelevanceThreshold: 3 },
  ]) {
    const result = advancePlan(plan(), { ...input, routerConfig: config });
    assert.equal(result.decision.routing.route, 'local'); assert.equal(result.decision.routing.aiRequired, false);
  }
});

test('prototype property names cannot collide with event or observation ledgers', () => {
  for (const key of ['constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
    assert.throws(() => plan([step(key)]), /identifier/);
    assert.throws(() => reducePlan(plan(), control(key, 'continue')), /identifier/);
  }
});

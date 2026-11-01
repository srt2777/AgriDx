import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advancePlan, createPlan, decideNextAction } from '../agent/planner';
import { plan, step, context, scope, manual } from './fixtures/planner';

/**
 * Proposal section 5.2 decision table (rescope is already covered by
 * tests/planner-checkpoint.test.ts, so it is not repeated here):
 * 证据充分 / 证据不足 / 机型冲突 / 故障码不匹配 / 高风险.
 *
 * 机型冲突 and 故障码不匹配 are Planner-level decisions in the sense that
 * matters here: the Router marks the candidate modelMatch as 'conflict',
 * so the Planner's supported() check refuses it and no review_evidence
 * step is proposed. The conflict itself is computed by
 * server/diagnosis/router.ts (candidateMatch), not invented by the Planner.
 */
const reviewStep = () => step('read', { kind: 'review_evidence', evidenceIds: [manual.entryId!] });

test('decision table: sufficient verified evidence proposes the review step', () => {
  const result = advancePlan(plan([reviewStep()]), context());
  assert.equal(result.decision.action?.kind, 'review_evidence');
  assert.equal(result.decision.action?.stepKey, 'read');
  assert.deepEqual(result.decision.questions, []);
});

test('decision table: insufficient evidence proposes nothing and reports no_evidence', () => {
  const result = advancePlan(plan([reviewStep()]), context('knowledge_only', { retrieved: [] }));
  assert.equal(result.decision.action, undefined);
  assert.equal(result.decision.reason, 'no_evidence');
});

test('decision table: a model-conflicting document does not support a review step', () => {
  const conflicting = { ...manual, model: 'LF954S' };
  const result = advancePlan(plan([reviewStep()]), context('knowledge_only', { retrieved: [conflicting] }));
  assert.equal(result.decision.action, undefined);
  assert.equal(result.decision.reason, 'no_evidence');
  assert.equal(result.decision.routing.candidates?.[0].modelMatch, 'conflict');
});

test('decision table: a fault-code mismatch does not support a review step', () => {
  const mismatched = { ...manual, faultCodes: ['E002'] };
  // The plan itself must carry the fault-code scope: a plan built for a
  // different scope correctly pauses with scope_mismatch before any
  // evidence check, so that case is not a fault-code test.
  const faultScope = { ...scope, faultCodes: ['E001'] };
  const faultPlan = createPlan({
    planId: 'test-plan', episodeId: 'episode-1', scope: faultScope, steps: [reviewStep()],
    evidence: [{ entryId: manual.entryId!, sourceId: manual.sourceId!, locator: manual.locator }],
  });
  const result = advancePlan(
    faultPlan,
    context('knowledge_only', { scope: faultScope, retrieved: [mismatched] }),
  );
  assert.equal(result.decision.action, undefined);
  assert.equal(result.decision.reason, 'no_evidence');
  assert.equal(result.decision.routing.candidates?.[0].modelMatch, 'conflict');
});

test('decision table: high risk escalates through the Router and proposes nothing', () => {
  for (const query of ['制动失灵怎么办', '转向突然失效是什么原因']) {
    const result = advancePlan(plan(), context('auto', { query, currentQuery: query }));
    assert.equal(result.decision.routing.route, 'safe');
    assert.equal(result.state.status, 'escalated');
    assert.equal(result.decision.action, undefined);
  }
});

test('decision table: no step kind in this table executes a physical operation', () => {
  for (const state of [plan(), plan([reviewStep()])]) {
    const action = decideNextAction(state, context()).action;
    if (action) assert.ok(['ask_user', 'review_evidence', 'rescope_evidence'].includes(action.kind));
  }
});

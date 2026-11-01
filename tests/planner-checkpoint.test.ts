import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlan } from '../agent/planner/reducer';
import { decideNextAction } from '../agent/planner/policy';
import {
  InMemoryPlannerCheckpointStore,
  PlannerCheckpointConflictError,
  resumePlannerCheckpoint,
} from '../agent/planner/checkpoint';
import type { KnowledgeChunk } from '../server/knowledge/types';

const scope = { machineType: '拖拉机', brand: '久保田', model: 'LX2620' };
const evidence = [{ entryId: 'KB-001', sourceId: 'SRC-001' }];
const chunk: KnowledgeChunk = {
  source: 'manual',
  heading: 'KB-001｜发动机无法启动',
  text: '故障现象：发动机无法启动。原因：燃油不足。检查：检查油位。',
  entryId: 'KB-001',
  sourceId: 'SRC-001',
  indexedReference: { entryId: 'KB-001', sourceId: 'SRC-001' },
  brand: '久保田',
  model: 'LX2620',
  locator: 'p.1',
  version: 'v1',
  scopeBoundary: '久保田 LX2620',
  status: '已核验',
  entryType: '维护/故障知识',
  applicability: 'matched',
  diagnosticMetadata: { coverage: { symptom: true, causes: true, checks: true, repair: true }, riskLevel: 'low' },
  relevance: { score: 10, method: 'keyword-weighted-overlap', calibrated: false },
};

function makePlan() {
  return createPlan({
    planId: 'plan-1',
    episodeId: 'episode-1',
    scope,
    evidence,
    steps: [{
      key: 'rescope',
      title: '换范围再查一次证据',
      kind: 'rescope_evidence',
      dependsOn: [],
      preconditions: [],
      expectedObservation: { slot: 'rescope_result', label: '重查证据结果' },
      // A rescope step may start with no evidence: the evidence is what
      // the re-retrieval is supposed to find.
      evidenceIds: [],
      discriminationValue: 10,
      cost: 1,
    }],
  });
}

test('a rescope_evidence step is valid, read-only, and asks no user question', () => {
  const state = makePlan();
  const decision = decideNextAction(state, {
    routerInput: {
      query: '久保田 LX2620 发动机无法启动 原因',
      currentQuery: '久保田 LX2620 发动机无法启动 原因',
      scope,
      retrieved: [chunk],
      clarificationNeeded: false,
      llmConfigured: true,
    },
  });
  assert.equal(decision.action?.kind, 'rescope_evidence');
  assert.deepEqual(decision.questions, []);
  assert.match(decision.action?.text ?? '', /换范围再查一次证据/);
  assert.match(decision.action?.text ?? '', /只读/);
});

test('a rescope step with an unknown evidence id is still rejected', () => {
  assert.throws(() => createPlan({
    planId: 'plan-2',
    episodeId: 'episode-2',
    scope,
    evidence,
    steps: [{
      key: 'rescope',
      title: '换范围再查一次证据',
      kind: 'rescope_evidence',
      dependsOn: [],
      preconditions: [],
      expectedObservation: { slot: 'rescope_result', label: '重查证据结果' },
      evidenceIds: ['KB-999'],
      discriminationValue: 10,
      cost: 1,
    }],
  }), /Unknown or missing evidence/);
});

test('planner checkpoint resumes, and a version or revision mismatch returns 409', async () => {
  const store = new InMemoryPlannerCheckpointStore();
  const context = { sessionId: 'session-1', deviceId: 'device-1', episodeId: 'episode-1' };
  const plan = makePlan();
  // First save is accepted; resume returns the stored plan.
  await store.compareAndSave({ ...context, expectedPlanVersion: plan.planVersion, memoryRevision: 3 }, plan);
  const resumed = await resumePlannerCheckpoint(store, context, makePlan());
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.state.planId, 'plan-1');

  // A stale plan version or a changed memory revision must not overwrite.
  await assert.rejects(
    () => store.compareAndSave({ ...context, expectedPlanVersion: 999, memoryRevision: 3 }, plan),
    (error: unknown) => error instanceof PlannerCheckpointConflictError && error.status === 409,
  );
  await assert.rejects(
    () => store.compareAndSave({ ...context, expectedPlanVersion: plan.planVersion, memoryRevision: 4 }, plan),
    (error: unknown) => error instanceof PlannerCheckpointConflictError && error.status === 409,
  );
  // The stored checkpoint is untouched by the failed saves.
  assert.equal((await store.load(context))?.planVersion, plan.planVersion);

  // A correct save advances, and a terminal checkpoint is never resumed.
  const advanced = { ...plan, planVersion: plan.planVersion + 1, status: 'cancelled' as const };
  await store.compareAndSave({ ...context, expectedPlanVersion: plan.planVersion, memoryRevision: 3 }, advanced);
  const notResumed = await resumePlannerCheckpoint(store, context, makePlan());
  assert.equal(notResumed.resumed, false);
});

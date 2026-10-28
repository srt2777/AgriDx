import type { KnowledgeChunk } from '../../server/knowledge/types';
import { createPlan, type StepDefinition, type PlannerScope } from '../../agent/planner';
import type { PlannerContext } from '../../agent/planner/ports';

export const scope: PlannerScope = { machineType: '拖拉机', brand: '东方红', model: 'LF904S' };
/** Entirely synthetic evidence: no repair validity, model API or knowledge files involved. */
export const manual: KnowledgeChunk = {
  source: 'planner-synthetic.md', entryId: 'TEST-PLAN-001', sourceId: 'SRC-TEST-PLAN', heading: 'TEST-PLAN-001｜合成规则测试资料',
  indexedReference: { entryId: 'TEST-PLAN-001', sourceId: 'SRC-TEST-PLAN' }, brand: '东方红', model: 'LF904S',
  entryType: '维护/故障知识', applicability: 'matched', status: '已核验', locator: '合成页1', version: '仅测试', scopeBoundary: '仅合成LF904S测试，不用于实车维修',
  relevance: { score: 12, method: 'keyword-weighted-overlap', calibrated: false },
  diagnosticMetadata: { coverage: { symptom: true, causes: true, checks: true, repair: true }, riskLevel: 'low' },
  text: '- 故障现象：合成现象。\n- 可能原因：合成待核实方向。\n- 安全提醒：不要短接安全联锁。',
};
export const step = (key: string, changes: Partial<StepDefinition> = {}): StepDefinition => ({
  key, title: `已有记录 ${key}`, kind: 'ask_user', dependsOn: [], preconditions: [],
  expectedObservation: { slot: key, label: `${key}的已有表现` }, evidenceIds: [], discriminationValue: 10, cost: 1, ...changes,
});
export function context(mode: 'auto' | 'knowledge_only' | 'ai_assisted' = 'knowledge_only', changes: Partial<PlannerContext['routerInput']> = {}): PlannerContext {
  return { routerInput: { query: '已有故障现象记录', currentQuery: '已有故障现象记录', scope, clarificationNeeded: false,
    retrieved: [manual], requestedMode: mode, llmConfigured: true, ...changes } };
}
export function plan(steps: readonly StepDefinition[] = [step('load'), step('alarm', { dependsOn: ['load'] })], maxActions = 8) {
  return createPlan({ planId: 'test-plan', episodeId: 'episode-1', scope, steps, evidence: [{ entryId: manual.entryId!, sourceId: manual.sourceId!, locator: manual.locator }], budget: { maxActions } });
}

import { DiagnosisRouter } from '../../server/diagnosis/router';
import { assessSuggestedAction } from '../../server/diagnosis/answerGuard';
import type { PlannerContext } from './ports';
import type { PlannerState, PlannerDecision, PlanStep } from './types';
import { hasObservation, prerequisitesSatisfied, questionKey, scopeKey, isTerminal } from './reducer';

/** One bounded rule pass. No tool dispatch, model generation, persistence or clock reads. */
export function decideNextAction(state: PlannerState, context: PlannerContext): PlannerDecision {
  const input = context.routerInput;
  if (typeof input.query !== 'string' || typeof input.currentQuery !== 'string' || input.query.length > 8000 || input.currentQuery.length > 2000 ||
    !Array.isArray(input.retrieved) || input.retrieved.length > 20 || input.retrieved.reduce((n, chunk) => n + chunk.text.length, 0) > 128000) throw new TypeError('Unbounded Planner routing context');
  // Preserve explicit emissions/configuration constraints in the existing scope evaluator.
  const routing = DiagnosisRouter.decide({ ...input, query: [input.query, ...(input.scope.conditions ?? [])].join(' ') }, context.routerConfig);
  const result = (status: PlannerDecision['status'], reason: PlannerDecision['reason'], rationale: string[]): PlannerDecision => ({ status, reason, routing, rationale, questions: [] });
  if (state.status === 'cancelled') return result('cancelled', 'user_cancelled', ['terminal_cancel']);
  if (routing.route === 'safe') return result('escalated', 'safety_restriction', [routing.reason]);
  if (isTerminal(state)) return result(state.status, state.stopReason, ['terminal_state']);
  if (scopeKey(input.scope) !== state.scopeKey) return result('paused', 'scope_mismatch', ['host_scope_must_match_plan']);
  // Scope clarification stays with the existing Router; no unbudgeted ad-hoc question.
  if (routing.route === 'clarify') return result('paused', 'identity_required', [routing.reason]);
  if (state.status === 'paused') return result('paused', state.stopReason, ['explicit_resume_or_new_observation_required']);
  if (state.budget.noProgress >= state.budget.maxNoProgress) return result('paused', 'no_progress', ['no_new_observation']);
  const memo = new Map<string, boolean>();
  const live = state.steps.filter(step => step.scopeKey === state.scopeKey);
  if (live.length && live.every(step => hasObservation(state, step, memo))) return result('paused', 'plan_review_complete', ['observations_are_not_a_verified_repair']);
  const pending = live.filter(step => !hasObservation(state, step, memo) && prerequisitesSatisfied(state, step, memo));
  // Reuse exact, indexed, reviewed and applicable candidate assessments; cached IDs alone grant nothing.
  const supported = (step: PlanStep) => step.evidenceIds.every(id => {
    const reference = state.evidence.find(ref => ref.entryId === id);
    return routing.candidates?.some(candidate => candidate.entryId === id && candidate.sourceId === reference?.sourceId &&
      !candidate.excluded && candidate.sourceIndexed && candidate.modelMatch === 'exact' && candidate.referenceVerification === 'verified' && !candidate.retrieval?.referenceOnly);
  });
  const applicable = pending.filter(supported);
  const unsafe = applicable.some(step => assessSuggestedAction([step.title, step.expectedObservation.label, ...(step.expectedObservation.options ?? [])].join('。')).restricted);
  if (unsafe) return result('escalated', 'unsafe_step', ['existing_answer_guard_rejected_rule_text']);
  // A question already issued in this prerequisite context waits; don't stream other checks every poll.
  if (applicable.some(step => state.askedKeys.includes(questionKey(state, step)))) return result('awaiting_user', 'awaiting_feedback', ['request_already_issued']);
  const ranked = applicable.filter(step => !state.askedKeys.includes(questionKey(state, step)))
    .sort((a, b) => b.discriminationValue - a.discriminationValue || a.cost - b.cost || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (!ranked.length) return result('paused', pending.length ? 'no_evidence' : 'prerequisites_unmet', ['no_eligible_next_step']);
  if (state.budget.issuedActions >= state.budget.maxActions) return result('exhausted', 'action_budget_exhausted', ['proposal_budget_not_execution_count']);
  const step = ranked[0];
  const text = `请补充已经观察或记录的“${step.expectedObservation.label}”；不要为此试车、拆检或接触危险部件。`;
  const decision = result('awaiting_user', 'awaiting_feedback', ['safety_and_scope_passed', 'dependencies_satisfied', 'discrimination_then_cost_then_stable_id']);
  decision.action = { kind: step.kind, stepId: step.id, stepKey: step.key, observationSlot: step.expectedObservation.slot, text, evidenceIds: [...step.evidenceIds] };
  if (step.kind === 'ask_user') decision.questions = [{ text, ...(step.expectedObservation.options ? { options: [...step.expectedObservation.options] } : {}) }];
  return decision;
}

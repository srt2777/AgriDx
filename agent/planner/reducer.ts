import type { CreatePlanInput, PlannerState, PlannerEvent, PlannerScope, ObservationValue, PlanStep, PlannerDecision } from './types';

export const PLANNER_LIMITS = Object.freeze({ steps: 32, events: 256, audit: 1024, evidence: 64, actions: 64 });
const forbidden = new Set(['__proto__', 'constructor', 'prototype', ...Object.getOwnPropertyNames(Object.prototype)]);
export function identifier(value: string): void {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(value) || forbidden.has(value)) throw new TypeError('Invalid Planner identifier');
}
function text(value: string, max = 400): void {
  if (typeof value !== 'string' || !value.trim() || value.length > max || [...value].some(char => char.charCodeAt(0) < 32)) throw new TypeError('Invalid Planner text');
}
function valueCheck(value: ObservationValue): void {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value === 'string') { text(value); return; }
  throw new TypeError('Observation must be a bounded primitive or null (unknown)');
}
/** No date, random ID, filesystem, aliases or significant-punctuation removal. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().filter(k => (value as Record<string, unknown>)[k] !== undefined)
    .map(k => JSON.stringify(k) + ':' + canonical((value as Record<string, unknown>)[k])).join(',') + '}';
  return JSON.stringify(value);
}
export function scopeKey(scope: PlannerScope): string {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope) || Object.keys(scope).some(key => !['machineType', 'brand', 'model', 'engineModel', 'faultCodes', 'conditions'].includes(key))) throw new TypeError('Invalid Planner scope fields');
  const identity = (s: string | undefined) => s?.trim().toUpperCase().replace(/\s+/g, ' ') || '';
  const list = (items: readonly string[] = []) => [...new Set(items.map(identity))].sort();
  for (const field of ['machineType', 'brand', 'model', 'engineModel'] as const) if (scope[field] !== undefined) text(scope[field]!, 100);
  for (const items of [scope.faultCodes, scope.conditions]) {
    if (items !== undefined && (!Array.isArray(items) || items.length > 20)) throw new TypeError('Too many scope constraints');
    items?.forEach(item => text(item, 100));
  }
  return canonical([identity(scope.machineType), identity(scope.brand), identity(scope.model), identity(scope.engineModel), list(scope.faultCodes), list(scope.conditions)]);
}
function bounded(value: number, max: number): number {
  if (!Number.isInteger(value) || value < 1 || value > max) throw new TypeError('Invalid Planner budget or rank');
  return value;
}
export function createPlan(input: CreatePlanInput): PlannerState {
  identifier(input.planId); identifier(input.episodeId);
  const key = scopeKey(input.scope);
  if (!Array.isArray(input.steps) || input.steps.length > PLANNER_LIMITS.steps) throw new TypeError('Too many Planner steps');
  const keys = new Set<string>(), slots = new Set<string>();
  const evidence = input.evidence ?? [];
  if (!Array.isArray(evidence) || evidence.length > PLANNER_LIMITS.evidence) throw new TypeError('Too many evidence references');
  const evidenceIds = new Set<string>();
  for (const ref of evidence) {
    identifier(ref.entryId); identifier(ref.sourceId);
    if (evidenceIds.has(ref.entryId)) throw new TypeError('Duplicate evidence ID');
    evidenceIds.add(ref.entryId); if (ref.locator !== undefined) text(ref.locator);
  }
  for (const step of input.steps) {
    identifier(step.key); text(step.title); identifier(step.expectedObservation.slot); text(step.expectedObservation.label);
    if (keys.has(step.key) || slots.has(step.expectedObservation.slot)) throw new TypeError('Duplicate step key or observation slot');
    keys.add(step.key); slots.add(step.expectedObservation.slot);
    if (!['ask_user', 'review_evidence'].includes(step.kind)) throw new TypeError('Phase one cannot execute actions');
    bounded(step.discriminationValue, 100); bounded(step.cost, 100);
    if (!Array.isArray(step.dependsOn) || step.dependsOn.length > PLANNER_LIMITS.steps || !Array.isArray(step.preconditions) || step.preconditions.length > PLANNER_LIMITS.steps) throw new TypeError('Unbounded dependencies');
    if (!Array.isArray(step.evidenceIds) || step.evidenceIds.length > PLANNER_LIMITS.evidence || step.evidenceIds.some((id: string) => !evidenceIds.has(id)) || step.kind === 'review_evidence' && !step.evidenceIds.length) throw new TypeError('Unknown or missing evidence');
    if (step.expectedObservation.options !== undefined && (!Array.isArray(step.expectedObservation.options) || step.expectedObservation.options.length > 6)) throw new TypeError('Too many options');
    step.expectedObservation.options?.forEach((option: string) => text(option, 200));
    for (const condition of step.preconditions) { identifier(condition.slot); valueCheck(condition.equals); }
  }
  const byKey = new Map(input.steps.map(s => [s.key, s]));
  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (key: string) => {
    if (visiting.has(key)) throw new TypeError('Cyclic step dependencies');
    if (visited.has(key)) return;
    const step = byKey.get(key); if (!step) throw new TypeError('Unknown dependency');
    visiting.add(key);
    for (const dependency of step.dependsOn) visit(dependency);
    // Preconditions are dependencies too; reject self-referential/cyclic conditions.
    for (const condition of step.preconditions) {
      const parent = input.steps.find(s => s.expectedObservation.slot === condition.slot);
      if (!parent) throw new TypeError('Unknown precondition slot');
      visit(parent.key);
    }
    visiting.delete(key); visited.add(key);
  };
  input.steps.forEach(s => visit(s.key));
  return {
    schemaVersion: 1, planId: input.planId, episodeId: input.episodeId, planVersion: 1,
    scope: structuredClone(input.scope), scopeKey: key, status: 'active',
    steps: input.steps.map(s => ({ ...structuredClone(s), id: `${input.planId}/${input.episodeId}/${s.key}`, scopeKey: key, status: 'pending' })),
    evidence: structuredClone([...evidence]), observations: {}, askedKeys: [], acceptedEvents: {}, audit: [],
    budget: { maxActions: bounded(input.budget?.maxActions ?? 8, PLANNER_LIMITS.actions), issuedActions: 0,
      maxNoProgress: bounded(input.budget?.maxNoProgress ?? 2, 10), noProgress: 0 },
  };
}
export function basisKey(state: PlannerState, step: PlanStep): string {
  const slots = [...new Set([...step.dependsOn.map(key => state.steps.find(s => s.key === key)!.expectedObservation.slot), ...step.preconditions.map(c => c.slot)])].sort();
  return canonical([state.scopeKey, slots.map(slot => [slot, state.observations[slot]?.eventId ?? null])]);
}
export function currentObservation(state: PlannerState, step: PlanStep) {
  const observation = state.observations[step.expectedObservation.slot];
  return observation?.scopeKey === state.scopeKey && observation.basisKey === basisKey(state, step) && observation.source !== 'simulated' ? observation : undefined;
}
export function prerequisitesSatisfied(state: PlannerState, step: PlanStep, memo = new Map<string, boolean>()): boolean {
  return step.dependsOn.every(key => hasObservation(state, state.steps.find(s => s.key === key)!, memo)) && step.preconditions.every(condition => {
    const parent = state.steps.find(s => s.expectedObservation.slot === condition.slot)!;
    return hasObservation(state, parent, memo) && currentObservation(state, parent)?.value === condition.equals;
  });
}
export function hasObservation(state: PlannerState, step: PlanStep, memo = new Map<string, boolean>()): boolean {
  if (memo.has(step.key)) return memo.get(step.key)!;
  const observation = currentObservation(state, step);
  const valid = step.scopeKey === state.scopeKey && observation?.value !== undefined && observation.value !== null && prerequisitesSatisfied(state, step, memo);
  memo.set(step.key, valid);
  return valid;
}
export function questionKey(state: PlannerState, step: PlanStep): string { return canonical([step.id, basisKey(state, step)]); }
export function isTerminal(state: PlannerState): boolean { return ['cancelled', 'escalated', 'resolved_reported', 'exhausted'].includes(state.status); }
function refreshSteps(state: PlannerState): void {
  const memo = new Map<string, boolean>();
  for (const step of state.steps) {
    if (step.scopeKey !== state.scopeKey) { step.status = 'invalidated'; continue; }
    const observation = currentObservation(state, step);
    step.status = hasObservation(state, step, memo)
      ? observation!.source === 'user_report' ? 'reported' : 'observed'
      : state.askedKeys.includes(questionKey(state, step)) ? 'awaiting_user' : 'pending';
  }
}
export function reducePlan(state: PlannerState, event: PlannerEvent): PlannerState {
  identifier(event.id); identifier(event.episodeId);
  if (event.id.startsWith('planner:')) throw new TypeError('Reserved Planner event ID');
  if (event.episodeId !== state.episodeId) throw new TypeError('Event belongs to another episode');
  const signature = canonical(event), previous = Object.hasOwn(state.acceptedEvents, event.id) ? state.acceptedEvents[event.id] : undefined;
  if (previous !== undefined) {
    if (previous !== signature) throw new TypeError('Event ID reused with different content');
    return state;
  }
  if (state.status === 'cancelled' || isTerminal(state) && event.type !== 'cancel') return state;
  if (Object.keys(state.acceptedEvents).length >= PLANNER_LIMITS.events && event.type !== 'cancel') return recordDecision(state, { status: 'exhausted', reason: 'event_limit' });
  const next = structuredClone(state);
  if (event.type === 'observation') {
    if (!['user_report', 'tool_result', 'simulated'].includes(event.source)) throw new TypeError('Unknown observation provenance');
    const step = next.steps.find(s => s.key === event.stepKey);
    if (!step || step.scopeKey !== next.scopeKey) throw new TypeError('Observation refers to an absent or invalidated step');
    valueCheck(event.value);
    const old = next.observations[step.expectedObservation.slot];
    if (event.corrects !== undefined && (!old || old.eventId !== event.corrects)) throw new TypeError('Correction must target the latest observation');
    if (old && event.corrects === undefined && (old.value !== event.value || old.source !== event.source)) throw new TypeError('Changed observations require an explicit correction');
    const same = old && old.value === event.value && old.source === event.source && old.basisKey === basisKey(next, step);
    if (same) next.budget.noProgress++;
    else {
      next.observations[step.expectedObservation.slot] = { eventId: event.id, stepId: step.id, slot: step.expectedObservation.slot,
        value: event.value, source: event.source, verification: 'unverified', scopeKey: next.scopeKey, basisKey: basisKey(next, step),
        ...(event.corrects ? { corrects: event.corrects } : {}) };
      next.budget.noProgress = event.value === null || event.source === 'simulated' ? next.budget.noProgress + 1 : 0;
    }
    if (next.stopReason !== 'user_paused') { next.status = 'active'; delete next.stopReason; }
  } else if (event.type === 'scope_changed') {
    next.scopeKey = scopeKey(event.scope); next.scope = structuredClone(event.scope);
    if (next.scopeKey !== state.scopeKey) { next.status = 'paused'; next.stopReason = 'scope_changed'; }
  } else if (event.type === 'cancel') { next.status = 'cancelled'; next.stopReason = 'user_cancelled'; }
  else if (event.type === 'resolved_reported') { next.status = 'resolved_reported'; next.stopReason = 'user_reported_resolved'; }
  else if (event.type === 'pause') { next.status = 'paused'; next.stopReason = 'user_paused'; }
  else if (event.type === 'resume') {
    if (next.stopReason !== 'scope_changed') { next.status = 'active'; delete next.stopReason; }
  } else if (event.type === 'continue') next.budget.noProgress++;
  else throw new TypeError('Unknown Planner event');
  if (Object.keys(next.acceptedEvents).length < PLANNER_LIMITS.events) next.acceptedEvents[event.id] = signature;
  next.planVersion++;
  refreshSteps(next);
  next.audit.push({ eventId: event.id, type: event.type, from: state.status, to: next.status, reason: next.stopReason,
    ...(event.type === 'observation' ? { stepId: next.steps.find(s => s.key === event.stepKey)!.id } : {}), evidenceIds: [] });
  return next;
}
/** Internal commit of a proposal, not a dispatch/execution acknowledgement. */
export function recordDecision(state: PlannerState, decision: Pick<PlannerDecision, 'status' | 'reason' | 'action'>): PlannerState {
  if (!decision.action && state.status === decision.status && state.stopReason === decision.reason) return state;
  const next = structuredClone(state);
  next.status = decision.status; next.stopReason = decision.reason;
  if (decision.action) {
    const step = next.steps.find(s => s.id === decision.action!.stepId)!;
    next.askedKeys.push(questionKey(next, step)); next.budget.issuedActions++;
  }
  next.planVersion++;
  refreshSteps(next);
  next.audit.push({ eventId: `planner:${next.planVersion}`, type: 'decision', from: state.status, to: next.status,
    reason: decision.reason, ...(decision.action ? { stepId: decision.action.stepId } : {}), evidenceIds: decision.action?.evidenceIds ?? [] });
  return next;
}

import type { PlannerState, PlannerEvent, PlannerResult } from './types';
import type { PlannerContext } from './ports';
import { reducePlan, recordDecision } from './reducer';
import { decideNextAction } from './policy';

export { createPlan, reducePlan, PLANNER_LIMITS } from './reducer';
export { decideNextAction } from './policy';
export type * from './types';
export type * from './ports';

/** Caller must thread the returned state. A proposal never acknowledges physical execution. */
export function advancePlan(state: PlannerState, context: PlannerContext, event?: PlannerEvent): PlannerResult {
  const updated = event ? reducePlan(state, event) : state;
  const decision = decideNextAction(updated, context);
  return { state: recordDecision(updated, decision), decision };
}

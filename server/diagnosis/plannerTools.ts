import { advancePlan, decideNextAction } from '../../agent/planner';
import { PlannerToolPort, plannerToolEvent, PLANNER_READ_TOOLS } from '../../agent/planner/tool-port';
import { hasObservation, prerequisitesSatisfied } from '../../agent/planner/reducer';
import { ToolExecutor } from '../../agent/tool-executor';
import type { ToolRegistry } from '../../agent/tool-registry';
import type { PlannerContext } from '../../agent/planner/ports';
import { MemoryError, type MemoryStore } from '../memory/store';

/** Trusted server-only dispatch for an already proposed, persisted read-tool step.
 * No model selects arguments; the caller binds scope and source IDs from the plan.
 * Pending reservations are never replayed after a process restart.
 */
export async function dispatchPlannerTool(input: {
  store: MemoryStore; owner: string; sessionId: string; revision: number;
  context: PlannerContext; registry: ToolRegistry; signal?: AbortSignal;
}) {
  const { store, owner, sessionId } = input;
  const session = store.session(owner, sessionId);
  const checkpoint = store.plannerCheckpoint(owner, sessionId);
  if (!checkpoint || session.revision !== input.revision) throw new MemoryError(409, 'memory_conflict', '诊断记录已更新');
  const context = structuredClone(input.context);
  if (input.signal?.aborted) return { status: 'cancelled' as const };
  const gate = decideNextAction(checkpoint.state, context);
  if (gate.routing.route === 'safe' || gate.routing.route === 'clarify' || gate.status !== 'active') return { status: 'stopped' as const, decision: gate };
  if (Object.values(checkpoint.state.toolCalls ?? {}).some(call => call.outcome === 'pending')) return { status: 'pending' as const };
  const step = checkpoint.state.steps.find(item => item.kind === 'read_tool' && item.status === 'awaiting_user' && !hasObservation(checkpoint.state, item) && prerequisitesSatisfied(checkpoint.state, item) && item.evidenceIds.every(id => {
    const ref = checkpoint.state.evidence.find(reference => reference.entryId === id);
    return gate.routing.candidates?.some(candidate => candidate.entryId === id && candidate.sourceId === ref?.sourceId && !candidate.excluded && candidate.sourceIndexed && candidate.modelMatch === 'exact' && candidate.referenceVerification === 'verified' && !candidate.retrieval?.referenceOnly);
  }) && !Object.values(checkpoint.state.toolCalls ?? {}).some(call => call.stepKey === item.key));
  if (!step?.tool) return { status: 'idle' as const };
  if (!PLANNER_READ_TOOLS.includes(step.tool) || Object.keys(checkpoint.state.toolCalls ?? {}).length >= 2) return { status: 'denied' as const };
  if (step.tool === 'get_knowledge_entry' && !step.evidenceIds[0]) return { status: 'denied' as const };
  const tool = input.registry.get(step.tool);
  if (!tool || tool.risk !== 'read') return { status: 'denied' as const };
  const lease = { sessionId, deviceId: session.deviceId, episodeId: checkpoint.state.episodeId, scopeKey: checkpoint.state.scopeKey, planVersion: checkpoint.state.planVersion, revision: input.revision };
  const callId = `call-${lease.planVersion}`;
  const reserved = store.applyPlannerToolEvent(owner, lease, { type: 'tool_started', id: `start-${callId}`, episodeId: lease.episodeId, stepKey: step.key, callId });
  const current = { ...lease, revision: reserved.revision, planVersion: reserved.checkpoint.state.planVersion };
  const { conditions: _conditions, ...scope } = checkpoint.state.scope;
  const args = step.tool === 'resolve_machine_scope' ? { query: context.routerInput.currentQuery, context: scope }
    : { entryId: step.evidenceIds[0] };
  const port = new PlannerToolPort(new ToolExecutor(input.registry), input.registry);
  const observation = await port.execute({ callId, stepId: step.id, tool: step.tool, args, lease: current, signal: input.signal,
    isCurrent: candidate => {
      try {
        const snapshot = store.plannerCheckpoint(owner, sessionId);
        return store.session(owner, sessionId).revision === candidate.revision && snapshot?.state.episodeId === candidate.episodeId && snapshot.state.planVersion === candidate.planVersion && snapshot.state.scopeKey === candidate.scopeKey;
      } catch { return false; }
    } });
  if (observation.outcome === 'stale') return { status: 'stale' as const };
  const event = plannerToolEvent(observation, step.key);
  if (event.type !== 'tool_finished') throw new TypeError('Expected tool result');
  const saved = store.applyPlannerToolEvent(owner, current, event);
  return { status: 'completed' as const, ...saved, next: advancePlan(saved.checkpoint.state, context).decision };
}

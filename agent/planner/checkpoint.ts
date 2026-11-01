import type { PlannerCheckpointPort } from './ports';
import type { PlannerState } from './types';

/**
 * Optimistic-lock failure for a planner checkpoint. The HTTP mapping is
 * intentionally the same 409 used by diagnosis memory: the caller must
 * reload and retry, never silently overwrite a newer plan.
 */
export class PlannerCheckpointConflictError extends Error {
  readonly status = 409;
  readonly code = 'planner_checkpoint_conflict';
  constructor(message = 'Planner checkpoint has changed; reload before resuming') {
    super(message);
    this.name = 'PlannerCheckpointConflictError';
  }
}

interface CheckpointEntry {
  state: PlannerState;
  memoryRevision: number;
}

function checkpointKey(context: { sessionId: string; deviceId: string; episodeId: string }): string {
  for (const [label, value] of Object.entries(context)) {
    if (typeof value !== 'string' || !value.trim() || value.length > 128) {
      throw new TypeError(`Invalid planner checkpoint ${label}`);
    }
  }
  return [context.sessionId, context.deviceId, context.episodeId].join('/');
}

/**
 * Minimal in-memory implementation of PlannerCheckpointPort.
 *
 * - `load` returns a cloned checkpoint, or undefined when there is none:
 *   the caller then starts a fresh plan instead of resuming.
 * - `compareAndSave` accepts a first save unconditionally, and afterwards
 *   requires both the expected plan version and the memory revision to
 *   match the stored checkpoint; otherwise it throws
 *   PlannerCheckpointConflictError (409) and leaves the stored checkpoint
 *   untouched.
 * - No diagnosis memory is read or written here, and no telemetry data is
 *   involved. Ownership must already have been checked by the host, which
 *   supplies sessionId/deviceId/episodeId; a model must never supply them.
 */
export class InMemoryPlannerCheckpointStore implements PlannerCheckpointPort {
  private readonly entries = new Map<string, CheckpointEntry>();

  async load(context: { sessionId: string; deviceId: string; episodeId: string }): Promise<PlannerState | undefined> {
    const entry = this.entries.get(checkpointKey(context));
    return entry ? structuredClone(entry.state) : undefined;
  }

  async compareAndSave(
    context: { sessionId: string; deviceId: string; episodeId: string; expectedPlanVersion: number; memoryRevision: number },
    state: PlannerState,
  ): Promise<void> {
    if (!Number.isInteger(context.expectedPlanVersion) || !Number.isInteger(context.memoryRevision)) {
      throw new TypeError('Invalid planner checkpoint version');
    }
    const key = checkpointKey({ sessionId: context.sessionId, deviceId: context.deviceId, episodeId: context.episodeId });
    const existing = this.entries.get(key);
    if (existing) {
      if (existing.state.planVersion !== context.expectedPlanVersion || existing.memoryRevision !== context.memoryRevision) {
        throw new PlannerCheckpointConflictError();
      }
    }
    this.entries.set(key, { state: structuredClone(state), memoryRevision: context.memoryRevision });
  }
}

/**
 * Resume helper: return the stored checkpoint when it exists and is not
 * terminal, otherwise the caller-supplied fallback plan. A terminal
 * checkpoint is never resumed; the caller must start a new plan.
 */
export async function resumePlannerCheckpoint(
  store: PlannerCheckpointPort,
  context: { sessionId: string; deviceId: string; episodeId: string },
  fallback: PlannerState,
): Promise<{ resumed: boolean; state: PlannerState }> {
  const stored = await store.load(context);
  if (!stored) return { resumed: false, state: fallback };
  if (['cancelled', 'escalated', 'resolved_reported', 'exhausted'].includes(stored.status)) {
    return { resumed: false, state: fallback };
  }
  return { resumed: true, state: stored };
}

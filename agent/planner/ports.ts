import type { DiagnosisRouterConfig, DiagnosisRouterInput } from '../../server/diagnosis/router';
import type { PlannerScope, PlannerState, PlannerEvent } from './types';

/** Reuse the host's retrieval. No repository, model, executor or database is invoked. */
export interface PlannerContext {
  routerInput: Omit<DiagnosisRouterInput, 'scope'> & { scope: PlannerScope };
  routerConfig?: Readonly<DiagnosisRouterConfig>;
}

/** Future host contracts only. Request-scoped ports bind ownership outside model/user data.
 * No implementation or chat integration in phase one. */
export interface PlannerCheckpointPort {
  load(context: { sessionId: string; deviceId: string; episodeId: string }): Promise<PlannerState | undefined>;
  /** Host must enforce ownership, expected version and atomic event idempotency. */
  compareAndSave(context: { sessionId: string; deviceId: string; episodeId: string; expectedPlanVersion: number; memoryRevision: number }, state: PlannerState): Promise<void>;
}
export interface PlannerObservationPort {
  /** Host supplies validated observations; a tool's ok flag is not a repair verification. */
  normalize(result: unknown): Extract<PlannerEvent, { type: 'observation' }>;
}

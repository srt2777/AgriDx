import type { CoordinationDecision, DiagnosticReply } from '../../shared/diagnosis';
import type { RetrievalContext } from '../../server/knowledge/scope';

/** Rules and observations supplied by a trusted host; never an HTTP request schema. */
export interface PlannerScope extends RetrievalContext { conditions?: readonly string[] }
export type ObservationValue = string | number | boolean | null;
export type ObservationSource = 'user_report' | 'tool_result' | 'simulated';
export type PlanStatus = 'active' | 'awaiting_user' | 'paused' | 'resolved_reported' | 'escalated' | 'cancelled' | 'exhausted';
export type StopReason = 'awaiting_feedback' | 'user_paused' | 'user_reported_resolved' | 'safety_restriction' | 'user_cancelled'
  | 'action_budget_exhausted' | 'no_progress' | 'no_evidence' | 'scope_changed' | 'scope_mismatch' | 'identity_required'
  | 'prerequisites_unmet' | 'plan_review_complete' | 'unsafe_step' | 'event_limit';
export interface EvidenceReference { entryId: string; sourceId: string; locator?: string }
export interface StepDefinition {
  key: string;
  title: string;
  /** Phase one can only request existing observations or propose reading evidence. */
  kind: 'ask_user' | 'review_evidence';
  dependsOn: readonly string[];
  preconditions: readonly { slot: string; equals: ObservationValue }[];
  expectedObservation: { slot: string; label: string; options?: readonly string[] };
  evidenceIds: readonly string[];
  /** Integer ranks, not calibrated fault probabilities. Higher value wins; lower cost wins. */
  discriminationValue: number;
  cost: number;
}
export interface PlanStep extends StepDefinition {
  id: string;
  scopeKey: string;
  status: 'pending' | 'awaiting_user' | 'reported' | 'observed' | 'invalidated';
}
export interface Observation {
  eventId: string;
  stepId: string;
  slot: string;
  value: ObservationValue;
  source: ObservationSource;
  /** Source provenance is never a verified repair assertion. */
  verification: 'unverified';
  scopeKey: string;
  basisKey: string;
  corrects?: string;
}
export interface PlannerBudget { maxActions: number; issuedActions: number; maxNoProgress: number; noProgress: number }
interface EventBase { id: string; episodeId: string }
export type PlannerEvent = EventBase & (
  | { type: 'observation'; stepKey: string; value: ObservationValue; source: ObservationSource; corrects?: string }
  | { type: 'scope_changed'; scope: PlannerScope }
  | { type: 'cancel' | 'pause' | 'resume' | 'resolved_reported' | 'continue' }
);
export interface PlannerAuditEvent {
  eventId: string;
  type: PlannerEvent['type'] | 'decision';
  from: PlanStatus;
  to: PlanStatus;
  reason?: StopReason;
  stepId?: string;
  evidenceIds: readonly string[];
}
export interface PlannerState {
  schemaVersion: 1;
  planId: string;
  episodeId: string;
  planVersion: number;
  scope: PlannerScope;
  scopeKey: string;
  status: PlanStatus;
  stopReason?: StopReason;
  steps: PlanStep[];
  evidence: EvidenceReference[];
  observations: Record<string, Observation>;
  /** Context-specific questions already issued, not a list of executed repairs. */
  askedKeys: string[];
  budget: PlannerBudget;
  /** Event signatures allow replay detection and reject same-ID/different-content collisions. */
  acceptedEvents: Record<string, string>;
  audit: PlannerAuditEvent[];
}
export interface CreatePlanInput {
  planId: string;
  episodeId: string;
  scope: PlannerScope;
  steps: readonly StepDefinition[];
  evidence?: readonly EvidenceReference[];
  budget?: { maxActions?: number; maxNoProgress?: number };
}
export interface PlannerAction {
  kind: StepDefinition['kind'];
  stepId: string;
  stepKey: string;
  observationSlot: string;
  /** Requests only observations already available, never a new physical operation. */
  text: string;
  evidenceIds: readonly string[];
}
export interface PlannerDecision {
  status: PlanStatus;
  reason?: StopReason;
  action?: PlannerAction;
  questions: DiagnosticReply['questions'];
  routing: CoordinationDecision;
  rationale: string[];
}
export interface PlannerResult { state: PlannerState; decision: PlannerDecision }

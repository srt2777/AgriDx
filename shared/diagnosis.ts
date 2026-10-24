/** Public diagnosis modes and decisions, without server initialization. */
export const DIAGNOSIS_MODES = ['auto', 'knowledge_only', 'ai_assisted'] as const;
export type DiagnosisMode = typeof DIAGNOSIS_MODES[number];
export type RouteReason = 'identity_conflict' | 'identity_required' | 'server_local_only' | 'invalid_config' | 'local_requested' | 'direct_reference' | 'llm_not_configured' | 'insufficient_evidence' | 'synthesis_requested' | 'ai_requested' | 'provider_unavailable' | 'llm_config_invalid' | 'high_risk_insufficient_evidence' | 'high_risk_restricted' | 'unknown_operation_risk' | 'knowledge_conflict' | 'output_rejected';
export type DiagnosticCoverageKey = 'symptom' | 'causes' | 'checks' | 'repair';
export type DiagnosticRiskLevel = 'low' | 'high' | 'unknown';
export type ReferenceVerification = 'verified' | 'pending' | 'unverified' | 'unspecified' | 'failed';
/** Explicit scope evidence, never an inferred vehicle interchangeability claim. */
export interface RetrievalBasis {
  tier: 'exact' | 'series' | 'component' | 'general';
  basis: string[];
  referenceOnly: boolean;
}
/** Only server-built, grounded facts enter the structured answer. */
export interface DiagnosticReply {
  understanding: string;
  topic?: string;
  supportLevel: 'manual' | 'general' | 'reference_only' | 'none';
  background?: { text: string; evidenceIds: string[] }[];
  causes: { text: string; evidenceIds: string[]; basis: 'source_candidate' | 'general_hypothesis' }[];
  suggestions: { text: string; kind: 'observe' | 'record' | 'professional'; evidenceIds: string[]; priority: number }[];
  questions: { text: string; options?: string[] }[];
  sourceNote: string;
  /** Guarded generated text remains explicitly separate from local facts. */
  aiSupplement?: string;
}
export interface DiagnosisCandidateAssessment {
  entryId?: string;
  sourceId?: string;
  relevance: { score: number | null; method: 'keyword-weighted-overlap' | 'unavailable'; calibrated: false; level: 'high' | 'medium' | 'low' | 'unknown' };
  coverage: Partial<Record<DiagnosticCoverageKey, boolean>>;
  coverageSufficient: boolean;
  modelMatch: 'exact' | 'compatible' | 'unknown' | 'conflict';
  referenceVerification: ReferenceVerification;
  /** Review of cited documents never implies a verified vehicle repair. */
  verificationBasis: 'document-review' | 'none';
  sourceIndexed: boolean;
  riskLevel: DiagnosticRiskLevel;
  directEligible: boolean;
  excluded: boolean;
  retrieval?: RetrievalBasis;
}
export interface CoordinationDecision {
  requestedMode: DiagnosisMode;
  effectiveMode: DiagnosisMode;
  route: 'local' | 'clarify' | 'ai' | 'safe';
  reason: RouteReason;
  evidenceLevel: 'none' | 'partial' | 'direct_reference';
  llmConfigured: boolean;
  /** Optional for backward-compatible responses produced before the router upgrade. */
  knowledgeIds?: string[];
  aiRequired?: boolean;
  riskLevel?: DiagnosticRiskLevel;
  requiredCoverage?: DiagnosticCoverageKey[];
  candidates?: DiagnosisCandidateAssessment[];
  directEligibleIds?: string[];
  referenceOnlyIds?: string[];
  excludedKnowledgeIds?: string[];
  retrievalOutcome?: 'no_manual' | 'no_results' | 'insufficient_evidence' | 'sufficient';
  /** Diagnostic codes only; no credentials or raw provider response. */
  outputIssues?: string[];
}
export function isDiagnosisMode(value: unknown): value is DiagnosisMode {
  return typeof value === 'string' && (DIAGNOSIS_MODES as readonly string[]).includes(value);
}

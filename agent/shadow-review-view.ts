import type { ShadowReviewRecord, ShadowReviewComparison, ShadowReviewToolResult } from './shadow-review';

/**
 * Internal shadow-review view (pure functions only).
 *
 * This module is NOT a page, NOT an HTTP route and NOT an authenticated
 * endpoint: it only converts an already-built ShadowReviewRecord into a
 * reviewable display item, and gates a human promotion decision. No record
 * is written to diagnosis memory here, and promotion is never automatic:
 * the caller must attest (via `verified`) that it has already checked the
 * proposal section 3.4 conditions — evidence verified, a manual page or
 * scope annotation present, and the case reproduced offline. This module
 * cannot verify those conditions itself; it only records the attestation
 * as a gate input, so a missing attestation is a rejection, not a guess.
 */

export const SHADOW_COMPARISON_LABELS: Record<ShadowReviewComparison, string> = {
  consistent: '一致',
  new_evidence: '补新证据',
  conflict: '冲突',
  high_risk: '高风险',
};

export interface ShadowReviewViewItem {
  sessionId: string;
  comparison: ShadowReviewComparison;
  comparisonLabel: string;
  /** Candidate evidence: ids the shadow run surfaced that the main path did not have. */
  candidateEvidenceIds: string[];
  plannerSteps: string[];
  toolResults: ShadowReviewToolResult[];
  safety: ShadowReviewRecord['safety'];
  mainRoute: string;
  mainReason?: string;
  durationMs: number;
  timedOut: boolean;
  reviewOnly: true;
}

export function toShadowReviewViewItem(record: ShadowReviewRecord): ShadowReviewViewItem {
  if (!record || record.reviewOnly !== true) throw new TypeError('Only review-only shadow records can be displayed');
  const main = new Set(record.evidenceIds);
  return {
    sessionId: record.sessionId,
    comparison: record.comparison,
    comparisonLabel: SHADOW_COMPARISON_LABELS[record.comparison],
    candidateEvidenceIds: record.shadowEvidenceIds.filter((id) => !main.has(id)),
    plannerSteps: [...record.plannerSteps],
    toolResults: record.toolResults.map((result) => ({ ...result })),
    safety: record.safety,
    mainRoute: record.mainRoute,
    ...(record.mainReason !== undefined ? { mainReason: record.mainReason } : {}),
    durationMs: record.durationMs,
    timedOut: record.timedOut,
    reviewOnly: true,
  };
}

export type PromotionRejectionReason = 'missing_reviewer' | 'not_new_evidence' | 'high_risk' | 'not_verified';

export type PromotionDecision =
  | { approved: true; sessionId: string; reviewer: string; candidateEvidenceIds: string[] }
  | { approved: false; reason: PromotionRejectionReason };

export function decideShadowPromotion(input: {
  record: ShadowReviewRecord;
  /** The human reviewer, explicitly named by the caller; never inferred. */
  reviewer: string;
  /** Caller attestation that proposal section 3.4 was checked (verified evidence, manual page or scope annotation, offline reproduction). */
  verified: boolean;
}): PromotionDecision {
  if (typeof input.reviewer !== 'string' || !input.reviewer.trim()) return { approved: false, reason: 'missing_reviewer' };
  // High risk is checked before the new-evidence check on purpose: a
  // high-risk record must be reported as high_risk, never silently as
  // "not a candidate" (its classification already beats new_evidence).
  if (input.record && (input.record.safety === 'high_risk' || input.record.comparison === 'high_risk')) return { approved: false, reason: 'high_risk' };
  if (!input.record || input.record.reviewOnly !== true || input.record.comparison !== 'new_evidence') return { approved: false, reason: 'not_new_evidence' };
  if (input.verified !== true) return { approved: false, reason: 'not_verified' };
  const view = toShadowReviewViewItem(input.record);
  return { approved: true, sessionId: input.record.sessionId, reviewer: input.reviewer.trim(), candidateEvidenceIds: view.candidateEvidenceIds };
}

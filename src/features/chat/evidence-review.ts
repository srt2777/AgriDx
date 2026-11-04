import type { ChatKnowledgeSource } from '../../../shared/chat';

/** Metadata checks only: no semantic entailment, scoring, model calls or authority upgrades. */
export function reviewEvidence(source: ChatKnowledgeSource) {
  const general = source.evidenceKind === 'general-knowledge' || source.entryType === '通识学习';
  const referenceOnly = source.usage === 'reference-only' || source.retrieval?.referenceOnly === true
    || source.evidenceKind === 'prompt' || (source.diagnosticEvidence === false && source.generalEvidence !== true);
  const provenance = source.referenceVerification === 'failed' ? 'failed'
    : general ? 'general'
    : source.referenceVerification === 'verified' && source.sourceIndexed === true ? 'verified' : 'pending';
  const scope = general ? 'general' : source.applicability === 'matched' ? 'matched' : 'pending';
  const location = general ? 'not-applicable' : source.pages?.pdf || source.pages?.printed || source.locator?.trim() ? 'present' : 'missing';
  const usage = referenceOnly ? 'reference-only' : source.usage ?? 'unknown';
  const needsReview = provenance === 'failed' || provenance === 'pending' || scope === 'pending' || location === 'missing' || usage === 'unknown';
  return { general, referenceOnly, provenance, scope, location, usage, needsReview } as const;
}
export type EvidenceReview = ReturnType<typeof reviewEvidence>;
export type EvidenceFilter = 'all' | 'needs-review' | 'general' | 'reference-only';
export function matchesEvidenceFilter(review: EvidenceReview, filter: EvidenceFilter) {
  return filter === 'all' || (filter === 'needs-review' ? review.needsReview : filter === 'general' ? review.general : review.referenceOnly);
}

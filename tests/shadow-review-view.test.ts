import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildShadowReviewRecord } from '../agent/shadow-review';
import { decideShadowPromotion, toShadowReviewViewItem } from '../agent/shadow-review-view';

const base = {
  sessionId: 'view-1',
  mainEvidenceIds: ['KB-001'],
  plannerSteps: ['0:resolve_machine_scope', '1:search_knowledge'],
  toolResults: [{ tool: 'search_knowledge', ok: true, error_type: null, duration_ms: 12, source: '混合资料' }],
  mainRoute: 'ai',
  durationMs: 120,
  timedOut: false,
  highRisk: false,
};

test('view item shows only shadow-only ids as candidate evidence', () => {
  const record = buildShadowReviewRecord({ ...base, shadowEvidenceIds: ['KB-001', 'KB-002'] });
  const view = toShadowReviewViewItem(record);
  assert.equal(view.comparison, 'new_evidence');
  assert.equal(view.comparisonLabel, '补新证据');
  assert.deepEqual(view.candidateEvidenceIds, ['KB-002']);
  assert.deepEqual(view.plannerSteps, ['0:resolve_machine_scope', '1:search_knowledge']);
  assert.equal(view.toolResults[0].tool, 'search_knowledge');
  assert.equal(view.safety, 'ok');
  assert.equal(view.reviewOnly, true);
  // The view is a copy: mutating it must not mutate the record.
  view.candidateEvidenceIds.push('KB-999');
  assert.deepEqual(toShadowReviewViewItem(record).candidateEvidenceIds, ['KB-002']);
});

test('view item labels all four comparisons and keeps the safety mark', () => {
  for (const [input, label, safety] of [
    [{ shadowEvidenceIds: [], highRisk: false, conflict: false }, '一致', 'ok'],
    [{ shadowEvidenceIds: ['KB-002'], highRisk: false, conflict: false }, '补新证据', 'ok'],
    [{ shadowEvidenceIds: [], highRisk: false, conflict: true }, '冲突', 'ok'],
    [{ shadowEvidenceIds: [], highRisk: true, conflict: false }, '高风险', 'high_risk'],
  ] as const) {
    const view = toShadowReviewViewItem(buildShadowReviewRecord({ ...base, ...input }));
    assert.equal(view.comparisonLabel, label);
    assert.equal(view.safety, safety);
  }
});

test('promotion gate approves only a named reviewer + new evidence + verified attestation', () => {
  const record = buildShadowReviewRecord({ ...base, shadowEvidenceIds: ['KB-002'] });
  const approved = decideShadowPromotion({ record, reviewer: 'reviewer-1', verified: true });
  assert.equal(approved.approved, true);
  if (approved.approved) {
    assert.equal(approved.sessionId, 'view-1');
    assert.equal(approved.reviewer, 'reviewer-1');
    assert.deepEqual(approved.candidateEvidenceIds, ['KB-002']);
  }
});

test('promotion gate rejects every missing or unsafe condition', () => {
  const fresh = buildShadowReviewRecord({ ...base, shadowEvidenceIds: ['KB-002'] });
  assert.deepEqual(decideShadowPromotion({ record: fresh, reviewer: '  ', verified: true }), { approved: false, reason: 'missing_reviewer' });
  assert.deepEqual(decideShadowPromotion({ record: fresh, reviewer: 'reviewer-1', verified: false }), { approved: false, reason: 'not_verified' });
  const consistent = buildShadowReviewRecord({ ...base, shadowEvidenceIds: ['KB-001'] });
  assert.deepEqual(decideShadowPromotion({ record: consistent, reviewer: 'reviewer-1', verified: true }), { approved: false, reason: 'not_new_evidence' });
  const conflict = buildShadowReviewRecord({ ...base, shadowEvidenceIds: ['KB-002'], conflict: true });
  assert.deepEqual(decideShadowPromotion({ record: conflict, reviewer: 'reviewer-1', verified: true }), { approved: false, reason: 'not_new_evidence' });
  const highRisk = buildShadowReviewRecord({ ...base, shadowEvidenceIds: ['KB-002'], highRisk: true });
  assert.deepEqual(decideShadowPromotion({ record: highRisk, reviewer: 'reviewer-1', verified: true }), { approved: false, reason: 'high_risk' });
  // Approval never writes anything: the gate returns a decision only.
  assert.equal('content' in (decideShadowPromotion({ record: fresh, reviewer: 'reviewer-1', verified: true })), false);
});

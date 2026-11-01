import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildShadowReviewRecord,
  classifyShadowComparison,
  InMemoryShadowReviewStore,
} from '../agent/shadow-review';

const base = {
  sessionId: 'session-1',
  mainEvidenceIds: ['KB-001'],
  plannerSteps: ['0:resolve_machine_scope', '1:search_knowledge'],
  toolResults: [{ tool: 'search_knowledge', ok: true, error_type: null, duration_ms: 12, source: '混合资料' }],
  mainRoute: 'ai',
  durationMs: 120,
  timedOut: false,
  highRisk: false,
};

test('shadow comparison has exactly four outcomes, with high risk winning', () => {
  assert.equal(classifyShadowComparison({ mainEvidenceIds: ['KB-001'], shadowEvidenceIds: [], highRisk: false, conflict: false }), 'consistent');
  assert.equal(classifyShadowComparison({ mainEvidenceIds: ['KB-001'], shadowEvidenceIds: ['KB-002'], highRisk: false, conflict: false }), 'new_evidence');
  assert.equal(classifyShadowComparison({ mainEvidenceIds: ['KB-001'], shadowEvidenceIds: ['KB-002'], highRisk: false, conflict: true }), 'conflict');
  assert.equal(classifyShadowComparison({ mainEvidenceIds: ['KB-001'], shadowEvidenceIds: ['KB-002'], highRisk: true, conflict: true }), 'high_risk');
});

test('a shadow review record is review-only and never carries answer content', () => {
  const record = buildShadowReviewRecord({ ...base, shadowEvidenceIds: ['KB-002'] });
  assert.equal(record.reviewOnly, true);
  assert.equal(record.comparison, 'new_evidence');
  assert.equal(record.safety, 'ok');
  assert.deepEqual(record.evidenceIds, ['KB-001']);
  assert.deepEqual(record.shadowEvidenceIds, ['KB-002']);
  // Only ids, steps and redacted tool summaries may appear; no answer text.
  assert.equal(JSON.stringify(record).includes('supported answer'), false);
});

test('a high-risk record is stored for audit but never a promotion candidate', () => {
  const store = new InMemoryShadowReviewStore();
  const highRisk = buildShadowReviewRecord({ ...base, sessionId: 'session-high', highRisk: true });
  const fresh = buildShadowReviewRecord({ ...base, sessionId: 'session-new', shadowEvidenceIds: ['KB-009'] });
  store.append(highRisk);
  store.append(fresh);
  assert.equal(store.list().length, 2);
  assert.deepEqual(store.candidatesForPromotion().map((record) => record.sessionId), ['session-new']);
  assert.equal(store.list('session-high')[0].comparison, 'high_risk');
});

test('the review store is separate from diagnosis memory: records are cloned', () => {
  const store = new InMemoryShadowReviewStore();
  const record = buildShadowReviewRecord(base);
  store.append(record);
  const listed = store.list()[0];
  (listed as unknown as { evidenceIds: string[] }).evidenceIds.push('KB-999');
  assert.deepEqual(store.list()[0].evidenceIds, ['KB-001']);
});

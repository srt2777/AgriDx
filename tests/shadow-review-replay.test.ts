import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildShadowReviewRecord,
  InMemoryShadowReviewStore,
  type ShadowReviewComparison,
} from '../agent/shadow-review';

/**
 * Offline replay cases for proposal section 5.1: ten distinct
 * (main evidence / shadow evidence / high-risk / conflict / timeout)
 * combinations, replayed through the real classifier and record builder.
 * No case writes to a user answer or to diagnosis memory: the only store
 * used here is the isolated InMemoryShadowReviewStore.
 */
const toolResults = [{ tool: 'search_knowledge', ok: true, error_type: null, duration_ms: 12, source: '混合资料' }];

interface ReplayCase {
  name: string;
  sessionId: string;
  mainEvidenceIds: string[];
  shadowEvidenceIds: string[];
  highRisk: boolean;
  conflict: boolean;
  timedOut: boolean;
  expected: ShadowReviewComparison;
}

const cases: ReplayCase[] = [
  { name: 'consistent: shadow repeats only main evidence', sessionId: 'replay-01', mainEvidenceIds: ['KB-001'], shadowEvidenceIds: ['KB-001'], highRisk: false, conflict: false, timedOut: false, expected: 'consistent' },
  { name: 'new evidence: shadow surfaces one extra id', sessionId: 'replay-02', mainEvidenceIds: ['KB-001'], shadowEvidenceIds: ['KB-001', 'KB-002'], highRisk: false, conflict: false, timedOut: false, expected: 'new_evidence' },
  { name: 'conflict: shadow flags an identity/evidence conflict', sessionId: 'replay-03', mainEvidenceIds: ['KB-001'], shadowEvidenceIds: ['KB-001'], highRisk: false, conflict: true, timedOut: false, expected: 'conflict' },
  { name: 'high risk: main path already flagged high risk', sessionId: 'replay-04', mainEvidenceIds: ['KB-001'], shadowEvidenceIds: ['KB-001'], highRisk: true, conflict: false, timedOut: false, expected: 'high_risk' },
  { name: 'high risk wins over conflict and new evidence', sessionId: 'replay-05', mainEvidenceIds: ['KB-001'], shadowEvidenceIds: ['KB-002'], highRisk: true, conflict: true, timedOut: false, expected: 'high_risk' },
  { name: 'conflict wins over new evidence', sessionId: 'replay-06', mainEvidenceIds: ['KB-001'], shadowEvidenceIds: ['KB-002'], highRisk: false, conflict: true, timedOut: false, expected: 'conflict' },
  { name: 'empty shadow evidence is honest, not a guess', sessionId: 'replay-07', mainEvidenceIds: ['KB-001'], shadowEvidenceIds: [], highRisk: false, conflict: false, timedOut: false, expected: 'consistent' },
  { name: 'timed out run can still surface new evidence', sessionId: 'replay-08', mainEvidenceIds: ['KB-001'], shadowEvidenceIds: ['KB-003'], highRisk: false, conflict: false, timedOut: true, expected: 'new_evidence' },
  { name: 'timed out run with a conflict stays a conflict', sessionId: 'replay-09', mainEvidenceIds: ['KB-001', 'KB-004'], shadowEvidenceIds: ['KB-004'], highRisk: false, conflict: true, timedOut: true, expected: 'conflict' },
  { name: 'empty main evidence with a shadow id is new evidence', sessionId: 'replay-10', mainEvidenceIds: [], shadowEvidenceIds: ['KB-010'], highRisk: false, conflict: false, timedOut: false, expected: 'new_evidence' },
];

for (const replayCase of cases) {
  test(`offline replay: ${replayCase.name}`, () => {
    const record = buildShadowReviewRecord({
      sessionId: replayCase.sessionId,
      mainEvidenceIds: replayCase.mainEvidenceIds,
      shadowEvidenceIds: replayCase.shadowEvidenceIds,
      plannerSteps: ['0:resolve_machine_scope', '1:search_knowledge'],
      toolResults,
      mainRoute: 'ai',
      durationMs: 120,
      timedOut: replayCase.timedOut,
      highRisk: replayCase.highRisk,
      conflict: replayCase.conflict,
    });
    assert.equal(record.comparison, replayCase.expected);
    assert.equal(record.reviewOnly, true);
    assert.equal(record.timedOut, replayCase.timedOut);
    assert.equal(record.safety, replayCase.expected === 'high_risk' ? 'high_risk' : 'ok');
    assert.deepEqual(record.evidenceIds, replayCase.mainEvidenceIds);
    assert.deepEqual(record.shadowEvidenceIds, replayCase.shadowEvidenceIds);
    // A review record carries ids, steps and redacted tool summaries only:
    // no answer body, no diagnosis-memory field, no content field.
    assert.equal('content' in record, false);
    assert.equal('answer' in record, false);
    assert.equal(JSON.stringify(record).includes('supported answer'), false);
  });
}

test('offline replay: the promotion queue contains only new_evidence cases', () => {
  const store = new InMemoryShadowReviewStore();
  for (const replayCase of cases) {
    store.append(buildShadowReviewRecord({
      sessionId: replayCase.sessionId,
      mainEvidenceIds: replayCase.mainEvidenceIds,
      shadowEvidenceIds: replayCase.shadowEvidenceIds,
      plannerSteps: ['0:resolve_machine_scope'],
      toolResults,
      mainRoute: 'ai',
      durationMs: 120,
      timedOut: replayCase.timedOut,
      highRisk: replayCase.highRisk,
      conflict: replayCase.conflict,
    }));
  }
  assert.equal(store.list().length, 10);
  assert.deepEqual(
    store.candidatesForPromotion().map((record) => record.sessionId),
    ['replay-02', 'replay-08', 'replay-10'],
  );
  // Every stored record is review-only, and the store is the only place
  // these records live in this test: nothing was written to diagnosis memory.
  assert.ok(store.list().every((record) => record.reviewOnly === true));
  assert.ok(store.list().every((record) => record.comparison !== 'high_risk' || !store.candidatesForPromotion().includes(record)));
});

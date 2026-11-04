import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reviewEvidence, matchesEvidenceFilter } from '../src/features/chat/evidence-review';
import type { ChatKnowledgeSource } from '../shared/chat';
const base: ChatKnowledgeSource = {source:'Manual',heading:'Inspection',evidenceKind:'archive',referenceVerification:'verified',sourceIndexed:true,applicability:'matched',usage:'answer-evidence',pages:{pdf:'12'}};
test('complete metadata has separate checks and never a probability or diagnosis verdict', () => {
  const before=structuredClone(base), review=reviewEvidence(base);
  assert.equal(review.needsReview,false); assert.equal(review.provenance,'verified'); assert.equal(review.scope,'matched'); assert.equal(review.location,'present'); assert.equal(review.usage,'answer-evidence'); assert.deepEqual(base,before);
  assert.equal('score' in review,false); assert.equal('diagnosis' in review,false);
});
test('indexing or a reviewed label alone cannot satisfy provenance', () => {
  assert.equal(reviewEvidence({...base,referenceVerification:undefined}).provenance,'pending');
  assert.equal(reviewEvidence({...base,sourceIndexed:undefined}).provenance,'pending');
  assert.equal(reviewEvidence({...base,referenceVerification:'failed'}).provenance,'failed');
});
test('missing scope, locator or usage stays unresolved even with other complete fields', () => {
  for (const source of [{...base,applicability:undefined},{...base,pages:undefined},{...base,usage:undefined}]) assert.equal(reviewEvidence(source).needsReview,true);
  assert.equal(reviewEvidence({source:'Legacy',heading:'Old answer'}).needsReview,true);
  assert.equal(reviewEvidence({...base,pages:undefined,locator:'  '}).location,'missing');
});
test('general evidence does not invent manual pages or model applicability', () => {
  const review=reviewEvidence({...base,evidenceKind:'general-knowledge',generalEvidence:true,diagnosticEvidence:false,pages:undefined});
  assert.equal(review.provenance,'general'); assert.equal(review.scope,'general'); assert.equal(review.location,'not-applicable'); assert.equal(review.referenceOnly,false);
  assert.equal(reviewEvidence({...base,evidenceKind:'general-knowledge',referenceVerification:'failed'}).needsReview,true);
});
test('reference restrictions dominate contradictory answer-evidence labels', () => {
  for(const source of [{...base,usage:'reference-only' as const},{...base,diagnosticEvidence:false as const},{...base,evidenceKind:'prompt' as const},{...base,retrieval:{tier:'exact' as const,basis:[],referenceOnly:true}}]) {
    assert.equal(reviewEvidence(source).referenceOnly,true); assert.equal(reviewEvidence(source).usage,'reference-only');
  }
});
test('filters retain original entries and allow overlapping review/general/reference groups', () => {
  const review=reviewEvidence({source:'General',heading:'Reference',entryType:'通识学习',usage:'reference-only',referenceVerification:'failed'});
  for(const filter of ['all','needs-review','general','reference-only'] as const) assert.equal(matchesEvidenceFilter(review,filter),true);
  assert.equal(matchesEvidenceFilter(reviewEvidence(base),'needs-review'),false);
  assert.equal(matchesEvidenceFilter(reviewEvidence(base),'general'),false);
});

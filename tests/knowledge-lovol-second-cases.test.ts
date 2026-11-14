import assert from 'node:assert/strict';
import { test } from 'node:test';
import { retrieve } from '../server/knowledge/retriever';
import { referenceVerification } from '../server/knowledge/evidence';
import { loadKnowledgeSnapshot } from '../server/knowledge/snapshot';

test('second batch retains real test reports and excludes wrong models', () => {
  const snapshot = loadKnowledgeSnapshot();
  const sourceIds = new Set([
    'SRC-LV-CN-M1204-B-NJJC20180806-AK', 'SRC-LV-CN-M804-B-W201401123-II',
    'SRC-LV-CN-M704-3A-NJJC2021040903', 'SRC-LV-CN-M804-2V-NJJC2021010903',
    'SRC-LV-CN-M504-E-W201401122-II', 'SRC-LV-CN-M754-B-W2010-293-II',
    'SRC-LV-CN-M2204-R-YC2017-143',
  ]);
  const chunks = snapshot.chunks.filter(c => sourceIds.has(c.sourceId ?? ''));
  assert.equal(chunks.length, 41);
  for (const chunk of chunks) {
    assert.ok(!snapshot.manualSourceIds.includes(chunk.sourceId!));
    assert.equal(referenceVerification(chunk.status), 'verified');
    assert.ok(retrieve(chunk.heading, 5, { brand: '雷沃', model: chunk.model }).some(c => c.entryId === chunk.entryId), chunk.entryId);
    const wrong = chunk.model === 'M1204-B' ? 'M804-B' : 'M1204-B';
    assert.ok(!retrieve(chunk.heading, 20, { brand: '雷沃', model: wrong }).some(c => c.entryId === chunk.entryId), chunk.entryId);
  }
});

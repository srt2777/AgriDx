import assert from 'node:assert/strict';
import { test } from 'node:test';
import { retrieve } from '../server/knowledge/retriever';
import { referenceVerification } from '../server/knowledge/evidence';
import { loadKnowledgeSnapshot } from '../server/knowledge/snapshot';

test('Benye manual entries keep original models, source and unknown edition boundaries', () => {
  const snapshot = loadKnowledgeSnapshot();
  const source = 'SRC-BENYE-CN-G4-202211';
  const chunks = snapshot.chunks.filter(c => c.sourceId === source);
  assert.equal(chunks.length, 53);
  assert.ok(snapshot.manualSourceIds.includes(source));
  for (const chunk of chunks) {
    assert.equal(referenceVerification(chunk.status), 'verified');
    const model = chunk.models?.[0];
    assert.ok(model);
    assert.ok(retrieve(chunk.heading, 5, { brand: '奔野', model }).some(c => c.entryId === chunk.entryId), chunk.entryId);
    assert.ok(!retrieve(chunk.heading, 20, { brand: '东风', model }).some(c => c.entryId === chunk.entryId), chunk.entryId);
  }
  for (const base of ['504', '704', '804', '904']) {
    const query = `奔野${base}(G4A) 农具升不起`;
    assert.ok(!retrieve(query, 20).some(c => c.sourceId === source), query);
  }
});

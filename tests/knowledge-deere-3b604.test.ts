import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildContextRegistry } from '../agent/context-tools';
import { ToolExecutor } from '../agent/tools';
import { referenceVerification } from '../server/knowledge/evidence';
import { retrieve } from '../server/knowledge/retriever';
import { loadKnowledgeSnapshot } from '../server/knowledge/snapshot';

test('3B-604 manual topics resolve to their source and exclude 3B-554', async () => {
  const snapshot = loadKnowledgeSnapshot();
  const chunks = snapshot.chunks.filter(c => c.sourceId === 'SRC-JD-3B604-OMSU37974-I8-CN');
  assert.equal(chunks.length, 14);
  const executor = new ToolExecutor(buildContextRegistry());
  for (const chunk of chunks) {
    assert.equal(referenceVerification(chunk.status), 'verified');
    assert.equal(retrieve(chunk.heading, 5, { brand: '约翰迪尔', model: '3B-604' })[0].entryId, chunk.entryId);
    assert.ok(!retrieve(chunk.heading, 20, { brand: '约翰迪尔', model: '3B-554' }).some(c => c.entryId === chunk.entryId));
    const result = await executor.execute('get_knowledge_entry', { entryId: chunk.entryId });
    assert.equal(result.ok, true);
    const detail = JSON.parse(result.content);
    assert.equal(detail.sourceId, 'SRC-JD-3B604-OMSU37974-I8-CN');
    assert.match(detail.content, /techinfo-omview/);
  }
});

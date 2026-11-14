import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildContextRegistry } from '../agent/context-tools';
import { ToolExecutor } from '../agent/tools';
import { loadKnowledgeSnapshot } from '../server/knowledge/snapshot';
import { retrieve } from '../server/knowledge/retriever';

const id = 'KB-JD-7M2204-OMRE578526-K5-CN-001';
const symptom = '整个液压系统不工作时检查供油和吸网';

test('one manual entry supports general reference and exact-model retrieval with its source scope', async () => {
  loadKnowledgeSnapshot();
  const general = retrieve(symptom, 30).find(chunk => chunk.entryId === id);
  assert.ok(general);
  assert.equal(general.applicability, 'pending');
  assert.equal(general.retrieval?.referenceOnly, true);
  assert.match(general.retrieval!.basis.join(' '), /机型专用资料可作为通用排查参考/);
  assert.match(general.scopeBoundary!, /004001/);

  const specific = retrieve(symptom, 10, { brand: '约翰迪尔', model: '7M-2204' }).find(chunk => chunk.entryId === id);
  assert.ok(specific);
  assert.equal(specific.applicability, 'matched');
  assert.ok(!retrieve(symptom, 30, { brand: '约翰迪尔', model: '6M-2104(G4)' }).some(chunk => chunk.entryId === id));

  const executor = new ToolExecutor(buildContextRegistry());
  for (const context of [{}, { brand: '约翰迪尔', model: '7M-2204' }]) {
    const result = await executor.execute('search_knowledge', { query: symptom, context, limit: 5 });
    assert.equal(result.ok, true);
    assert.ok(JSON.parse(result.content).chunks.some((chunk: { entryId: string }) => chunk.entryId === id));
  }
  const response = await executor.execute('get_knowledge_entry', { entryId: id });
  assert.equal(response.ok, true);
  const detail = JSON.parse(response.content);
  assert.equal(detail.sourceId, 'SRC-JD-7M2204-OMRE578526-K5-CN');
  assert.match(detail.content, /第294页/);
  assert.match(detail.content, /004001/);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildContextRegistry } from '../agent/context-tools';
import { ToolExecutor } from '../agent/tools';
import { retrieve } from '../server/knowledge/retriever';
import { loadKnowledgeSnapshot } from '../server/knowledge/snapshot';

test('6J manual symptom is retrievable for its four specified models and excludes a different 6M', async () => {
  loadKnowledgeSnapshot();
  const id = 'KB-JD-6J-OMAL221437-B7-CN-004';
  const query = '发动机过热时区分冷却液、风扇皮带和冷却器积灰';
  for (const model of ['JD1654', 'JD1854', 'JD2054', 'JD2104']) {
    assert.equal(retrieve(query, 6, { brand: '约翰迪尔', model })[0].entryId, id);
  }
  assert.ok(!retrieve(query, 30, { brand: '约翰迪尔', model: '6M-2104(G4)' }).some(chunk => chunk.entryId === id));
  const executor = new ToolExecutor(buildContextRegistry());
  const result = await executor.execute('get_knowledge_entry', { entryId: id });
  assert.equal(result.ok, true);
  const entry = JSON.parse(result.content);
  assert.equal(entry.sourceId, 'SRC-JD-6J-OMAL221437-B7-CN');
  assert.match(entry.content, /第156页/);
});

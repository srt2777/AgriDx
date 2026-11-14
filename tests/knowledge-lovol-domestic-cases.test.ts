import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildContextRegistry } from '../agent/context-tools';
import { ToolExecutor } from '../agent/tools';
import { referenceVerification } from '../server/knowledge/evidence';
import { retrieve } from '../server/knowledge/retriever';
import { loadKnowledgeSnapshot } from '../server/knowledge/snapshot';

test('Lovol real trial records stay scoped to the model and identified as reports', async () => {
  const snapshot = loadKnowledgeSnapshot();
  const id = 'KB-LV-CN-M1004-B-YC2017-009-S1R3';
  const sourceId = 'SRC-LV-CN-M1004-B-YC2017-009';
  const result = retrieve('M1004-B 液压油面过低导致提升缓慢', 5, { brand: '雷沃', model: 'M1004-B' });
  assert.equal(result[0].entryId, id);
  assert.equal(referenceVerification(result[0].status), 'verified');
  assert.ok(!snapshot.manualSourceIds.includes(sourceId));
  assert.ok(!retrieve('液压油面过低导致提升缓慢', 20, { brand: '雷沃', model: 'M1404-5X' }).some(c => c.entryId === id));
  const response = await new ToolExecutor(buildContextRegistry()).execute('get_knowledge_entry', { entryId: id });
  assert.equal(response.ok, true);
  const detail = JSON.parse(response.content);
  assert.equal(detail.sourceId, sourceId);
  assert.match(detail.content, /试验/);
  assert.match(detail.content, /油面/);
});

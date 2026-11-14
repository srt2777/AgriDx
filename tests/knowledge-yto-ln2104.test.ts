import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildContextRegistry } from '../agent/context-tools';
import { ToolExecutor } from '../agent/tools';
import { loadKnowledgeSnapshot } from '../server/knowledge/snapshot';
import { retrieve } from '../server/knowledge/retriever';

test('LN2104 hydraulic troubleshooting remains tied to its manual and excludes different models', async () => {
  loadKnowledgeSnapshot();
  const id = 'KB-YTO-LN2104-OM2018-032';
  const query = '农具不能提升时区分回油阀卡滞与吸油不足';
  const matched = retrieve(query, 8, { brand: '东方红', model: 'LN2104' });
  assert.equal(matched[0].entryId, id);
  assert.match(matched[0].text, /回油阀/);
  for (const model of ['LN2204', 'LY2104', 'LX2104']) {
    assert.ok(!retrieve(query, 20, { brand: '东方红', model }).some(chunk => chunk.entryId === id));
  }
  const executor = new ToolExecutor(buildContextRegistry());
  const response = await executor.execute('get_knowledge_entry', { entryId: id });
  assert.equal(response.ok, true);
  const detail = JSON.parse(response.content);
  assert.equal(detail.sourceId, 'SRC-YTO-LN2104-OM2018');
  assert.match(detail.content, /第68页/);
});

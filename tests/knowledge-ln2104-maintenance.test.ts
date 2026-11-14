import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildContextRegistry } from '../agent/context-tools';
import { ToolExecutor } from '../agent/tools';
import { loadKnowledgeSnapshot } from '../server/knowledge/snapshot';
import { retrieve } from '../server/knowledge/retriever';

test('LN2104 heater-valve reference preserves the manual illustration conflict', async () => {
  loadKnowledgeSnapshot();
  const id = 'KB-YTO-LN2104-OM2018-050';
  const query = '寒冷时驾驶室暖风不足先查冷却液水阀';
  assert.equal(retrieve(query, 5, { brand: '东方红', model: 'LN2104' })[0].entryId, id);
  assert.ok(!retrieve(query, 20, { brand: '东方红', model: 'LX2104' }).some(chunk => chunk.entryId === id));
  const response = await new ToolExecutor(buildContextRegistry()).execute('get_knowledge_entry', { entryId: id });
  assert.equal(response.ok, true);
  const detail = JSON.parse(response.content);
  assert.equal(detail.sourceId, 'SRC-YTO-LN2104-OM2018');
  assert.match(detail.content, /图 4-17/);
  assert.match(detail.content, /正文另将“竖直”写成关闭/);
});

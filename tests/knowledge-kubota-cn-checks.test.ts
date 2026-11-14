import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildContextRegistry } from '../agent/context-tools';
import { ToolExecutor } from '../agent/tools';
import { retrieve } from '../server/knowledge/retriever';
import { loadKnowledgeSnapshot } from '../server/knowledge/snapshot';

test('M954 and M954K retain their distinct manufacturer brake-pedal specifications', async () => {
  loadKnowledgeSnapshot();
  const baseId = 'KB-KB-MC-M704-M954-143E571B0468-001';
  const kId = 'KB-KB-MC-M854K-77F37D3D3D0C-009';
  const base = retrieve('基础型704和954踏板游隙按不同图检查', 10, { brand: '久保田', model: 'M954' });
  const k = retrieve('检查清单中旧款制动踏板A游隙范围', 10, { brand: '久保田', model: 'M954K' });
  assert.equal(base[0].entryId, baseId);
  assert.equal(k[0].entryId, kId);
  assert.ok(!base.some(chunk => chunk.entryId === kId));
  assert.ok(!k.some(chunk => chunk.entryId === baseId));
  assert.match(base[0].text, /7–14 mm/);
  assert.match(k[0].text, /40–45 mm/);
  const executor = new ToolExecutor(buildContextRegistry());
  const result = await executor.execute('get_knowledge_entry', { entryId: baseId });
  assert.equal(result.ok, true);
  const entry = JSON.parse(result.content);
  assert.equal(entry.sourceId, 'SRC-KB-MC-M704-M954-143E571B0468');
  assert.match(entry.content, /规格表第7项/);
});

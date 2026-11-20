import assert from 'node:assert/strict';
import test from 'node:test';
import { buildContextRegistry } from '../agent/context-tools';
import { ToolExecutor } from '../agent/tools';
import { loadKnowledgeBase } from '../server/knowledge/retriever';

test('东风 G2-6 同册两张悬挂运动表仅在对应的两个型号下引用', async () => {
  loadKnowledgeBase();
  const agent = new ToolExecutor(buildContextRegistry());
  const query = '检修三点悬挂要核对提升杆的长度和提升行程。手册给出的尺寸是多少？';
  const sourceId = 'SRC-DONGFENG-DF254-DF404-G2-6-EN';
  const cases = [
    { models: ['DF254G2-6', 'DF304G2-6'], suffix: '045', page: '印刷第55、56页', length: '411 mm', lift: '468 mm', other: '046' },
    { models: ['DF354G2-6', 'DF404G2-6'], suffix: '046', page: '印刷第57页', length: '550 mm', lift: '544 mm', other: '045' },
  ];
  for (const { models, suffix, page, length, lift, other } of cases) {
    for (const model of models) {
      const result = await agent.execute('search_knowledge', { query, context: { brand: '东风', model }, limit: 5 });
      assert.ok(result.ok, result.content);
      const {chunks} = JSON.parse(result.content) as {
        chunks: { entryId: string; sourceId: string; text: string; locator: string }[];
      };
      const expected = 'KB-DONGFENG-DF254-DF404-G2-6-EN-SUP-';
      assert.equal(chunks[0]?.entryId, expected + suffix);
      assert.equal(chunks[0].sourceId, sourceId);
      assert.ok(chunks[0].locator.includes(page));
      assert.ok(chunks[0].text.includes(length) && chunks[0].text.includes(lift));
      assert.ok(chunks.every(chunk => chunk.entryId !== expected + other));
    }
  }
});

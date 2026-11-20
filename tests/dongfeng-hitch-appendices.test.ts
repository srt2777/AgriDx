import assert from 'node:assert/strict';
import test from 'node:test';
import { buildContextRegistry } from '../agent/context-tools';
import { parseDiagnosticRequest } from '../server/diagnosis/request';
import { createDiagnosticService } from '../server/diagnosis/service';
import { ToolExecutor } from '../agent/tools';
import { loadKnowledgeBase } from '../server/knowledge/retriever';

test('东风 G2-6 同册两张悬挂运动表仅在对应的两个型号下引用', async () => {
  loadKnowledgeBase();
  const agent = new ToolExecutor(buildContextRegistry());
  const query = '检修三点悬挂要核对提升杆的长度和提升行程。手册给出的尺寸是多少？';
  const diagnose = createDiagnosticService({ hasAnyConfigured: () => false, chat: async () => { throw Error('test requires local mode'); } });
  const lookup = (model: string, question: string, brand = '东风') => diagnose(parseDiagnosticRequest({
    diagnosisMode: 'knowledge_only', machineType: '拖拉机', brand, model,
    messages: [{role: 'user', content: [brand, model, question].join(' ')}],
  }));
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
      const reply = (await lookup(model, query)).diagnosticReply;
      assert.ok(reply?.understanding.includes(length) && reply.understanding.includes(lift), model);
      assert.ok(reply.sourceNote.includes(page) && reply.sourceNote.includes('本附录仅适用于'));
      assert.ok(chunks[0].locator.includes(page));
      assert.ok(chunks[0].text.includes(length) && chunks[0].text.includes(lift));
      assert.ok(chunks.every(chunk => chunk.entryId !== expected + other));
    }
  }
  const oil = '测机油前，发动机应该停多长时间？';
  const answer = (await lookup('DF504', oil)).diagnosticReply;
  assert.ok(answer?.understanding.includes('15 分钟'));
  assert.ok(answer.sourceNote.includes('印刷第51、52页'));
  const wrongBrand = (await lookup('DF504', oil, '东方红')).diagnosticReply;
  assert.ok(wrongBrand && !wrongBrand.understanding.includes('15 分钟'));
});

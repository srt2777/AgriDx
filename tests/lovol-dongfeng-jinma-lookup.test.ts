import assert from 'node:assert/strict';
import test from 'node:test';
import { ToolExecutor } from '../agent/tools';
import { buildContextRegistry } from '../agent/context-tools';
import { createDiagnosticService } from '../server/diagnosis/service';
import { parseDiagnosticRequest } from '../server/diagnosis/request';
import { loadKnowledgeBase } from '../server/knowledge/retriever';

test('驱动型式、制动型式及停机测油条件按手册匹配', async () => {
  loadKnowledgeBase();
  const agent = new ToolExecutor(buildContextRegistry());
  async function search(brand: string, model: string, query: string) {
    const result = await agent.execute('search_knowledge', { query, context: { brand, model }, limit: 5 });
    assert.ok(result.ok, result.content);
    return (JSON.parse(result.content) as {chunks: {entryId: string; text: string}[]}).chunks;
  }
  const td = 'KB-LOVOL-TD-TL2-SM-02-EN-';
  const zb = 'KB-DONGFENG-ZB25-ZB35-ZB45-EN-';
  for (const [model, expected, other, toe, pressure] of [
    ['TD900', 'SUP-001', 'SUP-002', '5–10 mm', '200–250 kPa'],
    ['TD904', 'SUP-002', 'SUP-001', '0–5 mm', '150–180 kPa']
  ]) {
    const hits = await search('雷沃', model, '前轮前束和标准轮胎气压应该是多少？');
    assert.equal(hits[0].entryId, td + expected);
    assert.ok(hits[0].text.includes(toe) && hits[0].text.includes(pressure));
    assert.ok(hits.every(row => row.entryId !== td + other));
  }
  for (const model of ['ZB25', 'ZB35', 'ZB45']) {
    const brakes = await search('东风', model, '装鼓式制动时制动力不足，检查什么？');
    assert.equal(brakes.some(row => row.entryId === zb + '019'), model === 'ZB25');
    const oil = await search('东风', model, '发动机机油液位何时测量及换油时机？');
    assert.equal(oil[0].entryId, zb + 'SUP-001');
    assert.ok(oil[0].text.includes('至少 5 分钟'));
  }
  const jinma = await search('黄海金马', 'HHJM-164Y', '发动机起动困难时如何检查燃油、压缩和蓄电池？');
  assert.equal(jinma[0].entryId, 'KB-JINMA-HHJM-164Y-OM-EN-001');
  for (const part of ['燃油管', '气门', '蓄电池']) assert.ok(jinma[0].text.includes(part));
});

test('安全路由允许查阅对应车型静态胎压表，故障与调压操作继续交由安全流程', async () => {
  const diagnose = createDiagnosticService({ hasAnyConfigured: () => false, chat: async () => { throw Error('local test'); } });
  const lookup = (brand: string, model: string, question: string) => diagnose(parseDiagnosticRequest({
    diagnosisMode: 'knowledge_only', machineType: '拖拉机', brand, model,
    messages: [{role: 'user', content: [brand, model, question].join(' ')}],
  }));
  for (const [brand, model, query, terms] of [
    ['雷沃', 'TD900', '前轮前束和标准轮胎气压应该是多少？', ['5–10 mm', '200–250 kPa', '第124页']],
    ['雷沃', 'TD904', '前轮前束和标准轮胎气压应该是多少？', ['0–5 mm', '150–180 kPa', '第124页']],
    ['东方红', 'YTO-504', '运输和田间作业，前后轮胎压力分别是多少？', ['147–196 kPa', '98–118 kPa', '第10页']],
    ['东风', 'ZB35', '发动机机油液位何时测量及换油时机？', ['至少 5 分钟', '7-5']],
  ] as const) {
    const result = await lookup(brand, model, query);
    const reply = result.diagnosticReply!;
    const answer = reply.understanding + reply.sourceNote;
    for (const term of terms) assert.ok(answer.includes(term), model + ' ' + term + ' ' + answer);
    if (result.coordination?.route === 'safe') assert.ok(reply.suggestions.some(item => item.kind === 'professional'));
  }
  for (const [brand, question] of [['雷沃','刹车失灵，怎么调压？前轮前束和标准轮胎气压应该是多少？'], ['东风','前轮前束和标准轮胎气压应该是多少？']]) {
    const reply = (await lookup(brand, 'TD900', question)).diagnosticReply!;
    assert.ok(!reply.understanding.includes('200–250 kPa'));
  }
});

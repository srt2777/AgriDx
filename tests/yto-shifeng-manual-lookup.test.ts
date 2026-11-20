import assert from 'node:assert/strict';
import test from 'node:test';
import { ToolExecutor } from '../agent/tools';
import { buildContextRegistry } from '../agent/context-tools';
import { loadKnowledgeBase } from '../server/knowledge/retriever';

test('东方红液压表跨页同症状只检索一条，胎压区分运输与田间', async () => {
  loadKnowledgeBase();
  const agent = new ToolExecutor(buildContextRegistry());
  const lookup = async (brand: string, model: string, query: string) => {
    const result = await agent.execute('search_knowledge', { query, context: { brand, model }, limit: 5 });
    assert.ok(result.ok, result.content);
    return (JSON.parse(result.content) as { chunks: { entryId: string; locator: string; text: string }[] }).chunks;
  };
  const pressure = '运输和田间作业，前后轮胎压力分别是多少？';
  const id = 'KB-YTO-454-MF504-OM-RU-';
  for (const model of ['YTO-454','YTO-MF454','YTO-504','YTO-MF504']) {
    const [tyre] = await lookup('东方红', model, pressure);
    assert.equal(tyre.entryId, id + 'SUP-001');
    for (const term of ['147–196 kPa','98–118 kPa','8.3-20','12.4-28']) assert.ok(tyre.text.includes(term), term);
    const hits = await lookup('东方红', model, '液压悬挂轻载重载都不能提升时，吸油、操纵连杆和阀要检查哪里？');
    assert.equal(hits[0].entryId, id + '017');
    assert.match(hits[0].locator, /第56至57页/);
    assert.ok(hits[0].text.includes('进油滤网') && hits[0].text.includes('开口销'));
    assert.ok(hits.every(row => row.entryId !== id + '018'));
  }
  for (const [brand, model] of [['东风','YTO-504'],['东方红','LX954'],['时风','SF244']]) {
    assert.ok((await lookup(brand, model, pressure)).every(row => !row.entryId?.startsWith(id)));
  }
});

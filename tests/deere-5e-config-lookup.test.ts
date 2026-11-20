import assert from 'node:assert/strict';
import test from 'node:test';
import { ToolExecutor } from '../agent/tools';
import { buildContextRegistry } from '../agent/context-tools';
import { loadKnowledgeBase } from '../server/knowledge/retriever';

test('同样是液体配重轮胎，宁波迪尔与东风分别按其原件定位气门', async () => {
  loadKnowledgeBase();
  const agent = new ToolExecutor(buildContextRegistry());
  async function find(brand: string, model: string, query: string) {
    const r = await agent.execute('search_knowledge', { query, context: {brand, model}, limit: 5 });
    assert.ok(r.ok, r.content);
    return (JSON.parse(r.content) as {chunks: {entryId:string; text:string; locator:string}[]}).chunks;
  }
  const deere = 'KB-JD-5E-OMSU55602-G9-MT-0106DD76';
  const dongfeng = 'KB-DONGFENG-ZB25-ZB35-ZB45-EN-SUP-012';
  const valve = '液体配重轮胎测量胎压时，气门应该在什么位置？';
  for (const [brand, model, expected, other, position] of [
    ['约翰迪尔','5E-904',deere,dongfeng,'底部'], ['东风','ZB35',dongfeng,deere,'最高点']
  ]) {
    const hits = await find(brand, model, valve);
    assert.ok(hits.some(h => h.entryId === expected && h.text.includes(position)), model);
    assert.ok(hits.every(h => h.entryId !== other), model);
  }
  const id = 'KB-JD-5E-OMSU55602-G9-CN-CK-840FEA8F';
  const query = '两驱转向主轴在泥泞工况如何缩短润滑间隔';
  for (const model of ['5E-850','5E-1000','5E-1200']) {
    const hits = await find('约翰迪尔', model, query);
    assert.ok(hits.some(h => h.entryId === id && h.text.includes('每 10 小时') && h.locator.includes('95-2')));
  }
  for (const model of ['5E-854','5E-904','5E-954','5E-1004','5E-1204']) {
    assert.ok((await find('约翰迪尔', model, query)).every(h => h.entryId !== id));
  }
});

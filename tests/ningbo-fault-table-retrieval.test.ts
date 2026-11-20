import assert from 'node:assert/strict';
import test from 'node:test';
import { buildContextRegistry } from '../agent/context-tools';
import { ToolExecutor } from '../agent/tools';
import { loadKnowledgeBase } from '../server/knowledge/retriever';

test('宁波六机型故障表按自然症状引用原页，保留旧保养范围及同名机型品牌边界', async () => {
  loadKnowledgeBase();
  const agent = new ToolExecutor(buildContextRegistry());
  const search = async (query: string, brand: string, model: string) => {
    const result = await agent.execute('search_knowledge', { query, context: { brand, model }, limit: 5 });
    assert.ok(result.ok, result.content);
    return JSON.parse(result.content).chunks as {entryId: string; sourceId: string; locator: string}[];
  };
  const sourceId = 'SRC-JD-2C-OMSU37872-A6-CN';
  const cases = [
    ['304', '运行一会儿变速箱油温很高，要先检查哪里？', '001', '115-1'],
    ['B350', '三点悬挂的农具能降下来，但是下降太快，怎么调？', '015', '115-4'],
    ['2C-354', '起动机转得慢，电瓶接头也有锈，应该查哪些？', '022', '115-6'],
  ];
  for (const [model, query, suffix, page] of cases) {
    const [hit] = await search(query, '约翰迪尔', model);
    assert.equal(hit?.entryId, 'KB-JD-OMSU37872-A6-FT-' + suffix);
    assert.equal(hit.sourceId, sourceId);
    assert.ok(hit.locator.includes(page), hit.locator);
    assert.ok((await search(query, '东方红', model)).every(other => other.sourceId !== sourceId));
  }
  const olderTitle = '制动踏板左右自由行程角度的核对';
  const olderId = 'KB-JD-2C-OMSU37872-A6-CN-002';
  assert.ok((await search(olderTitle, '约翰迪尔', '2C-354')).some(chunk => chunk.entryId === olderId));
  assert.ok((await search(olderTitle, '约翰迪尔', '304')).every(chunk => chunk.entryId !== olderId));
});

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { buildContextRegistry } from '../agent/context-tools';
import { ToolExecutor } from '../agent/tools';

const indexPath = '知识库/整理后的知识库/农用拖拉机知识库/entries.jsonl';

type Entry = {
  entry_id: string;
  source_id: string;
  brand: string;
  model: string;
  models?: string[];
  title: string;
  locator: string;
};

const baseline = process.argv[2] ?? 'origin/main';
const baseCommit = execFileSync('git', ['rev-parse', '--verify', '--end-of-options', `${baseline}^{commit}`], { encoding: 'utf8' }).trim();
const original = spawn('git', ['show', `${baseCommit}:${indexPath}`], { stdio: ['ignore', 'pipe', 'inherit'] });
const gitClose = once(original, 'close');
const originalIds = new Set<string>();
for await (const line of createInterface({ input: original.stdout, crlfDelay: Infinity })) {
  if (line.trim()) originalIds.add((JSON.parse(line) as Entry).entry_id);
}
assert.equal((await gitClose)[0], 0, '无法读取基线知识索引');

const agent = new ToolExecutor(buildContextRegistry());

async function search(query: string, brand: string, model: string) {
  const result = await agent.execute('search_knowledge', { query, context: { brand, model }, limit: 5 });
  assert.ok(result.ok, result.content);
  return (JSON.parse(result.content) as {chunks: {entryId: string; sourceId: string; locator: string}[]}).chunks;
}

let checkedEntries = 0;
let matchedModels = 0;
let rejectedModels = 0;
for await (const line of createInterface({ input: createReadStream(indexPath), crlfDelay: Infinity })) {
  if (!line.trim()) continue;
  const entry = JSON.parse(line) as Entry;
  if (originalIds.has(entry.entry_id)) continue;
  const { entry_id: id, source_id: sourceId, brand, title, locator } = entry;
  const models = entry.models ?? [entry.model];
  assert.ok(models.length, id);
  const detailResult = await agent.execute('get_knowledge_entry', { entryId: id });
  assert.ok(detailResult.ok, detailResult.content);
  const detail = JSON.parse(detailResult.content);
  assert.equal(detail.entryId, id);
  assert.equal(detail.sourceId, sourceId);
  assert.ok(detail.content.includes(locator), id);
  for (const model of models) {
    const hits = await search(title, brand, model);
    assert.ok(hits.some(hit => hit.entryId === id && hit.sourceId === sourceId && hit.locator === locator),
      `${id}: ${brand} ${model} 未检索到正确来源和定位`);
    matchedModels++;
  }
  const wrong = /\(G4\)$/i.test(models[0]) ? models[0].replace(/\(G4\)$/i, '') : `${models[0]}(G4A)`;
  if (!models.includes(wrong)) {
    const unexpected = await search(id, brand, wrong);
    assert.ok(unexpected.every(hit => hit.entryId !== id), `${id}: 错型号 ${wrong} 召回了条目`);
    rejectedModels++;
  }
  checkedEntries++;
}
assert.ok(checkedEntries, '当前工作树相对基线没有新条目');
console.log(JSON.stringify({ baseCommit, checkedEntries, matchedModels, rejectedModels }, null, 2));

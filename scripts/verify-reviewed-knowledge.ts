import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createReadStream, readFileSync } from 'node:fs';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { buildContextRegistry } from '../agent/context-tools';
import { ToolExecutor } from '../agent/tools';
import { parseArchiveSections } from '../server/knowledge/archive';
import { referenceVerification } from '../server/knowledge/evidence';

const indexPath = '知识库/整理后的知识库/农用拖拉机知识库/entries.jsonl';

type Entry = {
  entry_id: string;
  source_id: string;
  entry_type: string;
  brand: string;
  model: string;
  models?: string[];
  title: string;
  locator: string;
  knowledge_path: string;
};

const baseline = process.argv[2] ?? 'origin/main';
const baseCommit = execFileSync('git', ['rev-parse', '--verify', '--end-of-options', `${baseline}^{commit}`], { encoding: 'utf8' }).trim();
const original = spawn('git', ['show', `${baseCommit}:${indexPath}`], { stdio: ['ignore', 'pipe', 'inherit'] });
const gitClose = once(original, 'close');
// Store a fingerprint per row so unchanged records need no Agent query.
const fingerprint = (line: string) => createHash('sha256').update(line).digest('base64');
const baselineRows = new Map<string, string>();
for await (const line of createInterface({ input: original.stdout, crlfDelay: Infinity })) {
  if (line.trim()) baselineRows.set((JSON.parse(line) as Entry).entry_id, fingerprint(line));
}
assert.equal((await gitClose)[0], 0, '无法读取基线知识索引');

// A technical correction can change only the Markdown body while its index row stays identical.
const markdown = indexPath.replace('entries.jsonl', '**/*.md');
const splitPaths = (value: string) => value.split('\0').filter(Boolean);
const changes = splitPaths(execFileSync('git', ['diff', '--no-renames', '--diff-filter=AMD', '--name-status', '-z',
  baseCommit, '--', markdown], { encoding: 'utf8' }));
const untracked = splitPaths(execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z', '--', markdown], { encoding: 'utf8' }));
for (const path of untracked) changes.push('A', path);
const changedSections = new Map<string, string | undefined>();
for (let i = 0; i < changes.length; i += 2) {
  const status = changes[i], path = changes[i + 1];
  const priorText = status === 'A' ? '' : execFileSync('git', ['show', baseCommit + ':' + path], {
    encoding: 'utf8', maxBuffer: 128 * 1024 * 1024,
  });
  const prior = parseArchiveSections(priorText.replace(/\r\n/g, '\n'));
  const current = parseArchiveSections(status === 'D' ? '' : readFileSync(path, 'utf8').replace(/\r\n/g, '\n'));
  const scopeChanged = prior.get('来源与适用范围')?.text !== current.get('来源与适用范围')?.text;
  for (const key of new Set([...prior.keys(), ...current.keys()])) {
    const old = prior.get(key), updated = current.get(key);
    if (scopeChanged || old?.heading !== updated?.heading || old?.text !== updated?.text) {
      changedSections.set(path + '\0' + key, updated?.text);
    }
  }
}

const sourceRows = JSON.parse(readFileSync(indexPath.replace('entries.jsonl', 'sources.json'), 'utf8')) as
  { source_id: string; minimum_machine_serial?: string }[];
const serialMinimums = new Map(sourceRows.map(source => [source.source_id, source.minimum_machine_serial]));

const agent = new ToolExecutor(buildContextRegistry());

async function search(query: string, brand: string, model: string) {
  const result = await agent.execute('search_knowledge', { query, context: { brand, model }, limit: 5 });
  assert.ok(result.ok, result.content);
  return (JSON.parse(result.content) as {chunks: {entryId: string; sourceId: string; locator: string}[]}).chunks;
}

let checkedEntries = 0;
let modifiedEntries = 0;
let bodyOnlyEntries = 0;
let matchedModels = 0;
let rejectedModels = 0;
for await (const line of createInterface({ input: createReadStream(indexPath), crlfDelay: Infinity })) {
  if (!line.trim()) continue;
  const entry = JSON.parse(line) as Entry;
  const previous = baselineRows.get(entry.entry_id);
  const sectionKey = entry.knowledge_path + '\0' + entry.entry_id;
  if (previous === fingerprint(line)) {
    if (!changedSections.has(sectionKey)) continue;
    bodyOnlyEntries++;
  }
  if (previous !== undefined) modifiedEntries++;
  const { entry_id: id, source_id: sourceId, brand, title, locator } = entry;
  const models = entry.models ?? [entry.model];
  assert.ok(models.length, id);
  const detailResult = await agent.execute('get_knowledge_entry', { entryId: id });
  assert.ok(detailResult.ok, detailResult.content);
  const detail = JSON.parse(detailResult.content);
  assert.equal(detail.entryId, id);
  assert.equal(detail.sourceId, sourceId);
  if (previous === undefined && ['维护/故障知识', '操作/维护知识'].includes(entry.entry_type)) {
    assert.equal(referenceVerification(detail.status), 'verified', id + ' 的原页复核状态未被 Agent 识别');
  }
  if (entry.models) assert.deepEqual(new Set(detail.models), new Set(entry.models), id);
  assert.ok(detail.content.includes(locator), id);
  if (changedSections.has(sectionKey)) {
    const expected = changedSections.get(sectionKey);
    assert.ok(expected, id + ' 的索引仍指向已移除的正文');
    assert.equal(detail.content.replace(/\r\n/g, '\n'), expected, id + ' 的 Agent 正文与手册卡片不一致');
  }
  const minimumSerial = serialMinimums.get(sourceId);
  const prefix = minimumSerial ? `整机序列号 ${minimumSerial}，` : '';
  for (const model of models) {
    const hits = await search(prefix + title, brand, model);
    assert.ok(hits.some(hit => hit.entryId === id && hit.sourceId === sourceId && hit.locator === locator),
      `${id}: ${brand} ${model} 未检索到正确来源和定位`);
    if (minimumSerial) {
      const earlier = String(Number(minimumSerial) - 1).padStart(6, '0');
      for (const excluded of [title, `整机序列号 ${earlier}，${title}`, `零件号 ${minimumSerial}，${title}`]) {
        const incorrect = await search(excluded, brand, model);
        assert.ok(incorrect.every(hit => hit.sourceId !== sourceId), `${id}: ${excluded}`);
      }
    }
    matchedModels++;
  }
  const wrong = /\(G4\)$/i.test(models[0]) ? models[0].replace(/\(G4\)$/i, '') : `${models[0]}(G4A)`;
  if (!models.includes(wrong)) {
    const unexpected = await search(prefix + id, brand, wrong);
    assert.ok(unexpected.every(hit => hit.entryId !== id), `${id}: 错型号 ${wrong} 召回了条目`);
    rejectedModels++;
  }
  checkedEntries++;
}
assert.ok(checkedEntries, '当前工作树相对基线没有新增或变更的索引或手册正文');
console.log(JSON.stringify({ baseCommit, checkedEntries, addedEntries: checkedEntries - modifiedEntries, modifiedEntries, bodyOnlyEntries, matchedModels, rejectedModels }, null, 2));

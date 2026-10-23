import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { loadKnowledgeBase, retrieve, stats } from '../server/knowledge/retriever';
import { getKnowledgeCatalog, loadKnowledgeCatalog } from '../server/knowledge/catalog';
import { loadKnowledgeSnapshot, reloadKnowledgeSnapshot } from '../server/knowledge/snapshot';
import { queryWithoutIdentity } from '../server/knowledge/scope';

const index = path.resolve('知识库/整理后的知识库/农用拖拉机知识库');
const question = '东方红 LF804S 启动机不转';

test('检索、目录和统计初始化共用一次归档读取，重复入口不再读取文件', t => {
  const reads = new Map<string, number>();
  const original = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', (...args: Parameters<typeof fs.readFileSync>) => {
    const file = String(args[0]);
    reads.set(file, (reads.get(file) ?? 0) + 1);
    return original(...args);
  });
  const snapshot = reloadKnowledgeSnapshot();
  const initialReadCount = [...reads.values()].reduce((a, b) => a + b, 0);
  const loaded = loadKnowledgeBase();
  const catalog = loadKnowledgeCatalog();
  loadKnowledgeBase(); loadKnowledgeCatalog();
  const matches = retrieve(question);
  assert.ok(matches.length > 0);
  assert.equal(loadKnowledgeSnapshot(), snapshot);
  assert.equal(loaded.chunkCount, stats().chunks);
  assert.equal(stats().archivedEntries, catalog.totals.archivedEntries);
  assert.equal(stats().totalEntries, catalog.totals.entries);
  assert.equal(stats().learningEntries, catalog.totals.learningEntries);
  assert.equal(catalog.totals.mappedEntries, stats().archivedEntries);
  assert.equal([...reads.values()].reduce((a, b) => a + b, 0), initialReadCount);
  for (const name of ['entries.jsonl', 'sources.json', 'hierarchy.json', 'kb-version.json']) assert.equal(reads.get(path.join(index, name)), 1, name);
  for (const [file, count] of reads) assert.equal(count, 1, `repeated read: ${file}`);
});

test('共享证据保留正文、引用、型号与配置，调用方不能污染缓存', () => {
  const snapshot = loadKnowledgeSnapshot();
  const catalog = getKnowledgeCatalog();
  assert.throws(() => { catalog.totals.entries = 0; }, TypeError);
  assert.throws(() => { snapshot.chunks[0].text = 'corrupted'; }, TypeError);
  const selected = getKnowledgeCatalog({ brand: '东方红', model: 'LF804S' }).selected!;
  for (const entry of selected.entries) {
    const original = snapshot.chunks.find(chunk => chunk.entryId === entry.entryId)!;
    assert.equal(entry.content, original.text);
    assert.equal(entry.sourceId, original.sourceId);
    assert.equal(entry.locator, original.locator);
    assert.equal(entry.scopeBoundary, original.scopeBoundary);
    assert.equal(entry.version, original.version);
  }
  const su = getKnowledgeCatalog({ brand: '久保田', model: 'LX2620SUHSD', component: 'cab' }).selected!;
  assert.ok(su.entries.some(entry => entry.configuration === 'ROPS'));
  assert.ok(su.entries.every(entry => entry.configuration !== 'CAB'));
  assert.throws(() => getKnowledgeCatalog({ brand: '久保田', model: 'LX2620HSDCX' }), RangeError);
  assert.equal(stats().archivedEntries, catalog.totals.archivedEntries);
});

test('目录校验失败不会切换检索、统计、目录或型号识别，修复后可整体重载', t => {
  const previous = loadKnowledgeSnapshot();
  const beforeReply = retrieve(question);
  const targetSource = beforeReply.find(chunk => chunk.sourceId)!.sourceId;
  const beforeStats = stats();
  const beforeScope = queryWithoutIdentity('SM-SNAPSHOT.98765 启动困难');
  const original = fs.readFileSync;
  let invalid = true;
  const mock = t.mock.method(fs, 'readFileSync', (...args: Parameters<typeof fs.readFileSync>) => {
    const file = String(args[0]);
    const data = original(...args);
    if (file === path.join(index, 'sources.json')) {
      const sources = JSON.parse(String(data));
      sources.find((source: { source_id: string }) => source.source_id === targetSource).version = 'SM-SNAPSHOT.98765';
      return JSON.stringify(sources);
    }
    if (invalid && file === path.join(index, 'hierarchy.json')) {
      const hierarchy = JSON.parse(String(data));
      hierarchy.entries.pop();
      return JSON.stringify(hierarchy);
    }
    return data;
  });
  assert.throws(() => reloadKnowledgeSnapshot(), /尚未维护分层导航/);
  assert.equal(loadKnowledgeSnapshot(), previous);
  assert.deepEqual(retrieve(question), beforeReply);
  assert.deepEqual(stats(), beforeStats);
  assert.equal(getKnowledgeCatalog(), previous.getCatalog());
  assert.equal(queryWithoutIdentity('SM-SNAPSHOT.98765 启动困难'), beforeScope);
  invalid = false;
  const next = reloadKnowledgeSnapshot();
  assert.notEqual(next, previous);
  assert.equal(getKnowledgeCatalog(), next.getCatalog());
  assert.equal(stats().archivedEntries, next.getCatalog().totals.archivedEntries);
  assert.ok(retrieve(question).some(chunk => chunk.sourceId === targetSource && chunk.version === 'SM-SNAPSHOT.98765'),
    'a successful reload invalidates router metadata and retrieval cache together');
  assert.equal(queryWithoutIdentity('SM-SNAPSHOT.98765 启动困难').trim(), '启动困难');
  mock.mock.restore();
  reloadKnowledgeSnapshot();
});

test('通用框架校验失败同样保留目录、诊断缓存及健康统计的完整快照', t => {
  const previous = loadKnowledgeSnapshot();
  const reply = retrieve(question);
  const previousStats = stats();
  const original = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', (...args: Parameters<typeof fs.readFileSync>) => {
    const data = original(...args);
    if (String(args[0]) !== path.join(index, '通用框架.json')) return data;
    const framework = JSON.parse(String(data));
    framework.links[0].entryId = 'KB-MISSING-COMMON-ENTRY';
    return JSON.stringify(framework);
  });
  assert.throws(() => reloadKnowledgeSnapshot(), /通用关联/);
  assert.equal(loadKnowledgeSnapshot(), previous);
  assert.deepEqual(stats(), previousStats);
  assert.deepEqual(retrieve(question), reply);
  assert.equal(getKnowledgeCatalog(), previous.getCatalog());
});

test('归档损坏和普通知识读取失败均保留上一个完整快照', t => {
  const previous = loadKnowledgeSnapshot();
  const original = fs.readFileSync;
  let failure = 'archive';
  t.mock.method(fs, 'readFileSync', (...args: Parameters<typeof fs.readFileSync>) => {
    const file = String(args[0]);
    if (failure === 'archive' && file === path.join(index, 'entries.jsonl')) return '{ invalid JSON';
    if (failure === 'generic' && file.includes('01_通用原理') && file.endsWith('.md')) throw new Error('simulated read failure');
    return original(...args);
  });
  assert.throws(() => reloadKnowledgeSnapshot(), SyntaxError);
  assert.equal(loadKnowledgeSnapshot(), previous);
  failure = 'generic';
  assert.throws(() => reloadKnowledgeSnapshot(), /simulated read failure/);
  assert.equal(loadKnowledgeSnapshot(), previous);
});

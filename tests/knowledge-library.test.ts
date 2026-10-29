import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { getKnowledgeCatalog } from '../server/knowledge/catalog';
import { loadKnowledgeSnapshot, reloadKnowledgeSnapshot } from '../server/knowledge/snapshot';
import { LEARNING_INDEXES } from '../server/knowledge/learning';
import { retrieve, stats } from '../server/knowledge/retriever';
import { parseKnowledgeCatalog } from '../src/features/knowledge/catalog-api';

const archiveCount = fs.readFileSync('知识库/整理后的知识库/农用拖拉机知识库/entries.jsonl', 'utf8').trim().split(/\r?\n/).length;
const learningCount = LEARNING_INDEXES.reduce((count, file) => count + fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).length, 0);
const totalCount = archiveCount + learningCount;

function verifyLibraryRecords() {
  const archiveIndex = '知识库/整理后的知识库/农用拖拉机知识库/entries.jsonl';
  const rows = [archiveIndex, ...LEARNING_INDEXES].flatMap(file => fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line)));
  const expected = new Map(rows.map(row => [row.entry_id, row]));
  assert.equal(expected.size, totalCount);
  const ids = new Set<string>();
  const collections = { archive: 0, learning: 0 };
  const documents = new Map<string, string>();
  const first = getKnowledgeCatalog({ collection: 'all' });
  assert.equal(first.totals.entries, totalCount);
  assert.equal(first.library!.total, first.totals.entries);
  assert.deepEqual(new Set(first.library!.entries.map(entry => entry.collection)), new Set(['archive', 'learning']));
  for (let page = 1; page <= Math.ceil(first.library!.total / first.library!.pageSize); page++) {
    const catalog = getKnowledgeCatalog({ collection: 'all', page: String(page) });
    assert.equal(parseKnowledgeCatalog(catalog), catalog);
    const library = catalog.library!;
    assert.equal(library.page, page);
    for (const entry of library.entries) {
      assert.ok(!ids.has(entry.entryId), entry.entryId);
      ids.add(entry.entryId);
      collections[entry.collection]++;
      const index = expected.get(entry.entryId)!;
      assert.ok(index, entry.entryId);
      assert.equal(entry.title, index.title);
      assert.equal(entry.knowledgePath, index.knowledge_path);
      if (!documents.has(entry.knowledgePath)) documents.set(entry.knowledgePath, fs.readFileSync(entry.knowledgePath, 'utf8').replace(/\r\n/g, '\n'));
      assert.ok(documents.get(entry.knowledgePath)!.includes(entry.content.replace(/\r\n/g, '\n')), `sole Markdown body: ${entry.entryId}`);
      if (entry.collection === 'learning') assert.equal(entry.diagnosticEvidence, false);
    }
  }
  assert.deepEqual(ids, new Set(expected.keys()));
  assert.deepEqual(collections, { archive: archiveCount, learning: learningCount });
}

test('统一目录在原始换行及强制CRLF加载下逐页覆盖全部原编号、唯一正文和类别', t => {
  verifyLibraryRecords();
  const read = fs.readFileSync;
  const mock = t.mock.method(fs, 'readFileSync', (...args: Parameters<typeof fs.readFileSync>) => {
    const data = read(...args);
    return typeof data === 'string' ? data.replace(/\r?\n/g, '\r\n') : data;
  });
  try {
    reloadKnowledgeSnapshot();
    verifyLibraryRecords();
  } finally {
    mock.mock.restore();
    reloadKnowledgeSnapshot();
  }
});

test('共同正文搜索保留类别隔离、中文关键词、大小写不敏感的编号及空结果分页', () => {
  for (const id of ['TK-0001', 'TK-1001', 'TK-6000', 'KB-YTO-LF-MANUAL-007']) {
    const library = getKnowledgeCatalog({ collection: 'all', q: id.toLowerCase() }).library!;
    assert.equal(library.total, 1, id);
    assert.equal(library.entries[0].entryId, id);
  }
  const body = getKnowledgeCatalog({ collection: 'learning', q: '牵引装置 动力输出轴' }).library!;
  assert.ok(body.entries.some(entry => entry.entryId === 'TK-0001'));
  assert.equal(getKnowledgeCatalog({ collection: 'archive', q: 'TK-6000' }).library!.total, 0);
  const empty = getKnowledgeCatalog({ collection: 'all', q: '不存在的知识UNIFIED-LIBRARY-TEST', page: '999999' }).library!;
  assert.deepEqual([empty.page, empty.total, empty.entries.length], [1, 0, 0]);
  const last = getKnowledgeCatalog({ collection: 'learning', page: '999999' }).library!;
  assert.equal(last.page, Math.ceil(learningCount / last.pageSize));
  assert.equal(last.entries.at(-1)!.entryId, 'TK-6875');
});

test('累计统计包含通识检索，保留维修证据集合与具体机型优先级', () => {
  const snapshot = loadKnowledgeSnapshot();
  assert.deepEqual(stats(), { chunks: totalCount + 9, archivedEntries: archiveCount, learningEntries: learningCount, totalEntries: totalCount });
  assert.equal(snapshot.chunks.filter(chunk => chunk.entryType === '通识学习').length, learningCount);
  const reply = retrieve('东方红 LF804S 启动机不转');
  assert.ok(reply.some(chunk => chunk.entryId === 'KB-YTO-LF-MANUAL-007'));
  assert.ok(reply.filter(chunk => chunk.entryId?.startsWith('TK-')).every(chunk => chunk.diagnosticEvidence === false));
  const entry = getKnowledgeCatalog({ collection: 'learning', q: 'TK-0001' }).library!.entries[0];
  assert.throws(() => { entry.content = 'corrupted'; }, TypeError);
});

test('通识索引用途或正文损坏时原子重载失败，继续提供上一份完整目录', t => {
  const previous = loadKnowledgeSnapshot();
  const previousStats = stats();
  const read = fs.readFileSync;
  let failure = 'purpose';
  t.mock.method(fs, 'readFileSync', (...args: Parameters<typeof fs.readFileSync>) => {
    const file = String(args[0]);
    const data = read(...args);
    if (failure === 'purpose' && file === path.resolve(LEARNING_INDEXES[0])) {
      return String(data).replace('"diagnostic_evidence": false', '"diagnostic_evidence": true');
    }
    if (failure === 'body' && file === fs.realpathSync(path.resolve('docs/tractor-knowledge/01.md'))) {
      return String(data).replace('### TK-0001', '### TK-9999');
    }
    return data;
  });
  assert.throws(() => reloadKnowledgeSnapshot(), /用途无效/);
  failure = 'body';
  assert.throws(() => reloadKnowledgeSnapshot(), /正文缺失/);
  assert.equal(loadKnowledgeSnapshot(), previous);
  assert.deepEqual(stats(), previousStats);
  assert.equal(getKnowledgeCatalog({ collection: 'all' }).library!.total, totalCount);
});

test('前端拒绝累计数字不符、学习用途升级、混入其他类别及错误分页的目录', () => {
  const catalog = getKnowledgeCatalog({ collection: 'learning', q: 'TK-6000' });
  assert.equal(parseKnowledgeCatalog(catalog), catalog);
  assert.throws(() => parseKnowledgeCatalog({ ...catalog, totals: { ...catalog.totals, entries: 4853 } }));
  const invalid = structuredClone(catalog);
  const entry = invalid.library!.entries[0];
  assert.equal(entry.collection, 'learning');
  Object.assign(entry, { diagnosticEvidence: true });
  assert.throws(() => parseKnowledgeCatalog(invalid));
  assert.throws(() => parseKnowledgeCatalog({ ...catalog, library: { ...catalog.library, collection: 'archive' } }));
  assert.throws(() => parseKnowledgeCatalog({ ...catalog, library: { ...catalog.library, page: 2 } }));
});

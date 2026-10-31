import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { getKnowledgeCatalog } from '../server/knowledge/catalog';
import { loadKnowledgeSnapshot, reloadKnowledgeSnapshot } from '../server/knowledge/snapshot';
import { describeSource, retrieve, stats } from '../server/knowledge/retriever';
import { hasDiagnosticEvidence } from '../server/knowledge/systemPrompt';
import { buildDiagnosticReply, renderDiagnosticReply } from '../server/diagnosis/reply';
import { decideCoordination } from '../server/knowledge/coordination';
import { parseKnowledgeCatalog } from '../src/features/knowledge/catalog-api';

test('875条FAO术语逐条对应官方来源子集，累计目录包含原13000条和新增手册知识，且保留原6000条通识', () => {
  const result = spawnSync(process.execPath, ['scripts/agrovoc-learning.mjs', '--check'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const records = JSON.parse(fs.readFileSync('docs/tractor-knowledge/expansion-875/source-concepts.json', 'utf8'));
  const terms = loadKnowledgeSnapshot().chunks.filter(chunk => chunk.learningKind === 'terminology');
  assert.equal(terms.length, 875);
  assert.equal(new Set(terms.map(chunk => chunk.sourceUrl)).size, 875);
  for (const [i, chunk] of terms.entries()) {
    assert.equal(chunk.entryId, `TK-${6001 + i}`);
    assert.equal(chunk.sourceUrl, records[i].uri);
    assert.ok(chunk.text.includes(records[i].zh));
    assert.ok(chunk.text.includes(records[i].en));
    assert.equal(chunk.diagnosticEvidence, false);
    assert.equal(chunk.sourceId, undefined);
    assert.match(chunk.scopeBoundary!, /不表示部件组成、故障因果/);
  }
  assert.deepEqual(stats(), { archivedEntries: 6361, learningEntries: 6875, totalEntries: 13236, chunks: 13245 });
  assert.equal(getKnowledgeCatalog({ collection: 'all' }).library!.total, 13236);
  const baseline = JSON.parse(fs.readFileSync('docs/tractor-knowledge/expansion-875/validation.json', 'utf8'));
  for (const [file, expected] of Object.entries(baseline.baseline_files)) {
    let content = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    // The 2026-10-29 snapshot is an immutable prefix, not a ban on future additions.
    if (file.endsWith('/农用拖拉机知识库/entries.jsonl')) {
      content = content.split('\n').slice(0, 6125).join('\n') + '\n';
    } else if (file.endsWith('/农用拖拉机知识库/sources.json')) {
      const nextSource = content.indexOf(',\n  {\n    "source_id": "SRC-NH-T1254B-T1404B-91783224"');
      assert.ok(nextSource > 0);
      content = content.slice(0, nextSource) + '\n]\n';
    } else if (file.endsWith('/农用拖拉机知识库/hierarchy.json')) {
      const hierarchy = JSON.parse(content);
      hierarchy.updated_at = '2026-10-29';
      hierarchy.entries = hierarchy.entries.slice(0, 6125);
      content = JSON.stringify(hierarchy, null, 2) + '\n';
    }
    assert.equal(createHash('sha256').update(content).digest('hex'), expected, file);
  }
});

test('术语关系可显式查阅，不能成为故障证据或挤占症状检索', () => {
  const last = retrieve('查阅 TK-6875');
  assert.equal(last.length, 1);
  assert.equal(last[0].learningKind, 'terminology');
  assert.equal(last[0].generalEvidence, undefined);
  assert.equal(last[0].retrieval?.referenceOnly, true);
  assert.equal(hasDiagnosticEvidence(last), false);
  assert.match(describeSource(last[0]), /FAO AGROVOC/);
  assert.match(describeSource(last[0]), /不作为故障诊断证据/);
  for (const query of ['拖拉机发动机启动困难', '东方红 LF804S 启动机不转', '液压提升无力']) {
    assert.ok(retrieve(query, 30).every(chunk => chunk.learningKind !== 'terminology'), query);
  }
  const glossary = retrieve('四轮驱动拖拉机英文术语', 6);
  assert.ok(glossary.some(chunk => chunk.learningKind === 'terminology' && chunk.heading.includes('四轮驱动拖拉机')));
  const reply = buildDiagnosticReply({ query: '查阅 TK-6875', chunks: last, scope: {},
    coordination: decideCoordination({ query: '查阅 TK-6875', currentQuery: '查阅 TK-6875', scope: {}, retrieved: last, llmConfigured: false }) });
  assert.equal(reply.supportLevel, 'reference_only');
  assert.deepEqual([reply.causes, reply.suggestions, reply.questions], [[], [], []]);
  assert.match(renderDiagnosticReply(reply), /词表直接上位概念/);
  assert.match(renderDiagnosticReply(reply), /aims.fao.org/);
  assert.equal(getKnowledgeCatalog({ collection: 'learning', q: 'TK-6875' }).library!.total, 1);
  const catalog = structuredClone(getKnowledgeCatalog({ collection: 'learning', q: 'TK-6875' }));
  assert.equal(parseKnowledgeCatalog(catalog), catalog);
  const term = catalog.library!.entries[0];
  assert.equal(term.collection, 'learning');
  term.sourceUrl = 'javascript:alert(1)';
  assert.throws(() => parseKnowledgeCatalog(catalog));
});

test('术语原始概念错绑时拒绝切换快照，继续提供上次完整知识库', t => {
  const before = loadKnowledgeSnapshot();
  const read = fs.readFileSync;
  const mock = t.mock.method(fs, 'readFileSync', (...args: Parameters<typeof fs.readFileSync>) => {
    const data = read(...args);
    if (String(args[0]).replaceAll('\\', '/').endsWith('expansion-875/index.jsonl') && typeof data === 'string') {
      return data.replace(/"source_uri":"[^"]+"/, '"source_uri":"http://aims.fao.org/aos/agrovoc/c_wrong"');
    }
    return data;
  });
  try {
    assert.throws(() => reloadKnowledgeSnapshot(), /术语来源无效/);
    assert.equal(loadKnowledgeSnapshot(), before);
  } finally {
    mock.mock.restore();
    reloadKnowledgeSnapshot();
  }
});

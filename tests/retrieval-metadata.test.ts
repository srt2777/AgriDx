import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import {
  clearRetrievalCache,
  deriveDiagnosticMetadata,
  formatForPrompt,
  loadKnowledgeBase,
  retrievalStats,
  retrieve,
  selectPromptChunks,
  type KnowledgeChunk,
} from '../server/knowledge/retriever';
import { buildSystemPrompt } from '../server/knowledge/systemPrompt';
import { peekKnowledgeSnapshot, reloadKnowledgeSnapshot } from '../server/knowledge/snapshot';

const context = { machineType: '拖拉机', brand: '纽荷兰', model: 'WORKMASTER25' };
const starterQuery = '钥匙在 START，启动电机不转';
const noCoverage = { symptom: false, causes: false, checks: false, repair: false };

function card(text: string, heading = 'KB-TEST-001｜灯光不亮'): KnowledgeChunk {
  return { source: 'fixture.md', heading, text, entryId: 'KB-TEST-001',
    sourceId: 'SRC-TEST-001', indexedReference: { entryId: 'KB-TEST-001', sourceId: 'SRC-TEST-001' },
    status: '已核对引用页原文；未实车验证', entryType: '维护/故障知识' };
}

before(() => loadKnowledgeBase());
const loadedChunks = () => peekKnowledgeSnapshot()!.chunks.map((chunk) => ({ ...chunk, diagnosticMetadata: deriveDiagnosticMetadata(chunk) }));

test('relevance retains the raw lexical score and never claims calibration or diagnostic accuracy', () => {
  const found = retrieve(starterQuery, 5, context);
  assert.equal(found[0]?.entryId, 'NH-WM25-003');
  assert.ok(found.every((chunk) => chunk.relevance?.method === 'keyword-weighted-overlap'));
  assert.ok(found.every((chunk) => chunk.relevance?.calibrated === false));
  assert.ok(found.every((chunk) => Number.isFinite(chunk.relevance?.score) && chunk.relevance!.score > 0));
  assert.ok(found[0].relevance!.score > 1, 'score must not silently become a 0–1 probability');
  assert.ok(found.every((chunk, i) => !i || chunk.relevance!.score <= found[i - 1].relevance!.score));
  assert.ok(found[0].diagnosticMetadata);
});

test('coverage requires substantive source content, including older bullet labels', () => {
  const complete = deriveDiagnosticMetadata(card([
    '- 故障现象：灯光不亮。',
    '- 可能原因：保险丝熔断或接线端松动。',
    '- 诊断步骤：核对保险丝状态，检查接线端是否松动；原表未给带电检测步骤。',
    '- 维修建议：查明熔断原因后按本机维护章节更换保险丝；接线由维修人员处理。',
    '- 整理安全边界：停机泄压，禁止拆高压液压或动力输出轴。',
  ].join('\n')));
  assert.deepEqual(complete.coverage, { symptom: true, causes: true, checks: true, repair: true });
  assert.equal(complete.riskLevel, 'low', 'generic closing warnings must not classify the lamp as high risk');
  const old = deriveDiagnosticMetadata(card([
    '- 可能原因选摘：燃油滤清器堵塞、蓄电池电量不足。',
    '- 原文方向：检查油箱和滤清器；核对蓄电池状态。',
    '- 对应处理方向：确认故障后更换本机匹配滤芯，维修人员处理接线。',
  ].join('\n'), 'KB-TEST-001｜发动机不着火'));
  assert.deepEqual(old.coverage, { symptom: true, causes: true, checks: true, repair: true });
  assert.equal(old.riskLevel, 'low', '不着火 is a starting symptom, not an active fire');
  const loaded = retrieve('发动机启动困难', 5, { brand: '久保田', model: 'LX2620' })
    .find((chunk) => chunk.entryId === 'KB-LX2620-003');
  assert.equal(loaded?.diagnosticMetadata?.coverage.causes, true);
  assert.equal(loaded?.diagnosticMetadata?.coverage.checks, true);
});

test('four headings, pending placeholders and identity checks do not fabricate full coverage', () => {
  const empty = deriveDiagnosticMetadata(card([
    '- 故障现象：待补故障现象。',
    '- 可能原因：原文未给可能原因，资料不足。',
    '- 诊断步骤：先匹配完整机型、版本和实际配置，核对部位、状态与原页。',
    '- 维修建议：暂无已核对的修理方法，待补。',
  ].join('\n')));
  assert.deepEqual(empty.coverage, noCoverage);
  assert.equal(empty.riskLevel, 'unknown');
  const maintenance = deriveDiagnosticMetadata(card([
    '- 故障现象：维护／操作主题：发动机只能从驾驶座起动；不表示实车已发生故障。',
    '- 可能原因：本页给出维护前提与操作要求，未将该主题作为独立故障确诊。',
    '- 诊断步骤：先匹配本册完整机型、市场和本条配置，再核对所指部位、状态与原页。未配相应附件时不套用本条。',
    '- 维修建议：手册事实概述：按对应章节更换滤芯。',
  ].join('\n')));
  assert.deepEqual(maintenance.coverage, { ...noCoverage, repair: true });
  assert.equal(maintenance.riskLevel, 'unknown');
});

test('generic information collection and background entries cannot qualify as diagnostic evidence', () => {
  const text = '- 故障现象：灯光不亮。\n- 可能原因：保险丝熔断。\n- 诊断步骤：检查保险丝。\n- 维修建议：更换保险丝。';
  for (const type of ['机型资料', '资料缺口', '资料索引', '资料核验', '系统适用边界']) {
    assert.deepEqual(deriveDiagnosticMetadata({ ...card(text), entryType: type }).coverage, noCoverage);
  }
  assert.deepEqual(deriveDiagnosticMetadata({ source: 'generic.md', heading: '灯光故障', text }).coverage, noCoverage);
  // 2026-10-22: open questions now rank archive + 通识 first, so read the generic hint from the index.
  const generic = loadedChunks().find((chunk) => !chunk.entryId && chunk.heading.includes('启动'));
  assert.ok(generic && !generic.entryId);
  assert.deepEqual(generic.diagnosticMetadata?.coverage, noCoverage);
});

test('fault heading and substantive causes retain high-risk labels without consulting footer warnings', () => {
  for (const heading of ['制动失灵', '转向沉重', '高压液压泄漏', '动力输出轴异响', '自动驾驶失联']) {
    assert.equal(deriveDiagnosticMetadata(card('- 故障现象：异响。', `KB-TEST-001｜${heading}`)).riskLevel, 'high');
  }
  assert.equal(deriveDiagnosticMetadata(card('- 故障现象：发动机不能起动。\n- 可能原因：高压共轨供油异常。')).riskLevel, 'high');
});

test('static retrieval cache separates scope, clones returned metadata and invalidates on reload', () => {
  clearRetrievalCache();
  const before = retrievalStats();
  const found = retrieve(starterQuery, 5, context);
  const expected = structuredClone(found);
  found[0].text = 'must not enter cache';
  found[0].models?.push('WORKMASTER25S');
  found[0].diagnosticMetadata!.coverage.causes = false;
  found[0].relevance!.score = -1;
  const cached = retrieve(starterQuery, 5, context);
  assert.deepEqual(cached, expected);
  assert.equal(retrievalStats().cacheHits - before.cacheHits, 1);
  assert.equal(retrievalStats().scoringPasses - before.scoringPasses, 1);
  const unknownModel = retrieve(starterQuery, 5, { ...context, model: 'WORKMASTER25S' });
  assert.ok(unknownModel.every(chunk => chunk.entryType === '通识学习' && chunk.diagnosticEvidence === false && !chunk.indexedReference));
  assert.equal(retrieve(starterQuery, 1, context).length, 1);
  const previousGeneration = retrievalStats().generation;
  const previousCacheEntries = retrievalStats().cacheEntries;
  loadKnowledgeBase();
  assert.equal(retrievalStats().generation, previousGeneration, 'repeated initialization reuses the active snapshot');
  assert.equal(retrievalStats().cacheEntries, previousCacheEntries);
  reloadKnowledgeSnapshot();
  loadKnowledgeBase();
  assert.equal(retrievalStats().generation, previousGeneration + 1);
  assert.equal(retrievalStats().cacheEntries, 0);
  const hitsBefore = retrievalStats().cacheHits;
  assert.deepEqual(retrieve(starterQuery, 5, context), expected);
  assert.equal(retrievalStats().cacheHits, hitsBefore);
  assert.equal('query' in retrievalStats(), false);
});

test('cache is bounded and expires rather than retaining diagnostic queries indefinitely', () => {
  const originalNow = Date.now;
  let now = originalNow();
  try {
    Date.now = () => now;
    clearRetrievalCache();
    for (let i = 0; i < retrievalStats().cacheMaxEntries + 5; i++) {
      retrieve(`${starterQuery} 标记${i}`, 1, context);
    }
    assert.equal(retrievalStats().cacheEntries, retrievalStats().cacheMaxEntries);
    now += retrievalStats().cacheTtlMs + 1;
    const previous = retrievalStats();
    retrieve(`${starterQuery} 标记132`, 1, context);
    assert.equal(retrievalStats().cacheHits, previous.cacheHits);
    assert.equal(retrievalStats().scoringPasses, previous.scoringPasses + 1);
    assert.equal(retrievalStats().cacheEntries, 1);
  } finally {
    Date.now = originalNow;
    clearRetrievalCache();
  }
});

test('prompt budget omits oversized blocks and preserves source, status and safety tails in selected blocks', () => {
  const oversized = card(`${'真实证据。'.repeat(500)}\n安全尾部：禁止短接联锁，须核对本机配置。`);
  oversized.scopeBoundary = '仅限本册北美版，不适用于25S';
  const small = { ...card('故障现象：灯光不亮。\n安全尾部：停机后由维修人员处理。'),
    entryId: 'KB-TEST-002', heading: 'KB-TEST-002｜灯光不亮', scopeBoundary: '只适用于本册CAB配置' };
  const budget = formatForPrompt([small], 20_000).length;
  assert.deepEqual(selectPromptChunks([oversized, small], budget), [small]);
  const prompt = formatForPrompt([oversized, small], budget);
  assert.equal(prompt.length, budget);
  assert.match(prompt, /KB-TEST-002/);
  assert.match(prompt, /只适用于本册CAB配置/);
  assert.match(prompt, /未实车验证/);
  assert.match(prompt, /安全尾部：停机后由维修人员处理/);
  assert.doesNotMatch(prompt, /KB-TEST-001|真实证据/);
  assert.equal(formatForPrompt([small], budget - 1), '');
  const full = formatForPrompt([oversized], 20_000);
  assert.match(full, /安全尾部：禁止短接联锁/);
  assert.ok(full.includes(oversized.text), 'body longer than 1200 chars must remain complete');
});

test('pre-retrieved prompts search zero times and report the actual context selection', () => {
  const found = retrieve(starterQuery, 5, context);
  const budget = formatForPrompt([found[0]], 20_000).length;
  const before = retrievalStats();
  const prompt = buildSystemPrompt({ query: starterQuery, ...context, retrieved: found, contextMaxChars: budget });
  assert.equal(retrievalStats().requests, before.requests);
  assert.deepEqual(prompt.retrieved, [found[0]]);
  assert.match(prompt.message.content, /NH-WM25-003/);
  assert.equal(buildSystemPrompt({ query: starterQuery, ...context, retrieved: [] }).retrieved.length, 0);
  assert.equal(retrievalStats().requests, before.requests);
});

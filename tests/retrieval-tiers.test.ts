import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { before, test } from 'node:test';
import { DiagnosisRouter } from '../server/diagnosis/router';
import { createDiagnosticService } from '../server/diagnosis/service';
import { referenceVerification } from '../server/knowledge/evidence';
import {
  clearRetrievalCache,
  loadKnowledgeBase,
  retrieve,
  retrieveWithDiagnostics,
  retrievalStats,
  type KnowledgeChunk,
} from '../server/knowledge/retriever';
import { loadKnowledgeSnapshot, reloadKnowledgeSnapshot } from '../server/knowledge/snapshot';
import { queryWithoutIdentity, resolveScope } from '../server/knowledge/scope';
import { buildContextRegistry } from '../agent/context-tools';
import { ToolExecutor } from '../agent/tools';

const lf = { machineType: '拖拉机', brand: '东方红', model: 'LF1504' };
const lfSource = 'SRC-YTO-LF1504-SMLF150449010';
const archive = (chunks: KnowledgeChunk[]) => chunks.filter(chunk => chunk.sourceId);

before(() => loadKnowledgeBase());

test('LF1504 overheating recalls its cooling safety reference without borrowing another LF manual', () => {
  const found = retrieve('东方红 LF1504 水温过高', 12, lf);
  const cooling = found.find(chunk => chunk.entryId === 'KB2000-20261015-YTOLF1504-010');
  assert.ok(cooling, 'the existing hot-coolant-cap safety card is a component reference');
  assert.equal(cooling.sourceId, lfSource);
  assert.equal(cooling.retrieval?.tier, 'component');
  assert.equal(cooling.retrieval.referenceOnly, true);
  assert.ok(cooling.retrieval.basis.length > 0);
  assert.ok(archive(found).every(chunk => chunk.sourceId === lfSource));
  assert.ok(found.every(chunk => !chunk.retrieval || chunk.retrieval.tier !== 'general' || chunk.retrieval.referenceOnly));
});

test('series retrieval requires explicit manual model coverage and retains emission boundaries', () => {
  const found = retrieve('不能起动应先区分起动机是否转动', 12, {
    machineType: '拖拉机', brand: '约翰迪尔', model: '6E-1204(G4)',
  });
  const manual = found.find(chunk => chunk.entryId === 'KB-JD-6E-G4-OMTR115296-004');
  assert.ok(manual);
  assert.ok(manual.models?.some(model => model.replace(/\s/g, '') === '6E-1204(G4)'));
  assert.equal(manual.retrieval?.tier, 'series');
  for (const model of ['6E-1604(G4)', '6E-1204(G3)', '6E-1204-X(G4)']) {
    const incompatible = retrieve('不能起动应先区分起动机是否转动', 20, {
      machineType: '拖拉机', brand: '约翰迪尔', model,
    });
    assert.ok(!archive(incompatible).some(chunk => chunk.sourceId === manual.sourceId), model);
  }
  const nationalFour = retrieve('东方红 LF1504 国四 水温过高', 20, lf);
  assert.ok(!archive(nationalFour).some(chunk => chunk.sourceId === lfSource));
});

test('diagnostics distinguish a known manual with no topic result from an unavailable model manual', () => {
  const known = retrieveWithDiagnostics('量子纠缠', 6, lf);
  assert.equal(known.manualAvailable, true);
  assert.equal(known.outcome, 'no_results');
  assert.deepEqual(known.chunks, []);
  const absent = retrieveWithDiagnostics('量子纠缠', 6, { ...lf, model: 'LF99999' });
  assert.equal(absent.manualAvailable, false);
  assert.equal(absent.outcome, 'no_manual');
  assert.deepEqual(archive(absent.chunks), []);
});

test('a shared fault number requires its controller prefix before retrieving exact manual evidence', async t => {
  const cards = loadKnowledgeSnapshot().chunks.filter(chunk =>
    chunk.sourceId === lfSource && chunk.entryType === '维护/故障知识' && chunk.entryId && chunk.heading.includes('｜'));
  const [powerShift, autoPowr] = cards;
  assert.ok(powerShift && autoPowr);
  const original = fs.readFileSync;
  const mock = t.mock.method(fs, 'readFileSync', (...args: Parameters<typeof fs.readFileSync>) => {
    const data = original(...args);
    const relevant = [[powerShift, 'PTP 000177.17、P242F'], [autoPowr, 'PTI 177.17']] as const;
    return relevant.filter(([card]) => String(args[0]) === path.resolve(card.source))
      .reduce<string | Buffer>((text, [card, code]) => {
        const input = String(text);
        const newline = input.includes('\r\n') ? '\r\n' : '\n';
        const heading = `## ${card.heading}${newline}`;
        return input.replace(heading, `${heading}${newline}- 故障码：${code}${newline}`);
      }, data);
  });
  t.after(() => { mock.mock.restore(); reloadKnowledgeSnapshot(); });
  reloadKnowledgeSnapshot();

  const executor = new ToolExecutor(buildContextRegistry());
  const ambiguous = await executor.execute('search_knowledge', { query: '故障码 177.17 是什么', context: lf, limit: 1 });
  const ambiguousBody = JSON.parse(ambiguous.content);
  assert.deepEqual(ambiguousBody.chunks, []);
  assert.deepEqual(ambiguousBody.faultCodeAmbiguity, [{ number: '177.17', controllers: ['PTI', 'PTP'] }]);
  assert.deepEqual(retrieve('177.17', 6, lf), []);
  const diagnose = createDiagnosticService({ hasAnyConfigured: () => true, chat: async () => { throw new Error('ambiguous code invoked provider'); } },
    { config: { logDecisions: false } });
  const reply = await diagnose({ ...lf, history: [{ role: 'user', content: '故障码 177.17 是什么' }], diagnosisMode: 'ai_assisted' });
  assert.equal(reply.diagnosisTrace?.aiAttempts, 0);
  assert.deepEqual(reply.diagnosticReply?.questions, [{ text: '请核对仪表上 177.17 前面的控制器前缀。', options: ['PTI', 'PTP'] }]);

  for (const [query, card] of [['PTP 177.17', powerShift], ['故障码 pti 177.17 是什么意思', autoPowr]] as const) {
    assert.deepEqual(retrieve(query, 5, lf).map(chunk => chunk.entryId), [card.entryId]);
  }
  const powertrain = retrieve('P242F', 5, lf);
  assert.deepEqual(powertrain.map(chunk => chunk.entryId), [powerShift.entryId]);
  assert.deepEqual(powertrain[0].faultCodes, ['PTP 000177.17', 'P242F']);
  assert.deepEqual(retrieve('如何排查？', 5, { ...lf, faultCodes: ['PTI 177.17'] }).map(chunk => chunk.entryId), [autoPowr.entryId]);
  assert.deepEqual(retrieve('故障码 ECU 177.17', 5, lf), []);
  assert.deepEqual(retrieve('故障码 177.18', 5, lf), []);
  assert.deepEqual(retrieve('PTP 177.17', 5, { ...lf, model: 'LF99999' }), []);
  assert.ok(retrieve('水温过高 177.17 摄氏度', 5, lf).length);
});

test('instrument display codes use their precise model table and retain legacy text search', t => {
  const card = loadKnowledgeSnapshot().chunks.find(chunk =>
    chunk.sourceId === lfSource && chunk.entryType === '维护/故障知识' && chunk.entryId && chunk.heading.includes('｜'));
  assert.ok(card);
  const original = fs.readFileSync;
  const mock = t.mock.method(fs, 'readFileSync', (...args: Parameters<typeof fs.readFileSync>) => {
    const data = original(...args);
    if (String(args[0]) !== path.resolve(card.source)) return data;
    const input = String(data);
    const newline = input.includes('\r\n') ? '\r\n' : '\n';
    const heading = `## ${card.heading}${newline}`;
    return input.replace(heading, `${heading}${newline}- 故障码：ERROR-8、ERROR-ENG、ERROR-41${newline}`);
  });
  t.after(() => { mock.mock.restore(); reloadKnowledgeSnapshot(); });
  reloadKnowledgeSnapshot();
  for (const query of ['东方红 LF1504 显示 error‑8', '故障码 ERROR-41 是什么', 'ERROR-ENG']) {
    assert.deepEqual(retrieve(query, 5, lf).map(chunk => chunk.entryId), [card.entryId]);
  }
  assert.deepEqual(retrieve('仪表故障怎么查', 5, { ...lf, faultCodes: ['ERROR-41'] })
    .map(chunk => chunk.entryId), [card.entryId]);
  assert.deepEqual(retrieve('故障码 ERROR-88', 5, lf), []);
  assert.ok(!archive(retrieve('ERROR-8', 5, { ...lf, model: 'LF99999' })).some(chunk => chunk.entryId === card.entryId));
  const legacy = retrieve('ERROR-ENG', 12, { brand: '久保田', model: 'M5-091' });
  assert.ok(legacy.some(chunk => chunk.entryId === 'KB-KB-M5-20261016-108'));
});

test('three-field displays preserve zeros and require a unique card for the exact model', async t => {
  const cards = loadKnowledgeSnapshot().chunks.filter(chunk =>
    chunk.sourceId === lfSource && chunk.entryType === '维护/故障知识' && chunk.entryId && chunk.heading.includes('｜'));
  const [target, differentSystem, conflicting, duplicate] = cards;
  assert.ok(target && differentSystem && conflicting && duplicate);
  const original = fs.readFileSync;
  const codes = [[target, '1 / 013 / 01'], [differentSystem, '2/013/01'],
    [conflicting, '3/204/05'], [duplicate, '3/204/05']] as const;
  const mock = t.mock.method(fs, 'readFileSync', (...args: Parameters<typeof fs.readFileSync>) => {
    const data = original(...args);
    return codes.filter(([card]) => String(args[0]) === path.resolve(card.source))
      .reduce<string | Buffer>((text, [card, code]) => {
        const input = String(text);
        const newline = input.includes('\r\n') ? '\r\n' : '\n';
        const heading = `## ${card.heading}${newline}`;
        return input.replace(heading, `${heading}${newline}- 故障码：${code}${newline}`);
      }, data);
  });
  t.after(() => { mock.mock.restore(); reloadKnowledgeSnapshot(); });
  reloadKnowledgeSnapshot();

  const executor = new ToolExecutor(buildContextRegistry());
  const response = await executor.execute('search_knowledge', {
    query: '东方红 LF1504 仪表跳出 1 ／ 013 ／ 01 是什么', context: lf, limit: 5,
  });
  assert.equal(response.ok, true);
  const hits = JSON.parse(response.content).chunks;
  assert.deepEqual(hits.map((chunk: KnowledgeChunk) => [chunk.entryId, chunk.faultCodes, chunk.applicability]),
    [[target.entryId, ['1/013/01'], 'matched']]);
  assert.deepEqual(retrieve('如何处理仪表报警？', 5, { ...lf, faultCodes: ['2 / 013 / 01'] }).map(chunk => chunk.entryId),
    [differentSystem.entryId]);
  for (const query of ['故障码 1/013/02 是什么', '3/204/05', '013/01', '1/013',
    '故障码 013/01 是什么意思', '故障码 1/013 是什么意思', '故障码 1/13/01', '故障码 1/013/1']) {
    assert.deepEqual(retrieve(query, 5, lf), [], query);
  }
  assert.deepEqual(retrieve('1/013/01', 5), []);
  assert.deepEqual(retrieve('1/013/01', 5, { ...lf, model: 'LF99999' }), []);
  assert.deepEqual(retrieve('怎么查？', 5, { ...lf, faultCodes: ['1 / 013'] }), []);
  assert.ok(retrieve('东方红 LF1504 水温过高，原单号 1/999/99', 5, lf).length);
  assert.equal(resolveScope('井关 TJW1233 故障码 3/204/05', { brand: 'ISEKI', model: 'TJW1233' }).identityConflict, false);
});

test('hydraulic test-port labels remain in the query without conflicting with tractor identity', () => {
  const context = { machineType: '拖拉机', brand: 'Belarus', model: '3522.5' };
  for (const query of [
    '前后悬挂同时举升乏力且无异响时测 M3 压力',
    '前后悬挂同时举升乏力且无异响时测压口 M3 怎么测',
    'hydraulic lift is weak at pressure test port M3',
  ]) {
    assert.equal(resolveScope(query, context).identityConflict, false, query);
    assert.ok(queryWithoutIdentity(query).includes('M3'), query);
  }
  for (const query of ['机型 M3 的前后悬挂压力怎么测', '机型 6E-1204(G4) 的测压口 M3 怎么测']) {
    assert.equal(resolveScope(query, context).identityConflict, true, query);
  }
});

test('component and general candidates never become direct repair evidence through a high score', () => {
  const reviewed: KnowledgeChunk = {
    source: 'fixture.md', heading: 'TEST-TIER-001｜起动困难', text: '合成接口测试，不是维修资料。',
    entryId: 'TEST-TIER-001', sourceId: 'SOURCE-TIER-001',
    indexedReference: { entryId: 'TEST-TIER-001', sourceId: 'SOURCE-TIER-001' },
    brand: '东方红', model: 'LF904S', entryType: '维护/故障知识', applicability: 'matched',
    locator: '合成PDF第1页', version: '合成版', scopeBoundary: '仅用于合成LF904S测试', status: '已核验',
    relevance: { score: 100, method: 'keyword-weighted-overlap', calibrated: false },
    diagnosticMetadata: { coverage: { symptom: true, causes: true, checks: true, repair: true }, riskLevel: 'low' },
  };
  for (const tier of ['component', 'general'] as const) {
    const result = DiagnosisRouter.decide({
      query: '起动困难怎么办', currentQuery: '起动困难怎么办',
      scope: { brand: '东方红', model: 'LF904S' }, clarificationNeeded: false, llmConfigured: true,
      retrieved: [{ ...reviewed, retrieval: { tier, basis: ['合成层级限制'], referenceOnly: true } }],
    });
    assert.equal(result.candidates?.[0].directEligible, false, tier);
    assert.notEqual(result.reason, 'direct_reference', tier);
    assert.notEqual(result.evidenceLevel, 'direct_reference', tier);
  }
});

test('retrieval cache deeply clones tier explanations and reload invalidates the same generation', () => {
  clearRetrievalCache();
  const first = retrieve('东方红 LF1504 水温过高', 12, lf);
  const expected = structuredClone(first);
  assert.ok(first.some(chunk => chunk.retrieval?.basis.length));
  first.find(chunk => chunk.retrieval)!.retrieval!.basis.push('must not enter cache');
  assert.deepEqual(retrieve('东方红 LF1504 水温过高', 12, lf), expected);
  const generation = retrievalStats().generation;
  reloadKnowledgeSnapshot();
  assert.deepEqual(retrieve('东方红 LF1504 水温过高', 12, lf), expected);
  assert.equal(retrievalStats().generation, generation + 1);
});

test('failed highest-ranked references are removed before top-k selection', t => {
  const query = '东方红 LF1504 起动机不转';
  const originalFirst = retrieve(query, 1, lf)[0];
  assert.ok(originalFirst?.entryId && originalFirst.sourceId === lfSource);
  const entriesPath = path.resolve('知识库/整理后的知识库/农用拖拉机知识库/entries.jsonl');
  const read = fs.readFileSync;
  const mock = t.mock.method(fs, 'readFileSync', (...args: Parameters<typeof fs.readFileSync>) => {
    const data = read(...args);
    if (String(args[0]) !== entriesPath) return data;
    return String(data).split(/\r?\n/).map(line => {
      if (!line.trim()) return line;
      const entry = JSON.parse(line) as { entry_id: string; status: string };
      return entry.entry_id === originalFirst.entryId
        ? JSON.stringify({ ...entry, status: '核验失败；已核验' }) : line;
    }).join('\n');
  });
  t.after(() => { mock.mock.restore(); reloadKnowledgeSnapshot(); });
  reloadKnowledgeSnapshot();
  assert.equal(referenceVerification(loadKnowledgeSnapshot().chunks.find(chunk => chunk.entryId === originalFirst.entryId)!.status), 'failed');
  const found = retrieve(query, 1, lf);
  assert.equal(found.length, 1, 'an admissible candidate should fill the vacated slot');
  assert.notEqual(found[0].entryId, originalFirst.entryId);
  assert.ok(found.every(chunk => referenceVerification(chunk.status) !== 'failed'));
});

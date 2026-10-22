import assert from 'node:assert/strict';
import fs from 'node:fs';
import { before, test } from 'node:test';
import {
  formatForPrompt,
  loadKnowledgeBase,
  retrieve as retrieveAll,
  stats,
  type KnowledgeChunk,
} from '../server/knowledge/retriever';
import { buildSystemPrompt } from '../server/knowledge/systemPrompt';
import { generateLocalKnowledgeReply } from '../server/knowledge/fallbackDiagnosis';
import { resolveScope, type RetrievalContext } from '../server/knowledge/scope';
import { peekKnowledgeSnapshot } from '../server/knowledge/snapshot';

const tractor = { machineType: '拖拉机' };
const workmaster = { ...tractor, brand: '纽荷兰', model: 'WORKMASTER25' };
const startQuery = '钥匙在 START，启动电机不转';

// Model-specific regressions inspect archive hits; general learning is tested separately.
function retrieve(query: string, k = 6, context: RetrievalContext = {}): KnowledgeChunk[] {
  return retrieveAll(query, k, context).filter(chunk => chunk.entryType !== '通识学习');
}

/** Generic hint files, reached directly: open questions now rank archive + 通识 above them (2026-10-22). */
function genericHints(query: string): KnowledgeChunk[] {
  const terms = [...query.matchAll(/[\u4e00-\u9fa5]{2}/g)].map((match) => match[0]);
  return (peekKnowledgeSnapshot()?.chunks ?? []).filter((chunk) => !chunk.entryId && chunk.heading !== '(概述)')
    .map((chunk) => ({ chunk, score: terms.filter((term) => `${chunk.heading}${chunk.text}`.includes(term)).length }))
    .filter(({ score }) => score > 0).sort((a, b) => b.score - a.score).slice(0, 2).map(({ chunk }) => chunk);
}

function archived(chunks: KnowledgeChunk[]) {
  return chunks.filter((chunk) => chunk.entryId && chunk.entryType !== '通识学习');
}

function expectEntry(chunks: KnowledgeChunk[], entryId: string): KnowledgeChunk {
  const chunk = chunks.find((item) => item.entryId === entryId);
  assert.ok(chunk, `Expected archived entry ${entryId}; received ${chunks.map((item) => item.entryId ?? item.heading).join(', ')}`);
  return chunk;
}

function expectIdentityConflict(query: string, context: RetrievalContext) {
  const { message, retrieved } = buildSystemPrompt({ query, ...context });
  assert.equal(retrieved.length, 0, query);
  assert.equal(retrieve(query, 100, context).length, 0, query);
  assert.match(generateLocalKnowledgeReply(query, retrieved, context), /请确认本次咨询对象/);
  assert.match(message.content, /不得生成诊断结论、操作步骤或维修参数/);
  assert.doesNotMatch(message.content, /适用性：品牌／型号匹配/);
}

before(() => {
  loadKnowledgeBase();
});

test('indexes each archived entry exactly once and preserves the 9 existing chunks', () => {
  const indexed = fs.readFileSync('知识库/整理后的知识库/农用拖拉机知识库/entries.jsonl', 'utf8')
    .trim().split(/\r?\n/).map((line) => JSON.parse(line) as {
      entry_id: string; source_id: string; title: string; brand: string; model: string; models?: string[]; entry_type: string;
    });
  const sources = JSON.parse(fs.readFileSync('知识库/整理后的知识库/农用拖拉机知识库/sources.json', 'utf8')) as {
    source_id: string; models?: string[];
  }[];
  const sourceModels = new Map(sources.map((source) => [source.source_id, source.models]));
  assert.equal(stats().archivedEntries, indexed.length);
  assert.equal(stats().chunks, indexed.length + stats().learningEntries + 9);
  const entries = indexed.map(({ entry_id, source_id, title, brand, model, models, entry_type }) => {
    let exactModel = models?.[0] ?? sourceModels.get(source_id)?.[0] ?? model;
    const range = sourceModels.get(source_id);
    const titleModels = resolveScope(title, {}).models.filter((item) => !['国三', '国四'].includes(item));
    const rangeModels = new Set(range?.flatMap((item) => resolveScope('', { model: item }).models));
    // A manual-index title can ask about the whole documented range; repair entries stay exact.
    if (entry_type === '资料索引' && range && titleModels.length > 1 && titleModels.every((item) => rangeModels.has(item))) {
      exactModel = range.join('/');
    }
    const found = retrieve(title, indexed.length, { ...tractor, brand, model: exactModel });
    const chunk = expectEntry(found, entry_id);
    assert.ok(chunk.sourceId);
    assert.deepEqual(chunk.indexedReference, { entryId: chunk.entryId, sourceId: chunk.sourceId });
    assert.ok(chunk.sourceUrl);
    assert.ok(chunk.originalPath);
    assert.ok(chunk.locator);
    assert.ok(chunk.version);
    assert.ok(chunk.scopeBoundary);
    assert.ok(chunk.status);
    return chunk.entryId;
  });
  assert.equal(new Set(entries).size, indexed.length);
});

test('source model lists select only an exact documented John Deere configuration', () => {
  const entryId = 'KB-JD-6E-G4-OMTR115296-004';
  for (const brand of ['约翰迪尔', 'John Deere']) {
    const context = { ...tractor, brand, model: '6E-1204(G4)' };
    const found = retrieve('不能起动应先区分起动机是否转动', 100, context);
    const chunk = expectEntry(found, entryId);
    assert.equal(chunk.sourceId, 'SRC-JD-6E-G4-OMTR115296');
    assert.equal(chunk.applicability, 'matched');
    expectEntry(retrieve(`${brand} 6E-1204(G4) 不能起动`), entryId);
  }
  for (const model of ['6E-1204', '6E-1204(G3)', '6E-1204(G5)', '6E-1204-X(G4)', '6E-1604(G4)']) {
    assert.equal(retrieve('不能起动', 100, { ...tractor, brand: '约翰迪尔', model }).length, 0, model);
    assert.equal(retrieve(`John Deere ${model} 不能起动`, 100).length, 0, model);
  }
  assert.equal(retrieve('John Deere 6E-1204(G4) 量子纠缠').length, 0);
});

test('new brand aliases and source-declared model families remain distinct', () => {
  expectEntry(retrieve('原件与适用范围', 100, { ...tractor, brand: 'YTO', model: 'LF804S' }), 'KB-YTO-LF-MANUAL-001');
  expectEntry(retrieve('YTO LF804S 原件与适用范围', 100), 'KB-YTO-LF-MANUAL-001');
  expectEntry(retrieve('原件与适用范围', 100, { ...tractor, brand: 'Weitai', model: 'TT804(G4)' }), 'KB-WT-TRACTOR-MANUAL-001');
  assert.equal(retrieve('原件与适用范围', 100, { ...tractor, brand: 'Weitai', model: 'TT804(G5)' }).length, 0);
  assert.equal(retrieve('原件与适用范围', 100, { ...tractor, brand: '久保田', model: 'LF804S' }).length, 0);
  expectEntry(retrieve('原件与适用范围', 100, { ...tractor, brand: 'Lovol', model: 'TX平台' }), 'KB-LV-TX-TRAINING-001');
});

test('CAB-only LX2620 entries require an exact documented CAB model', () => {
  const query = 'CAB驾驶室内循环与新风滤网清洁条件 空调冷凝器滤网';
  const cabIds = ['KB-LX2620-014', 'KB-LX2620-015'];
  for (const model of ['LX2620HSDC', 'LX2620HSDCC']) {
    const context = { ...tractor, brand: '久保田', model };
    for (const entryId of cabIds) {
      const entry = expectEntry(retrieve(query, 100, context), entryId);
      assert.equal(entry.requiresExactModel, true);
      expectEntry(retrieve(`Kubota ${model} ${query}`, 100), entryId);
    }
  }
  for (const model of ['LX2620', 'LX2620SU', 'LX2620HSD', 'LX2620SUHSD', 'LX2620/LX2620SU', 'LX2620HSDCX']) {
    for (const found of [
      retrieve(query, 100, { ...tractor, brand: '久保田', model }),
      retrieve(`久保田 ${model} ${query}`, 100),
    ]) assert.ok(found.every((entry) => !cabIds.includes(entry.entryId ?? '')), model);
  }
  assert.ok(retrieve(query, 100, { ...tractor, brand: '久保田' })
    .every((entry) => !cabIds.includes(entry.entryId ?? '')));
  assert.ok(retrieve('ROPS防翻架 内循环与新风滤网 空调冷凝器', 100, { ...tractor, brand: '久保田', model: 'LX2620HSDC' })
    .every((entry) => !cabIds.includes(entry.entryId ?? '')));
  // The manual's shared radiator check still applies to the documented SU model.
  expectEntry(retrieve('散热格栅与滤网清洁', 100, { ...tractor, brand: '久保田', model: 'LX2620SUHSD' }), 'KB-LX2620-010');
});

test('new US manual identities stay separate and cannot establish Chinese emission compatibility', () => {
  for (const [model, entryId, sourceId, query] of [
    ['M6060', 'KB-KB-M6060-005', 'SRC-KB-M6060-3C13199724', 'DPF消声器周围易燃物检查'],
    ['M7060', 'KB-KB-M6060-006', 'SRC-KB-M6060-3C13199724', '保险丝熔断先查原因'],
    ['M5-091', 'KB-KB-M5-001', 'SRC-KB-M5-3B79199724', '禁止短接起动端子'],
    ['M5-111', 'KB-KB-M5-004', 'SRC-KB-M5-3B79199724', '液压高压泄漏不能用手探查'],
  ]) {
    const context = { ...tractor, brand: '久保田', model };
    const found = retrieve(query, 100, context);
    expectEntry(found, entryId);
    assert.ok(found.every((entry) => entry.sourceId === sourceId), model);
    expectEntry(retrieve(`Kubota ${model} ${query}`, 100), entryId);
    assert.equal(retrieve(`国四 ${query}`, 100, context).length, 0, model);
    assert.equal(retrieve(`国三 ${query}`, 100, context).length, 0, model);
  }
  for (const model of ['M7040', 'M6061', 'M5-092', 'M5-111(G4)']) {
    assert.equal(retrieve('起动 油位 液压', 100, { ...tractor, brand: '久保田', model }).length, 0, model);
  }
  for (const query of ['M6060 CAB ROPS位置与安全带使用条件', 'M7060驾驶室 DPF消声器', 'CAB 保险丝熔断']) {
    assert.equal(retrieve(query, 100, { ...tractor, brand: '久保田', model: 'M6060' }).length, 0, query);
  }
  assert.equal(retrieve('久保田 M6060 CAB ROPS位置与安全带使用条件', 100).length, 0);
  expectEntry(retrieve('久保田 M6060 ROPS位置与安全带使用条件', 100), 'KB-KB-M6060-001');
  for (const drive of ['2WD', '两驱', '二轮驱动']) {
    assert.equal(retrieve(`久保田 M6060 ${drive} 变速箱油位检查`, 100).length, 0, drive);
    assert.equal(retrieve(`${drive} DPF消声器周围易燃物检查`, 100, { ...tractor, brand: '久保田', model: 'M6060' }).length, 0, drive);
  }
  expectEntry(retrieve('久保田 M6060 四驱 ROPS位置与安全带使用条件', 100), 'KB-KB-M6060-001');
  // Mixed-scope M5 source has no single whole-manual drive configuration.
  expectEntry(retrieve('久保田 M5-091 2WD 禁止短接起动端子', 100), 'KB-KB-M5-001');
});

test('Weitai chapter differences remain verification information rather than a combined starting procedure', () => {
  const context = { ...tractor, brand: '潍泰', model: 'TT804(G4)' };
  const query = '起动前操纵位置的章节差异与实车核对';
  const found = retrieve(query, 100, context);
  assert.equal(found[0]?.entryId, 'KB-WT-TRACTOR-MANUAL-002');
  assert.equal(found[0].entryType, '资料核验');
  const reply = generateLocalKnowledgeReply(query, found, context);
  assert.match(reply, /【来源与适用信息】/);
  assert.match(reply, /不能据此生成一套通用起动步骤/);
  assert.match(reply, /中立／下降/);
  assert.doesNotMatch(reply, /【建议排查】/);
  assert.equal(retrieve('国四 起动操纵位置', 100, context).length, 0);
});

test('navigation-system aliases do not establish equivalence to conflicting model fields or whole tractors', () => {
  const entryId = 'KB-QX-QY210PRO-V01-003';
  for (const brand of ['千寻位置', '千耘']) {
    expectEntry(retrieve('未定位与交接垄不准', 100, { ...tractor, brand, model: 'QY210Pro' }), entryId);
    expectEntry(retrieve(`${brand} QY210 Pro 未定位与交接垄不准`, 100), entryId);
  }
  assert.equal(retrieve('未定位与交接垄不准', 100, { ...tractor, brand: '千耘', model: 'QYBD-2.5GD' }).length, 0);
  assert.equal(retrieve('千耘 QYBD-2.5GD 未定位与交接垄不准', 100).length, 0);
  assert.equal(retrieve('未定位与交接垄不准', 100, { ...tractor, brand: '鸿鹄', model: 'QY210Pro' }).length, 0);
});

test('researched domestic brands without applicable entries return insufficient knowledge', () => {
  for (const brand of ['常发', 'Changfa', '黄海金马', '金马', 'Jinma', '时风', 'Shifeng']) {
    const query = `${brand} 发动机水温过高`;
    assert.equal(retrieve(query, 100, tractor).length, 0, brand);
    assert.equal(retrieve('发动机水温过高', 100, { ...tractor, brand }).length, 0, brand);
    assert.match(generateLocalKnowledgeReply(query, [], { ...tractor, brand }), /资料不足/);
  }
});

test('Wode WF national-three manuals match exact models and refuse national-four reuse', () => {
  const context = { ...tractor, brand: '沃得', model: 'WF1404-3' };
  const entry = expectEntry(retrieve('磨合 牵引负荷', 100, context), 'KB-WD-WF-003');
  assert.equal(entry.emissionStage, '国三');
  expectEntry(retrieve('沃得 WF1404-3 国三 磨合', 100), 'KB-WD-WF-003');
  assert.equal(retrieve('沃得 WF1404-3 国四 磨合', 100).length, 0);
  assert.equal(retrieve('国四 磨合', 100, context).length, 0);
  assert.equal(retrieve('沃得 WF1204-1(G4) 磨合', 100).length, 0);
  expectEntry(retrieve('沃得 WF1604 副离合器调整', 100), 'KB-WD-WF-104');
  expectEntry(retrieve('沃得 WF1504-2 离合器打滑', 100), 'KB-WD-WF-007');
});

test('CHCNAV NX510 navigation entries retrieve under aliases without whole-tractor equivalence', () => {
  const entryId = 'KB-CHC-NX510-006';
  for (const brand of ['华测', '华测导航', 'CHCNAV']) {
    expectEntry(retrieve('开机 状态栏', 100, { ...tractor, brand, model: 'NX510' }), entryId);
  }
  expectEntry(retrieve('华测 NX510 开机要点', 100), entryId);
  const found = expectEntry(retrieve('华测 NX510 开机要点', 100), entryId);
  assert.equal(found.applicability, 'matched');
  assert.equal(retrieve('开机 状态栏', 100, { ...tractor, brand: '鸿鹄', model: 'NX510' }).length, 0);
  expectIdentityConflict('鸿鹄 T70 失联 避障', { ...tractor, brand: '华测', model: 'NX510' });
  expectEntry(retrieve('华测 NX510 失联 避障', 100, { ...tractor, brand: '华测', model: 'NX510' }), 'KB-CHC-NX510-008');
});

test('LF1504 emission evidence is preserved and a national-four query cannot reuse its national-three manual', () => {
  const context = { ...tractor, brand: '东方红', model: 'LF1504' };
  const entry = expectEntry(retrieve('起动机不转与转动无力', 100, context), 'KB-YTO-LF1504-007');
  assert.equal(entry.emissionStage, '国三');
  expectEntry(retrieve('东方红 LF1504 国三 起动机不转', 100), 'KB-YTO-LF1504-007');
  assert.equal(retrieve('东方红 LF1504 国四 起动机不转', 100).length, 0);
  assert.equal(retrieve('国四 起动机不转', 100, context).length, 0);
  assert.equal(retrieve('起动机不转', 100, { ...context, model: 'LF1504(G4)' }).length, 0);
  assert.equal(retrieve('国三 不能起动', 100, { ...tractor, brand: '约翰迪尔', model: '6E-1204(G4)' }).length, 0);
});

test('national-emission spellings work in queries and model fields without equating overseas standards', () => {
  const context = { ...tractor, brand: '东方红', model: 'LF1504' };
  const query = '起动机不转';
  for (const stage of ['国三', '国3', '国III', '国Ⅲ', '国 iii']) {
    expectEntry(retrieve(`东方红 LF1504 ${stage} ${query}`, 100), 'KB-YTO-LF1504-007');
    expectEntry(retrieve(query, 100, { ...context, model: `LF1504 ${stage}` }), 'KB-YTO-LF1504-007');
    expectEntry(retrieve(query, 100, { ...context, model: `LF1504(${stage})` }), 'KB-YTO-LF1504-007');
    expectEntry(retrieve(`雷沃 ${stage} 发动机电气接头与传感器`, 100), 'LV-NR3-001');
    expectEntry(retrieve('发动机电气接头与传感器', 100, {
      ...tractor, brand: '雷沃', model: `${stage}拖拉机`,
    }), 'LV-NR3-001');
  }
  for (const stage of ['国四', '国4', '国IV', '国Ⅳ', '国 iv']) {
    const cases = [
      { query: `东方红 LF1504 ${stage} ${query}`, context: {} },
      { query, context: { ...context, model: `LF1504 ${stage}` } },
      { query, context: { ...context, model: `LF1504(${stage})` } },
      { query: `雷沃 ${stage} 发动机电气接头与传感器`, context: {} },
      { query: `雷沃 国三拖拉机 ${stage} 发动机电气接头与传感器`, context: {} },
      { query: '发动机电气接头与传感器', context: {
        ...tractor, brand: '雷沃', model: `${stage}拖拉机`,
      } },
      { query: `${stage} 发动机电气接头与传感器`, context: {
        ...tractor, brand: '雷沃', model: '国三拖拉机',
      } },
      { query: '国三拖拉机 发动机电气接头与传感器', context: {
        ...tractor, brand: '雷沃', model: `${stage}拖拉机`,
      } },
    ];
    for (const item of cases) {
      const found = retrieve(item.query, 100, item.context);
      assert.equal(found.length, 0, item.query);
      const reply = generateLocalKnowledgeReply(item.query, found, item.context);
      assert.match(reply, /未检索到与问题及已知机型相符的知识条目/);
      assert.doesNotMatch(reply, /已找到对应品牌／型号的资料|【检索到的知识】/);
    }
  }
  for (const standard of ['Tier IV', 'Stage IV']) {
    expectEntry(retrieve(`久保田 M6060 ${standard} DPF消声器周围易燃物检查`, 100), 'KB-KB-M6060-005');
  }
  // Emission normalization must not erase an unsupported model suffix.
  assert.equal(retrieve(query, 100, { ...context, model: 'LF1504-X 国III' }).length, 0);
  assert.equal(retrieve(`东方红 LF1504-X 国III ${query}`, 100).length, 0);
});

test('ranks a model-specific starting fault ahead of the generic sample', () => {
  const found = retrieve(startQuery, 6, workmaster);
  assert.equal(found[0]?.entryId, 'NH-WM25-003');
  assert.ok(found.every((chunk) => chunk.sourceId === 'SRC-NH-WM25-92157408'));
  assert.equal(expectEntry(found, 'NH-WM25-003').applicability, 'matched');
});

test('electric hand tools preserve diesel-manual scope while electric tractors stay excluded', () => {
  const context = { ...tractor, brand: '久保田', model: 'M5-091' };
  for (const query of ['DEF排放塞装回不用电动工具', 'DEF排放塞能用电动扳手吗', 'DEF drain plug electric tools']) {
    assert.equal(resolveScope(query, context).electric, false, query);
    expectEntry(retrieve(query, 912, context), 'KB-KB-M5-20261013-092');
  }
  for (const query of ['电动拖拉机的DEF排放塞能用电动工具吗', 'electric tractor DEF drain plug electric tools']) {
    assert.equal(resolveScope(query, context).electric, true, query);
    assert.equal(archived(retrieve(query, 912, context)).length, 0, query);
  }
  assert.equal(archived(retrieve('DEF排放塞电动工具', 912, { ...context, machineType: '新能源农机' })).length, 0);
});

test('finds representative steering, storage and autonomous-operation entries', () => {
  const wobble = retrieve('前轮摆动', 6, { ...tractor, brand: '雷沃', model: '欧豹TG系列' });
  assert.equal(wobble[0]?.entryId, 'LV-TG-002');
  const storage = retrieve('冬季长期存放的防锈与封护', 6, { ...tractor, brand: '东风' });
  assert.equal(storage[0]?.entryId, 'DF-WINTER-001');
  assert.equal(storage[0]?.applicability, 'pending');
  const lostLink = retrieve('无人作业失联，定位失效', 6, { ...tractor, brand: '鸿鹄', model: 'T70' });
  assert.equal(lostLink[0]?.entryId, 'HH-T70-002');
});

test('accepts supported model aliases in context and in a recognizable query', () => {
  for (const model of ['WORKMASTER 25', 'WORKMASTER25']) {
    expectEntry(retrieve(startQuery, 6, { ...workmaster, model }), 'NH-WM25-003');
    expectEntry(retrieve(`纽荷兰 ${model} ${startQuery}`), 'NH-WM25-003');
  }
  for (const model of ['LX2620', 'LX2620SU', 'LX2620/LX2620SU', 'LX2620-LX2620SU']) {
    expectEntry(retrieve('发动机启动困难', 6, { ...tractor, brand: '久保田', model }), 'KB-LX2620-003');
    expectEntry(retrieve(`久保田 ${model} 发动机启动困难`), 'KB-LX2620-003');
  }
  for (const model of ['欧豹TG', 'TG系列']) {
    expectEntry(retrieve('前轮摆动', 6, { ...tractor, brand: '雷沃', model }), 'LV-TG-002');
    expectEntry(retrieve(`雷沃 ${model} 前轮摆动`), 'LV-TG-002');
  }
  expectEntry(retrieve('中联 PL系列 发动机无法启动'), 'ZL-PL-003');
  expectEntry(retrieve('鸿鹄 T70 无人作业失联'), 'HH-T70-002');
  expectEntry(retrieve('雷沃 国三 发动机电气接头与传感器'), 'LV-NR3-001');
});

test('does not apply WORKMASTER25 entries to WORKMASTER25S or an unsupported model', () => {
  for (const model of ['WORKMASTER25S', 'WORKMASTER 25S', 'WORKMASTER35']) {
    assert.equal(archived(retrieve(startQuery, 100, { ...workmaster, model })).length, 0, model);
    assert.equal(archived(retrieve(`纽荷兰 ${model} ${startQuery}`, 100)).length, 0, model);
  }
});

test('conflicting query and context identities require confirmation before any retrieval', () => {
  const kubota = { ...tractor, brand: '久保田', model: 'LX2620' };
  const conflicts = [
    { query: '东方红 LF1504 发动机启动困难', context: kubota },
    { query: '纽荷兰 WORKMASTER25 发动机过热', context: kubota },
    { query: '久保田 M5-111 发动机机油油位检查', context: kubota },
    { query: '久保田 L2502 发动机启动困难', context: kubota },
    { query: '型号 L2502 发动机启动困难', context: kubota },
    { query: '机型：L2502 发动机启动困难', context: kubota },
    { query: 'M5-111 发动机机油油位检查', context: { ...tractor, model: 'LX2620' } },
    { query: '东方红 起动机不转', context: { ...tractor, brand: '久保田' } },
    { query: '久保田 LX2620 发动机过热', context: { ...tractor, brand: '纽荷兰' } },
    { query: '久保田 M7060 变速箱油位检查', context: { ...tractor, brand: '久保田', model: 'M6060' } },
    { query: '久保田 LX2620 M5-111 发动机机油油位检查', context: kubota },
    { query: '久保田 LX2620/LX2620SU 发动机启动困难', context: kubota },
    { query: '久保田 M5-111 发动机启动困难', context: { ...kubota, model: 'LX2620/LX2620SU' } },
    { query: '久保田 东方红 发动机启动困难', context: kubota },
    { query: '东方红 LF1504-X 国III 起动机不转', context: { ...tractor, brand: '东方红', model: 'LF1504' } },
  ];
  for (const { query, context } of conflicts) expectIdentityConflict(query, context);

  const tg = retrieve('雷沃 国三 发动机电气接头与传感器', 100, {
    ...tractor, brand: '雷沃', model: '欧豹TG系列',
  });
  assert.ok(archived(tg).every((chunk) => chunk.entryId?.startsWith('LV-TG-')));
});

test('consistent aliases and subsets of an explicit manual model range remain retrievable', () => {
  const kubota = { ...tractor, brand: '久保田', model: 'LX2620' };
  for (const item of [
    { query: 'Kubota LX 2620 发动机启动困难', context: kubota },
    { query: '久保田 LX2620 发动机启动困难', context: { ...tractor, brand: 'Kubota', model: 'LX 2620' } },
    { query: '发动机启动困难', context: kubota },
    { query: '久保田 发动机启动困难', context: { ...tractor, model: 'LX2620' } },
    { query: 'LX2620 发动机启动困难', context: { ...tractor, brand: '久保田' } },
    { query: '久保田 LX2620 / LX 2620 发动机启动困难', context: kubota },
    { query: '久保田 Err1 发动机启动困难', context: kubota },
    { query: '久保田 故障码P0015 发动机启动困难', context: kubota },
    { query: '故障码：P0015 发动机启动困难', context: kubota },
    { query: '久保田 12V 发动机启动困难', context: kubota },
  ]) expectEntry(retrieve(item.query, 100, item.context), 'KB-LX2620-003');
  expectEntry(retrieve(`New Holland WORKMASTER 25 ${startQuery}`, 100, workmaster), 'NH-WM25-003');
  for (const model of ['LX2620/LX2620SU', 'LX2620-LX2620SU']) {
    const context = { ...kubota, model };
    for (const queryModel of ['LX2620', 'LX2620SU', 'LX2620/LX2620SU', 'LX2620-LX2620SU']) {
      expectEntry(retrieve(`久保田 ${queryModel} 发动机启动困难`, 100, context), 'KB-LX2620-003');
    }
  }
  for (const [model, queryModel] of [
    ['QY210Pro', 'QYBD-2.5SD'], ['QYBD-2.5SD', 'QY210 Pro'],
    ['QYBD-2.5SD（QY210 Pro）', 'QY210 Pro'], ['QY210Pro', 'QYBD-2.5SD（QY210 Pro）'],
  ]) {
    const context = { ...tractor, brand: '千寻位置', model };
    expectEntry(retrieve(`千耘 ${queryModel} 未定位与交接垄不准`, 100, context), 'KB-QX-QY210PRO-V01-003');
  }
  expectIdentityConflict('千耘 QYBD-2.5GD 未定位与交接垄不准', {
    ...tractor, brand: '千寻位置', model: 'QY210Pro',
  });
});

test('document references do not replace or conflict with the actual machine identity', () => {
  const context = { ...tractor, brand: '久保田', model: 'LX2620' };
  const references = [
    'SRC-KB-LX2620-6C82063118', 'KB-LX2620-003', 'SRC-YTO-LF1504-SMLF150449010',
    'SRC-QX-QY210PRO-V01', 'M5-111.pdf', 'SM-LF1504.49.010', '知识库/原始农机说明书/东方红/LF1504/来源记录.md',
    'https://example.com/YTO/LF1504/manual.pdf',
    '[东方红 LF1504说明书](https://example.com/LF1504.pdf)',
  ];
  for (const reference of references) {
    expectEntry(retrieve(`参考资料 ${reference}；发动机启动困难`, 100, context), 'KB-LX2620-003');
    expectEntry(retrieve(`参考资料 ${reference}；久保田 LX2620 发动机启动困难`, 100, context), 'KB-LX2620-003');
    expectIdentityConflict(`参考资料 ${reference}；久保田 M5-111 发动机启动困难`, context);
    assert.equal(retrieve(`${reference} 量子纠缠`, 100).length, 0);
  }
  // A filename must not swallow the real identity in surrounding unspaced text.
  expectIdentityConflict('东方红LF1504参阅M5-111.pdf，发动机启动困难', context);
  for (const delimiter of ['，', '；', '。', '：', ',', ';', ':', '.']) {
    expectEntry(retrieve(`发动机启动困难${delimiter}参见LX2620.md`, 100, context), 'KB-LX2620-003');
    expectEntry(retrieve(`参考https://example.com/M5-111.pdf${delimiter}发动机启动困难`, 100, context), 'KB-LX2620-003');
  }
  expectEntry(retrieve('东方红 LF1504，手册编号SM-LF1504.49.010，起动机不转', 100, {
    ...tractor, brand: '东方红', model: 'LF1504',
  }), 'KB-YTO-LF1504-007');
  expectIdentityConflict('东方红 LF1504.49.011 起动机不转', { ...tractor, brand: '东方红', model: 'LF1504' });
});

test('a tractor context cannot override a non-tractor identity in the question', () => {
  for (const machineType of ['联合收割机', '插秧机', '植保机', 'combine']) {
    expectIdentityConflict(`${machineType} 液压提升无力`, tractor);
    expectIdentityConflict(`${machineType} 久保田 LX2620 发动机启动困难`, {
      ...tractor, brand: '久保田', model: 'LX2620',
    });
  }
  expectIdentityConflict('拖拉机 液压提升无力', { machineType: '联合收割机' });
  assert.equal(resolveScope('拖拉机 液压提升无力', { machineType: '农机' }).identityConflict, false);
  expectEntry(retrieve('久保田 LX2620 拖拉机挂接播种机时发动机动力不足', 100, {
    ...tractor, brand: '久保田', model: 'LX2620',
  }), 'KB-LX2620-004');
  expectEntry(retrieve('PTO接播种机时防护罩要求', 100, {
    ...tractor, brand: '久保田', model: 'M6060',
  }), 'KB-KB-M6060-002');
  expectIdentityConflict('联合收割机挂接播种机时发动机动力不足', tractor);
});

test('unidentified equipment and non-tractor equipment do not receive tractor archive entries', () => {
  // 2026-10-22: an open question searches the archive too, but never as a matched manual.
  const open = archived(retrieve('发动机无法启动', 100));
  assert.ok(open.length > 0 && open.every((chunk) => chunk.applicability === 'pending'));
  for (const machineType of ['联合收割机', '插秧机', '植保机']) {
    const found = retrieve(`纽荷兰 WORKMASTER25 ${startQuery}`, 100, { ...workmaster, machineType });
    assert.equal(archived(found).length, 0, machineType);
  }
});

test('non-tractor equipment cannot receive tractor sample operations or parameters', () => {
  for (const machineType of ['联合收割机', '插秧机', '植保机', '播种机', 'combine', 'transplanter', 'sprayer']) {
    for (const item of [
      { query: '液压提升无力', context: { machineType } },
      { query: `${machineType} 液压提升无力`, context: {} },
    ]) {
      const found = retrieve(item.query, 100, item.context);
      assert.equal(found.length, 0, machineType);
      const reply = generateLocalKnowledgeReply(item.query, found, item.context);
      assert.match(reply, /未检索到与问题及已知机型相符的知识条目/);
      assert.doesNotMatch(reply, /【检索到的知识】|40–80|16–20|MPa/);
    }
  }
  assert.ok(retrieve('液压提升无力', 100).some((chunk) => chunk.heading === '四、液压系统故障'));
  assert.ok(retrieve('液压提升无力', 100, tractor).some((chunk) => chunk.heading === '四、液压系统故障'));
});

test('unidentified tractor questions collect information instead of returning unsourced repairs', () => {
  const unsourcedFacts = /5[–-]10\s*分钟|10[–-]15\s*mm|82\s*℃|40[–-]80|16[–-]20\s*MPa|13\.5\s*V|预热\s*2[–-]3\s*次|每\s*(?:50|100|200|500|1000)\s*小时|拧松喷油泵放气螺塞|泵油至无气泡|清洁或更换空滤|校喷油器与喷油泵|测发电机输出|齿轮泵磨损|调节器损坏|两侧制动片磨损不均/;
  const queries = [
    '发动机水温过高开锅，应该怎么处理',
    '发动机启动困难，冬季不能启动，怎么排空气',
    '动力不足冒黑烟，是否需要换空滤',
    '液压提升无力，正常油温和压力是多少',
    '充电指示灯常亮，发电机正常输出电压是多少',
    '制动跑偏转向沉重，是什么原因',
    '保养周期是多少小时，何时更换机油和液压油',
    '维修前安全规范，如何停机和隔离',
  ];
  for (const query of queries) {
    for (const context of [{}, tractor]) {
      // 2026-10-22: open questions now rank archive (pending) + 通识; none of it is a matched manual.
      assert.ok(retrieve(query, 6, context).every((chunk) => chunk.applicability !== 'matched'), query);
      // The generic information-collection hints keep their boundaries when they are what was found.
      const hints = genericHints(query);
      const { message, retrieved } = buildSystemPrompt({ query, ...context, retrieved: hints });
      assert.ok(retrieved.length > 0, query);
      assert.equal(archived(retrieved).length, 0, query);
      const reply = generateLocalKnowledgeReply(query, retrieved, context);
      assert.match(reply, /【当前资料不足】/);
      assert.match(reply, /【信息收集】/);
      assert.match(reply, /不是操作／维修依据/);
      assert.match(reply, /完整型号及后缀/);
      assert.doesNotMatch(reply, /【初步判断】|【可能原因】|【建议排查】|【检索到的知识】|【知识依据】/);
      for (const content of [formatForPrompt(retrieved), message.content, reply]) {
        assert.equal(typeof content, 'string');
        assert.doesNotMatch(content, unsourcedFacts, query);
      }
      assert.match(message.content, /不得据此列出或排序故障原因、生成维修／检测步骤、操作参数或保养周期/);
      assert.match(message.content, /不能为了填满输出模板编造内容/);
      assert.doesNotMatch(message.content, /按可能性从高到低列 2-4 条|按通用知识回答/);
    }
  }
});

test('verified model-specific parameters and procedures survive the generic guidance restriction', () => {
  const query = '发动机机油油位检查';
  const context = { ...tractor, brand: '久保田', model: 'M5-111' };
  const { message, retrieved } = buildSystemPrompt({ query, ...context });
  const chunk = expectEntry(retrieved, 'KB-KB-M5-005');
  assert.equal(chunk.applicability, 'matched');
  const reply = generateLocalKnowledgeReply(query, [chunk], context);
  for (const content of [message.content, reply]) {
    assert.equal(typeof content, 'string');
    assert.match(content, /熄火后至少等5分钟/);
    assert.match(content, /把车辆停在平整地面/);
    for (const metadata of [chunk.entryId, chunk.sourceId, chunk.version, chunk.locator, chunk.scopeBoundary]) {
      assert.ok(metadata && content.includes(metadata), `Missing archived evidence: ${metadata}`);
    }
  }
  assert.doesNotMatch(reply, /仅命中整理者编写的信息收集提示/);
});

test('declared electric equipment cannot receive incompatible diesel tractor archive instructions', () => {
  for (const machineType of ['新能源农机', 'New-energy']) {
    assert.equal(retrieve('发动机不着火', 100, { ...workmaster, machineType }).length, 0);
  }
  expectEntry(retrieve('无人作业失联', 6, { machineType: '无人农机', brand: '鸿鹄', model: 'T70' }), 'HH-T70-002');
});

test('model/source identifiers alone cannot turn an undocumented question into a knowledge hit', () => {
  for (const query of ['久保田 LX2620 量子纠缠', '纽荷兰 WORKMASTER 25 量子纠缠']) {
    assert.equal(retrieve(query).length, 0, query);
  }
  assert.equal(retrieve('量子纠缠', 6, workmaster).length, 0);
  assert.equal(retrieve('发动机过热', 6, { ...tractor, brand: '久保田', model: 'LX9999' }).length, 0);
});

test('retains source identifiers, original document location and applicability boundaries in the prompt', () => {
  const { message, retrieved } = buildSystemPrompt({ query: startQuery, ...workmaster });
  const chunk = expectEntry(retrieved, 'NH-WM25-003');
  assert.equal(chunk.sourceId, 'SRC-NH-WM25-92157408');
  assert.match(chunk.locator ?? '', /175/);
  assert.match(chunk.scopeBoundary ?? '', /25S/);
  for (const content of [formatForPrompt([chunk]), message.content]) {
    assert.equal(typeof content, 'string');
    for (const value of [chunk.entryId, chunk.sourceId, chunk.originalPath, chunk.locator, chunk.scopeBoundary]) {
      assert.ok(value && content.includes(value), `Missing source metadata: ${value}`);
    }
  }
});

test('the local archived reply quotes supported facts and source boundaries without inventing a diagnosis', () => {
  const chunks = retrieve(startQuery, 6, workmaster);
  const chunk = expectEntry(chunks, 'NH-WM25-003');
  const reply = generateLocalKnowledgeReply(startQuery, chunks, workmaster);
  assert.match(reply, /启动联锁条件未满足/);
  assert.match(reply, /不得向 HST 用户统一要求/);
  for (const value of [chunk.entryId, chunk.sourceId, chunk.originalPath, chunk.locator, chunk.scopeBoundary]) {
    assert.ok(value && reply.includes(value), `Missing local reply metadata: ${value}`);
  }
  assert.doesNotMatch(reply, /完成知识对齐与推理|疑似属于|对应功能部件磨损、老化或密封失效|供油、供电或液压回路压力异常|滤清器堵塞或油液品质不达标/);
});

test('information-only archive hits explain provenance without presenting maintenance guidance', () => {
  const cases = [
    {
      entryId: 'KB-LV-TX-TRAINING-001',
      query: '交机培训手册原件与适用范围',
      context: { ...tractor, brand: '雷沃', model: 'TX平台' },
    },
    {
      entryId: 'KB-BARB-HYDROTRAC-4HWD-001',
      query: '封面机型、发行日期与适用范围',
      context: { ...tractor, brand: 'Barbieri', model: 'HydroTRAC 4HWD' },
    },
  ];
  for (const { entryId, query, context } of cases) {
    const found = retrieve(query, 100, context);
    assert.equal(found[0]?.entryId, entryId);
    const reply = generateLocalKnowledgeReply(query, found, context);
    assert.match(reply, /【来源与适用信息】/);
    assert.match(reply, /不是操作／维修依据/);
    assert.ok(reply.includes(entryId));
    assert.ok(found[0].scopeBoundary && reply.includes(found[0].scopeBoundary));
    assert.doesNotMatch(reply, /【初步判断】|【可能原因】|【建议排查】|故障表中的可能原因需要检测验证|尚缺正式操作／维修手册/);
  }
});

test('T70 material remains background information and never produces diesel repair instructions', () => {
  const context = { ...tractor, brand: '鸿鹄', model: 'T70' };
  const query = '无人作业失联，定位失效';
  const { message, retrieved } = buildSystemPrompt({ query, ...context });
  const chunk = expectEntry(retrieved, 'HH-T70-002');
  const reply = generateLocalKnowledgeReply(query, retrieved, context);
  assert.match(reply, /尚未取得急停、失联、定位失效、电池高压/);
  assert.match(reply, /不得用普通柴油机启动\/充电流程替代/);
  assert.match(message.content, /仅用于机型识别及应用背景/);
  assert.ok(chunk.scopeBoundary && reply.includes(chunk.scopeBoundary));
  assert.doesNotMatch(reply, /拔出机油尺|柴油滤芯|喷油泵|检查燃油箱油量|疑似属于|测量系统工作压力/);
});

test('6M Chinese manual requires the documented G4 suffix and refuses report bare models', () => {
  const query = '高压共轨燃油管能自己拆吗';
  const context = { ...tractor, brand: '约翰迪尔' };
  for (const model of ['6M-1654(G4)', '6M-1854(G4)', '6M-2104(G4)']) {
    const found = archived(retrieve(query, 100, { ...context, model }));
    expectEntry(found, 'KB-JD-6M-OMAL232272-006');
    assert.ok(found.every((chunk) => chunk.sourceId === 'SRC-JD-6M-OMAL232272-03AUG2026'));
  }
  for (const model of ['6M-2104', '6M-2104(G3)', '6M-2304(G4)']) {
    assert.equal(archived(retrieve(query, 100, { ...context, model })).length, 0, model);
  }
});

test('LF manual additions preserve four-wheel-drive and cab-only maintenance limits', () => {
  const context = { ...tractor, brand: '东方红', model: 'LF804S' };
  expectEntry(retrieve('四驱更改轮距后验证前轮极限位置无干涉', 100, context), 'KB-YTO-LF-MANUAL-021');
  assert.ok(!retrieve('两驱更改轮距后验证前轮极限位置无干涉', 100, context)
    .some((chunk) => chunk.entryId === 'KB-YTO-LF-MANUAL-021'));
  expectEntry(retrieve('驾驶室清洗机罩待冷却使用低压水', 100, context), 'KB-YTO-LF-MANUAL-022');
  assert.ok(!retrieve('ROPS防翻架配置清洗机罩待冷却使用低压水', 100, context)
    .some((chunk) => chunk.entryId === 'KB-YTO-LF-MANUAL-022'));
});

test('reloading the index is idempotent and the original generic retrieval remains available', () => {
  const initial = stats();
  const first = loadKnowledgeBase();
  const second = loadKnowledgeBase();
  assert.deepEqual(first, second);
  assert.deepEqual(stats(), initial);
  assert.ok(genericHints('发动机水温过高开锅').some((chunk) => chunk.source === '01_通用原理/通用故障诊断.md' && chunk.heading.includes('水温过高')));
  const found = retrieve('发动机水温过高开锅');
  assert.ok(found.length > 0 && found.length <= 6);
  assert.ok(archived(found).every((chunk) => chunk.applicability === 'pending'));
});

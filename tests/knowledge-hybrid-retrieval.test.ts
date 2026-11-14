import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadKnowledgeBase, retrieve, retrieveWithDiagnostics, describeSource, vectorRecallStats } from '../server/knowledge/retriever';
import { buildVectorIndex, rankVectorCandidates, vectorFeatureHashes, VECTOR_RECALL_THRESHOLD } from '../server/knowledge/vectorRecall';
import { decideDiagnosisRoute } from '../server/diagnosis/router';

loadKnowledgeBase();

test('向量特征哈希：同一文本稳定，不同文本区分，空文本无特征', () => {
  const a = vectorFeatureHashes('拖拉机方向盘转向不灵敏');
  const b = vectorFeatureHashes('拖拉机方向盘转向不灵敏');
  const c = vectorFeatureHashes('拖拉机水温过高开锅');
  assert.deepEqual([...a.entries()].sort(), [...b.entries()].sort());
  assert.notDeepEqual([...a.keys()].sort(), [...c.keys()].sort());
  assert.equal(vectorFeatureHashes('').size, 0);
  assert.equal(vectorFeatureHashes('，。；').size, 0);
});

test('向量召回：同义表述排在前面，无关表述排在后面或被阈值滤掉', () => {
  // 每类主题各放两篇：df ≥ 2 的特征才建倒排表，单篇独有特征不参与召回。
  const index = buildVectorIndex([
    '方向盘转向不灵敏｜拖拉机方向盘转向不灵敏造成转向沉重',
    '方向盘转动费力｜方向盘转动费力转向泵流量低',
    '发动机水温偏高｜发动机水温偏高开锅冷却液不足',
    '发动机水温过高｜发动机水温过高冷却液缺少',
    '制动失灵｜拖拉机制动失灵刹车不灵刹不住',
    '制动跑偏｜拖拉机制动跑偏刹车一侧不灵',
  ]);
  assert.equal(index.documents, 6);
  const ranked = rankVectorCandidates(index, '方向盘转不动', [0, 1, 2, 3, 4, 5], 6, 0);
  assert.deepEqual(ranked.slice(0, 2).map(item => item.index).sort(), [0, 1]);
  assert.ok(ranked[1].cosine > ranked[2].cosine);
  assert.deepEqual(rankVectorCandidates(index, '方向盘转不动', [0, 1, 2, 3, 4, 5], 6, 0.99), []);
  assert.deepEqual(rankVectorCandidates(index, '', [0, 1, 2, 3, 4, 5], 6), []);
  assert.deepEqual(rankVectorCandidates(index, '方向盘转不动', [], 6), []);
});

test('向量召回：哈希 ≥2^31 的特征也能进倒排表（回归：Int32Array 会把它变负数丢掉）', () => {
  // 与 vectorRecall.ts 相同的 FNV-1a（偏移量 / 质数一致）：找一个二元、三元
  // 字串哈希全落在高半区（≥2^31）的三元词；有 bug 时它在文档向量里全丢，
  // 查询余弦会变成 0，测试即失败。
  const fnv = (s: string): number => {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
    return h;
  };
  let probe = '';
  const words = ['方向盘', '转向器', '提升器', '起动机', '制动器', '离合器', '变速箱', '散热器', '喷油嘴', '滤清器', '液压泵', '传动轴', '排气管', '节温器', '发电机', '蓄电池'];
  for (const word of words) {
    for (let i = 0; i + 3 <= word.length; i++) {
      const gram = word.slice(i, i + 3);
      if (fnv(gram.slice(0, 2)) >= 2 ** 31 && fnv(gram.slice(1, 3)) >= 2 ** 31 && fnv(gram) >= 2 ** 31) {
        probe = gram;
        break;
      }
    }
    if (probe) break;
  }
  assert.ok(probe, '应找到二元/三元哈希全在高半区的三元词');
  const index = buildVectorIndex([
    `测试甲｜拖拉机${probe}工作正常`,
    '测试乙｜拖拉机水温过高开锅',
    `测试丙｜农机${probe}需要检查`,
  ]);
  const ranked = rankVectorCandidates(index, probe, [0, 1, 2], 3, 0);
  assert.ok([0, 2].includes(ranked[0].index), probe);
  assert.ok(ranked[0].cosine > 0.1, `cosine=${ranked[0].cosine}`);
  assert.ok(ranked[0].cosine > ranked[2].cosine);
});

test('混合检索对照：同一批问题，加向量前后 top-6 命中与错召', () => {
  const questions: { q: string; ctx?: Record<string, string> }[] = [
    { q: '东方红 LF804S 启动机不转' },
    { q: '东方红 LF804S 车子发动不起来' },
    { q: '东方红 LF804S 打火没反应' },
    { q: '拖拉机发动机声音不对劲' },
    { q: '拖拉机方向盘转不动' },
    { q: '拖拉机刹车踩下去没反应' },
    { q: '拖拉机液压油管漏了' },
    { q: '拖拉机水温太高怎么办' },
    { q: '拖拉机爬坡没力气' },
    { q: '拖拉机提升器升不起来' },
    { q: '发动机冒黑烟没劲' },
    { q: '拖拉机换挡卡住了挂不进去' },
    { q: '东方红 LF804S 启动困难', ctx: { brand: '久保田', model: 'LX2620' } },
    { q: '发动机启动困难', ctx: { machineType: '拖拉机', brand: '久保田', model: 'LX9999' } },
  ];
  let gains = 0;
  let losses = 0;
  let keywordPlusVector = 0;
  for (const { q, ctx } of questions) {
    const off = retrieve(q, 6, ctx ?? {}, { vectorRecall: false });
    const on = retrieve(q, 6, ctx ?? {});
    const offIds = new Set(off.map(chunk => chunk.entryId));
    const onIds = new Set(on.map(chunk => chunk.entryId));
    for (const id of offIds) if (!onIds.has(id)) losses++;
    for (const id of onIds) if (id && !offIds.has(id)) gains++;
    // 主路不变：关键词命中的首条、分数都不变；向量只补位，不挤掉任何命中。
    assert.equal(on[0]?.entryId, off[0]?.entryId, q);
    assert.equal(on[0]?.relevance?.score, off[0]?.relevance?.score, q);
    assert.ok(on.filter(chunk => !chunk.entryId).length >= off.filter(chunk => !chunk.entryId).length, q);
    // 仅向量命中的上限：归档 ≤2、通识 ≤1；且一律 referenceOnly、分 0。
    const vectorOnly = on.filter(chunk => chunk.retrieval?.recall === 'vector');
    assert.ok(vectorOnly.filter(chunk => chunk.entryType !== '通识学习').length <= 2, q);
    assert.ok(vectorOnly.filter(chunk => chunk.entryType === '通识学习').length <= 1, q);
    for (const chunk of vectorOnly) {
      assert.equal(chunk.relevance?.score, 0, q);
      assert.equal(chunk.retrieval?.referenceOnly, true, q);
      assert.match(describeSource(chunk), /向量语义召回候选/);
    }
    for (const chunk of on) {
      if (chunk.retrieval?.recall === 'keyword+vector') keywordPlusVector++;
    }
  }
  // 14 问里至少补回 1 条（提升器同义表述），且 0 丢失。
  assert.equal(losses, 0);
  assert.ok(gains >= 1, `gains=${gains}`);
  assert.ok(keywordPlusVector >= 1, `keyword+vector=${keywordPlusVector}`);
  const stats = vectorRecallStats();
  assert.equal(stats.documents, 13483);
  assert.ok(stats.features > 100000, `features=${stats.features}`);
  // 构建耗时随机器负载波动很大（空闲约 4–12s，负载 40 时约 44s）；上限只防
  // 构建失控，不作性能承诺。
  assert.ok(stats.buildMs > 0 && stats.buildMs < 120000, `buildMs=${stats.buildMs}`);
  console.log(`[hybrid-retrieval] 14 问：补回 ${gains} 条、丢失 ${losses} 条、关键词+向量双支持 ${keywordPlusVector} 条；`
    + `向量索引 ${stats.documents} 篇 / ${stats.features} 特征 / 构建 ${stats.buildMs}ms / 阈值 ${VECTOR_RECALL_THRESHOLD}`);
});

test('混合检索：服务层自带身份前缀的无主题问题不靠通用词召回', () => {
  // 诊断服务传给检索的 query 自带“品牌 型号 机型”前缀；向量查询去掉身份词与
  // 机型通用词后只剩“量子纠缠”，库里没有任何相关特征，必须返回空结果。
  // 回归：只去掉身份词时，“拖拉机”三个字串就能让短篇过阈值，把无结果问题
  // 变成 insufficient_evidence（见 diagnosis-interaction-api 的 HTTP metadata 测试）。
  const ctx = { machineType: '拖拉机', brand: '东方红', model: 'LF1504' };
  assert.deepEqual(retrieve('东方红 LF1504 拖拉机 量子纠缠', 6, ctx), []);
  assert.equal(retrieveWithDiagnostics('东方红 LF1504 拖拉机 量子纠缠', 6, ctx).outcome, 'no_results');
  assert.deepEqual(retrieve('量子纠缠', 6, ctx), []);
});

test('混合检索：仅向量命中的高风险条目不把路由推向 safe', () => {
  // 回归（planner-integration “原故障恢复”）：011 是高风险条目（冷却系统），
  // 向量补位把它带进检索后，路由器曾因 indexedHighRisk 把“冷却液泄漏检查
  // 正常”判为 safe，观察没记上、原故障流程被打断。向量-only 是语义猜测，
  // 不能触发高风险升级；路由应与关向量时一致（local）。
  const ctx = { machineType: '拖拉机', brand: '东方红', model: 'LF1504' };
  const on = retrieve('东方红 LF1504 拖拉机 水温过高 冷却液泄漏检查正常', 6, ctx);
  assert.ok(on.some(chunk => chunk.entryId === 'KB2000-20261015-YTOLF1504-011'));
  const decision = decideDiagnosisRoute({ query: '东方红 LF1504 拖拉机 水温过高 冷却液泄漏检查正常',
    currentQuery: '冷却液泄漏检查正常', scope: ctx, retrieved: on, clarificationNeeded: false, llmConfigured: false });
  assert.notEqual(decision.route, 'safe');
  const off = retrieve('东方红 LF1504 拖拉机 水温过高 冷却液泄漏检查正常', 6, ctx, { vectorRecall: false });
  const decisionOff = decideDiagnosisRoute({ query: '东方红 LF1504 拖拉机 水温过高 冷却液泄漏检查正常',
    currentQuery: '冷却液泄漏检查正常', scope: ctx, retrieved: off, clarificationNeeded: false, llmConfigured: false });
  assert.equal(decision.route, decisionOff.route);
});

test('混合检索：归档关键词为空时向量候选不抢占结果头，排在结构引用之后', () => {
  // 回归（planner-integration “原故障恢复”）：该问的归档关键词命中为空，
  // 010/005 只是结构引用；向量条目 011 若排到它们前面，会改写 primary 判定，
  // 让“冷却液泄漏检查正常”不再被记为 cooling-leak 观察。向量只能补在尾部。
  const ctx = { machineType: '拖拉机', brand: '东方红', model: 'LF1504' };
  const on = retrieve('东方红 LF1504 拖拉机 水温过高 冷却液泄漏检查正常', 6, ctx);
  const vectorAt = on.findIndex(chunk => chunk.entryId === 'KB2000-20261015-YTOLF1504-011');
  assert.ok(vectorAt >= 0, '向量应补回 011');
  assert.ok(on.slice(0, vectorAt).some(chunk => chunk.entryId === 'KB2000-20261015-YTOLF1504-010'));
  assert.ok(on.slice(0, vectorAt).some(chunk => chunk.entryId === 'KB-YTO-LF1504-005'));
  assert.equal(on[0].retrieval?.recall, 'keyword');
  assert.equal(on[vectorAt].retrieval?.recall, 'vector');
});

test('混合检索：提升器同义表述补回同组件参考条目，关键词片段保留在前', () => {
  const off = retrieve('拖拉机提升器升不起来', 6, {}, { vectorRecall: false });
  const on = retrieve('拖拉机提升器升不起来', 6, {});
  assert.equal(off.length, 1);
  assert.equal(off[0].entryId, undefined);
  assert.equal(on[0].entryId, undefined);
  assert.equal(on[0].relevance?.score, off[0].relevance?.score);
  const gained = on.find(chunk => chunk.entryId === 'KB-WZ-TSME-0470');
  assert.ok(gained, '向量应补回提升器同组件条目');
  // 注：去掉机型通用词前补回的是 KB2000-20261015-WDWF21-049（余弦约 0.20，
  // 其中“拖拉机”三个字串贡献了大部分）；去掉后它的余弦掉到阈值以下，现补
  // 回的是同组件条目 KB-WZ-TSME-0470（提升器的调整，余弦 0.12）。
  assert.equal(gained.retrieval?.recall, 'vector');
  assert.equal(gained.retrieval?.referenceOnly, true);
  assert.equal(gained.relevance?.score, 0);
});

test('混合检索：关键词命中只备注向量支持，不改分数；显式编号查找不走向量', () => {
  const on = retrieve('东方红 LF804S 启动机不转', 6, {});
  const top = on.find(chunk => chunk.entryId === 'KB-YTO-LF-MANUAL-007')!;
  assert.equal(top.retrieval?.recall, 'keyword+vector');
  assert.ok(Math.abs(top.relevance!.score - 10.95) < 1e-9);
  const lookup = retrieve('KB-YTO-LF-MANUAL-007', 6, { brand: '东方红', model: 'LF804S' });
  assert.equal(lookup[0]?.entryId, 'KB-YTO-LF-MANUAL-007');
  assert.equal(lookup[0]?.retrieval?.recall, 'keyword');
});

test('混合检索：未知型号、排放不匹配时仍无归档条目，不靠向量补位', () => {
  const ctx = { machineType: '拖拉机', brand: '久保田', model: 'LX9999' };
  const unknown = retrieve('发动机启动困难', 6, ctx);
  const unknownOff = retrieve('发动机启动困难', 6, ctx, { vectorRecall: false });
  assert.ok(unknown.length > 0);
  assert.ok(unknown.every(chunk => chunk.entryType === '通识学习' && chunk.retrieval?.referenceOnly));
  assert.deepEqual(unknown.map(chunk => chunk.entryId), unknownOff.map(chunk => chunk.entryId));
  const diagnosed = retrieveWithDiagnostics('发动机启动困难', 6, ctx);
  const diagnosedOff = retrieveWithDiagnostics('发动机启动困难', 6, ctx, { vectorRecall: false });
  assert.equal(diagnosed.outcome, diagnosedOff.outcome);
  assert.notEqual(diagnosed.outcome, 'sufficient');
  assert.ok(diagnosed.chunks.every(chunk => !chunk.entryId || chunk.entryType === '通识学习'));

  assert.deepEqual(retrieve('东方红 LF804S 启动困难', 6, { brand: '久保田', model: 'LX2620' }), []);
  const emissionMismatch = retrieve('东方红 LF804S 国三排放启动困难', 6, { brand: '东方红', model: 'LF804S' });
  assert.ok(emissionMismatch.every(chunk => !chunk.entryId || chunk.entryType === '通识学习'));
  assert.ok(retrieveWithDiagnostics('东方红 LF804S 国三排放启动困难', 6, { brand: '东方红', model: 'LF804S' }).chunks
    .every(chunk => !chunk.entryId || chunk.entryType === '通识学习'));
});

test('混合检索：仅向量命中的条目只作参考，路由器永不把它判为直接证据', () => {
  const on = retrieve('拖拉机提升器升不起来', 6, {});
  assert.ok(on.some(chunk => chunk.entryId === 'KB-WZ-TSME-0470'));
  const decision = decideDiagnosisRoute({ query: '拖拉机提升器升不起来', currentQuery: '拖拉机提升器升不起来',
    scope: {}, retrieved: on, clarificationNeeded: false, llmConfigured: false });
  assert.ok(!decision.directEligibleIds?.includes('KB-WZ-TSME-0470'));
  assert.notEqual(decision.evidenceLevel, 'direct_reference');
  assert.equal(decision.retrievalOutcome, 'insufficient_evidence');
});

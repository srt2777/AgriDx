import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadArchive } from '../server/knowledge/archive';
import { getKnowledgeCatalog } from '../server/knowledge/catalog';
import { buildDiagnosticReply } from '../server/diagnosis/reply';
import { decideCoordination } from '../server/knowledge/coordination';
import { resolveScope } from '../server/knowledge/scope';
import { referenceVerification } from '../server/knowledge/evidence';
import { loadKnowledgeBase, retrieve } from '../server/knowledge/retriever';

const sourceId = 'SRC-NH-T1254B-T1404B-91783224';
const batch = loadArchive().chunks.filter(chunk => chunk.sourceId === sourceId);
loadKnowledgeBase();

test('说明书首批有188个独立编号、人工选页、逐项候选及型号边界', () => {
  assert.equal(batch.length, 188);
  assert.equal(new Set(batch.map(chunk => chunk.entryId)).size, 188);
  assert.deepEqual(batch.reduce<Record<string, number>>((counts, chunk) => {
    counts[chunk.entryType!] = (counts[chunk.entryType!] ?? 0) + 1;
    return counts;
  }, {}), { '安全操作': 28, '操作/维护知识': 38, '维护/故障知识': 122 });
  for (const chunk of batch) {
    assert.deepEqual(chunk.models, ['T1254B', 'T1404-B']);
    assert.equal(chunk.requiresExactModel, true);
    assert.equal(chunk.emissionStageUnknown, true);
    assert.equal(chunk.emissionStage, undefined);
    assert.equal(referenceVerification(chunk.status), 'verified');
    assert.match(chunk.locator!, /PDF第\d+页；印刷第\d+-\d+页/);
    assert.match(chunk.scopeBoundary!, /配置|选装/);
    assert.match(chunk.text, /SRC-NH-T1254B-T1404B-91783224/);
    if (chunk.entryType === '维护/故障知识') {
      assert.deepEqual(chunk.roles, ['symptom', 'cause', 'action']);
      assert.match(chunk.text, /原表可能原因：/);
      assert.match(chunk.text, /不能单凭现象确诊/);
      assert.match(chunk.text, /手册处理方向：/);
    }
  }
});

test('只有精确型号能查到手册条目，近似型号和未知排放不借用参数', () => {
  const sample = batch.find(chunk => chunk.heading.includes('标准型燃油箱标称容量'))!;
  for (const model of ['T1254B', 'T1404-B']) {
    const context = { machineType: '拖拉机', brand: '纽荷兰', model };
    const match = retrieve(sample.heading, 20, context).find(chunk => chunk.entryId === sample.entryId);
    assert.ok(match, model);
    assert.equal(match.applicability, 'matched');
    assert.match(match.text, /标准型燃油箱容量为 250\.0 L/);
    assert.match(match.text, /其他配置/);
    const catalog = getKnowledgeCatalog({ collection: 'all', q: sample.entryId }).library!;
    assert.equal(catalog.total, 1);
    assert.equal(catalog.entries[0].content, sample.text);
  }
  for (const context of [
    { brand: '纽荷兰' },
    { brand: '纽荷兰', model: 'T1404' },
    { brand: '纽荷兰', model: 'T1404-B-G4' },
    { brand: '东方红', model: 'T1254B' },
  ]) {
    assert.ok(retrieve(sample.heading, 100, { machineType: '拖拉机', ...context })
      .every(chunk => chunk.sourceId !== sourceId));
  }
  assert.ok(retrieve('国四 燃油箱容量', 100, { machineType: '拖拉机', brand: '纽荷兰', model: 'T1254B' })
    .every(chunk => chunk.sourceId !== sourceId));
});


test('电动指令变速器不会误判为电动拖拉机，资料范围不冒充维修建议', () => {
  const context = { machineType: '拖拉机', brand: '纽荷兰', model: 'T1254B' };
  const transmission = retrieve('电动指令变速器的挡域', 100, context);
  assert.ok(transmission.some(chunk => chunk.entryId === 'KB-NH-T14-20261031-0056'));
  assert.equal(resolveScope('电动指令变速器的挡域', context).electric, false);
  assert.equal(resolveScope('电动拖拉机行驶故障', {}).electric, true);
  assert.ok(retrieve('起动器不工作：蓄电池或起动电动机连接松动或腐蚀', 100, context)
    .some(chunk => chunk.entryId === 'KB-NH-T14-20261031-0180'));
  const query = '发动机无法启动或很难启动，燃油液位过低，该怎么检查？';
  const retrieved = retrieve(query, 6, context);
  const coordination = decideCoordination({ query, currentQuery: query, scope: context, retrieved, llmConfigured: false });
  const reply = buildDiagnosticReply({ query, chunks: retrieved, scope: context, coordination });
  assert.ok(reply.suggestions.every(item => !item.text.includes('本册参数不得套用')));
  assert.ok(retrieved.some(item => item.sourceId === sourceId && item.scopeBoundary?.includes('未知条件不推断')));
});

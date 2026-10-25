import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { getKnowledgeCatalog, loadKnowledgeCatalog } from '../server/knowledge/catalog';
import { ALARM_AT, CHECKS, DEMO_RECORD_KEY, DURATION, EVIDENCE_ID, OUTAGE_AT, clampTime,
  demoEvidence, diagnosisDraft, frame, parseRecords, type DemoRecord } from '../src/pages/FaultDetectionPage/demo';
import { catalogParts, resolveSelection, selectionForPart } from '../src/components/parts-tractor/parts-catalog';
import { canAutoReload, registerUpdateGuard } from '../src/features/updates/update-safety';

test('预设告警只在温度场景的指定时间触发，不以示例温度作维修阈值', () => {
  assert.equal(frame('temperature', ALARM_AT - 1).alert, false);
  assert.equal(frame('temperature', ALARM_AT).alert, true);
  assert.equal(frame('temperature', 0).alert, false);
  for (const scenario of ['quiet', 'outage'] as const) for (let i = 0; i <= DURATION; i++) assert.equal(frame(scenario, i).alert, false);
  assert.equal(clampTime(NaN), 0);
  assert.equal(clampTime(999), DURATION);
});
test('断流后只保留最后样本时间和值，当前状态未知，回放可恢复', () => {
  const last = frame('outage', OUTAGE_AT - 1);
  for (const at of [OUTAGE_AT, 90, DURATION]) {
    const sample = frame('outage', at);
    assert.equal(sample.offline, true);
    assert.equal(sample.sampleAt, last.sampleAt);
    for (const metric of ['temperature', 'rpm', 'pressure'] as const) assert.equal(sample[metric], last[metric]);
  }
  assert.equal(frame('outage', 0).offline, false);
});
test('资料使用实际归档接口，核对原条目、范围、页码及来源，不回填其他机型', () => {
  loadKnowledgeCatalog();
  const catalog = getKnowledgeCatalog({ collection: 'archive', q: EVIDENCE_ID });
  const entry = demoEvidence(catalog);
  assert.ok(entry, '演示资料必须在实际目录中可读取');
  assert.match(entry.content, /冷却|过热/);
  assert.match(entry.locator, /130/);
  assert.ok(entry.scopeBoundary);
  assert.ok(entry.sourceUrl);
  assert.equal(demoEvidence(null), null);
  assert.equal(demoEvidence({ ...catalog, library: { ...catalog.library!, entries: [{ ...entry, brand: '其他品牌' }] } }), null);
  assert.equal(demoEvidence({ ...catalog, library: { ...catalog.library!, entries: [] } }), null);
});
test('演示记录过滤损坏数据，数量有限制，与真实诊断存储分离', () => {
  const valid: DemoRecord = { scenario: 'quiet', at: 5, checkId: 'scope', note: '待核对' };
  assert.deepEqual(parseRecords(JSON.stringify([null, {}, valid, { ...valid, scenario: 'real' }, { ...valid, at: -1 }, { ...valid, note: 'a'.repeat(1001) }])), [valid]);
  assert.deepEqual(parseRecords('{invalid'), []);
  assert.equal(parseRecords(JSON.stringify(Array(110).fill(valid))).length, 100);
  assert.match(DEMO_RECORD_KEY, /fault-demo/);
  assert.equal(CHECKS.length, 4);
});
test('聊天仅带模拟标识的有界预填，隔离场景记录，不携带自动发送指令', () => {
  const rows: DemoRecord[] = Array.from({ length: 100 }, () => ({ scenario: 'temperature', at: 50, checkId: 'review', note: '演示'.repeat(400) }));
  rows.push({ scenario: 'quiet', at: 1, checkId: 'scope', note: '其他场景私有笔记' });
  const draft = diagnosisDraft('temperature', 45, rows, true);
  assert.match(draft.question, /模拟演示，未连接实车/);
  assert.doesNotMatch(draft.question, /其他场景私有笔记/);
  assert.ok(draft.question.length < 2000);
  assert.equal('autoSend' in draft, false);
});
test('只在柴油模型定位到实际存在的关联部件，不使用故障着色暗示损坏', () => {
  assert.ok(catalogParts('diesel').some(part => part.partId === 'radiator'));
  assert.equal(resolveSelection(selectionForPart('radiator'))?.node.partId, 'radiator');
  const model = readFileSync(new URL('../src/pages/FaultDetectionPage/FaultModel.tsx', import.meta.url), 'utf8');
  assert.match(model, /modelId="diesel"/);
  assert.match(model, /faultPartId=\{null\}/);
});
test('旧工作台页面消费统一遥测hook和有界回放，不再前端生成参数帧', () => {
  const page = readFileSync(new URL('../src/pages/FaultDetectionPage/FaultDetectionPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /useTelemetry\(\{ modelId: 'diesel', partId: 'engine'/);
  assert.match(page, /buildReplayTimeline/);
  assert.doesNotMatch(page, /frame\(scenario/);
  assert.doesNotMatch(page, /const METRICS/);
});
test('演示播放或未保存笔记阻止自动更新，解除后允许更新', () => {
  assert.equal(canAutoReload('/fault-detection'), false);
  const remove = registerUpdateGuard('fault-demo-test', '/fault-detection', true);
  assert.equal(canAutoReload('/fault-detection'), false);
  remove();
  const idle = registerUpdateGuard('fault-demo-test', '/fault-detection', false);
  assert.equal(canAutoReload('/fault-detection'), true);
  idle();
});

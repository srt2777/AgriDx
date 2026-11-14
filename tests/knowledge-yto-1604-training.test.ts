import assert from 'node:assert/strict';
import { test } from 'node:test';
import { retrieve } from '../server/knowledge/retriever';
import { referenceVerification } from '../server/knowledge/evidence';
import { loadKnowledgeSnapshot } from '../server/knowledge/snapshot';
import { createDiagnosticService } from '../server/diagnosis/service';

test('1604 and 1804 original training entries keep exact model boundaries', () => {
  const snapshot = loadKnowledgeSnapshot();
  const chunks = snapshot.chunks.filter(c => c.sourceId === 'SRC-YTO-1604-1804-HYD2015' || c.sourceId === 'SRC-YTO-1604-1804-TRANS2015');
  assert.equal(chunks.length, 19);
  assert.ok(!snapshot.manualSourceIds.includes('SRC-YTO-1604-1804-HYD2015'));
  assert.ok(!snapshot.manualSourceIds.includes('SRC-YTO-1604-1804-TRANS2015'));
  assert.ok(chunks.every(chunk => referenceVerification(chunk.status) === 'verified'));
  for (const chunk of chunks) {
    const models = chunk.models ?? [];
    for (const model of models) {
      const matching = retrieve(chunk.heading, 5, { brand: '东方红', model });
      assert.equal(matching[0]?.entryId, chunk.entryId, `${model} ${chunk.entryId}`);
      assert.ok(!retrieve(`东方红 ${model}(G4) ${chunk.heading}`, 20).some(c => c.entryId === chunk.entryId));
    }
  }
  const restricted = 'KB-YTO-1604-1804-HYD2015-008';
  assert.ok(!retrieve('三类悬挂调平', 20, { brand: '东方红', model: '1804' }).some(c => c.entryId === restricted));
});

test('YTO hitch training entries retrieve by matching model and exclude incompatible models', () => {
  loadKnowledgeSnapshot();
  const cases = [
    ['1804', 'KB-YTO-1804-IMPLEMENT2015-001', '东方红1804拖拉机长途运输三点悬挂的上拉杆怎么锁在固定支架上'],
    ['1804', 'KB-YTO-1804-IMPLEMENT2015-002', '东方红1804挂单轴拖车用哪个拖挂钩，牵引点高度怎样选'],
    ['1604', 'KB-YTO-1604-1804-HYD2015-009', '东方红1604悬挂下拉杆晃动，限位杆锁销插边孔还是中间孔'],
  ];
  for (const [model, id, query] of cases) {
    assert.equal(retrieve(query, 5, { brand: '东方红', model })[0]?.entryId, id);
    for (const wrong of [model === '1604' ? '1804' : '1604', 'LX1804', '1804(G4)', '1404']) {
      assert.ok(!retrieve(query, 20, { brand: '东方红', model: wrong }).some(chunk => chunk.entryId === id), `${id} ${wrong}`);
    }
  }
});

test('diagnosis attributes actual YTO training PDFs as paginated training resources', async () => {
  loadKnowledgeSnapshot();
  const diagnose = createDiagnosticService({ hasAnyConfigured: () => false, chat: async () => { throw new Error('unused'); } },
    { config: { logDecisions: false } });
  for (const [entryId, pages] of [
    ['KB-YTO-1604-1804-HYD2015-001', '12、19'],
    ['KB-YTO-1604-1804-TRANS2015-001', '21、45、46'],
  ]) {
    const response = await diagnose({ machineType: '拖拉机', brand: '东方红', model: '1604', diagnosisMode: 'knowledge_only',
      history: [{ role: 'user', content: `查看资料 ${entryId}` }] });
    const reference = response.knowledgeSources.find(source => source.entryId === entryId);
    assert.ok(reference, entryId);
    assert.match(reference.evidenceLabel!, /^资料：.*培训教程/);
    assert.equal(reference.pages?.pdf, pages);
    assert.equal(reference.pages?.printed, undefined);
    assert.equal(reference.referenceVerification, 'verified');
  }
});

test('legacy broad-range FAQ titles remain retrievable without asserting exact model coverage', () => {
  loadKnowledgeSnapshot();
  for (const [id, title] of [
    ['KB-YTO-EBUY-WFAQ-002', '动力输出不停转'],
    ['KB-YTO-EBUY-WFAQ-003', '动力输出离合器打滑'],
    ['KB-YTO-EBUY-WFAQ-004', '动力输出不转'],
    ['KB-YTO-EBUY-WFAQ-008', '动力输出压力过高或过低'],
    ['KB-YTO-EBUY-WFAQ-009', '差速锁压力过高或过低'],
    ['KB-YTO-EBUY-WFAQ-038', '动力输出压力不显示'],
  ]) {
    assert.ok(retrieve(title, 100, { brand: '东方红', model: '大中轮拖' }).some(c => c.entryId === id), id);
    for (const model of ['1604', '1804', '1404', '1504', 'LG1604', 'LX1604']) {
      assert.ok(!retrieve(title, 100, { brand: '东方红', model }).some(c => c.entryId === id), `${id} ${model}`);
    }
  }
});

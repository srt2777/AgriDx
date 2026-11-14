import assert from 'node:assert/strict';
import { test } from 'node:test';
import { retrieve } from '../server/knowledge/retriever';
import { referenceVerification } from '../server/knowledge/evidence';
import { loadKnowledgeSnapshot } from '../server/knowledge/snapshot';

test('1604 and 1804 original training entries keep exact model boundaries', () => {
  const snapshot = loadKnowledgeSnapshot();
  const chunks = snapshot.chunks.filter(c => c.sourceId === 'SRC-YTO-1604-1804-HYD2015' || c.sourceId === 'SRC-YTO-1604-1804-TRANS2015');
  assert.equal(chunks.length, 18);
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

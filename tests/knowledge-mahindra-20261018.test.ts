import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { loadArchive } from '../server/knowledge/archive';
import { getKnowledgeCatalog } from '../server/knowledge/catalog';
import { loadKnowledgeBase, retrieve } from '../server/knowledge/retriever';

const index = '知识库/整理后的知识库/农用拖拉机知识库';
const manifest = JSON.parse(fs.readFileSync(`${index}/采集记录/20261018_两批故障知识20条.json`, 'utf8')) as {
  added_entries: number; stages: { entry_ids: string[] }[];
};
const ids = manifest.stages.flatMap(s => s.entry_ids);
const archive = loadArchive().chunks;
const batch = archive.filter(c => ids.includes(c.entryId ?? ''));
loadKnowledgeBase();

test('本次二十条不重复计入旧十条，两个问题批次均为同册精确范围', () => {
  assert.equal(manifest.added_entries, 20);
  assert.equal(ids.length, 20);
  assert.equal(new Set(ids).size, 20);
  assert.equal(batch.length, 20);
  assert.equal(new Set(batch.map(c => c.text)).size, 20);
  for (const c of batch) {
    assert.equal(c.sourceId, 'SRC-MH-6065-6075-CAB-REV01');
    assert.deepEqual(c.models, ['6065', '6075']);
    assert.equal(c.configuration, 'CAB');
    assert.equal(c.driveConfiguration, '4WD');
    assert.equal(c.emissionStage, undefined);
    assert.match(c.text, /整理边界：/);
  }
});

test('二十条均可按两种完整型号检索，原机型目录与统一搜索返回同一正文', () => {
  for (const model of ['6065', '6075']) {
    const selected = getKnowledgeCatalog({ brand: 'Mahindra', model }).selected!;
    for (const c of batch) {
      const context = { machineType: '拖拉机', brand: 'Mahindra', model };
      assert.ok(retrieve(c.heading, 100, context).some(x => x.entryId === c.entryId), `${model}/${c.entryId}`);
      assert.equal(selected.entries.find(x => x.entryId === c.entryId)?.content, c.text);
      const unified = getKnowledgeCatalog({ collection: 'all', q: c.entryId }).library!;
      assert.equal(unified.total, 1);
      assert.equal(unified.entries[0].content, c.text);
      assert.equal(unified.entries[0].collection, 'archive');
    }
  }
});

test('跨页分组、合列压力与节温器重复行差异完整保留，不自行生成参数', () => {
  const entry = (n: number) => batch.find(c => c.entryId === `KB-MH-ENGINE-20261018-${String(n).padStart(3, '0')}`)!;
  assert.match(entry(2).locator ?? '', /110—111/);
  assert.match(entry(2).text, /续页.*制动拖滞/);
  assert.match(entry(7).locator ?? '', /111—112/);
  assert.match(entry(7).text, /续页.*PCV/);
  assert.match(entry(8).text, /节温器重复列出/);
  assert.match(entry(9).text, /压力过高与过低合列/);
  assert.match(entry(5).text, /四项处理栏全部为星号/);
  assert.match(entry(1).text, /与起动机不转\/转动缓慢分开/);
});

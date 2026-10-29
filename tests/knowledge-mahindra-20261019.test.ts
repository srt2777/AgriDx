import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { test } from 'node:test';
import { loadArchive } from '../server/knowledge/archive';
import { getKnowledgeCatalog } from '../server/knowledge/catalog';
import { generateLocalKnowledgeReply } from '../server/knowledge/fallbackDiagnosis';
import { loadKnowledgeBase, retrieve } from '../server/knowledge/retriever';

const index = '知识库/整理后的知识库/农用拖拉机知识库';
const manifest = JSON.parse(fs.readFileSync(`${index}/采集记录/20261019_烟色耗油后轮四条.json`, 'utf8')) as {
  added_entries: number; entry_ids: string[];
  baseline_integrity: { entries_bytes: number; entries_sha256: string; knowledge_documents: number;
    knowledge_sha256: string; hierarchy_sha256: string; components_sha256: string; other_sources_sha256: string };
};
// 3.5.10仅追加书名、子品牌和规范型号字段并统一主品牌；基线比较还原到追加前的来源形状。
const ADDED_3510 = ['sub_brand', 'product_line', 'brand_label', 'title_status', 'title_evidence', 'model_ids'];
const before3510 = <T extends Record<string, unknown>>(source: T): T => {
  const copy: Record<string, unknown> = { ...source };
  if (typeof copy.brand_label === 'string') copy.brand = copy.brand_label;
  if (copy.title_status !== undefined) delete copy.title;
  for (const field of ADDED_3510) delete copy[field];
  return copy as T;
};
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const read = (path: string) => fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const batch = loadArchive().chunks.filter(c => manifest.entry_ids.includes(c.entryId ?? ''));
loadKnowledgeBase();

test('续补四条保持4873行旧索引、67份正文、其他来源及原导航不变', () => {
  const base = manifest.baseline_integrity;
  const prefix = Buffer.from(read(`${index}/entries.jsonl`)).subarray(0, base.entries_bytes);
  assert.equal(hash(prefix), base.entries_sha256);
  const old = prefix.toString('utf8').trim().split('\n').map(line => JSON.parse(line) as { knowledge_path: string });
  assert.equal(old.length, 4873);
  const paths = [...new Set(old.map(e => e.knowledge_path))].sort();
  assert.equal(paths.length, base.knowledge_documents);
  assert.equal(hash(paths.map(p => `${p}\0${hash(read(p))}`).join('\n')), base.knowledge_sha256);
  const hierarchy = JSON.parse(read(`${index}/hierarchy.json`));
  assert.equal(hash(JSON.stringify(hierarchy.entries.slice(0, 4873))), base.hierarchy_sha256);
  assert.equal(hash(JSON.stringify(hierarchy.components)), base.components_sha256);
  const sources = JSON.parse(read(`${index}/sources.json`)) as { source_id: string }[];
  const historical = sources.slice(0, 28);
  assert.equal(historical.at(-1)?.source_id, 'SRC-MH-6065-6075-CAB-REV01');
  assert.equal(hash(JSON.stringify(historical.filter(s => s.source_id !== 'SRC-MH-6065-6075-CAB-REV01').map(before3510))), base.other_sources_sha256);
});

test('四个新现象有独立编号正文、页码和精确配置，不拆原因或合列烟色凑数', () => {
  assert.equal(manifest.added_entries, 4);
  assert.equal(new Set(manifest.entry_ids).size, 4);
  assert.equal(batch.length, 4);
  assert.equal(new Set(batch.map(c => c.text)).size, 4);
  for (const c of batch) {
    assert.equal(c.sourceId, 'SRC-MH-6065-6075-CAB-REV01');
    assert.deepEqual(c.models, ['6065', '6075']);
    assert.equal(c.configuration, 'CAB');
    assert.equal(c.driveConfiguration, '4WD');
    assert.equal(c.emissionStage, undefined);
    assert.match(c.text, /整理边界：/);
    assert.match(c.text, /经销商/);
    assert.match(c.version ?? '', /Rev 01/);
  }
  assert.match(batch[0].text, /PCV/);
  assert.match(batch[1].text, /合列黑烟与灰烟/);
  assert.match(batch[2].text, /不是既有机油消耗/);
  assert.match(batch[2].text, /不能在运转或带压状态/);
  assert.match(batch[3].text, /防止解除锁止后溜车/);
  assert.match(batch[3].locator ?? '', /PDF第115页／印刷第114页/);
});

test('两种完整型号与统一目录逐条返回唯一原文，隔离错型号和配置', () => {
  for (const model of ['6065', '6075']) {
    const selected = getKnowledgeCatalog({ brand: 'Mahindra', model }).selected!;
    for (const c of batch) {
      assert.ok(retrieve(c.heading, 100, { machineType: '拖拉机', brand: 'Mahindra', model }).some(x => x.entryId === c.entryId));
      const entry = selected.entries.find(x => x.entryId === c.entryId)!;
      assert.equal(entry.content, c.text);
      assert.equal(entry.locator, c.locator);
      assert.equal(entry.sourceUrl, c.sourceUrl);
      const unified = getKnowledgeCatalog({ collection: 'all', q: c.entryId }).library!;
      assert.equal(unified.total, 1);
      assert.equal(unified.entries[0].content, c.text);
      const reply = generateLocalKnowledgeReply(`${model} ${c.heading}`, [c], { machineType: '拖拉机', brand: 'Mahindra', model });
      for (const term of [c.entryId!, 'SRC-MH-6065-6075-CAB-REV01', 'Rev 01', 'PDF第', '经销商']) assert.ok(reply.includes(term), term);
    }
  }
  for (const context of [{ brand: 'Mahindra' }, { brand: 'Mahindra', model: '6000' }, { brand: 'Mahindra', model: '6066' }, { brand: '东方红', model: 'LX1004' }]) {
    assert.ok(!retrieve('蓝烟 黑烟 燃油消耗 后轮不转', 100, { machineType: '拖拉机', ...context }).some(c => manifest.entry_ids.includes(c.entryId ?? '')));
  }
  for (const condition of [{ configuration: 'ROPS' as const }, { driveConfiguration: '2WD' as const }, { emissionStage: '国四' as const }]) {
    assert.ok(!getKnowledgeCatalog({ brand: 'Mahindra', model: '6065', ...condition }).selected!.entries.some(c => manifest.entry_ids.includes(c.entryId)));
  }
});

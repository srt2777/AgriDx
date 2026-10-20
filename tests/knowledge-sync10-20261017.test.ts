import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { test } from 'node:test';
import { loadArchive } from '../server/knowledge/archive';
import { getKnowledgeCatalog, loadKnowledgeCatalog } from '../server/knowledge/catalog';
import { loadKnowledgeBase, retrieve } from '../server/knowledge/retriever';
import { generateLocalKnowledgeReply } from '../server/knowledge/fallbackDiagnosis';

const index = '知识库/整理后的知识库/农用拖拉机知识库';
const manifest = JSON.parse(fs.readFileSync(`${index}/采集记录/20261017_十条知识同步验证.json`, 'utf8')) as {
  entry_ids: string[];
  baseline_integrity: { entries_bytes: number; entries_sha256: string; knowledge_documents: number;
    knowledge_sha256: string; sources_sha256: string; hierarchy_sha256: string; components_sha256: string };
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
const batch = loadArchive().chunks.filter(c => manifest.entry_ids.includes(c.entryId ?? ''));
loadKnowledgeBase();
loadKnowledgeCatalog();

test('十条同步批次保留4853行索引、65份正文、旧来源和旧导航', () => {
  const base = manifest.baseline_integrity;
  const prefix = Buffer.from(fs.readFileSync(`${index}/entries.jsonl`, 'utf8').replace(/\r\n/g, '\n')).subarray(0, base.entries_bytes);
  assert.equal(hash(prefix), base.entries_sha256);
  const entries = prefix.toString('utf8').trim().split(/\r?\n/).map(line => JSON.parse(line) as { knowledge_path: string });
  assert.equal(entries.length, 4853);
  const paths = [...new Set(entries.map(e => e.knowledge_path))].sort();
  assert.equal(paths.length, base.knowledge_documents);
  assert.equal(hash(paths.map(p => `${p}\0${hash(fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n'))}`).join('\n')), base.knowledge_sha256);
  const sources = JSON.parse(fs.readFileSync(`${index}/sources.json`, 'utf8'));
  const hierarchy = JSON.parse(fs.readFileSync(`${index}/hierarchy.json`, 'utf8'));
  assert.equal(hash(JSON.stringify(sources.slice(0, 27).map(before3510))), base.sources_sha256);
  assert.equal(hash(JSON.stringify(hierarchy.entries.slice(0, 4853))), base.hierarchy_sha256);
  assert.equal(hash(JSON.stringify(hierarchy.components)), base.components_sha256);
});

test('十条均有唯一正文、来源及原页，继承6065/6075四驱驾驶室范围而不推断中国国四', () => {
  assert.equal(batch.length, 10);
  assert.equal(new Set(manifest.entry_ids).size, 10);
  for (const c of batch) {
    assert.equal(c.sourceId, 'SRC-MH-6065-6075-CAB-REV01');
    assert.deepEqual(c.models, ['6065', '6075']);
    assert.equal(c.configuration, 'CAB');
    assert.equal(c.driveConfiguration, '4WD');
    assert.equal(c.emissionStage, undefined);
    assert.match(c.version ?? '', /Rev 01/);
    assert.match(c.locator ?? '', /PDF第11[45]页／印刷第11[34]页/);
    assert.match(c.scopeBoundary ?? '', /不将Tier-4 Final换算为中国国四/);
    assert.match(c.text, /整理边界：/);
    assert.match(c.text, /未全书审校、厂家复核或实车验证/);
    assert.equal(c.entryType, '维护/故障知识');
  }
});

test('两种精确型号均能检索全部十条，网页目录逐条展示同一原Markdown正文', () => {
  for (const model of ['6065', '6075']) {
    const context = { machineType: '拖拉机', brand: 'Mahindra', model };
    const selected = getKnowledgeCatalog({ brand: 'Mahindra', model }).selected!;
    for (const c of batch) {
      assert.ok(retrieve(c.heading, 100, context).some(x => x.entryId === c.entryId), `${model}/${c.entryId}`);
      const entry = selected.entries.find(e => e.entryId === c.entryId);
      assert.ok(entry, c.entryId);
      assert.equal(entry.content, c.text);
      assert.equal(entry.locator, c.locator);
      assert.equal(entry.sourceUrl, c.sourceUrl);
    }
  }
  assert.ok(retrieve('Mahindra 6065 起动机不工作', 100).some(c => c.entryId === manifest.entry_ids[8]));
  assert.ok(retrieve('mahindra 6075 液压提升缓慢', 100).some(c => c.entryId === manifest.entry_ids[2]));
});

test('相似型号、其他品牌、ROPS、两驱或中国国四不套用本批资料', () => {
  for (const context of [
    { brand: 'Mahindra', model: '6066' }, { brand: 'Mahindra', model: '6000' },
    { brand: 'Mahindra' }, { brand: '东方红', model: 'LX1004' },
  ]) {
    assert.ok(!retrieve('起动机不工作', 100, { machineType: '拖拉机', ...context }).some(c => manifest.entry_ids.includes(c.entryId ?? '')));
  }
  for (const condition of [{ configuration: 'ROPS' as const }, { driveConfiguration: '2WD' as const }, { emissionStage: '国四' as const }]) {
    assert.equal(getKnowledgeCatalog({ brand: 'Mahindra', model: '6065', ...condition }).selected!.entries.length, 0);
  }
  for (const query of ['Mahindra 6065 ROPS 起动机不工作', 'Mahindra 6065 两驱 起动机不工作', 'Mahindra 6065 国四 起动机不工作']) {
    assert.ok(!retrieve(query, 100).some(c => manifest.entry_ids.includes(c.entryId ?? '')), query);
  }
});

test('实际资料答复保留星号经销商、原页与联锁安全边界', () => {
  const turbo = batch.find(c => c.entryId === manifest.entry_ids[0])!;
  const starter = batch.find(c => c.entryId === manifest.entry_ids[8])!;
  assert.match(turbo.text, /经销商/);
  assert.match(starter.text, /不短接起动机或旁路空挡\/PTO联锁/);
  const response = generateLocalKnowledgeReply('Mahindra 6065 涡轮增压器异响', [turbo], { machineType: '拖拉机', brand: 'Mahindra', model: '6065' });
  for (const pattern of [/SRC-MH-6065-6075-CAB-REV01/, /Rev 01/, /PDF第114页/, /经销商/]) assert.match(response, pattern);
});

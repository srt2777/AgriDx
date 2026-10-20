import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { getKnowledgeCatalog } from '../server/knowledge/catalog';
import { canonicalCatalogBrand } from '../shared/knowledge-catalog';

const sources = JSON.parse(fs.readFileSync('知识库/整理后的知识库/农用拖拉机知识库/sources.json', 'utf8')) as Array<Record<string, unknown>>;

test('每个来源都有书名或明确待核实状态，并有规范型号编号', () => {
  for (const source of sources) {
    const titled = (typeof source.title === 'string' && source.title.trim() !== '') || source.title_status === '待核实';
    assert.ok(titled, String(source.source_id));
    assert.ok(Array.isArray(source.model_ids) && source.model_ids.length > 0, String(source.source_id));
  }
  assert.match(String(sources.find(s => s.source_id === 'SRC-NH-WM25-92157408')?.title), /92157408/);
});

test('子品牌归入主品牌，旧品牌标签筛选仍映射到主品牌', () => {
  assert.ok(sources.filter(s => s.sub_brand === '欧豹').every(s => s.brand === '雷沃'));
  const p5000 = sources.find(s => s.source_id === 'SRC-LV-P5000-TRAINING');
  assert.equal(p5000?.brand, '雷沃');
  assert.equal(p5000?.sub_brand, '阿波斯');
  assert.equal(canonicalCatalogBrand('雷沃欧豹'), '雷沃');
  assert.equal(canonicalCatalogBrand('千寻位置 / 千耘'), '千寻位置');
  const names = getKnowledgeCatalog().brands.map(b => b.name);
  assert.ok(names.includes('雷沃') && !names.includes('雷沃欧豹') && !names.includes('雷沃阿波斯'));
  assert.equal(getKnowledgeCatalog({ brand: '雷沃阿波斯', model: 'P5000' }).selected?.brand, '雷沃');
});

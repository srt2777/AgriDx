import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { buildCommonDiagnosisQuestion, isCommonFramework, type CommonFrameworkDefinition } from '../shared/common-knowledge';
import { loadArchive } from '../server/knowledge/archive';
import { validateCommonDefinition } from '../server/knowledge/common';
import { getKnowledgeCatalog, loadKnowledgeCatalog } from '../server/knowledge/catalog';
import { parseKnowledgeCatalog } from '../ui/src/features/knowledge/catalog-api';
import { resolveScope } from '../server/knowledge/scope';
import { resolveDiagnosticContext } from '../server/knowledge/conversation';

const root = '知识库/整理后的知识库/农用拖拉机知识库';
const definition: CommonFrameworkDefinition = JSON.parse(fs.readFileSync(`${root}/通用框架.json`, 'utf8'));
const hierarchy = JSON.parse(fs.readFileSync(`${root}/hierarchy.json`, 'utf8'));
const archive = loadArchive().chunks;
const validate = (input: unknown) => validateCommonDefinition(input, archive, hierarchy.entries, hierarchy.components.map((x: { id: string }) => x.id));
loadKnowledgeCatalog();

test('通用问诊预填不把配置追问变成已确认的四驱条件，仍保留用户选择', () => {
  const tyre = definition.symptoms.find(x => x.id === 'tyre-wear')!;
  assert.ok(tyre.questions.some(x => x.includes('四驱')));
  const context = { machineType: '拖拉机', brand: '久保田', model: 'M6060' };
  const questionScope = (configurationText?: string) => {
    const resolved = resolveDiagnosticContext([{ role: 'user', content: buildCommonDiagnosisQuestion(tyre, configurationText) }], context);
    return resolveScope(resolved.query, resolved.scope);
  };
  const unknown = questionScope();
  assert.deepEqual(unknown.driveConfigurations, []);
  assert.deepEqual(unknown.configurations, []);
  assert.deepEqual(unknown.emissions, []);
  const confirmed = questionScope('ROPS、2WD、国三');
  assert.deepEqual(confirmed.driveConfigurations, ['2WD']);
  assert.deepEqual(confirmed.configurations, ['ROPS']);
  assert.deepEqual(confirmed.emissions, ['国三']);
  assert.equal(confirmed.identityConflict, false);
  assert.deepEqual(questionScope('4WD').driveConfigurations, ['4WD']);
});

test('通用入口组织全部目标，不返回跨机型维修正文，不把线索计为性能覆盖', () => {
  const catalog = getKnowledgeCatalog({ symptom: 'engine-power' });
  assert.equal(catalog.selected, undefined);
  assert.equal(catalog.common?.scope, 'archive');
  assert.equal(catalog.common?.systems.length, 15);
  assert.equal(catalog.common?.cells.length, 216);
  assert.ok(catalog.common?.questions.some(x => x.includes('负载变化')));
  assert.ok(catalog.common?.cells.filter(x => x.stageId === 'normal' || x.stageId === 'retest').every(x => x.status === 'gap'));
  assert.ok(!JSON.stringify(catalog).includes('候选为'));
  assert.equal(catalog.totals.archivedEntries, archive.length);
  assert.equal(parseKnowledgeCatalog(JSON.parse(JSON.stringify(catalog))).common?.selectedSymptom, 'engine-power');
});

test('同一表现匹配不同品牌的原证据，保留正文、页码与范围且避免症状混用', () => {
  const yto = getKnowledgeCatalog({ brand: '东方红', model: 'LF804S', symptom: 'starter-stopped' });
  const jd = getKnowledgeCatalog({ brand: '约翰迪尔', model: '5E-1004', symptom: 'starter-stopped' });
  assert.deepEqual(yto.selected?.entries.map(x => x.entryId), ['KB-YTO-LF-MANUAL-007']);
  assert.deepEqual(jd.selected?.entries.map(x => x.entryId), ['KB-JD-5E-D0-088']);
  for (const catalog of [yto, jd]) {
    const original = archive.find(x => x.entryId === catalog.selected!.entries[0].entryId)!;
    assert.equal(catalog.selected!.entries[0].content, original.text);
    assert.equal(catalog.selected!.entries[0].scopeBoundary, original.scopeBoundary);
    assert.equal(catalog.selected!.entries[0].locator, original.locator);
    assert.equal(catalog.common?.scope, 'model');
    assert.equal(catalog.common?.linkedEntries, 1);
  }
  const slow = getKnowledgeCatalog({ brand: '东方红', model: 'LF804S', symptom: 'starter-slow' });
  assert.deepEqual(slow.selected?.entries.map(x => x.entryId), ['KB-YTO-LF-MANUAL-008']);
});

test('未知型号、型号缺口及配套导航不会借用其他整机的维修证据', () => {
  assert.throws(() => getKnowledgeCatalog({ brand: '东方红', model: 'LF1504(G4)', symptom: 'engine-power' }), RangeError);
  assert.throws(() => getKnowledgeCatalog({ symptom: 'invented-symptom' }), RangeError);
  const missing = getKnowledgeCatalog({ brand: '鸿鹄', model: 'T70', symptom: 'engine-power' });
  assert.equal(missing.common?.linkedEntries, 0);
  assert.deepEqual(missing.selected?.entries, []);
  assert.ok(missing.selected?.gaps.some(x => x.includes('通用分类')));
  const nav = getKnowledgeCatalog({ brand: '千寻位置 / 千耘', model: 'QY210 Pro', symptom: 'nav-position' });
  assert.deepEqual(nav.selected?.entries.map(x => x.entryId), ['KB-QX-QY210PRO-V01-003']);
  const tractor = getKnowledgeCatalog({ brand: '约翰迪尔', model: '5E-1004', symptom: 'nav-position' });
  assert.deepEqual(tractor.selected?.entries, []);
});

test('显式配置、驱动与排放只返回有相同元数据的证据，未知条件保留缺口', () => {
  const g4 = getKnowledgeCatalog({ brand: '约翰迪尔', model: '5E-1004', symptom: 'engine-power', emissionStage: '国四' });
  assert.deepEqual(g4.selected?.entries, []);
  assert.equal(g4.common?.linkedEntries, 0);
  const cab = getKnowledgeCatalog({ brand: '久保田', model: 'LX2620HSDC', component: 'cab', configuration: 'CAB' });
  assert.ok(cab.selected?.entries.some(x => x.entryId === 'KB-LX2620-014'));
  const conflict = getKnowledgeCatalog({ brand: '久保田', model: 'LX2620SUHSD', component: 'cab', configuration: 'CAB' });
  assert.deepEqual(conflict.selected?.entries, []);
  const drive = getKnowledgeCatalog({ brand: '久保田', model: 'M6060', symptom: 'aftertreatment-alert', driveConfiguration: '2WD' });
  assert.deepEqual(drive.selected?.entries, []);
  const matched = getKnowledgeCatalog({ brand: '久保田', model: 'M6060', symptom: 'aftertreatment-alert', driveConfiguration: '4WD' });
  assert.deepEqual(matched.selected?.entries.map(x => x.entryId), ['KB-KB-M60-20261013-079']);
});

test('通用关联拒绝虚构依据、错误组件、资料背景与重复编号', () => {
  const mutations: ((x: CommonFrameworkDefinition) => void)[] = [
    x => { x.links[0].stages[0].evidenceTerms = ['不存在的性能检测结果']; },
    x => { x.links[0].performanceIds = ['brakes-effectiveness']; },
    x => { x.links[0].entryId = 'KB-HH-T70-001'; },
    x => { x.links.push(x.links[0]); },
    x => { x.systems[0].performanceTargets[0].id = x.systems[1].performanceTargets[0].id; },
  ];
  for (const mutate of mutations) {
    const invalid = structuredClone(definition);
    mutate(invalid);
    assert.throws(() => validate(invalid));
  }
  assert.equal(validate(definition), definition);
});

test('浏览器拒绝缺格、重复格、损坏引用和伪造合计', () => {
  const common = getKnowledgeCatalog().common!;
  assert.ok(isCommonFramework(common));
  for (const mutate of [
    (x: typeof common) => x.cells.pop(),
    (x: typeof common) => x.cells.push(x.cells[0]),
    (x: typeof common) => { x.cells[0].status = 'references'; },
    (x: typeof common) => { x.linkedEntries++; },
  ]) {
    const invalid = structuredClone(common);
    mutate(invalid);
    assert.equal(isCommonFramework(invalid), false);
    assert.throws(() => parseKnowledgeCatalog({ ...getKnowledgeCatalog(), common: invalid }));
  }
});

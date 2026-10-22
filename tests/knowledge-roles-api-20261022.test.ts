import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadArchive, loadRoleSidecar, parsePages } from '../server/knowledge/archive';
import { getKnowledgeCatalog, loadKnowledgeCatalog } from '../server/knowledge/catalog';
import { retrieve } from '../server/knowledge/retriever';
import { generateLocalKnowledgeReply } from '../server/knowledge/fallbackDiagnosis';
import { buildRoleFlow, formatRoleFlow } from '../server/knowledge/roles';

const INDEX = '知识库/整理后的知识库/农用拖拉机知识库';
const sidecar = fs.readFileSync(`${INDEX}/entry-roles.jsonl`, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));

test('服务端加载 entry-roles.jsonl，每条角色与旁路文件一致，队列中的 AI 建议不被加载', () => {
  const chunks = loadArchive(undefined, { configureModels: false }).chunks;
  const byId = new Map(chunks.map((c) => [c.entryId, c]));
  for (const record of sidecar) assert.deepEqual(byId.get(record.entry_id)?.roles, record.roles);
  assert.equal(chunks.filter((c) => c.roles?.length).length, sidecar.length);
  const queued = fs.readFileSync(`${INDEX}/role-review-queue.jsonl`, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
  for (const q of queued) assert.equal(byId.get(q.entry_id)?.roles, undefined);
  const sample = byId.get('KB-LX2620-005')!;
  assert.equal(sample.sourceTitle !== undefined, true);
  assert.deepEqual(sample.pages, { pdf: '60、130', printed: '58、128' });
});

test('页码按定位原文提取，不推测', () => {
  assert.deepEqual(parsePages('PDF 第 101、104 页；印刷第 99、102 页。'), { pdf: '101、104', printed: '99、102' });
  assert.deepEqual(parsePages('PDF 第 95～96 页'), { pdf: '95～96' });
  assert.deepEqual(parsePages('故障表；PDF物理第130页；印刷128'), { pdf: '130', printed: '128' });
  assert.equal(parsePages('网页报道'), undefined);
});

test('旁路文件含未知字段、重复或不存在的条目时拒绝加载', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roles-'));
  try {
    fs.writeFileSync(path.join(dir, 'entry-roles.jsonl'), '{"entry_id":"KB-A-001","roles":["cause"],"role_basis":"原文标记","ai_suggestion":{}}\n');
    assert.throws(() => loadRoleSidecar(dir), /未知字段/);
    fs.writeFileSync(path.join(dir, 'entry-roles.jsonl'), '{"entry_id":"KB-A-001","roles":["cause"],"role_basis":"原文标记"}\n'.repeat(2));
    assert.throws(() => loadRoleSidecar(dir), /重复/);
    fs.rmSync(path.join(dir, 'entry-roles.jsonl'));
    assert.equal(loadRoleSidecar(dir).size, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('目录每个层级给出按角色的覆盖计数，条目返回角色、书名和页码', () => {
  const catalog = loadKnowledgeCatalog();
  const brand = catalog.brands.find((b) => b.name === '久保田')!;
  const coverage = brand.roleCoverage;
  assert.ok(coverage.tagged > 0 && coverage.symptom <= coverage.tagged && coverage.tagged + coverage.untagged <= brand.entryCount);
  const model = brand.models.find((m) => m.components.some((c) => c.roleCoverage.tagged > 0))!;
  const component = model.components.find((c) => c.roleCoverage.tagged > 0)!;
  assert.ok(component.roleCoverage.tagged <= model.roleCoverage.tagged);
  for (const part of component.parts) assert.ok(part.roleCoverage.tagged <= component.roleCoverage.tagged);
  const total = catalog.brands.reduce((n, b) => n + b.roleCoverage.tagged, 0);
  assert.equal(total, sidecar.length);
  const selected = getKnowledgeCatalog({ brand: brand.name, model: model.name, component: component.id }).selected!;
  const tagged = selected.entries.find((e) => e.roles?.length)!;
  assert.ok(tagged.roleBasis && tagged.sourceTitle);
});

test('资料库搜索可按角色筛选，只返回已标注该角色的归档条目', () => {
  const library = getKnowledgeCatalog({ role: 'check', q: '启动' }).library!;
  assert.ok(library.total > 0);
  for (const entry of library.entries) {
    assert.equal(entry.collection, 'archive');
    assert.ok(entry.collection === 'archive' && entry.roles?.includes('check'));
  }
});

test('诊断按 现象 → 原因／检查 → 处理 组织证据并带书名页码', () => {
  const found = retrieve('发动机启动困难', 5, { brand: '久保田', model: 'LX2620' });
  const flow = buildRoleFlow(found);
  assert.ok(flow.symptom.length + flow.cause.length + flow.action.length > 0);
  for (const step of [...flow.symptom, ...flow.cause]) assert.ok(step.entryId && step.sourceTitle);
  const text = formatRoleFlow(flow);
  assert.match(text, /《.+》/);
  const reply = generateLocalKnowledgeReply('发动机启动困难', found, { brand: '久保田', model: 'LX2620' });
  assert.match(reply, /【按角色整理（现象 → 原因／检查 → 处理）】/);
  assert.equal(buildRoleFlow([{ ...found[0], roles: undefined }]).untaggedEntryIds.length, found[0].entryId ? 1 : 0);
});

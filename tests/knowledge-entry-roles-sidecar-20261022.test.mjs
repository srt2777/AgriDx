import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

// 第3步批量角色标注：entries.jsonl 受字节锁定基线测试保护，角色存入旁路文件，不改条目和正文。
const root = '知识库/整理后的知识库/农用拖拉机知识库';
const lines = (name) => readFileSync(`${root}/${name}`, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
const NON_DIAGNOSTIC = new Set(['系统适用边界', '资料索引', '资料核验', '机型资料', '资料缺口']);
const ORDER = ['symptom', 'cause', 'check', 'action', 'retest'];

test('角色旁路文件与人工核对队列恰好覆盖既有快照中可标注条目且互不重叠', () => {
  // The original 6,125-entry snapshot excludes eight retired notices.
  const entries = lines('entries.jsonl').slice(0, 6125 - 8);
  const snapshotIds = new Set(entries.map((e) => e.entry_id));
  // Later batches append their own sidecar rows; the snapshot partition counts only its own rows.
  const tags = lines('entry-roles.jsonl').filter((t) => snapshotIds.has(t.entry_id));
  const queue = lines('role-review-queue.jsonl').filter((q) => snapshotIds.has(q.entry_id));
  const taggable = new Set(entries.filter((e) => !NON_DIAGNOSTIC.has(e.entry_type)).map((e) => e.entry_id));
  assert.equal(taggable.size, 5568 - 8);
  assert.equal(tags.length, 2222);
  assert.equal(queue.length, 3346 - 8);
  const tagged = new Set(tags.map((t) => t.entry_id));
  const queued = new Set(queue.map((q) => q.entry_id));
  assert.equal(tagged.size, tags.length);
  assert.equal(queued.size, queue.length);
  for (const id of tagged) { assert.ok(taggable.has(id)); assert.ok(!queued.has(id)); }
  for (const id of queued) assert.ok(taggable.has(id));
  assert.equal(tagged.size + queued.size, taggable.size);
  for (const e of entries) assert.ok(!('roles' in e) && !('role_basis' in e), 'entries.jsonl 不直接写角色字段');
});

test('试点批 kb300k-pilot-jd-20261115：新增诊断条目全部以原文标记写入旁路文件', () => {
  // 两册约翰迪尔手册试点批新增 804 条；其中旧条目 -001/-002/-008/-010 不计入本批。
  const pilotSources = new Set(['SRC-JD-904105412041354-OMSJ16422-L4-CN', 'SRC-JD-1404-OMSU38852-L4-CN']);
  const prior = new Set(['KB-JD-904105412041354-OMSJ16422-L4-CN-001', 'KB-JD-1404-OMSU38852-L4-CN-002', 'KB-JD-1404-OMSU38852-L4-CN-008', 'KB-JD-1404-OMSU38852-L4-CN-010']);
  const pilot = lines('entries.jsonl').filter((e) => pilotSources.has(e.source_id) && !prior.has(e.entry_id));
  assert.equal(pilot.length, 804);
  const diagnostic = pilot.filter((e) => !NON_DIAGNOSTIC.has(e.entry_type));
  assert.equal(diagnostic.length, 754);
  const tags = lines('entry-roles.jsonl');
  const pilotTags = tags.filter((t) => pilot.some((e) => e.entry_id === t.entry_id));
  assert.equal(pilotTags.length, 754);
  assert.equal(new Set(pilotTags.map((t) => t.entry_id)).size, 754);
  for (const e of diagnostic) assert.ok(pilotTags.some((t) => t.entry_id === e.entry_id));
  for (const t of pilotTags) assert.equal(t.role_basis, '原文标记');
  const queue = lines('role-review-queue.jsonl');
  for (const e of pilot) assert.ok(!queue.some((q) => q.entry_id === e.entry_id));
});

test('JD5 批 kb300k-batch2-jd5-20261115：新增诊断条目全部以原文标记写入旁路文件', () => {
  // 约翰迪尔 JD5 操作手册 OMSJ16405 E5 新增 394 条；其中旧条目 -001/-002 不计入本批。
  const jd5Source = 'SRC-JD-JD5-OMSJ16405-E5-CN';
  const prior = new Set(['KB-JD-JD5-OMSJ16405-E5-CN-001', 'KB-JD-JD5-OMSJ16405-E5-CN-002']);
  const batch = lines('entries.jsonl').filter((e) => e.source_id === jd5Source && !prior.has(e.entry_id));
  assert.equal(batch.length, 394);
  const diagnostic = batch.filter((e) => !NON_DIAGNOSTIC.has(e.entry_type));
  assert.equal(diagnostic.length, 357);
  const tags = lines('entry-roles.jsonl');
  const batchTags = tags.filter((t) => batch.some((e) => e.entry_id === t.entry_id));
  assert.equal(batchTags.length, 357);
  assert.equal(new Set(batchTags.map((t) => t.entry_id)).size, 357);
  for (const e of diagnostic) assert.ok(batchTags.some((t) => t.entry_id === e.entry_id));
  for (const t of batchTags) assert.equal(t.role_basis, '原文标记');
  const queue = lines('role-review-queue.jsonl');
  for (const e of batch) assert.ok(!queue.some((q) => q.entry_id === e.entry_id));
});
test('8R 批 kb300k-batch2-jd8r-20261116：156 条原文标记写入旁路文件，339 条列入人工核对队列', () => {
  // 约翰迪尔 8R G4 操作手册 OMTA30801 G3 新增 547 条；其中旧条目 -005/-006/-008/-011 不计入本批。
  const jd8rSource = 'SRC-JD-8RG4-OMTA30801-G3-CN';
  const prior = new Set(['KB-JD-8RG4-OMTA30801-G3-CN-005', 'KB-JD-8RG4-OMTA30801-G3-CN-006', 'KB-JD-8RG4-OMTA30801-G3-CN-008', 'KB-JD-8RG4-OMTA30801-G3-CN-011']);
  const batch = lines('entries.jsonl').filter((e) => e.source_id === jd8rSource && !prior.has(e.entry_id));
  assert.equal(batch.length, 547);
  const annotatable = batch.filter((e) => !NON_DIAGNOSTIC.has(e.entry_type));
  assert.equal(annotatable.length, 495);
  const nonAnnotatable = batch.filter((e) => NON_DIAGNOSTIC.has(e.entry_type));
  assert.equal(nonAnnotatable.length, 52);
  const tags = lines('entry-roles.jsonl');
  const batchTags = tags.filter((t) => batch.some((e) => e.entry_id === t.entry_id));
  assert.equal(batchTags.length, 156);
  assert.equal(new Set(batchTags.map((t) => t.entry_id)).size, 156);
  for (const t of batchTags) assert.equal(t.role_basis, '原文标记');
  assert.ok(batchTags.every((t) => !t.roles.includes('check') && !t.roles.includes('retest')));
  const queue = lines('role-review-queue.jsonl');
  const batchQueue = queue.filter((q) => batch.some((e) => e.entry_id === q.entry_id));
  assert.equal(batchQueue.length, 339);
  assert.equal(new Set(batchQueue.map((q) => q.entry_id)).size, 339);
  for (const q of batchQueue) assert.equal(q.status, 'pending');
  // 旁路与队列互不重叠、恰好覆盖 495 条可标注条目；52 条五类不标注条目两边都不进。
  const tagged = new Set(batchTags.map((t) => t.entry_id));
  const queued = new Set(batchQueue.map((q) => q.entry_id));
  for (const id of tagged) assert.ok(!queued.has(id));
  assert.equal(tagged.size + queued.size, annotatable.length);
  for (const e of nonAnnotatable) assert.ok(!tagged.has(e.entry_id) && !queued.has(e.entry_id));
  // 人审阻塞修正：本批 hierarchy 不得再挂 navigation（-049/-139/-140/-285/-286/-499 已改挂 machine）。
  const hierarchy = JSON.parse(readFileSync('知识库/整理后的知识库/农用拖拉机知识库/hierarchy.json', 'utf8'));
  const batchHier = hierarchy.entries.filter((h) => batch.some((e) => e.entry_id === h.entry_id));
  assert.equal(batchHier.length, 547);
  assert.ok(batchHier.every((h) => h.components.length > 0));
  assert.ok(!batchHier.some((h) => h.components.some((c) => c.component_id === 'navigation')));
});

test('自动标注只用原文标记依据，角色按规范顺序且不含 retest', () => {
  for (const t of lines('entry-roles.jsonl')) {
    assert.deepEqual(Object.keys(t).sort(), ['entry_id', 'role_basis', 'roles']);
    assert.equal(t.role_basis, '原文标记');
    assert.ok(t.roles.length > 0);
    assert.deepEqual([...t.roles].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)), t.roles);
    assert.ok(!t.roles.includes('retest'));
  }
  for (const q of lines('role-review-queue.jsonl')) assert.equal(q.status, 'pending');
});

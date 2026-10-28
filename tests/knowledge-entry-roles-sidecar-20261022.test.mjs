import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

// 第3步批量角色标注：entries.jsonl 受字节锁定基线测试保护，角色存入旁路文件，不改条目和正文。
const root = '知识库/整理后的知识库/农用拖拉机知识库';
const lines = (name) => readFileSync(`${root}/${name}`, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
const NON_DIAGNOSTIC = new Set(['系统适用边界', '资料索引', '资料核验', '机型资料', '资料缺口']);
const ORDER = ['symptom', 'cause', 'check', 'action', 'retest'];

test('角色旁路文件与人工核对队列恰好覆盖全部可标注条目且互不重叠', () => {
  const entries = lines('entries.jsonl');
  const tags = lines('entry-roles.jsonl');
  const queue = lines('role-review-queue.jsonl');
  const taggable = new Set(entries.filter((e) => !NON_DIAGNOSTIC.has(e.entry_type)).map((e) => e.entry_id));
  assert.equal(taggable.size, 4903);
  assert.equal(tags.length, 2182);
  assert.equal(queue.length, 2721);
  const tagged = new Set(tags.map((t) => t.entry_id));
  const queued = new Set(queue.map((q) => q.entry_id));
  assert.equal(tagged.size, tags.length);
  assert.equal(queued.size, queue.length);
  for (const id of tagged) { assert.ok(taggable.has(id)); assert.ok(!queued.has(id)); }
  for (const id of queued) assert.ok(taggable.has(id));
  assert.equal(tagged.size + queued.size, taggable.size);
  for (const e of entries) assert.ok(!('roles' in e) && !('role_basis' in e), 'entries.jsonl 不直接写角色字段');
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

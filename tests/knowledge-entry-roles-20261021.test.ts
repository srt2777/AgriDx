import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { ENTRY_ROLES, entryRoleSchemaError, loadArchive, type ArchiveEntry } from '../server/knowledge/archive';

const entries = fs.readFileSync('知识库/整理后的知识库/农用拖拉机知识库/entries.jsonl', 'utf8')
  .trim().split(/\r?\n/).map((line) => JSON.parse(line) as ArchiveEntry);
const base: ArchiveEntry = {
  entry_id: 'TEST-1', source_id: 'SRC-TEST-1', brand: '测试', model: 'M1', title: '测试', knowledge_path: 'x.md',
  locator: '测试', status: '已核验', entry_type: '维护/故障知识',
};

test('角色/风险字段为可选：现有条目全部通过且原索引仍可加载', () => {
  assert.deepEqual([...ENTRY_ROLES], ['symptom', 'cause', 'check', 'action', 'retest']);
  for (const entry of entries) assert.equal(entryRoleSchemaError(entry), undefined, entry.entry_id);
  assert.equal(loadArchive(undefined, { configureModels: false }).chunks.length, entries.length);
});

test('角色/风险字段结构与校验工具一致', () => {
  assert.equal(entryRoleSchemaError({ ...base, roles: ['symptom', 'cause', 'check', 'action', 'retest'], role_basis: '人工核对' }), undefined);
  assert.equal(entryRoleSchemaError({ ...base, risk_level: 'high', risk_basis: '原文警示' }), undefined);
  const invalid: Partial<ArchiveEntry>[] = [
    { roles: ['cause', 'symptom'], role_basis: '人工核对' },
    { roles: ['symptom', 'symptom'], role_basis: '人工核对' },
    { roles: [], role_basis: '人工核对' },
    { roles: ['symptom'] },
    { role_basis: '人工核对' },
    { risk_level: 'high' },
    { risk_basis: '依据' },
    { risk_level: 'critical' as 'high', risk_basis: '依据' },
  ];
  for (const fields of invalid) assert.ok(entryRoleSchemaError({ ...base, ...fields }), JSON.stringify(fields));
  assert.ok(entryRoleSchemaError({ ...base, entry_type: '资料索引', roles: ['symptom'], role_basis: '人工核对' }));
});

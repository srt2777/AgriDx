import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { validateSuggestion, ROLES } from '../scripts/role-suggester-deepseek.mjs';

const root = '知识库/整理后的知识库/农用拖拉机知识库';
const lines = (name) => readFileSync(`${root}/${name}`, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));

test('AI 角色建议只写在队列 ai_suggestion，status 保持 pending，不进入 entry-roles.jsonl', () => {
  const queue = lines('role-review-queue.jsonl');
  assert.equal(queue.length, 2329);
  for (const q of queue) {
    assert.equal(q.status, 'pending');
    const a = q.ai_suggestion;
    if (!a) continue;
    assert.ok(['roles', 'none'].includes(a.label));
    assert.equal(a.label === 'none', a.roles.length === 0);
    assert.deepEqual([...a.roles].sort((x, y) => ROLES.indexOf(x) - ROLES.indexOf(y)), a.roles);
    assert.deepEqual(Object.keys(a.evidence).sort(), [...a.roles].sort());
    assert.ok(a.confidence >= 0 && a.confidence <= 1);
    assert.ok(a.model && /^\d{4}-\d{2}-\d{2}$/.test(a.suggested_at));
  }
  for (const t of lines('entry-roles.jsonl')) assert.ok(!('ai_suggestion' in t) && t.role_basis !== 'AI建议');
});

test('校验丢弃无原文逐字引文的角色，无角色时为 none', () => {
  const body = '- 故障现象：发动机不能启动。\n- 处理：补充燃油。';
  const ok = validateSuggestion({ roles: [{ role: 'action', quote: '补充燃油' }, { role: 'cause', quote: '电池亏电' },
    { role: 'bogus', quote: '补充燃油' }], confidence: 1.7 }, body);
  assert.deepEqual(ok.roles, ['action']);
  assert.equal(ok.confidence, 1);
  const none = validateSuggestion({ roles: [{ role: 'symptom', quote: '' }], confidence: 0.4, risk_level: 'high', risk_quote: '烫伤' }, body);
  assert.equal(none.label, 'none');
  assert.ok(!('risk_level' in none));
});

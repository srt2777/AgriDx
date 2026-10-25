import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chatPathBadge, evidenceRows } from '../src/features/chat/evidence';

test('role flow always exposes five columns and leaves retest empty when untagged', () => {
  const rows = evidenceRows({ symptom: [{ entryId: 's', heading: '现象' }], cause: [], check: [], action: [], retest: [], untaggedEntryIds: [] }, [{ entryId: 's', source: 'book', heading: 'x', sourceTitle: 'Manual', scopeBoundary: 'T70' }]);
  assert.deepEqual(rows.map(row => row.id), ['symptom', 'cause', 'check', 'action', 'retest']);
  assert.equal(rows[0].items[0].source?.sourceTitle, 'Manual');
  assert.equal(rows[4].items.length, 0);
});

test('path badges distinguish source, clarification, AI and safety fallback', () => {
  assert.equal(chatPathBadge({ route: 'local', requestedMode: 'auto', effectiveMode: 'knowledge_only', reason: 'direct_reference', evidenceLevel: 'direct_reference', llmConfigured: false }, undefined, 'knowledge-base'), 'source-answer');
  assert.equal(chatPathBadge({ route: 'clarify', requestedMode: 'auto', effectiveMode: 'knowledge_only', reason: 'identity_required', evidenceLevel: 'none', llmConfigured: false }, undefined), 'clarify');
  assert.equal(chatPathBadge({ route: 'ai', requestedMode: 'ai_assisted', effectiveMode: 'ai_assisted', reason: 'ai_requested', evidenceLevel: 'partial', llmConfigured: true }, undefined, 'openai'), 'ai-assist');
  assert.equal(chatPathBadge({ route: 'safe', requestedMode: 'auto', effectiveMode: 'knowledge_only', reason: 'high_risk_restricted', evidenceLevel: 'none', llmConfigured: false }, 'provider_unavailable'), 'safety-fallback');
});

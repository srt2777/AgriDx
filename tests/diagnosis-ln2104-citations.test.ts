import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDiagnosticService } from '../server/diagnosis/service';
import { loadKnowledgeBase } from '../server/knowledge/retriever';
import { LlmRouter } from '../server/llm/router';

test('knowledge-only response cites manual fault candidates without presenting them as confirmed', async () => {
  loadKnowledgeBase();
  const diagnose = createDiagnosticService(new LlmRouter(), { config: { logDecisions: false } });
  const response = await diagnose({ history: [{ role: 'user', content: '东方红 LN2104 农具不能提升，如何检查回油阀和吸油？' }],
    machineType: '拖拉机', brand: '东方红', model: 'LN2104', diagnosisMode: 'knowledge_only' });
  const id = 'KB-YTO-LN2104-OM2018-032';
  const cause = response.diagnosticReply?.causes.find(item => item.text === '回油阀卡滞');
  assert.ok(cause);
  assert.equal(cause.basis, 'source_candidate');
  assert.deepEqual(cause.evidenceIds, [id]);
  assert.match(response.diagnosticReply!.understanding, /不能.*确定|不能直接决定换件/);
  const source = response.knowledgeSources.find(item => item.entryId === id);
  assert.equal(source?.usage, 'answer-evidence');
  assert.match(source?.locator ?? '', /第68页/);
});

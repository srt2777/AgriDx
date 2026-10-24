import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { loadKnowledgeBase, retrieve, describeSource } from '../server/knowledge/retriever';
import { createDiagnosticService } from '../server/diagnosis/service';
import { decideDiagnosisRoute } from '../server/diagnosis/router';
import { buildRoleFlow, formatRoleFlow } from '../server/knowledge/roles';

// Open questions retain TK evidence. Current task permits named-machine general references only when archive coverage is incomplete.
before(() => loadKnowledgeBase());

const query = '拖拉机启动电机不转';
const isTk = (id?: string) => Boolean(id?.startsWith('TK-'));

test('no brand/model: TK entries can appear as labelled general evidence alongside archive entries', () => {
  const found = retrieve(query, 6, { machineType: '拖拉机' });
  const tk = found.filter(chunk => isTk(chunk.entryId));
  assert.ok(tk.length > 0, 'TK sources appear');
  assert.ok(tk.length < found.length || found.every(chunk => isTk(chunk.entryId)), 'TK cannot fill every slot when archive hits exist');
  assert.ok(found.some(chunk => chunk.entryId && !isTk(chunk.entryId)), 'an archive entry keeps a slot');
  for (const chunk of tk) {
    assert.equal(chunk.generalEvidence, true);
    assert.equal(chunk.diagnosticEvidence, false, 'data flag is unchanged; evidence role is runtime only');
    assert.ok(!chunk.pages && !chunk.sourceId);
    assert.match(describeSource(chunk), /通识（无手册页码）/);
  }
  for (const chunk of found.filter(chunk => chunk.entryId && !isTk(chunk.entryId))) assert.notEqual(chunk.applicability, 'matched');
  const flow = buildRoleFlow(found);
  assert.deepEqual(flow.generalKnowledgeIds, tk.map(chunk => chunk.entryId));
  assert.match(formatRoleFlow(flow), /通识依据（通识·无手册页码）/);
  const decision = decideDiagnosisRoute({ query, currentQuery: query, scope: { machineType: '拖拉机' }, retrieved: found,
    clarificationNeeded: false, llmConfigured: false });
  assert.notEqual(decision.evidenceLevel, 'none');
  assert.ok(!decision.directEligibleIds?.some(isTk), 'TK is never a direct manual answer');
});

test('brand and model named: compatible archive first, supplemental TK remains reference-only', () => {
  const found = retrieve('钥匙在 START，启动电机不转', 6, { machineType: '拖拉机', brand: '纽荷兰', model: 'WORKMASTER25' });
  assert.ok(found.length > 0);
  assert.ok(found.some(chunk => chunk.sourceId));
  assert.ok(found.filter(chunk => !isTk(chunk.entryId)).every(chunk => chunk.brand === '纽荷兰'));
  assert.ok(found.filter(chunk => isTk(chunk.entryId)).every(chunk => chunk.retrieval?.referenceOnly && !chunk.sourceId));
  assert.ok(found.every(chunk => !chunk.generalEvidence));
  assert.ok(retrieve(query, 6, { machineType: '拖拉机', brand: '纽荷兰', model: 'WORKMASTER25S' })
    .every(chunk => !chunk.sourceId && chunk.retrieval?.referenceOnly), 'an unknown model gets no manual transplant');
});

test('API sources label TK as 通识 and keep book title/page for archive entries', async () => {
  const service = createDiagnosticService({ hasAnyConfigured: () => false, chat: async () => { throw new Error('unused'); } });
  const open = await service({ history: [{ role: 'user', content: query }], machineType: '拖拉机', diagnosisMode: 'knowledge_only' } as never);
  const tk = open.knowledgeSources.filter(source => isTk(source.entryId));
  assert.ok(tk.length > 0);
  assert.ok(tk.every(source => source.evidenceLabel === '通识（无手册页码）' && source.evidenceKind === 'general-knowledge' && source.generalEvidence && !source.pages));
  assert.ok(open.knowledgeSources.filter(source => source.entryId && !isTk(source.entryId)).every(source => source.evidenceKind === 'archive' && source.evidenceLabel?.startsWith('手册：')));
  assert.match(open.choices[0].message.content, /通识/);
  const named = await service({ history: [{ role: 'user', content: '钥匙在 START，启动电机不转' }], machineType: '拖拉机', brand: '纽荷兰', model: 'WORKMASTER25', diagnosisMode: 'knowledge_only' } as never);
  assert.ok(named.knowledgeSources.filter(source => isTk(source.entryId)).every(source => !source.sourceId && !source.generalEvidence && source.retrieval?.referenceOnly));
  assert.ok(named.knowledgeSources.some(source => source.pages && source.evidenceLabel?.includes('页')));
});

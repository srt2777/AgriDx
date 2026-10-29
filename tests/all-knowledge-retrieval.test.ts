import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadKnowledgeBase, retrieve, describeSource, deriveDiagnosticMetadata } from '../server/knowledge/retriever';
import { loadKnowledgeSnapshot } from '../server/knowledge/snapshot';
import { hasIndexedReference, referenceVerification } from '../server/knowledge/evidence';
import { buildSystemPrompt, hasDiagnosticEvidence } from '../server/knowledge/systemPrompt';
import { createDiagnosticService } from '../server/diagnosis/service';
import { decideDiagnosisRoute } from '../server/diagnosis/router';
import { loadArchive } from '../server/knowledge/archive';

loadKnowledgeBase();

test('6875条学习资料逐条可按编号检索，区分6000条原理通识与875条术语参考', () => {
  const snapshot = loadKnowledgeSnapshot();
  const learning = snapshot.chunks.filter(chunk => chunk.entryType === '通识学习');
  assert.equal(learning.length, 6875);
  for (const original of learning) {
    const found = retrieve(`查阅 ${original.entryId!.toLowerCase()}`);
    assert.equal(found.length, 1, original.entryId);
    const chunk = found[0];
    assert.equal(chunk.entryId, original.entryId);
    assert.equal(chunk.text, original.text);
    assert.equal(chunk.status, original.status);
    assert.ok(chunk.locator?.includes(chunk.entryId!));
    assert.equal(chunk.diagnosticEvidence, false);
    assert.equal(hasIndexedReference(chunk), false);
    // 2026-10-22: an open (no brand/model) lookup uses TK as 通识 evidence; the data flag stays false.
    assert.equal(chunk.generalEvidence, chunk.learningKind === 'terminology' ? undefined : true);
    assert.equal(hasDiagnosticEvidence([chunk]), chunk.learningKind !== 'terminology');
    assert.equal(hasDiagnosticEvidence([{ ...chunk, generalEvidence: undefined }]), false);
    assert.equal(referenceVerification(chunk.status), 'unverified');
    assert.ok(Object.values(deriveDiagnosticMetadata(chunk).coverage).every(value => value === false));
    assert.match(describeSource(chunk), chunk.learningKind === 'terminology' ? /FAO AGROVOC术语关系参考/ : /通识（无手册页码）/);
    assert.match(describeSource({ ...chunk, generalEvidence: undefined }), /不是原厂手册证据/);
  }
  assert.deepEqual(retrieve('TK-9999'), []);
  assert.equal(retrieve('KB-YTO-LF-MANUAL-007', 6, { brand: '东方红', model: 'LF804S' })[0]?.entryId, 'KB-YTO-LF-MANUAL-007');
  assert.deepEqual(retrieve('KB-YTO-LF-MANUAL-007', 6, { brand: '久保田', model: 'LX2620' }), []);
});

test('已知型号优先匹配手册，覆盖不足的通识仅参考，未知型号不套用手册', () => {
  const found = retrieve('东方红 LF804S 启动机不转');
  assert.equal(found[0].entryId, 'KB-YTO-LF-MANUAL-007');
  assert.ok(found.filter(chunk => chunk.entryType === '通识学习').every(chunk => chunk.retrieval?.referenceOnly && !chunk.generalEvidence && !chunk.sourceId));
  const unknown = retrieve('发动机启动困难', 6, { machineType: '拖拉机', brand: '久保田', model: 'LX9999' });
  assert.ok(unknown.every(chunk => chunk.entryType === '通识学习' && chunk.retrieval?.referenceOnly));
  assert.deepEqual(retrieve('东方红 LF804S 启动困难', 6, { brand: '久保田', model: 'LX2620' }), []);
  assert.deepEqual(retrieve('TK-1001', 6, { machineType: '联合收割机' }), []);
  assert.deepEqual(retrieve('电动拖拉机 柴油机启动困难'), []);
});

test('纯通识及归档信息参与AI上下文，但不升级为直接维修证据', async () => {
  const previousMode = process.env.DIAGNOSIS_MODE;
  const previousExternal = process.env.ALLOW_EXTERNAL_AI;
  process.env.DIAGNOSIS_MODE = 'auto';
  process.env.ALLOW_EXTERNAL_AI = 'true';
  try {
    const sent: string[] = [];
    const service = createDiagnosticService({ hasAnyConfigured: () => true, chat: async messages => {
      sent.push(messages[0].content);
      return { result: { content: '通识原理参考，待验证。', model: 'test', provider: 'deepseek' }, primary: 'deepseek', fellBack: false };
    } }, { config: { logDecisions: false } });
    const response = await service({ history: [{ role: 'user', content: '解释 TK-1001 的原理' }] });
    assert.equal(sent.length, 1);
    assert.match(sent[0], /有效效率以燃料低热值为分母/);
    assert.match(sent[0], /通识知识参与分析/);
    assert.deepEqual(response.diagnosisTrace?.sentKnowledgeIds, ['TK-1001']);
    assert.equal(response.answerMode, 'knowledge-grounded', '2026-10-22: open question counts TK as 通识 evidence');
    assert.deepEqual(response.coordination?.directEligibleIds, []);
    const info = loadArchive().chunks.find(chunk => chunk.entryType === '资料索引')!;
    const indexed = { ...info, applicability: 'matched' as const, relevance: { score: 100, method: 'keyword-weighted-overlap' as const, calibrated: false as const } };
    const decision = decideDiagnosisRoute({ query: '资料来源', currentQuery: '资料来源', scope: { brand: info.brand, model: info.models?.[0] ?? info.model }, retrieved: [indexed], clarificationNeeded: false, llmConfigured: true });
    assert.ok(!decision.excludedKnowledgeIds?.includes(info.entryId!));
    assert.equal(decision.evidenceLevel, 'none');
    assert.ok(!decision.directEligibleIds?.length);
    const prompt = buildSystemPrompt({ query: 'TK-1001' });
    assert.match(prompt.message.content, /TK-1001/);
    assert.match(prompt.message.content, /通识（无手册页码）/);
    assert.equal(prompt.answerMode, 'knowledge-grounded');
  } finally {
    if (previousMode === undefined) delete process.env.DIAGNOSIS_MODE; else process.env.DIAGNOSIS_MODE = previousMode;
    if (previousExternal === undefined) delete process.env.ALLOW_EXTERNAL_AI; else process.env.ALLOW_EXTERNAL_AI = previousExternal;
  }
});

test('不启用模型时实际展示通识正文，危险操作继续走安全回复', async () => {
  const service = createDiagnosticService({ hasAnyConfigured: () => false, chat: async () => { throw new Error('must not call AI'); } }, { config: { logDecisions: false } });
  const response = await service({ history: [{ role: 'user', content: '拖拉机有效效率的燃料能量基准' }], diagnosisMode: 'knowledge_only' });
  assert.match(response.choices[0].message.content, /有效效率以燃料低热值为分母/);
  assert.match(response.localSummary!, /TK-1001/);
  assert.match(response.localSummary!, /未逐条完成/);
  const unsafe = await service({ history: [{ role: 'user', content: '查阅TK-1001，高压共轨怎么拆卸' }], diagnosisMode: 'ai_assisted' });
  assert.equal(unsafe.coordination?.route, 'safe');
  assert.doesNotMatch(unsafe.choices[0].message.content, /有效效率以燃料低热值为分母/);
});

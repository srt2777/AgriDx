import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assessSuggestedAction, validateDiagnosticAnswer } from '../server/diagnosis/answerGuard';
import type { KnowledgeChunk } from '../server/knowledge/types';

const manual: KnowledgeChunk = {
  source: 'synthetic.md', heading: 'TEST-001｜合成压力资料', text: '测试压力标准为0.3MPa；故障码P1234表示测试传感器异常。',
  entryId: 'TEST-001', sourceId: 'SRC-TEST-001', indexedReference: { entryId: 'TEST-001', sourceId: 'SRC-TEST-001' },
  entryType: '维护/故障知识', applicability: 'matched', status: '已核验', scopeBoundary: '合成测试，不用于实车',
  sourceTitle: '合成测试手册', locator: 'PDF第3～4页；印刷第1～2页', pages: { pdf: '3～4', printed: '1～2' },
  faultCodes: ['P1234'],
};
const accepted = (content: string, chunk = manual) => validateDiagnosticAnswer(content, [chunk]);

test('dangerous actual instructions are restricted, while local negated warnings remain usable', () => {
  for (const text of ['短接起动联锁', '带压松开接头', '带电测量高压线路', '热车拧水箱盖', '调高溢流阀', '清除故障码']) {
    assert.equal(assessSuggestedAction(text).restricted, true, text);
  }
  for (const text of ['不要短接联锁。', '禁止带压拆卸接头。', '切勿热车拧水箱盖。', '不要在悬空机具下作业。', 'do not bypass the safety interlock']) {
    assert.equal(assessSuggestedAction(text).restricted, false, text);
  }
  assert.equal(assessSuggestedAction('不要带压拆管；随后短接起动联锁。').restricted, true);
  assert.equal(assessSuggestedAction('不能不短接起动联锁。').restricted, true);
});

test('references, source binding, book names and PDF/printed pages are checked against supplied chunks', () => {
  assert.equal(accepted('TEST-001／SRC-TEST-001《合成测试手册》PDF第3页，印刷第1页。').ok, true);
  for (const text of ['KB-FAKE-999指出原因。', 'SRC-NOT-SENT-001资料。', 'TEST-001 PDF第8页。', 'TEST-001 印刷第3页。', '《不存在的书》给出资料。']) {
    assert.equal(accepted(text).ok, false, text);
  }
  const another = { ...manual, entryId: 'TEST-002', sourceId: 'SRC-TEST-002', indexedReference: { entryId: 'TEST-002', sourceId: 'SRC-TEST-002' } };
  assert.equal(validateDiagnosticAnswer('TEST-001／SRC-TEST-002', [manual, another]).ok, false);
  assert.equal(accepted('TEST-001的核对记录。', { ...manual, status: '核验失败' }).ok, false);
});

test('specialized parameters require matched reviewed original evidence, never merely a supplied reference', () => {
  assert.equal(accepted('TEST-001：测试压力标准为0.3MPa。').ok, true);
  assert.equal(accepted('TEST-001：测试压力标准为9MPa。').ok, false);
  for (const changes of [{ status: '待核验' }, { applicability: 'pending' as const }, { entryType: '通识学习', diagnosticEvidence: false as const },
    { retrieval: { tier: 'component' as const, basis: ['部件参考'], referenceOnly: true } }]) {
    assert.equal(accepted('TEST-001：测试压力标准为0.3MPa。', { ...manual, ...changes }).ok, false);
  }
  assert.equal(validateDiagnosticAnswer('测试压力标准为0.3MPa。', [manual], { trustedEvidenceIds: [] }).ok, false);
  assert.equal(accepted('TEST-001故障码P9999表示测试传感器异常。').ok, false);
  assert.equal(accepted('TEST-001故障码P1234表示测试传感器异常。').ok, true);
  assert.equal(accepted('TEST-001已核验。', { ...manual, status: '待核验' }).ok, false);
  assert.equal(accepted('资料核对不代表实车验证。').ok, true);
});

test('output size and positive dangerous advice are rejected without an extra model call', () => {
  assert.equal(accepted(' ').ok, false);
  assert.equal(accepted('a'.repeat(10001)).ok, false);
  assert.equal(accepted('建议短接起动联锁进行试验。').ok, false);
  assert.equal(accepted('不要短接起动联锁，请记录已观察到的报警。').ok, true);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assessSuggestedAction, validateDiagnosticAnswer, filterDiagnosticAnswer } from '../server/diagnosis/answerGuard';
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

// Regression probes found during migration; never allow negation on another verb
// or missing “故障码” to confer authority on technical instructions.
test('negation scope cannot hide positive hazardous advice', () => {
  for (const text of ['无需停机即可短接启动端子。', '不要担心只需绕过安全联锁试车。', '不必担心，可以热车拧水箱盖。', '不要忘记短接联锁。']) {
    assert.equal(assessSuggestedAction(text).restricted, true, text);
    assert.equal(accepted(text).ok, false, text);
  }
});

test('bare code meanings and context-free numeric settings require original support', () => {
  for (const text of ['P1234表示喷油泵损坏。', 'E001意味着发动机故障。', '设置为9MPa。', 'TEST-001测试压力标准为2MPa。']) {
    assert.equal(accepted(text).ok, false, text);
  }
  assert.equal(accepted('TEST-001故障码P1234表示测试传感器异常。').ok, true);
  const pressure = { ...manual, text: '测试压力标准为12MPa。环境温度为37℃。' };
  assert.equal(accepted('测试压力标准为2MPa。', pressure).ok, false);
  assert.equal(accepted('本机水温上限为37℃。', pressure).ok, false);
  assert.equal(accepted('资料已经验证有效。', { ...manual, status: '待核验' }).ok, false);
  for (const id of ['NH-FAKE-999', 'DF-FAKE-999', 'HH-FAKE-999']) assert.equal(accepted(id).ok, false);
});


test('display-equivalent and colon code claims cannot bypass source and safety checks', () => {
  for (const text of ['Ｐ１２３４表示喷油泵损坏。', 'P1234：喷油泵损坏。', 'P1234为喷油泵故障。', '根据厂家手册，水泵已经损坏。', '建议短\u200b接联锁。']) {
    assert.equal(accepted(text).ok, false, text);
  }
});


test('a negative disclaimer about vehicle validation cannot hide an affirmative document review claim', () => {
  assert.equal(accepted('未经实车验证，但资料已核验。', { ...manual, status: '待核验' }).ok, false);
  assert.equal(accepted('未实车验证，TEST-001已核验。', { ...manual, status: '核验失败' }).ok, false);
  assert.equal(accepted('不代表本机已验证。', { ...manual, status: '待核验' }).ok, true);
});


test('the known machine identity is not a fault code but actual code meanings remain guarded', () => {
  for (const model of ['LF1504', 'lf1504']) {
    assert.equal(validateDiagnosticAnswer('LF1504旋耕时水温过高通常表示散热负荷增加。', [], { model }).ok, true);
  }
  assert.equal(validateDiagnosticAnswer('P1234表示喷油泵损坏。', [], { model: 'LF1504' }).ok, false);
  assert.equal(validateDiagnosticAnswer('故障码LF1504表示喷油泵损坏。', [], { model: 'LF1504' }).ok, false);
  assert.equal(validateDiagnosticAnswer('P1234表示喷油泵损坏。', [], { model: 'P1234' }).ok, false);
});

test('partial output keeps independent causal explanation, not dangling repair steps or ungrounded certainty', () => {
  const good = '旋耕时水温上升可能涉及负荷增加、散热器外部遮挡或冷却液不足，仍需核实。';
  const result = filterDiagnosticAnswer(good + '\n\n维修压力标准为9MPa。\n\n然后把盖子打开。', []);
  assert.equal(result.content, good);
  assert.ok(result.removedIssues.includes('unsupported_parameter'));
  assert.equal(filterDiagnosticAnswer('维修压力标准为9MPa。\n\n然后把盖子打开。', []).content, '');
  assert.equal(validateDiagnosticAnswer('就是水泵坏了。', []).ok, false);
  assert.equal(validateDiagnosticAnswer('不一定是水泵坏了，仍需核实。', []).ok, true);
});

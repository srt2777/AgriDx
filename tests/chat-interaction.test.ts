import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseChatResponse } from '../src/features/chat/api';
import {
  composeDiagnosticQuestion, createChatRequest, loadChatSession, META_KEY, parseChatMetadata,
  parseFaultCodes, parseHistory, readDiagnosticTextAttachment, saveHistory, STORAGE_KEY,
} from '../src/features/chat/session';
import { PreviewMemoryStore } from '../src/dev-preview/memory';
import { compactLegacyGeneralSourceNote } from '../src/features/chat/presentation';

const diagnosticReply = {
  understanding: '已记下LF1504的水温异常。', supportLevel: 'reference_only' as const,
  causes: [{ text: '暂不能确认具体原因。', evidenceIds: [], basis: 'general_hypothesis' as const }],
  suggestions: [{ text: '先记录已经观察到的报警文字。', kind: 'record' as const, evidenceIds: [], priority: 1 }],
  questions: [{ text: '什么时候出现？', options: ['热车后', '冷车时', '暂不清楚'] }], sourceNote: '系列资料仅供参考。',
  aiSupplement: '以下分析仍需要匹配本机资料。',
};
const source = { source: '机型知识卡/示例.md', heading: '水温观察', entryId: 'KB-TEST-001', sourceId: 'SRC-TEST',
  sourceTitle: '示例手册', pages: { pdf: '12', printed: '9' }, scopeBoundary: '限M1/CAB，现场配置仍待确认。', models: ['M1'],
  engineModel: 'ENGINE-A', faultCodes: ['E001'], evidenceKind: 'archive' as const, usage: 'reference-only' as const,
  retrieval: { tier: 'series' as const, basis: ['完整型号不匹配，仅系列资料'], referenceOnly: true },
  status: '待核实', referenceVerification: 'pending' as const };
const coordination = { requestedMode: 'auto' as const, effectiveMode: 'auto' as const, route: 'local' as const,
  reason: 'output_rejected' as const, evidenceLevel: 'partial' as const, llmConfigured: true,
  retrievalOutcome: 'insufficient_evidence' as const, outputIssues: ['unsupported_number'], referenceOnlyIds: ['KB-TEST-001'],
  candidates: [{ entryId: 'KB-TEST-001', relevance: { score: 2, method: 'keyword-weighted-overlap' as const, calibrated: false as const, level: 'low' as const },
    coverage: { symptom: true, repair: false }, coverageSufficient: false, modelMatch: 'compatible' as const,
    referenceVerification: 'pending' as const, verificationBasis: 'none' as const, sourceIndexed: true, riskLevel: 'unknown' as const,
    directEligible: false, excluded: false, retrieval: source.retrieval }] };
const trace = { retrievalCount: 1, aiAttempts: 1, aiSuccesses: 0, aiProvider: null, scoreMethod: 'keyword-weighted-overlap',
  contextChars: 400, sentKnowledgeIds: ['KB-TEST-001'], timings: { retrievalMs: 1, decisionMs: 2, externalAiMs: 3, totalMs: 6 } };
const roleFlow = { symptom: [{ entryId: 'KB-TEST-001', heading: '水温观察', pages: { pdf: '12' } }], cause: [], check: [], action: [], retest: [], untaggedEntryIds: [] };
const payload = { choices: [{ message: { content: '保存的完整原文' } }], provider: 'knowledge-base', model: '本地引擎', answerMode: 'local-evidence',
  diagnosticReply, knowledgeSources: [source], coordination, diagnosisTrace: trace, roleFlow };

test('old general-source notes group repeated statuses while retaining boundaries and unfamiliar notes', () => {
  const boundary = '通识（无手册页码），只能解释一般原理，不能作为本机参数或维修操作依据。';
  const original = `本次参考TK-1（未核验）、TK-2（未核验）、TK-3（待复核）${boundary}\n仿真数据提醒。`;
  assert.equal(compactLegacyGeneralSourceNote(original), `本次参考TK-1、TK-2（未核验）；TK-3（待复核）${boundary}\n仿真数据提醒。`);
  const unusual = `本次参考TK-1（未核验、待复核）、TK-2（未核验）${boundary}`;
  assert.equal(compactLegacyGeneralSourceNote(unusual), unusual);
  assert.equal(compactLegacyGeneralSourceNote('来源范围仍需核对。'), '来源范围仍需核对。');
});

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}

test('structured answers retain provenance, guarded AI, review scope and technical metadata through browser history', () => {
  const reply = parseChatResponse({ ...payload, credentials: 'never-retain' });
  assert.deepEqual(reply.diagnosticReply, diagnosticReply);
  assert.deepEqual(reply.knowledgeSources, [source]);
  assert.deepEqual(reply.coordination, coordination);
  assert.deepEqual(reply.diagnosisTrace, trace);
  assert.deepEqual(reply.roleFlow, roleFlow);
  assert.equal('credentials' in reply, false);
  const store = storage();
  saveHistory([{ id: 'saved-answer', ...reply }], store);
  const restored = loadChatSession(null, store).messages[0];
  assert.deepEqual(restored.diagnosticReply, diagnosticReply);
  assert.deepEqual(restored.knowledgeSources, [source]);
  assert.deepEqual(restored.coordination, coordination);
  assert.deepEqual(restored.diagnosisTrace, trace);
  assert.equal(JSON.parse(store.getItem(STORAGE_KEY)!).length, 1);
});

test('malformed optional metadata is discarded without inventing evidence for legacy messages', () => {
  const legacy = parseChatResponse({ choices: [{ message: { content: '旧答复保留' } }] });
  assert.equal(legacy.knowledgeSources, undefined);
  assert.equal(legacy.diagnosticReply, undefined);
  const invalid = parseChatMetadata({ diagnosticReply: { ...diagnosticReply, suggestions: [{ kind: 'repair', text: '危险步骤', priority: 1, evidenceIds: [] }] },
    knowledgeSources: [null, { source: {}, heading: 'invalid' }], coordination: { ...coordination, requestedMode: 'override' }, diagnosisTrace: { ...trace, timings: { ...trace.timings, totalMs: NaN } } });
  assert.equal(invalid.diagnosticReply, undefined);
  assert.deepEqual(invalid.knowledgeSources, []);
  assert.equal(invalid.coordination, undefined);
  assert.equal(invalid.diagnosisTrace, undefined);
  assert.equal(parseChatMetadata({ ...payload, diagnosticReply: { ...diagnosticReply, questions: Array(7).fill({ text: '重复' }) } }).diagnosticReply, undefined);
});

test('diagnostic request sends engine/codes and text, never reply metadata or device memory as evidence', () => {
  const reply = { id: 'answer', ...parseChatResponse(payload) };
  const codes = parseFaultCodes(' E001，E002; E001、P1234 ');
  assert.deepEqual(codes, ['E001', 'E002', 'P1234']);
  const request = createChatRequest([reply], '继续检查', { machineType: '拖拉机', brand: '东方红', model: 'LF1504', engineModel: ' ENGINE-A ', faultCodes: codes });
  assert.equal(request.engineModel, 'ENGINE-A');
  assert.deepEqual(request.faultCodes, codes);
  assert.deepEqual(request.messages[0], { role: 'assistant', content: '保存的完整原文' });
  assert.equal('knowledgeSources' in request, false);
  assert.throws(() => parseFaultCodes(Array(21).fill('E001').join(',')));
  assert.throws(() => parseFaultCodes('E'.repeat(33)));
  const store = storage();
  store.setItem(META_KEY, JSON.stringify({ machineType: '拖拉机', brand: '东方红', model: 'LF1504', engineModel: 'A', faultCodes: codes }));
  assert.deepEqual(loadChatSession(null, store).context.faultCodes, codes);
});

const file = (name: string, content: string, size?: number) => {
  const bytes = new TextEncoder().encode(content);
  return { name, size: size ?? bytes.byteLength, arrayBuffer: async () => bytes.buffer };
};
test('text attachments preserve UTF-8 evidence verbatim, remain user reports and share the 2000-character limit', async () => {
  const attachment = await readDiagnosticTextAttachment(file('故障日志.txt', '\uFEFF报警E001\n水温高；用户报告'));
  assert.equal(attachment.text, '报警E001\n水温高；用户报告');
  const composed = composeDiagnosticQuestion('热车后出现', attachment);
  assert.match(composed, /用户提供的故障信息文本.*未经核验/);
  assert.match(composed, /报警E001\n水温高；用户报告/);
  assert.ok(composeDiagnosticQuestion('x'.repeat(2000), attachment).length > 2000);
  await assert.rejects(readDiagnosticTextAttachment(file('铭牌.jpg', 'image')), /不支持图片/);
  await assert.rejects(readDiagnosticTextAttachment(file('dump.log', 'small', 16_385)), /16KB/);
  await assert.rejects(readDiagnosticTextAttachment(file('data.json', 'x'.repeat(2000))), /2000/);
  await assert.rejects(readDiagnosticTextAttachment(file('dump.csv', 'a\u0000b')), /二进制/);
  await assert.rejects(readDiagnosticTextAttachment(file('empty.txt', '  ')), /非空/);
  await assert.rejects(readDiagnosticTextAttachment({ name: 'bad.txt', size: 2, arrayBuffer: async () => new Uint8Array([0xff, 0xfe]).buffer }));
});

test('preview memory preserves structured reply metadata and revision on session restore', () => {
  const store = new PreviewMemoryStore(storage());
  const device = store.saveDevice({ name: '测试车', machineType: '拖拉机', brand: '东方红', model: 'LF1504', hours: null, notes: '' });
  const session = store.createSession(device.id);
  const { role: _role, memory: _memory, ...assistant } = parseChatResponse(payload);
  const saved = store.appendTurn(session.id, 0, '水温高', assistant, []);
  const restored = store.session(session.id);
  assert.equal(saved.revision, 1);
  assert.deepEqual(restored.messages[1].diagnosticReply, diagnosticReply);
  assert.deepEqual(restored.messages[1].knowledgeSources, [source]);
  assert.deepEqual(parseHistory(restored.messages)[1].coordination, coordination);
});

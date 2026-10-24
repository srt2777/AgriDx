import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanAnswerText, formatChatAnswer } from '../src/features/chat/answer-presentation';
import type { ChatMessage } from '../src/features/chat/session';

const t = (zh: string) => zh;
const sample = (): ChatMessage => ({ id: 'test', role: 'assistant', content: '完整答复及技术数据',
  knowledgeChunks: 3, model: 'test-model', provider: 'deepseek', coordinationMessage: '协调路由 ai',
  diagnosticReply: { understanding: '你咨询的是东方红 LF1504。你描述的是“旋耕时水温过高”。目前还不能只凭这一现象确定具体故障。',
    supportLevel: 'general', sourceNote: 'TK-4195 核验说明 未逐条完成原厂手册对照',
    background: [{ text: '这是通用冷却原理。', evidenceIds: ['TK-4195'] }],
    causes: [{ text: '散热器外部可能有遮挡。', basis: 'source_candidate', evidenceIds: ['KB-TEST-001'] }],
    suggestions: [{ text: '不要在热机或带压时打开冷却系统盖。', kind: 'professional', priority: 0, evidenceIds: [] }],
    questions: [{ text: '轻负荷时也会升温吗？', options: ['会', '不会'] }] } });

test('LF1504 body contains diagnosis and safety, without metadata or mechanical headings', () => {
  const message = sample(); const saved = structuredClone(message);
  const body = formatChatAnswer(message, t);
  assert.match(body, /可能有遮挡/); assert.match(body, /不要在热机或带压时打开/); assert.match(body, /轻负荷/);
  assert.doesNotMatch(body, /TK-4195|KB-TEST|test-model|协调路由|核验说明|你咨询的是|你描述的是|【/);
  assert.deepEqual(message, saved, 'display must not mutate original reply or metadata');
});

test('guarded AI analysis is not preceded by a repeated template; limitation remains', () => {
  const message = sample(); message.diagnosticReply!.aiSupplement = '旋耕负荷增加时，散热受阻是需要核实的方向。';
  const body = formatChatAnswer(message, t);
  assert.match(body, /旋耕负荷增加/); assert.match(body, /通用分析.*不能据此确诊/);
  assert.doesNotMatch(body, /你描述的是|AI 补充分析|AI补充分析/);
});

test('unavailable and unconfigured AI remain honestly disclosed without technical codes', () => {
  for (const reason of ['provider_unavailable', 'not_configured'] as const) {
    const message = sample(); message.fallbackReason = reason; message.provider = 'knowledge-base';
    const body = formatChatAnswer(message, t);
    assert.match(body, reason === 'provider_unavailable' ? /AI 暂时无法连接/ : /未启用外部 AI/);
    assert.match(body, /安全/); assert.doesNotMatch(body, /provider_unavailable|not_configured/);
  }
});

test('no evidence does not become a confident diagnosis or invented cause', () => {
  const message = sample(); const reply = message.diagnosticReply!;
  reply.supportLevel = 'none'; reply.causes = []; reply.background = [];
  assert.match(formatChatAnswer(message, t), /资料不足以判断/);
  assert.doesNotMatch(formatChatAnswer(message, t), /可能有遮挡/);
});

test('legacy technical sections are hidden but substantive advice and safety survive', () => {
  const content = '**【服务状态】** 本地引擎\n命中数量：0\n\n**【故障现象分析】**\n水温偏高需要核实散热情况。\n\n**【知识依据】**\nKB-TEST-001 来源编号：SRC-TEST\n\n**【安全提醒】**\n不要打开热机水箱盖。\n\n**【继续确认】** 轻负荷也会发生吗？';
  const body = cleanAnswerText(content);
  assert.match(body, /水温偏高/); assert.match(body, /不要打开热机水箱盖/); assert.match(body, /轻负荷也会发生/);
  assert.doesNotMatch(body, /本地引擎|命中|KB-TEST|SRC-TEST|【/);
});

test('legacy natural Markdown and fault codes/measurements are kept verbatim', () => {
  const text = '水温报警 P0117 需核对。\n\n- 不要开热盖。\n- 记录仪表上的 100℃；不是维修标准。\n\n**安全提示**：先停机。';
  assert.equal(cleanAnswerText(text), text);
});

test('errors and opaque diagnostic code blocks do not get swallowed', () => {
  assert.equal(formatChatAnswer({ id: 'error', role: 'error', content: '连接失败，请稍后重试。' }, t), '连接失败，请稍后重试。');
  assert.match(cleanAnswerText('```text\n【服务状态】 原始故障文本\n```'), /原始故障文本/);
});

test('only the first two follow-ups are projected; original questions stay intact', () => {
  const message = sample(); message.diagnosticReply!.questions = [1,2,3].map(n => ({ text: `追问${n}？` }));
  assert.doesNotMatch(formatChatAnswer(message, t), /追问3/);
  assert.equal(message.diagnosticReply!.questions.length, 3);
});

test('legacy Markdown debug sections are folded but safety prohibitions stay visible', () => {
  const body = cleanAnswerText('### 调试信息\n相似度评分：0.8\n不要打开热机水箱盖。\n### 下一步\n记录已有报警原文。');
  assert.doesNotMatch(body, /调试信息|相似度/);
  assert.match(body, /不要打开热机水箱盖/);
  assert.match(body, /记录已有报警原文/);
});

test('safety instructions attached to metadata or citations are not removed', () => {
  assert.match(cleanAnswerText('【服务状态】AI不可用；不要在热机时开盖。'), /不要在热机时开盖/);
  assert.match(cleanAnswerText('观察前先冷却（KB-TEST-001，禁止靠近风扇）。'), /禁止靠近风扇/);
});

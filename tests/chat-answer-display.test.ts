import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DEFAULT_FOLDED_ANSWER_EXTRAS, isAnswerExtraFoldedByDefault } from '../src/features/chat/presentation';

const chatPageSource = readFileSync(new URL('../src/pages/ChatPage/ChatPage.tsx', import.meta.url), 'utf8');

test('回答附带信息默认折叠，回答正文保持可见', () => {
  // 折叠的是依据类附带信息：通用原理参考、依据行、来源说明。
  assert.deepEqual([...DEFAULT_FOLDED_ANSWER_EXTRAS], ['background', 'evidence-line', 'source-note']);
  for (const section of DEFAULT_FOLDED_ANSWER_EXTRAS) {
    assert.equal(isAnswerExtraFoldedByDefault(section), true, `${section} 默认应折叠`);
  }
  // 回答正文本身（理解、可能原因、建议、追问）不在折叠清单里。
  for (const section of ['understanding', 'causes', 'suggestions', 'questions', 'ai-supplement']) {
    assert.equal(isAnswerExtraFoldedByDefault(section), false, `${section} 默认应直接显示`);
  }
  assert.equal(isAnswerExtraFoldedByDefault('unknown-section'), false);
});

test('对话页不再按条件自动展开通用原理参考', () => {
  // 旧逻辑：没有原因/建议/AI 补充时自动展开；新规则：默认一律折叠，用户手动展开。
  assert.equal(chatPageSource.includes('open={!reply.causes.length'), false);
  assert.equal(chatPageSource.includes("open={!reply.causes.length && !reply.suggestions.length && !reply.aiSupplement}"), false);
  assert.equal(
    chatPageSource.includes("isAnswerExtraFoldedByDefault('background')"),
    true,
    '通用原理参考的折叠状态应由展示规则函数决定',
  );
});

test('依据行与来源说明收进依据折叠区，默认不可见', () => {
  const evidenceDetailsIndex = chatPageSource.indexOf('className="chat-evidence mt-4');
  assert.notEqual(evidenceDetailsIndex, -1, '应保留“查看依据与核对项”折叠区');
  const evidenceLineIndex = chatPageSource.indexOf("t('依据：'");
  assert.ok(evidenceLineIndex > evidenceDetailsIndex, '“依据：”行应在依据折叠区内部');
  const sourceNoteIndex = chatPageSource.indexOf('compactLegacyGeneralSourceNote(reply.sourceNote)');
  assert.ok(sourceNoteIndex > evidenceDetailsIndex, '来源说明应在依据折叠区内部');
});

test('回答正文仍在折叠区之外默认显示', () => {
  const evidenceDetailsIndex = chatPageSource.indexOf('className="chat-evidence mt-4');
  for (const marker of ['{reply.understanding}', "t('可能原因，仍需核实'", "t('建议先做'", "t('再确认一下'"]) {
    const index = chatPageSource.indexOf(marker);
    assert.notEqual(index, -1, `应保留正文部分：${marker}`);
    assert.ok(index < evidenceDetailsIndex, `正文部分应在折叠区之前：${marker}`);
  }
});

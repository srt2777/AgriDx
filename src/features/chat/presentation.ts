/**
 * 回答正文之外的附带信息，默认收进折叠区，只在用户手动展开时显示。
 * 正文（理解、可能原因、建议、追问）始终直接显示；这里只决定展示层，
 * 不改变回答内容、诊断路由或模型行为。
 */
export const DEFAULT_FOLDED_ANSWER_EXTRAS = ['background', 'evidence-line', 'source-note'] as const;
export type AnswerExtraSection = (typeof DEFAULT_FOLDED_ANSWER_EXTRAS)[number];

export function isAnswerExtraFoldedByDefault(section: string): boolean {
  return (DEFAULT_FOLDED_ANSWER_EXTRAS as readonly string[]).includes(section);
}

/** Compact the older, repeated general-source note without discarding any status. */
export function compactLegacyGeneralSourceNote(note: string): string {
  const match = /^本次参考(.+?)通识（无手册页码），只能解释一般原理，不能作为本机参数或维修操作依据。([\s\S]*)$/.exec(note);
  if (!match) return note;
  const entries = match[1].split('、').map(entry => /^(TK-[A-Za-z0-9-]+)（([^（）]+)）$/.exec(entry));
  if (entries.length < 2 || entries.some(entry => !entry)) return note;
  const groups = new Map<string, string[]>();
  for (const entry of entries) {
    if (!entry) return note;
    const ids = groups.get(entry[2]) ?? [];
    ids.push(entry[1]);
    groups.set(entry[2], ids);
  }
  if (groups.size === entries.length) return note;
  const grouped = [...groups].map(([status, ids]) => `${ids.join('、')}（${status}）`).join('；');
  return `本次参考${grouped}通识（无手册页码），只能解释一般原理，不能作为本机参数或维修操作依据。${match[2]}`;
}

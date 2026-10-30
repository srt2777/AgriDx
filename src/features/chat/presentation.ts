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

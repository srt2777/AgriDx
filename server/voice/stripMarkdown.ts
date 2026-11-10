/**
 * Strip Markdown/formatting from an answer before speech synthesis, so the
 * speaker never reads out "**", "#", list markers or link syntax.
 * Pure function; covered by tests/voice.test.ts.
 */
export function stripMarkdownForSpeech(input: string): string {
  let text = input.replace(/\r\n?/g, '\n');
  // Fenced code blocks: keep the code itself out of speech entirely.
  text = text.replace(/```[\s\S]*?```/g, ' ');
  text = text.replace(/`([^`]*)`/g, '$1');
  // Images ![alt](url) -> alt; links [text](url) -> text.
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  // Headings, blockquotes, rules, tables.
  text = text.replace(/^#{1,6}\s+/gm, '');
  text = text.replace(/^>\s?/gm, '');
  text = text.replace(/^\s*[-*_]{3,}\s*$/gm, ' ');
  text = text.replace(/\|/g, ' ');
  // Ordered / unordered list markers at line starts.
  text = text.replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '');
  // Bold / italic / strikethrough markers.
  text = text.replace(/(\*\*|__)(.*?)\1/g, '$2');
  text = text.replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1$2');
  text = text.replace(/(^|[^_\w])_([^_\n]+)_/g, '$1$2');
  text = text.replace(/~~(.*?)~~/g, '$1');
  // Any leftover HTML tags.
  text = text.replace(/<[^>]+>/g, ' ');
  // Collapse whitespace; keep sentence punctuation.
  return text.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').replace(/\n/g, ' ').trim();
}

/**
 * Truncate speech text at a sentence boundary where possible.
 * Returns the text actually spoken and whether it was cut short.
 */
export function truncateForSpeech(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  const cut = text.slice(0, maxChars);
  const boundary = Math.max(
    cut.lastIndexOf('。'),
    cut.lastIndexOf('！'),
    cut.lastIndexOf('？'),
    cut.lastIndexOf('；'),
    cut.lastIndexOf('\n'),
  );
  const spoken = (boundary > maxChars * 0.5 ? cut.slice(0, boundary + 1) : cut).trim();
  return { text: spoken, truncated: true };
}

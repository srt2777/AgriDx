import type { ChatResponse } from './chat';
import { validateLiteratureRecord, type LiteratureRecord, type LiteraturePage } from './literature';

export type LiteratureSearch = (params: URLSearchParams, signal?: AbortSignal) => Promise<LiteraturePage>;
export const LITERATURE_BOUNDARY = '仅核对文献元数据；未取得或核验全文、研究结论及具体机型适用性，不作为维修诊断依据。';
/** One source record becomes one archival entry; no additional knowledge count. */
export function literatureArchiveEntry(record: LiteratureRecord) {
  validateLiteratureRecord(record);
  if (/中国农机化学报|journal of chinese agricultural mechanization/i.test(record.journal)) throw new Error('Excluded journal');
  return {
    entryId: record.id, entryType: '文献归档' as const, sourceId: `doi:${record.doi}`,
    title: record.title, topic: record.topic,
    content: `标题：${record.title}\n作者：${record.authors.join('；')}\n期刊：${record.journal}\n出版日期：${record.published.join('-')}\nDOI：${record.doi}`,
    citation: { title: record.title, authors: record.authors, journal: record.journal, published: record.published, doi: record.doi, url: record.url },
    provenance: { sourceUrl: record.sourceUrl, retrievedAt: record.retrievedAt, responseSha256: record.responseSha256 },
    status: '元数据已对照来源，全文未核验', scopeBoundary: LITERATURE_BOUNDARY,
    diagnosticEvidence: false as const, fullTextVerified: false as const,
    knowledgeClaims: [] as never[],
  };
}
const escape = (value: string) => value.replace(/[\\`*_{}[\]<>()#!|]/g, '\\$&').replace(/[\r\n]+/g, ' ');
/** Explicit discovery requests only; ordinary diagnosis always retains its existing safety routing. */
export function literatureQuery(question: string): string | undefined {
  const trimmed = question.trim();
  if (/^(?:https?:\/\/doi\.org\/)?10\.\d{4,9}\/\S+$/i.test(trimmed)) return trimmed;
  const match = trimmed.match(/^(?:查文献|查找文献|检索文献|搜索文献|文献检索|文献搜索|引用文献)\s*[:：]?\s*(.*)$/s);
  if (!match) return;
  // UI search aliases, not translations of source titles or scientific claims.
  return match[1].replace(/拖拉机/g, 'tractor').replace(/液压/g, 'hydraulic').replace(/灌溉/g, 'irrigation').trim();
}
export async function literatureChatReply(question: string, search: LiteratureSearch, signal?: AbortSignal): Promise<ChatResponse | undefined> {
  const query = literatureQuery(question);
  if (query === undefined) return;
  signal?.throwIfAborted();
  const response = (content: string, knowledgeSources: ChatResponse['knowledgeSources'] = []): ChatResponse => ({
    choices: [{ message: { role: 'assistant', content } }], provider: 'knowledge-base', model: 'literature-archive',
    answerMode: 'local-evidence', fellBack: false, knowledgeChunks: knowledgeSources.length, knowledgeSources,
  });
  if (!query || query.length > 100) return response('请输入 1–100 字的文献标题关键词或 DOI，例如“查文献：tractor”。文献归档只能引用已取得的元数据。');
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', forwardAbort, {once:true});
  const timer = setTimeout(() => controller.abort(new Error('Literature lookup timed out')), 10_000);
  const budget = controller.signal;
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => { onAbort = () => reject(budget.reason); budget.addEventListener('abort', onAbort, {once:true}); });
  try {
    const page = await Promise.race([search(new URLSearchParams({ q: query }), budget), aborted]);
    signal?.throwIfAborted();
    const entries = page.entries.slice(0, 5).map(literatureArchiveEntry);
    const content = [`检索词：${escape(query)}。匹配 ${page.total} 条文献归档，列出前 ${entries.length} 条。`, LITERATURE_BOUNDARY,
      ...entries.map((entry, i) => `${i+1}. [${escape(entry.title)}](${entry.citation.url})\n   ${escape(entry.citation.authors.slice(0, 5).join('；'))}；${escape(entry.citation.journal)}；${entry.citation.published.join('-')}。\n   条目：${entry.entryId}；DOI：${escape(entry.citation.doi)}。`),
      entries.length ? '以上引用仅说明该文献的书目信息，不能据此归纳论文结论。' : '未找到匹配记录；可用原文关键词或 DOI 重试，不能据此判定相关研究不存在。',
      `[打开归档检索](#/knowledge?view=literature&q=${encodeURIComponent(query)})`].join('\n\n');
    return response(content, entries.map(entry => ({ entryId: entry.entryId, entryType: entry.entryType,
      evidenceKind: 'literature', evidenceLabel: '文献归档（全文未核验）', usage: 'reference-only',
      source: entry.citation.url, sourceId: entry.sourceId, sourceTitle: entry.citation.journal, heading: entry.title,
      locator: `DOI：${entry.citation.doi}`, status: entry.status, scopeBoundary: entry.scopeBoundary,
      diagnosticEvidence: false, referenceVerification: 'pending', sourceIndexed: true, applicability: 'pending' })));
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof RangeError) return response('检索条件无效，请使用不超过 12 个标题关键词或一个完整 DOI。');
    return response('文献归档暂时无法读取，本次未取得可引用来源。请稍后重试；不会生成虚构引用。');
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', forwardAbort); budget.removeEventListener('abort', onAbort); }
}

import { literatureArchiveEntry, LITERATURE_BOUNDARY, type LiteratureSearch } from '../shared/literature-archive';
import type { ToolRegistry } from './tool-registry';
/** Host-injected storage works in Node and static preview; no network chosen by a model. */
export function registerLiteratureTools(registry: ToolRegistry, search: LiteratureSearch) {
  registry.register('search_literature', '检索文献归档并返回可引用书目信息。仅元数据，不含全文或维修结论；使用原文关键词或 DOI。', {
    type: 'object', properties: { query: { type: 'string', minLength: 1, maxLength: 100 }, page: { type: 'integer', minimum: 1, maximum: 999999 } },
    required: ['query'], additionalProperties: false,
  }, async ({query, page = 1}, context) => {
    const result = await search(new URLSearchParams({q: query, page: String(page)}), context?.signal);
    context?.signal.throwIfAborted();
    return { total: result.total, page: result.page, pages: result.pages, scopeBoundary: LITERATURE_BOUNDARY,
      entries: result.entries.slice(0, 3).map(literatureArchiveEntry) };
  }, {risk: 'read', timeout_s: 10, max_output: 16000});
}

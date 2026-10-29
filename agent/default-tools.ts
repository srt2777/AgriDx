import { getKnowledgeCatalog } from '../server/knowledge/catalog';
import { loadKnowledgeBase, retrieveWithDiagnostics, stats } from '../server/knowledge/retriever';
import { resolveScope } from '../server/knowledge/scope';
import { ToolRegistry } from './tool-registry';
import type { InputSchema } from './tool-types';
import { calculator } from './calculator';
const string = (description: string): InputSchema => ({ type: 'string', description, maxLength: 200 });
const context: InputSchema = {
  type: 'object', description: '可选机型上下文，例如 {"brand":"久保田","model":"LX2620"}，默认空对象', additionalProperties: false,
  properties: {
    machineType: string('农机类型'), brand: string('品牌'), model: string('完整型号'), engineModel: string('发动机型号'),
    faultCodes: { type: 'array', description: '故障码列表，例如 ["P001"]，默认空', items: string('故障码'), maxItems: 20 },
  },
};
const object = (properties: Record<string, InputSchema>, required: string[] = []): InputSchema => ({ type: 'object', properties, required, additionalProperties: false });

/** Read-only adapters; no model API, memory, shell execution or simulation access. */
export function build_default_registry(): ToolRegistry {
  const reg = new ToolRegistry();
  reg.register('calculator', '计算基础四则运算和取余；需要精确算术时使用，不用于查询厂家参数或执行代码。返回有限数字 JSON。', object({ expression: { type: 'string', description: '算式，例如 (12 + 3) * 2，仅支持 + - * / % 和括号', minLength: 1, maxLength: 2000 } }, ['expression']), ({ expression }) => calculator(expression));
  reg.register('search_knowledge', '需要查找农机症状与手册依据时使用，保留来源、适用范围及核验状态。不要用于确诊坏件、生成无依据参数或实车操作。返回含来源、范围和正文的 JSON。', object({
    query: { type: 'string', minLength: 1, maxLength: 2000, description: '症状与问题，尽量包含完整机型' },
    limit: { type: 'integer', minimum: 1, maximum: 5, description: '最多返回条数，默认1' }, context,
  }, ['query']), ({ query, limit = 1, context = {} }) => {
    const { chunks, ...result } = retrieveWithDiagnostics(query, limit, context);
    // Put applicability and source metadata before the potentially long body.
    return { ...result, chunks: chunks.map(({ text, ...metadata }) => ({ ...metadata, text })) };
  });
  reg.register('browse_knowledge', '需要按品牌、型号、组件或关键词浏览资料目录时使用。目录是资料线索，不要当作已确诊故障或适用性证明。返回精简目录 JSON。', object({
    brand: string('品牌'), model: string('完整型号'), component: string('组件'), part: string('零部件'), q: string('目录关键词'),
    collection: { type: 'string', enum: ['all', 'archive', 'learning'], description: '资料集合，默认 all' },
    limit: { type: 'integer', minimum: 1, maximum: 20, description: '返回条目数，默认10' },
    page: { type: 'integer', minimum: 1, maximum: 999999, description: '页码，默认1' },
  }), ({ page, limit = 10, ...filters }) => {
    const catalog = getKnowledgeCatalog({ ...filters, ...(page === undefined ? {} : { page: String(page) }) });
    const summarize = ({ content, ...entry }: { content: string }) => entry;
    return {
      limitations: catalog.limitations,
      selected: catalog.selected && { ...catalog.selected, entries: catalog.selected.entries.slice(0, limit).map(summarize) },
      library: catalog.library && { ...catalog.library, entries: catalog.library.entries.slice(0, limit).map(summarize) },
      totals: catalog.totals, kbVersion: catalog.kbVersion,
      ...(!catalog.selected && !catalog.library ? { brands: catalog.brands.slice(0, limit).map(b => ({ name: b.name, models: b.models.map(m => m.name).slice(0, limit) })) } : {}),
    };
  });
  reg.register('knowledge_stats', '需要当前已加载知识条目统计时使用。数量不代表独立故障种类、机型覆盖率或线上部署状态，不用于维修判断。返回统计 JSON。', object({}), () => { loadKnowledgeBase(); return stats(); });
  reg.register('resolve_machine_scope', '需要解析问题中的品牌、型号及与已填机型的冲突时使用。只做身份范围解析，不验证实车配置、手册适用性或厂家参数。返回解析范围与冲突 JSON。', object({
    query: { type: 'string', minLength: 1, maxLength: 2000, description: '待解析问题，包含品牌或完整型号' }, context,
  }, ['query']), ({ query, context = {} }) => { loadKnowledgeBase(); return resolveScope(query, context); });
  reg.register('get_current_time', '需要当前日期与时间用于记录时使用，返回ISO时间及上海时间。不要用于判断故障、获取历史事件或核验上线时间。', object({}), () => {
    const date = new Date();
    return { iso: date.toISOString(), timezone: 'Asia/Shanghai', local: date.toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }) };
  });
  return reg;
}

/** Shared registry; each task must create its own executor. */
export const registry = build_default_registry();

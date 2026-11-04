import { getKnowledgeCatalog } from '../server/knowledge/catalog';
import { loadKnowledgeBase, retrieveWithDiagnostics, stats } from '../server/knowledge/retriever';
import { resolveScope } from '../server/knowledge/scope';
import { loadKnowledgeSnapshot } from '../server/knowledge/snapshot';
import { identifyPlannerTopic, identifyPlannerTopics, plannerFaultChains, plannerTopicLabel, type PlannerTopic } from '../server/diagnosis/plannerPlans';
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
  reg.register('fault_chain', '需要按故障主题查看症状→原因→证据→追问的逻辑链时使用。链来自 Planner 主题模板与已核验知识条目，不是故障概率，基本事件仍是用户报告或手册证据、待核实。返回顶事件、原因分解与每原因对应的步骤和证据 ID。', object({
    topic: { type: 'string', enum: ['overheat', 'starting', 'fuel', 'electrical', 'hydraulic', 'transmission'], description: '故障主题，overheat/starting/fuel/electrical/hydraulic/transmission 之一' },
    symptom: string('症状文本，未给 topic 时用它识别主题；多系统歧义时返回错误'),
  }), ({ topic, symptom }) => {
    const resolved: PlannerTopic | undefined = topic as PlannerTopic | undefined ?? (typeof symptom === 'string' ? identifyPlannerTopic(symptom) : undefined);
    if (!resolved) {
      // Ambiguous symptoms name their candidate systems only (labels, no
      // evidence IDs, no fault conclusion); the caller must pick one first.
      const candidates = typeof symptom === 'string' ? identifyPlannerTopics(symptom) : [];
      return { error: 'TOPIC_NOT_IDENTIFIED',
        note: candidates.length >= 2
          ? `多系统歧义，无法确定唯一逻辑链，可能涉及：${candidates.map(plannerTopicLabel).join('、')}。请先确认其中一个系统，再请求该系统的逻辑链。`
          : '请给出单个已知的故障主题或单系统症状文本，多系统歧义无法确定唯一逻辑链。' };
    }
    const chain = plannerFaultChains[resolved];
    return { topic: resolved, topEvent: chain.topEvent, causes: chain.causes.map(cause => ({ ...cause, verification: 'unverified' })),
      note: '原因排序即追问价值排序（区分度降序），不是故障概率；证据 ID 须经本轮检索核对后才可引用。' };
  });
  const modelEntries = (entryType: string, brand: string, model: string, limit: number) => {
    const norm = (value: string) => value.trim().toUpperCase();
    const wantedBrand = norm(brand), wantedModel = norm(model);
    const seen = new Set<string>();
    // Compact index rows only: no per-entry models list (the caller named
    // the model) and no repeated full book title per entry — sources are
    // listed once at the top level. Without this, a 20-row index exceeds
    // the 4000-char tool output budget and the JSON is truncated.
    const entries: { entryId: string; title: string; sourceId: string }[] = [];
    const sources = new Map<string, string>();
    for (const chunk of loadKnowledgeSnapshot().chunks) {
      if (chunk.entryType !== entryType || !chunk.entryId || !chunk.sourceId || seen.has(chunk.entryId)) continue;
      if (norm(chunk.brand ?? '') !== wantedBrand) continue;
      if (!(chunk.models ?? []).some(m => norm(m) === wantedModel)) continue;
      seen.add(chunk.entryId);
      const title = chunk.heading.includes('｜') ? chunk.heading.split('｜').slice(1).join('｜') : chunk.heading;
      entries.push({ entryId: chunk.entryId, title, sourceId: chunk.sourceId });
      if (!sources.has(chunk.sourceId)) sources.set(chunk.sourceId, chunk.sourceTitle ?? chunk.source ?? '');
      if (entries.length >= limit) break;
    }
    return { entries, sources: [...sources.entries()].map(([sourceId, sourceTitle]) => ({ sourceId, sourceTitle })) };
  };
  const modelSchema = () => object({
    brand: { type: 'string', minLength: 1, maxLength: 100, description: '品牌，需与知识条目品牌一致' },
    model: { type: 'string', minLength: 1, maxLength: 100, description: '完整型号，需与知识条目型号精确一致（大小写不敏感）' },
    limit: { type: 'integer', minimum: 1, maximum: 20, description: '最多返回条数，默认10' },
  }, ['brand', 'model']);
  reg.register('model_fault_index', '需要按品牌型号列出该机型的故障表类知识条目时使用。只返回条目 ID、标题与来源 ID，不返回全文；适用性与核验状态须另行核对，不要当作已确诊故障。', modelSchema(), ({ brand, model, limit = 10 }) => {
    const { entries, sources } = modelEntries('维护/故障知识', brand, model, limit);
    return { brand, model, entries, sources, note: entries.length ? '仅为条目索引，正文请用 get_knowledge_entry 读取并核对适用范围。' : '该品牌型号下没有故障表类条目，或型号写法与知识条目不一致。' };
  });
  reg.register('maintenance_schedule', '需要按品牌型号列出该机型的操作/维护类知识条目（检查、保养类线索）时使用。返回的只是知识库条目索引，不是厂家发布的保养计划；条目适用性须另行核对，不返回全文。', modelSchema(), ({ brand, model, limit = 10 }) => {
    const { entries, sources } = modelEntries('操作/维护知识', brand, model, limit);
    return { brand, model, entries, sources, note: entries.length ? '仅为条目索引，正文请用 get_knowledge_entry 读取并核对适用范围。' : '该品牌型号下没有操作/维护类条目，或型号写法与知识条目不一致。' };
  });
  return reg;
}

/** Shared registry; each task must create its own executor. */
export const registry = build_default_registry();

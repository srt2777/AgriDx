import { MAX_TOOL_OUTPUT, TOOL_TIMEOUT_MS } from './config';
import { getKnowledgeCatalog } from '../server/knowledge/catalog';
import { loadKnowledgeBase, retrieveWithDiagnostics, stats } from '../server/knowledge/retriever';
import { resolveScope } from '../server/knowledge/scope';

/** Supported JSON Schema subset. Unsupported keywords are rejected at registration. */
export interface InputSchema {
  type: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'null';
  description?: string;
  properties?: Record<string, InputSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: InputSchema;
  enum?: (string | number | boolean | null)[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  maxItems?: number;
}
export interface Tool {
  name: string;
  description: string;
  input_schema: InputSchema;
  func: (args: any) => unknown;
}
const keywords = new Set(['type', 'description', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'minimum', 'maximum', 'minLength', 'maxLength', 'maxItems']);
function checkSchema(schema: InputSchema): void {
  if (!schema || !['object', 'string', 'number', 'integer', 'boolean', 'array', 'null'].includes(schema.type)) throw new TypeError('Unsupported schema type');
  for (const key of Object.keys(schema)) if (!keywords.has(key)) throw new TypeError(`Unsupported schema keyword: ${key}`);
  for (const child of Object.values(schema.properties ?? {})) checkSchema(child);
  for (const key of schema.required ?? []) if (!Object.hasOwn(schema.properties ?? {}, key)) throw new TypeError(`Missing property schema: ${key}`);
  if (schema.items) checkSchema(schema.items);
}
function validate(value: unknown, schema: InputSchema, at = 'args'): void {
  const object = typeof value === 'object' && value !== null && !Array.isArray(value);
  const validType = schema.type === 'object' ? object
    : schema.type === 'array' ? Array.isArray(value)
    : schema.type === 'null' ? value === null
    : schema.type === 'integer' ? typeof value === 'number' && Number.isInteger(value)
    : schema.type === 'number' ? typeof value === 'number' && Number.isFinite(value)
    : typeof value === schema.type;
  if (!validType) throw new TypeError(`${at} must be ${schema.type}`);
  if (schema.enum && !schema.enum.includes(value as never)) throw new TypeError(`${at} is not an allowed value`);
  if (schema.type === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of schema.required ?? []) if (!Object.hasOwn(record, key)) throw new TypeError(`${at}.${key} is required`);
    for (const key of Object.keys(record)) {
      const child = Object.hasOwn(schema.properties ?? {}, key) ? schema.properties![key] : undefined;
      if (child) validate(record[key], child, `${at}.${key}`);
      else if (schema.additionalProperties === false) throw new TypeError(`${at}.${key} is unexpected`);
    }
  }
  if (typeof value === 'number' && ((schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum))) throw new TypeError(`${at} out of range`);
  if (typeof value === 'string') {
    const size = Array.from(value).length;
    if ((schema.minLength !== undefined && size < schema.minLength) || (schema.maxLength !== undefined && size > schema.maxLength)) throw new TypeError(`${at} invalid length`);
  }
  if (Array.isArray(value)) {
    if (schema.maxItems !== undefined && value.length > schema.maxItems) throw new TypeError(`${at} too many items`);
    if (schema.items) value.forEach((item, i) => validate(item, schema.items!, `${at}[${i}]`));
  }
}
function bounded(text: string): string {
  const chars = Array.from(text);
  const marker = '\n[TRUNCATED]';
  return chars.length <= MAX_TOOL_OUTPUT ? text : chars.slice(0, MAX_TOOL_OUTPUT - marker.length).join('') + marker;
}

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(name: string, description: string, input_schema: InputSchema, func: Tool['func']): void {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name) || !description.trim() || typeof func !== 'function') throw new TypeError('Invalid tool definition');
    if (input_schema.type !== 'object') throw new TypeError('Tool input must be an object schema');
    checkSchema(input_schema);
    this.tools.set(name, { name, description, input_schema: structuredClone(input_schema), func });
  }

  /** Functional decorator: registry.tool(name, description, schema)(fn). */
  tool(name: string, description: string, input_schema: InputSchema) {
    return <F extends Tool['func']>(func: F): F => {
      this.register(name, description, input_schema, func);
      return func;
    };
  }

  schemas(): Omit<Tool, 'func'>[] {
    return [...this.tools.values()].map(({ name, description, input_schema }) => ({ name, description, input_schema: structuredClone(input_schema) }));
  }

  describe(): string { return [...this.tools.values()].map(t => `- ${t.name}: ${t.description}`).join('\n'); }
  names(): string[] { return [...this.tools.keys()]; }

  /** Always await: synchronous throws, promise rejections and serialization failures become text. */
  async call(name: string, args: unknown = {}): Promise<string> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const tool = this.tools.get(name);
      if (!tool) return bounded(`ERROR: 未知工具；可用工具: ${this.names().join(', ')}`);
      const input = args ?? {};
      try { validate(input, tool.input_schema); }
      catch { return bounded('ERROR: 参数不正确，请按工具 input_schema 提供必填参数及正确类型。'); }
      const output = await Promise.race([
        Promise.resolve().then(() => tool.func(input)),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Tool timeout')), TOOL_TIMEOUT_MS); }),
      ]);
      const text = typeof output === 'string' ? output : JSON.stringify(output) ?? 'null';
      return bounded(text);
    } catch {
      // Do not expose exception messages: backend errors may contain credentials or private data.
      return 'ERROR: 工具执行失败（可能超时或输出无法序列化）。';
    } finally { if (timer !== undefined) clearTimeout(timer); }
  }
}

const string = (description: string): InputSchema => ({ type: 'string', description, maxLength: 200 });
const context: InputSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    machineType: string('农机类型'), brand: string('品牌'), model: string('完整型号'), engineModel: string('发动机型号'),
    faultCodes: { type: 'array', items: string('故障码'), maxItems: 20 },
  },
};
const object = (properties: Record<string, InputSchema>, required: string[] = []): InputSchema => ({ type: 'object', properties, required, additionalProperties: false });

/** Read-only adapters; no model API, memory, shell execution or simulation access. */
export function build_default_registry(): ToolRegistry {
  const reg = new ToolRegistry();
  reg.register('search_knowledge', '需要查找农机症状与手册依据时使用，保留来源、适用范围及核验状态。不要用于确诊坏件、生成无依据参数或实车操作。', object({
    query: { type: 'string', minLength: 1, maxLength: 2000, description: '症状与问题，尽量包含完整机型' },
    limit: { type: 'integer', minimum: 1, maximum: 5, description: '最多返回条数，默认1' }, context,
  }, ['query']), ({ query, limit = 1, context = {} }) => {
    const { chunks, ...result } = retrieveWithDiagnostics(query, limit, context);
    // Put applicability and source metadata before the potentially long body.
    return { ...result, chunks: chunks.map(({ text, ...metadata }) => ({ ...metadata, text })) };
  });
  reg.register('browse_knowledge', '需要按品牌、型号、组件或关键词浏览资料目录时使用。目录是资料线索，不要当作已确诊故障或适用性证明。', object({
    brand: string('品牌'), model: string('完整型号'), component: string('组件'), part: string('零部件'), q: string('目录关键词'),
    collection: { type: 'string', enum: ['all', 'archive', 'learning'] },
    page: { type: 'integer', minimum: 1, maximum: 999999 },
  }), ({ page, ...filters }) => {
    const catalog = getKnowledgeCatalog({ ...filters, ...(page === undefined ? {} : { page: String(page) }) });
    const summarize = ({ content, ...entry }: { content: string }) => entry;
    return {
      limitations: catalog.limitations,
      selected: catalog.selected && { ...catalog.selected, entries: catalog.selected.entries.map(summarize) },
      library: catalog.library && { ...catalog.library, entries: catalog.library.entries.map(summarize) },
      totals: catalog.totals, kbVersion: catalog.kbVersion,
      ...(!catalog.selected && !catalog.library ? { brands: catalog.brands.map(b => ({ name: b.name, models: b.models.map(m => m.name) })) } : {}),
    };
  });
  reg.register('knowledge_stats', '需要当前已加载知识条目统计时使用。数量不代表独立故障种类、机型覆盖率或线上部署状态，不用于维修判断。', object({}), () => { loadKnowledgeBase(); return stats(); });
  reg.register('resolve_machine_scope', '需要解析问题中的品牌、型号及与已填机型的冲突时使用。只做身份范围解析，不验证实车配置、手册适用性或厂家参数。', object({
    query: { type: 'string', minLength: 1, maxLength: 2000 }, context,
  }, ['query']), ({ query, context = {} }) => { loadKnowledgeBase(); return resolveScope(query, context); });
  reg.register('get_current_time', '需要当前日期与时间用于记录时使用，返回ISO时间及上海时间。不要用于判断故障、获取历史事件或核验上线时间。', object({}), () => {
    const date = new Date();
    return { iso: date.toISOString(), timezone: 'Asia/Shanghai', local: date.toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }) };
  });
  return reg;
}

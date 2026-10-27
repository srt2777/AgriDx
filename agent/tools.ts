import { MAX_TOOL_OUTPUT } from './config';
import { getKnowledgeCatalog } from '../server/knowledge/catalog';
import { loadKnowledgeBase, retrieveWithDiagnostics, stats } from '../server/knowledge/retriever';
import { resolveScope } from '../server/knowledge/scope';

import Ajv, { type ValidateFunction } from 'ajv';
import { DEFAULT_TOOL_TIMEOUT, MAX_PARALLEL_TOOLS, MAX_REPEAT_CALLS } from './config';

export interface InputSchema {
  type: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'null';
  description?: string;
  properties?: Record<string, InputSchema>;
  required?: readonly string[];
  additionalProperties?: boolean;
  items?: InputSchema;
  enum?: readonly (string | number | boolean | null)[];
  minimum?: number; maximum?: number; minLength?: number; maxLength?: number; maxItems?: number;
}
export interface Tool {
  name: string; description: string; input_schema: InputSchema;
  func: (args: any) => unknown;
  risk?: 'read' | 'write' | 'dangerous'; timeout_s?: number; max_output?: number;
}
export type ErrorType = 'UNKNOWN_TOOL' | 'INVALID_ARGS' | 'TIMEOUT' | 'PERMISSION_DENIED' | 'REPEATED_CALL' | 'TOOL_ERROR';
export interface ToolResult { ok: boolean; content: string; error_type: ErrorType | null; duration_ms: number }
const ajv = new Ajv({ allErrors: true, strict: true });
const serialize = (value: unknown): string => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? String(v) : v) ?? 'null';
function canonical(value: unknown): string {
  return serialize(value && typeof value === 'object' ? Array.isArray(value) ? value.map(v => JSON.parse(canonical(v))) : Object.fromEntries(Object.keys(value).sort().map(k => [k, JSON.parse(canonical((value as Record<string, unknown>)[k]))])) : value);
}
function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, /password|token|secret|key/i.test(k) ? '***' : redact(v)]));
  return value;
}
export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();
  private readonly validators = new Map<string, ValidateFunction>();
  register(tool: Tool): void;
  register(name: string, description: string, schema: InputSchema, func: Tool['func'], options?: Partial<Pick<Tool, 'risk' | 'timeout_s' | 'max_output'>>): void;
  register(toolOrName: Tool | string, description?: string, schema?: InputSchema, func?: Tool['func'], options = {}): void {
    const t: Tool = typeof toolOrName === 'string' ? { name: toolOrName, description: description!, input_schema: schema!, func: func!, ...options } : toolOrName;
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(t.name) || !t.description?.trim() || typeof t.func !== 'function') throw new TypeError('Invalid tool definition');
    if (this.tools.has(t.name)) throw new TypeError(`Duplicate tool: ${t.name}`);
    if (t.input_schema?.type !== 'object') throw new TypeError('Tool input must be object');
    if (t.risk && !['read','write','dangerous'].includes(t.risk)) throw new TypeError('Invalid risk');
    if (t.timeout_s !== undefined && (!Number.isFinite(t.timeout_s) || t.timeout_s <= 0)) throw new TypeError('Invalid timeout');
    if (t.max_output !== undefined && (!Number.isInteger(t.max_output) || t.max_output < 1)) throw new TypeError('Invalid output limit');
    const inputSchema = structuredClone(t.input_schema);
    const validator = ajv.compile(inputSchema);
    this.tools.set(t.name, { ...t, risk: t.risk ?? 'read', timeout_s: t.timeout_s ?? DEFAULT_TOOL_TIMEOUT, input_schema: inputSchema });
    this.validators.set(t.name, validator);
  }
  tool(name: string, description: string, schema: InputSchema, options: Partial<Pick<Tool,'risk'|'timeout_s'|'max_output'>> = {}) {
    return <F extends Tool['func']>(func: F): F => { this.register(name, description, schema, func, options); return func; };
  }
  get(name: string): Tool | undefined { const t = this.tools.get(name); return t && { ...t, risk: t.risk ?? 'read', timeout_s: t.timeout_s ?? DEFAULT_TOOL_TIMEOUT, input_schema: structuredClone(t.input_schema) }; }
  validator(name: string): ValidateFunction | undefined { return this.validators.get(name); }
  schemas(allowed?: string[]) { return [...this.tools.values()].filter(t => !allowed || allowed.includes(t.name)).map(({name,description,input_schema}) => ({name,description,input_schema:structuredClone(input_schema)})); }
  names(): string[] { return [...this.tools.keys()]; }
  describe(): string { return this.names().map(n => `- ${n}: ${this.tools.get(n)!.description}`).join('\n'); }
  /** Compatibility helper; task loops must retain one ToolExecutor for repeat protection. */
  async call(name: string, args: unknown = {}): Promise<string> { return (await new ToolExecutor(this).execute(name,args)).content; }
}
export class ToolExecutor {
  readonly trace: { tool: string; args: unknown; ok: boolean; error_type: ErrorType | null; result: string; duration_ms: number }[] = [];
  private readonly repeats = new Map<string,number>();
  constructor(private readonly registry: ToolRegistry, private readonly confirm?: (name: string, args: any) => boolean | Promise<boolean>) {}
  async execute(name: string, args: unknown = {}): Promise<ToolResult> {
    const start = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (ok: boolean, content: string, error_type: ErrorType | null): ToolResult => {
      const result = { ok, content, error_type, duration_ms: Math.round(performance.now()-start) };
      let safeArgs: unknown = '[无法记录参数]'; try { safeArgs = redact(structuredClone(args)); } catch { /* malformed args must not escape */ }
      this.trace.push({tool:name,args:safeArgs,ok,error_type,result:content.slice(0,200),duration_ms:result.duration_ms});
      return result;
    };
    const fail = (type: ErrorType, message: string) => finish(false,`ERROR[${type}]: ${message}`,type);
    try {
      const tool = this.registry.get(name);
      if (!tool) return fail('UNKNOWN_TOOL',`未知工具 ${name}。请选择可用工具：${this.registry.names().join(', ')}。`);
      const key = name + ':' + canonical(args);
      const count = (this.repeats.get(key) ?? 0)+1; this.repeats.set(key,count);
      if (count > MAX_REPEAT_CALLS) return fail('REPEATED_CALL','已用相同参数调用多次，请换参数或换方案。');
      if ((tool.risk ?? 'read') !== 'read' && !(this.confirm ? await this.confirm(name, structuredClone(args)) : tool.risk === 'write')) return fail('PERMISSION_DENIED','工具需要用户确认。请取得确认后重试。');
      const check = this.registry.validator(name)!;
      if (!check(args)) return fail('INVALID_ARGS',`${ajv.errorsText(check.errors,{dataVar:'args'})}；校验详情 ${serialize(check.errors)}；实际参数 ${serialize(redact(args))}。请按 input_schema 修正参数后重试。`);
      // Timers stop waiting only: in-flight async side effects cannot be killed. Synchronous
      // CPU-bound callbacks block Node's event loop; use a Worker/process adapter for those.
      const output = await Promise.race([Promise.resolve().then(() => tool.func(args)), new Promise<never>((_,reject) => { timer=setTimeout(() => reject(new ToolTimeout()),(tool.timeout_s ?? DEFAULT_TOOL_TIMEOUT)*1000); })]);
      let text = typeof output === 'string' ? output : serialize(output);
      const chars = Array.from(text), max = tool.max_output ?? MAX_TOOL_OUTPUT;
      if (chars.length > max) text = chars.slice(0,max).join('') + `...[已截断,原长 ${chars.length} 字符,请缩小查询范围]`;
      return finish(true,text,null);
    } catch (e) {
      if (e instanceof ToolTimeout) return fail('TIMEOUT','工具执行超时，后台操作可能仍在运行。请缩小范围，勿盲目重试有副作用操作。');
      return fail('TOOL_ERROR',`${e instanceof Error ? e.name + ': ' + e.message : String(e)}。请检查参数或换用其他工具。`);
    } finally { if (timer) clearTimeout(timer); }
  }
  async execute_tool_uses(content_blocks: unknown): Promise<Record<string,unknown>[]> {
    if (!Array.isArray(content_blocks)) return [];
    const blocks = content_blocks.filter(b => b && b.type === 'tool_use');
    const results: Record<string,unknown>[] = new Array(blocks.length);
    const run = async (i: number) => {
      const b = blocks[i]; const r = await this.execute(b.name,b.input);
      results[i] = {type:'tool_result',tool_use_id:b.id,content:r.content,...(!r.ok ? {is_error:true} : {})};
    };
    // Read batches are barriers around serial writes, preserving side-effect ordering.
    let pending: number[] = [];
    const flush = async () => {
      let next = 0; const batch = pending; pending = [];
      await Promise.all(Array.from({length:Math.min(MAX_PARALLEL_TOOLS,batch.length)},async () => { while(next < batch.length) await run(batch[next++]); }));
    };
    for (let i=0;i<blocks.length;i++) {
      if ((this.registry.get(blocks[i].name)?.risk ?? 'read') === 'read') pending.push(i);
      else { await flush(); await run(i); }
    }
    await flush(); return results;
  }
}
class ToolTimeout extends Error {}

/** Recursive descent parser: no eval, Function, properties, calls or identifiers. */
export function calculator(expression: string): number {
  const tokens = expression.match(/(?:\d+(?:\.\d*)?|\.\d+)|[()+*/%-]|[^\s]/g) ?? [];
  if (tokens.length > 300 || expression.length > 2000) throw new Error('表达式过长');
  let i=0;
  const atom = (): number => {
    const token=tokens[i++];
    if (token==='+' || token==='-') return (token==='-' ? -1 : 1)*atom();
    if (token==='(') { const v=sum(); if(tokens[i++]!==')') throw new Error('缺少右括号'); return v; }
    if (!token || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(token)) throw new Error('仅允许数字、+ - * / % 和括号');
    return Number(token);
  };
  const product = (): number => { let v=atom(); while(['*','/','%'].includes(tokens[i])) { const op=tokens[i++],rhs=atom(); v=op==='*'?v*rhs:op==='/'?v/rhs:v%rhs; } return v; };
  const sum = (): number => { let v=product(); while(['+','-'].includes(tokens[i])) { const op=tokens[i++],rhs=product(); v=op==='+'?v+rhs:v-rhs; } return v; };
  const result=sum(); if(i!==tokens.length || !Number.isFinite(result)) throw new Error('表达式不合法或除数为零'); return result;
}

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

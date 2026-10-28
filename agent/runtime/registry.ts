import { createHash, randomUUID } from 'node:crypto';
import Ajv, { type ValidateFunction } from 'ajv';
import { redact } from '../security/guard';

export type SideEffect = 'read' | 'write' | 'dangerous';
export interface Definition {
  name: string; description: string; parameters: object; returns: string; side_effect: SideEffect;
  timeout_ms: number; retryable: boolean; requires_confirmation: boolean; cache_ttl: number; tags: string[]; version: string;
  execute: (args: unknown, signal: AbortSignal) => unknown | Promise<unknown>;
}
export interface ExecutionOptions {
  /** Trusted host options; never populate from model or HTTP request arguments. */
  allowed: readonly SideEffect[]; confirmed?: boolean; signal?: AbortSignal;
  cacheScope?: string; audit?: (event: unknown) => void;
}
export type ToolResponse = { ok: boolean; data: unknown; error: null | { code: string; message: string; retryable: boolean; hint: string }; meta: { latency_ms: number; cached: boolean; truncated: boolean; evidence_level: string | null } };
const ajv = new Ajv({ allErrors: true, strict: true });
const json = (value: unknown): string => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? String(item) : item) ?? 'null';
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${json(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return json(value);
}

/** Instantiate per workflow: cached results and cursors must not outlive the trusted task boundary. */
export class Registry {
  private readonly entries = new Map<string, { definition: Definition; validate: ValidateFunction }>();
  private readonly cache = new Map<string, { expires: number; data: unknown }>();
  private readonly pages = new Map<string, { scope: string; text: string; offset: number; expires: number }>();
  constructor(private readonly outputLimit = 6000, private readonly now = Date.now) {
    if (!Number.isInteger(outputLimit) || outputLimit < 100) throw new Error('输出上限无效');
  }
  register(definition: Definition): void {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(definition.name) || this.entries.has(definition.name)) throw new Error('无效或重复工具名称');
    if (!definition.description?.trim() || !definition.returns?.trim() || !definition.version?.trim() || typeof definition.execute !== 'function' || !Number.isFinite(definition.timeout_ms) || definition.timeout_ms <= 0 || !Number.isFinite(definition.cache_ttl) || definition.cache_ttl < 0 || !Array.isArray(definition.tags) || definition.tags.some(tag => typeof tag !== 'string')) throw new Error('工具定义不完整');
    if (!['read', 'write', 'dangerous'].includes(definition.side_effect)) throw new Error('权限等级无效');
    if ((definition.parameters as { type?: string })?.type !== 'object') throw new Error('工具参数必须为 object schema');
    if (definition.side_effect !== 'read' && !definition.requires_confirmation) throw new Error('写入和危险工具必须确认');
    const parameters = structuredClone(definition.parameters);
    this.entries.set(definition.name, { definition: { ...definition, parameters, tags: [...definition.tags] }, validate: ajv.compile(parameters) });
  }
  schemas(): object[] { return [...this.entries.values()].map(({ definition: d }) => ({ type: 'function', function: { name: d.name, description: d.description, parameters: structuredClone(d.parameters) } })); }
  anthropicSchemas(): object[] { return [...this.entries.values()].map(({ definition: d }) => ({ name: d.name, description: d.description, input_schema: structuredClone(d.parameters) })); }
  definitions(): Omit<Definition, 'execute'>[] { return [...this.entries.values()].map(({ definition: { execute: _execute, ...d } }) => structuredClone(d)); }
  list(filter: { tag?: string; side_effect?: SideEffect } = {}): string[] { return this.definitions().filter(d => (!filter.tag || d.tags.includes(filter.tag)) && (!filter.side_effect || d.side_effect === filter.side_effect)).map(d => d.name); }
  private expire(): void {
    for (const [key, entry] of this.cache) if (entry.expires <= this.now()) this.cache.delete(key);
    for (const [key, page] of this.pages) if (page.expires <= this.now()) this.pages.delete(key);
  }
  /** Cursors are opaque, single-use, task-scoped; they page serialized data, never arbitrary files. */
  readPage(cursor: string, scope: string): { text: string; next_cursor: string | null } | undefined {
    this.expire(); const page = this.pages.get(cursor);
    if (!page || page.scope !== scope) return undefined;
    this.pages.delete(cursor);
    const text = page.text.slice(page.offset, page.offset + this.outputLimit);
    const offset = page.offset + text.length;
    const next = offset < page.text.length ? randomUUID() : null;
    if (next) this.pages.set(next, { ...page, offset });
    return { text, next_cursor: next };
  }
  async execute(name: string, args: unknown, options: ExecutionOptions): Promise<ToolResponse> {
    const start = performance.now(); this.expire();
    const finish = (data: unknown, error: ToolResponse['error'] = null, cached = false): ToolResponse => {
      const response: ToolResponse = { ok: !error, data, error, meta: { latency_ms: Math.round(performance.now()-start), cached, truncated: false, evidence_level: null } };
      if (!error && data && typeof data === 'object' && 'evidence_level' in data && typeof data.evidence_level === 'string') response.meta.evidence_level = data.evidence_level;
      if (!error) {
        const serialized = json(data);
        if (serialized.length > this.outputLimit) {
          const cursor = randomUUID();
          if (this.pages.size >= 32) this.pages.delete(this.pages.keys().next().value!);
          this.pages.set(cursor, { scope: options.cacheScope ?? '', text: serialized, offset: this.outputLimit, expires: this.now() + 60_000 });
          response.data = { preview: serialized.slice(0, this.outputLimit), next_cursor: cursor, total_chars: serialized.length };
          response.meta.truncated = true;
        }
      }
      return response;
    };
    const fail = (code: string, message: string, retryable = false, hint = '') => finish(null, { code, message, retryable, hint });
    const entry = this.entries.get(name); if (!entry) return fail('NOT_FOUND', '工具不存在');
    const { definition: d, validate } = entry;
    if (!options.allowed.includes(d.side_effect)) return fail('PERMISSION_DENIED', '当前角色无权调用此工具');
    // Snapshot once: caller mutation during an await cannot change validated/confirmed arguments.
    let input: unknown;
    try { input = structuredClone(args); } catch { return fail('INVALID_ARGS', '参数必须可序列化'); }
    if (!validate(input)) return fail('INVALID_ARGS', '参数不符合 schema', false, ajv.errorsText(validate.errors));
    if (d.requires_confirmation && !options.confirmed) return fail('NEEDS_CONFIRMATION', '该操作需要可信宿主确认');
    if (options.signal?.aborted) return fail('CANCELLED', '调用已取消');
    if (d.side_effect !== 'read' && !options.audit) return fail('PERMISSION_DENIED', '写操作必须由宿主提供审计');
    let cacheKey: string | undefined;
    try { if (d.side_effect === 'read' && d.cache_ttl > 0 && options.cacheScope) cacheKey = createHash('sha256').update(canonical([name, d.version, options.cacheScope, input])).digest('hex'); }
    catch { return fail('INVALID_ARGS', '参数不能包含循环引用'); }
    const cached = cacheKey ? this.cache.get(cacheKey) : undefined;
    if (cached) return finish(structuredClone(cached.data), null, true);
    const controller = new AbortController();
    let timeout = false; let timer: ReturnType<typeof setTimeout> | undefined; let rejectAbort: () => void = () => {};
    const abort = () => { rejectAbort(); controller.abort(); };
    options.signal?.addEventListener('abort', abort, { once: true });
    let started = false;
    const audit = (status: string) => options.audit?.({ tool: name, args: redact(input), status });
    try {
      if (d.side_effect !== 'read') audit('started');
      if (options.signal?.aborted) return fail('CANCELLED', '调用已取消');
      const interrupted = new Promise<never>((_, reject) => {
        rejectAbort = () => reject(new Error('interrupted'));
        timer = setTimeout(() => { timeout = true; abort(); }, d.timeout_ms);
      });
      started = true;
      const data = await Promise.race([Promise.resolve().then(() => { if (controller.signal.aborted) throw new Error('interrupted'); return d.execute(input, controller.signal); }), interrupted]);
      // Serialize before acknowledging completion; cyclic results cannot enter cache or traces.
      json(data);
      if (d.side_effect !== 'read') audit('completed');
      if (cacheKey) {
        if (this.cache.size >= 64) this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(cacheKey, { data: structuredClone(data), expires: this.now() + d.cache_ttl });
      }
      return finish(data);
    } catch {
      if (d.side_effect !== 'read') { try { audit(started ? 'failed_or_uncertain' : 'audit_failed_before_execution'); } catch { /* Never retry a write because its audit sink failed. */ } }
      if (controller.signal.aborted) return fail(timeout ? 'TIMEOUT' : 'CANCELLED', '执行已中止或超时；底层副作用可能仍在运行', d.side_effect === 'read' && timeout && d.retryable);
      return fail('INTERNAL', started ? '工具或审计执行失败；有副作用操作请核实状态' : '审计不可用，操作未执行', false);
    } finally { if (timer) clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
  }
}

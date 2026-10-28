import Ajv, { type ValidateFunction } from 'ajv';
import { redact } from '../security/guard';

export type SideEffect = 'read' | 'write' | 'dangerous';
export interface Definition {
  name: string; description: string; parameters: object; returns: string; side_effect: SideEffect;
  timeout_ms: number; retryable: boolean; requires_confirmation: boolean; cache_ttl: number; tags: string[]; version: string;
  execute: (args: unknown, signal: AbortSignal) => unknown | Promise<unknown>;
}
export type ToolResponse = { ok: boolean; data: unknown; error: null | { code: string; message: string; retryable: boolean; hint: string }; meta: { latency_ms: number; cached: boolean; truncated: boolean; evidence_level: string | null } };
const ajv = new Ajv({ allErrors: true, strict: true });
export class Registry {
  private entries = new Map<string, { definition: Definition; validate: ValidateFunction }>();
  register(definition: Definition): void {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(definition.name) || this.entries.has(definition.name)) throw new Error('无效或重复工具名称');
    if (!definition.description || !definition.returns || !Number.isFinite(definition.timeout_ms) || definition.timeout_ms <= 0 || !Number.isFinite(definition.cache_ttl) || definition.cache_ttl < 0) throw new Error('工具定义不完整');
    if (!['read', 'write', 'dangerous'].includes(definition.side_effect)) throw new Error('权限等级无效');
    if (definition.side_effect !== 'read' && !definition.requires_confirmation) throw new Error('写入和危险工具必须确认');
    this.entries.set(definition.name, { definition: { ...definition, parameters: structuredClone(definition.parameters), tags: [...definition.tags] }, validate: ajv.compile(definition.parameters) });
  }
  schemas(): object[] { return [...this.entries.values()].map(({ definition: d }) => ({ type: 'function', function: { name: d.name, description: d.description, parameters: structuredClone(d.parameters) } })); }
  list(filter: { tag?: string; side_effect?: SideEffect } = {}): string[] { return [...this.entries.values()].map(x => x.definition).filter(d => (!filter.tag || d.tags.includes(filter.tag)) && (!filter.side_effect || d.side_effect === filter.side_effect)).map(d => d.name); }
  async execute(name: string, args: unknown, options: { allowed: readonly SideEffect[]; confirmed?: boolean; signal?: AbortSignal; audit?: (event: unknown) => void } ): Promise<ToolResponse> {
    const start = performance.now();
    const finish = (data: unknown, error: ToolResponse['error'] = null): ToolResponse => ({ ok: !error, data, error, meta: { latency_ms: Math.round(performance.now()-start), cached: false, truncated: false, evidence_level: null } });
    const fail = (code: string, message: string, retryable = false, hint = '') => finish(null, { code, message, retryable, hint });
    const entry = this.entries.get(name); if (!entry) return fail('NOT_FOUND', '工具不存在');
    const { definition: d, validate } = entry;
    if (!options.allowed.includes(d.side_effect)) return fail('PERMISSION_DENIED', '当前角色无权调用此工具');
    if (!validate(args)) return fail('INVALID_ARGS', '参数不符合 schema', false, ajv.errorsText(validate.errors));
    if (d.requires_confirmation && !options.confirmed) return fail('NEEDS_CONFIRMATION', '该操作需要可信宿主确认');
    if (options.signal?.aborted) return fail('CANCELLED', '调用已取消');
    const controller = new AbortController();
    const abort = () => controller.abort(); options.signal?.addEventListener('abort', abort, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const data = await Promise.race([Promise.resolve().then(() => d.execute(structuredClone(args), controller.signal)), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, d.timeout_ms);
        controller.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      })]);
      if (d.side_effect !== 'read') options.audit?.({ tool: name, args: redact(args), status: 'ok' });
      return finish(data);
    } catch (e) {
      if (d.side_effect !== 'read') options.audit?.({ tool: name, args: redact(args), status: 'failed' });
      if (controller.signal.aborted) return fail(options.signal?.aborted ? 'CANCELLED' : 'TIMEOUT', '执行已中止或超时；底层副作用可能仍在运行', false);
      return fail('INTERNAL', '工具执行失败', false);
    } finally { if (timer) clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
  }
}

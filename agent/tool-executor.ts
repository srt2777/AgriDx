import { MAX_TOOL_OUTPUT, DEFAULT_TOOL_TIMEOUT, MAX_PARALLEL_TOOLS, MAX_REPEAT_CALLS } from './config';
import { schemaErrors } from './tool-registry';
import type { ToolRegistry } from './tool-registry';
import type { ErrorType, ToolResult } from './tool-types';
import { canonical, redact, serialize } from './tool-utils';
export class ToolExecutor {
  readonly trace: { tool: string; args: unknown; ok: boolean; error_type: ErrorType | null; result: string; duration_ms: number }[] = [];
  private readonly repeats = new Map<string,number>();
  constructor(private readonly registry: ToolRegistry, private readonly confirm?: (name: string, args: any) => boolean | Promise<boolean>) {}
  async execute(name: string, args: unknown = {}, options: { signal?: AbortSignal } = {}): Promise<ToolResult> {
    const start = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let detachAbort: (() => void) | undefined;
    const controller = new AbortController();
    const finish = (ok: boolean, content: string, error_type: ErrorType | null): ToolResult => {
      const result = { ok, content, error_type, duration_ms: Math.round(performance.now()-start) };
      let safeArgs: unknown = '[无法记录参数]'; try { safeArgs = redact(structuredClone(args)); } catch { /* malformed args must not escape */ }
      this.trace.push({tool:name,args:safeArgs,ok,error_type,result:content.slice(0,200),duration_ms:result.duration_ms});
      return result;
    };
    const fail = (type: ErrorType, message: string) => finish(false,`ERROR[${type}]: ${message}`,type);
    try {
      if (options.signal?.aborted) return fail('CANCELLED','调用已取消。');
      const cancelled = new Promise<never>((_,reject) => {
        const abort = () => { controller.abort(); reject(new ToolCancelled()); };
        options.signal?.addEventListener('abort',abort,{once:true});
        detachAbort = () => options.signal?.removeEventListener('abort',abort);
        if(options.signal?.aborted)abort();
      });
      // A synchronous early return must not leave an abort rejection unobserved.
      void cancelled.catch(() => {});
      const tool = this.registry.get(name);
      if (!tool) return fail('UNKNOWN_TOOL',`未知工具 ${name}。请选择可用工具：${this.registry.names().join(', ')}。`);
      const key = name + ':' + canonical(args);
      const count = (this.repeats.get(key) ?? 0)+1; this.repeats.set(key,count);
      if (count > MAX_REPEAT_CALLS) return fail('REPEATED_CALL','已用相同参数调用多次，请换参数或换方案。');
      if ((tool.risk ?? 'read') !== 'read' && !(this.confirm ? await Promise.race([Promise.resolve().then(()=>this.confirm!(name, structuredClone(args))),cancelled]) : tool.risk === 'write')) return fail('PERMISSION_DENIED','工具需要用户确认。请取得确认后重试。');
      if (options.signal?.aborted) return fail('CANCELLED','调用已取消。');
      const check = this.registry.validator(name)!;
      if (!check(args)) return fail('INVALID_ARGS',`${schemaErrors(check.errors)}；校验详情 ${serialize(check.errors)}；实际参数 ${serialize(redact(args))}。请按 input_schema 修正参数后重试。`);
      // Cooperative tools receive the signal; synchronous work cannot be preempted.
      const output = await Promise.race([Promise.resolve().then(() => { if(controller.signal.aborted)throw new ToolCancelled(); return tool.func(args,{signal:controller.signal}); }), cancelled, new Promise<never>((_,reject) => { timer=setTimeout(() => { controller.abort(); reject(new ToolTimeout()); },(tool.timeout_s ?? DEFAULT_TOOL_TIMEOUT)*1000); })]);
      let text = typeof output === 'string' ? output : serialize(output);
      const chars = Array.from(text), max = tool.max_output ?? MAX_TOOL_OUTPUT;
      if (chars.length > max) text = chars.slice(0,max).join('') + `...[已截断,原长 ${chars.length} 字符,请缩小查询范围]`;
      return finish(true,text,null);
    } catch (e) {
      if (e instanceof ToolTimeout) return fail('TIMEOUT','工具执行超时，后台操作可能仍在运行。请缩小范围，勿盲目重试有副作用操作。');
      if (e instanceof ToolCancelled) return fail('CANCELLED','调用已取消；不支持协作取消的工具可能仍在运行。');
      return fail('TOOL_ERROR',`${e instanceof Error ? e.name + ': ' + e.message : String(e)}。请检查参数或换用其他工具。`);
    } finally { if (timer) clearTimeout(timer); detachAbort?.(); }
  }
  async execute_tool_uses(content_blocks: unknown, options: { signal?: AbortSignal } = {}): Promise<Record<string,unknown>[]> {
    if (!Array.isArray(content_blocks)) return [];
    const blocks = content_blocks.filter(b => b && b.type === 'tool_use');
    const results: Record<string,unknown>[] = new Array(blocks.length);
    const run = async (i: number) => {
      const b = blocks[i]; const r = await this.execute(b.name,b.input,options);
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
class ToolCancelled extends Error {}


import Ajv, { type ValidateFunction } from 'ajv';
import { DEFAULT_TOOL_TIMEOUT } from './config';
import type { InputSchema, Tool } from './tool-types';
import { ToolExecutor } from './tool-executor';
const ajv = new Ajv({ allErrors: true, strict: true });
export const schemaErrors = (errors: ValidateFunction['errors']) => ajv.errorsText(errors, { dataVar: 'args' });
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

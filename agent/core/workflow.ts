import { randomUUID } from 'node:crypto';
import Ajv from 'ajv';
import type { AgentWorkflowInput, WorkflowEvent, WorkflowResult } from '../../shared/agent';
import { createStrictSearch, type StrictSearchResult } from '../retrieval/strict';
import { dangerousRequest, suspiciousInstructions } from '../security/guard';
import { Registry, type Definition } from '../runtime/registry';
import { runLoop, type AgentProvider } from './loop';
import { loadPrompts, type PromptBundle } from '../prompts/loader';
import { WorkflowMetrics } from '../observability/metrics';

export const workflowInputSchema = { type: 'object', additionalProperties: false, required: ['query', 'machine'], properties: {
  query: { type: 'string', minLength: 1, maxLength: 2000 }, faultCode: { type: 'string', minLength: 1, maxLength: 120 },
  machine: { type: 'object', additionalProperties: false, properties: Object.fromEntries(['brand', 'model', 'engineModel'].map(field => [field, { type: 'string', minLength: 1, maxLength: 120 }])) },
} };
const validate = new Ajv({ strict: true }).compile<AgentWorkflowInput>(workflowInputSchema);
export class WorkflowInputError extends Error {}
export function parseWorkflowInput(value: unknown): AgentWorkflowInput {
  if (!validate(value)) throw new WorkflowInputError('请提供问题及设备信息；问题上限 2000 字符，不支持客户端指令或确认字段。');
  const input = structuredClone(value);
  input.query = input.query.trim();
  if (!input.query) throw new WorkflowInputError('问题不能为空');
  return input;
}
export function extractCode(query: string): string | undefined {
  return query.match(/SPN\s*[:=]?\s*\d+\s*[,;/ -]+\s*FMI\s*[:=]?\s*\d+/i)?.[0]
    ?? query.match(/\b[PBCU]\d{3,6}\b/i)?.[0];
}
const definition = (name: string, description: string, execute: Definition['execute']): Definition => ({ name, description,
  parameters: { type: 'object', properties: {}, additionalProperties: false }, returns: '来源与适用范围或结构化追问',
  side_effect: 'read', timeout_ms: 10_000, retryable: false, requires_confirmation: false, cache_ttl: 30_000, tags: ['diagnosis'], version: '1.0.0', execute });

export function createWorkflow(dependencies: { search?: ReturnType<typeof createStrictSearch>; prompts?: () => PromptBundle; timeoutMs?: number } = {}) {
  const search = dependencies.search ?? createStrictSearch(); const prompts = dependencies.prompts ?? loadPrompts;
  const metrics = new WorkflowMetrics();
  return {
    metrics,
    async run(value: unknown, options: { signal?: AbortSignal; onEvent?: (event: WorkflowEvent) => void } = {}): Promise<WorkflowResult> {
      const input = parseWorkflowInput(value); const started = performance.now(); const events: WorkflowEvent[] = [];
      const emit = (event: WorkflowEvent) => { events.push(event); try { options.onEvent?.(event); } catch { /* Observer does not control diagnosis. */ } };
      const finish = (partial: Omit<WorkflowResult, 'trace'>, version: string, stopReason: string, steps = 0): WorkflowResult => {
        const result: WorkflowResult = { ...partial, trace: { id: randomUUID(), provider: 'local-rule', prompt_version: version,
          stop_reason: stopReason, steps, elapsed_ms: Math.round(performance.now() - started), events } };
        metrics.record(result); return result;
      };
      const safety = /液压|高压|PTO|动力输出|蓄电池|电瓶|燃油|顶起|悬挂|高温|过热|开锅/i.test(input.query)
        ? ['涉及高压、带电、旋转、悬挂负载或高温风险时，先停机并按本机手册落实隔离；不要带压拆卸、接近转动件或进入悬挂负载下方。无法确认安全条件时联系授权维修站。']
        : ['检查前先停机，并按本机手册确认安全条件；本次资料定位不代替实车检查。'];
      if (dangerousRequest(input.query)) {
        emit({ type: 'done', step: 0, status: 'safety_restriction' });
        return finish({ status: 'refused', content: '不提供绕过安全保护、短接控制器、屏蔽传感器或改动排放和限速的指导。请停机并联系授权维修站。', safety, confidence: '低', evidence_level: '不足', citations: [], questions: [] }, 'guard-only', 'safety_restriction');
      }
      if (suspiciousInstructions(input.query)) {
        emit({ type: 'done', step: 0, status: 'untrusted_instruction' });
        return finish({ status: 'refused', content: '请求包含试图覆盖系统规则的指令。请直接描述机型、故障现象或故障码。', safety, confidence: '低', evidence_level: '不足', citations: [], questions: [] }, 'guard-only', 'untrusted_instruction');
      }
      let bundle: PromptBundle;
      try { bundle = prompts(); } catch {
        emit({ type: 'done', step: 0, status: 'prompt_unavailable' });
        return finish({ status: 'degraded', content: '诊断规则配置不可用，请联系维护者检查提示词文件。', safety, confidence: '低', evidence_level: '不足', citations: [], questions: [] }, 'unavailable', 'prompt_unavailable');
      }
      let found: StrictSearchResult | undefined;
      const missingIdentity = !input.machine.brand?.trim() || !input.machine.model?.trim();
      const code = input.faultCode?.trim() ?? extractCode(input.query);
      const registry = new Registry();
      registry.register(definition('extract_fault_entities', '何时使用：检索前识别本次设备与代码。何时不要使用：不可推断故障原因。区别：此工具不检索资料。示例：{}。', () => ({ machine: input.machine, fault_code: code ?? null, observation: '用户陈述，未经实车验证' })));
      registry.register(definition('ask_user_clarification', '何时使用：缺少身份时追问。何时不要使用：不可猜测型号。区别：不执行检索。示例：{}。', () => ({ questions: ['品牌与完整型号是什么？', '仪表是否显示故障码？', '故障在什么工况下出现？'] })));
      const searchDefinition = (name: string, description: string) => definition(name, description, () => {
        found = search({ ...input, topK: 5, ...(code ? { faultCode: code } : {}) });
        return found;
      });
      registry.register(searchDefinition('search_knowledge_base', '何时使用：机型明确后按现象找资料。何时不要使用：机型未知或危险请求。区别：故障码优先用精确工具。示例：{}。'));
      registry.register(searchDefinition('lookup_fault_code', '何时使用：已知机型和故障码时精确查表。何时不要使用：猜测代码含义。区别：全快照匹配代码和机型。示例：{}。'));
      const provider: AgentProvider = { name: 'local-rule', next: async ({ observations, step }) => {
        if (step === 0) return { calls: [{ id: 'extract', name: 'extract_fault_entities', args: {} }] };
        if (step === 1 && observations[0]?.result.ok) return { calls: [{ id: 'retrieve', name: missingIdentity ? 'ask_user_clarification' : code ? 'lookup_fault_code' : 'search_knowledge_base', args: {} }] };
        return { done: true };
      } };
      const outcome = await runLoop(registry, provider, { signal: options.signal, timeoutMs: dependencies.timeoutMs, onEvent: emit });
      if (outcome.reason !== 'complete' || outcome.observations.some(observation => !observation.result.ok)) {
        return finish({ status: 'degraded', content: '本次资料定位未完成；工具失败或执行达到限制，未据此生成维修结论。请稍后重试。', safety, confidence: '低', evidence_level: '不足', citations: [], questions: [] }, bundle.version, outcome.reason, outcome.steps);
      }
      const questions = missingIdentity || found?.status === 'identity_required' ? [
        { id: 'machine', label: '本次设备的品牌与完整型号是什么？' },
        { id: 'code', label: '仪表是否显示故障码？请提供完整代码。', options: ['有故障码', '未显示', '暂不清楚'] },
        { id: 'condition', label: '故障在启动、怠速、行走还是作业时出现？', options: ['启动时', '怠速时', '行走时', '作业时'] },
      ] : [
        { id: 'configuration', label: '能否确认年份、发动机和本机手册版本？' },
        { id: 'condition', label: '故障发生条件和最近维修情况是什么？' },
        { id: 'checks', label: '已经完成哪些安全检查，观察到什么结果？' },
      ];
      // Present bounded, literal reference excerpts. A quote is not promoted into a generated repair instruction.
      const citations = [] as NonNullable<StrictSearchResult['citations']>;
      let remaining = 24_000;
      for (const citation of found?.citations ?? []) {
        const length = JSON.stringify(citation).length;
        // Omit an oversized reference rather than cut off its safety/configuration boundary.
        if (length > remaining) continue;
        citations.push(citation); remaining -= length;
      }
      const status = missingIdentity || found?.status === 'identity_required' ? 'needs_clarification' : citations.length ? 'references_found' : 'insufficient_evidence';
      const content = status === 'needs_clarification' ? found?.reason ?? '请先补充品牌与完整型号，再定位本机资料。'
        : citations.length ? `找到 ${citations.length} 条匹配本机范围的已核验资料。当前只展示资料与出处；原因尚未实车确认，置信度低。请核对每条资料的版本及适用范围，存在差异时请维修人员复核。`
          : '知识库中未找到可靠依据。请补充以下信息；当前无法据此提供故障原因、标准值或维修步骤。';
      return finish({ status, content, safety, confidence: '低', evidence_level: citations.length ? '部分' : '不足', citations, questions }, bundle.version, outcome.reason, outcome.steps);
    },
  };
}
export type Workflow = ReturnType<typeof createWorkflow>;

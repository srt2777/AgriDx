import type { ChatMessage } from '../llm/types';
import { isDiagnosisMode, type DiagnosisMode } from '../knowledge/coordination';
import type { RetrievalContext } from '../knowledge/scope';
import type { ChatTelemetrySummary } from '../../shared/chat';

export interface DiagnosticRequest extends RetrievalContext {
  diagnosisMode?: DiagnosisMode;
  history: (ChatMessage & { role: 'user' | 'assistant' })[];
  telemetrySummary?: ChatTelemetrySummary;
}

export class DiagnosticInputError extends Error {
  constructor(message: string, public readonly code: 'bad_request' | 'too_long' = 'bad_request') {
    super(message);
    this.name = 'DiagnosticInputError';
  }
}

/** Validate untrusted input without HTTP, knowledge loading or provider calls. */
export function parseDiagnosticRequest(input: unknown): DiagnosticRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new DiagnosticInputError('请求体必须为 JSON 对象');
  }
  const body = input as Record<string, unknown>;
  for (const field of ['machineType', 'brand', 'model', 'engineModel'] as const) {
    const value = body[field];
    if (value !== undefined && (typeof value !== 'string' || value.length > 100)) {
      throw new DiagnosticInputError('农机类型、品牌和型号必须为字符串（各上限 100 字符）');
    }
  }
  if (body.faultCodes !== undefined && (!Array.isArray(body.faultCodes) || body.faultCodes.length > 20 ||
    body.faultCodes.some(code => typeof code !== 'string' || !code.trim() || code.length > 32))) {
    throw new DiagnosticInputError('故障码必须为非空文本数组（最多20个，各上限32字符）');
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw new DiagnosticInputError('messages 参数缺失或格式错误');
  }
  if (body.messages.length > 40) {
    throw new DiagnosticInputError('对话轮次过多，请新开对话', 'too_long');
  }
  if (body.diagnosisMode !== undefined && !isDiagnosisMode(body.diagnosisMode)) throw new DiagnosticInputError('回答模式无效');
  const telemetry = body.telemetrySummary;
  const telemetryRecord = telemetry && typeof telemetry === 'object' && !Array.isArray(telemetry) ? telemetry as Record<string, unknown> : undefined;
  if (telemetry !== undefined && (!telemetryRecord || telemetryRecord.source !== 'simulated' || typeof telemetryRecord.text !== 'string' || telemetryRecord.text.length > 1600)) {
    throw new DiagnosticInputError('仿真监测摘要格式错误或过长');
  }
  const roles = new Set(['system', 'user', 'assistant']);
  for (const message of body.messages) {
    if (!message || typeof message !== 'object' || !roles.has(message.role) || typeof message.content !== 'string') {
      throw new DiagnosticInputError('消息格式错误');
    }
    const maxLength = message.role === 'assistant' ? 16_000 : 2000;
    if (message.content.length > maxLength) {
      throw new DiagnosticInputError(`单条消息过长（上限 ${maxLength} 字符）`, 'too_long');
    }
  }
  const history: DiagnosticRequest['history'] = body.messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .slice(body.sessionId ? -40 : -20)
    .map((message) => ({ role: message.role, content: message.content }));
  if (history.at(-1)?.role !== 'user' || !history.at(-1)?.content.trim()) {
    throw new DiagnosticInputError('请提供非空的当前用户问题');
  }
  return {
    history,
    diagnosisMode: body.diagnosisMode as DiagnosisMode | undefined,
    machineType: (body.machineType as string | undefined)?.trim(),
    brand: (body.brand as string | undefined)?.trim(),
    model: (body.model as string | undefined)?.trim(),
    engineModel: (body.engineModel as string | undefined)?.trim(),
    faultCodes: (body.faultCodes as string[] | undefined)?.map(code => code.trim()),
    telemetrySummary: telemetry as ChatTelemetrySummary | undefined,
  };
}

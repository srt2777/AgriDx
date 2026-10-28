import type { AgentWorkflowInput, WorkflowEvent, WorkflowResult } from '../../../shared/agent';
const statuses = ['references_found', 'needs_clarification', 'insufficient_evidence', 'refused', 'degraded'];
function resultFrom(value: unknown): WorkflowResult {
  if (!value || typeof value !== 'object') throw new Error('资料定位响应格式错误');
  const result = value as WorkflowResult;
  if (!statuses.includes(result.status) || typeof result.content !== 'string' || !Array.isArray(result.safety) || result.safety.some(s => typeof s !== 'string') || !Array.isArray(result.citations) || result.citations.some(c => !c || typeof c.chunk_id !== 'string' || typeof c.doc_title !== 'string' || typeof c.snippet !== 'string' || typeof c.section_path !== 'string') || !Array.isArray(result.questions) || result.questions.some(q => !q || typeof q.id !== 'string' || typeof q.label !== 'string' || q.options && (!Array.isArray(q.options) || q.options.some(o => typeof o !== 'string'))) || !result.trace || !Array.isArray(result.trace.events)) throw new Error('资料定位响应格式错误');
  return result;
}
/** Incremental SSE reader; handles UTF-8 and frame boundaries without rendering incomplete JSON. */
export async function readWorkflowStream(response: Response, onEvent: (event: WorkflowEvent) => void): Promise<WorkflowResult> {
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(typeof body?.error === 'string' ? body.error : '资料定位暂不可用');
  }
  if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body) throw new Error('资料定位流格式错误');
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '', size = 0; let result: WorkflowResult | undefined;
  const consume = () => {
    let boundary: number;
    while ((boundary = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
      const type = frame.split('\n').find(line => line.startsWith('event:'))?.slice(6).trim();
      const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      if (!data) continue;
      const value: unknown = JSON.parse(data);
      if (type === 'final') result = resultFrom(value);
      else if (type === 'status' && value && typeof value === 'object' && 'type' in value && typeof value.type === 'string' && ['plan_update','tool_start','tool_end','tool_error','done'].includes(value.type)) onEvent(value as WorkflowEvent);
    }
  };
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength; if (size > 256_000) throw new Error('资料定位响应超过限制');
      buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, '\n'); consume();
    }
    buffer += decoder.decode(); consume();
    if (!result) throw new Error('资料定位中断，未收到完整结果');
    return result;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export async function requestWorkflow(input: AgentWorkflowInput, signal: AbortSignal, onEvent: (event: WorkflowEvent) => void): Promise<WorkflowResult> {
  const response = await fetch('/api/agent/run', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, credentials: 'same-origin', signal, body: JSON.stringify({ ...input, machine: Object.fromEntries(Object.entries(input.machine).filter(([, value]) => value?.trim()).map(([key, value]) => [key, value!.trim()])) }) });
  return readWorkflowStream(response, onEvent);
}

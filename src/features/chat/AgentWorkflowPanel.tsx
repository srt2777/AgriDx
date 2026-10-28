import { useEffect, useRef, useState } from 'react';
import type { AgentWorkflowInput, WorkflowEvent, WorkflowResult } from '../../../shared/agent';
import { requestWorkflow } from './agent-api';

const toolName: Record<string, string> = { extract_fault_entities: '核对设备与故障码', search_knowledge_base: '查找本机资料', lookup_fault_code: '精确查询故障码', ask_user_clarification: '整理追问信息' };
export function AgentWorkflowPanel({ query, machine, faultCode, onQuestion, onBusyChange }: AgentWorkflowInput & { onQuestion: (text: string) => void; onBusyChange: (busy: boolean) => void }) {
  const [enabled, setEnabled] = useState(false); const [busy, setBusy] = useState(false);
  const [events, setEvents] = useState<WorkflowEvent[]>([]); const [result, setResult] = useState<WorkflowResult>(); const [error, setError] = useState('');
  const task = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/agent/status', { signal: controller.signal, credentials: 'same-origin', cache: 'no-store' }).then(res => res.ok ? res.json() : null).then(status => { if (!controller.signal.aborted) setEnabled(status?.enabled === true); }).catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => { task.current?.abort(); setBusy(false); onBusyChange(false); setResult(undefined); setEvents([]); setError(''); return () => task.current?.abort(); }, [query, machine.brand, machine.model, machine.engineModel, faultCode, onBusyChange]);
  if (!enabled) return null;
  const run = async () => {
    task.current?.abort(); const controller = new AbortController(); task.current = controller;
    setBusy(true); onBusyChange(true); setEvents([]); setResult(undefined); setError('');
    try {
      const response = await requestWorkflow({ query, machine, ...(faultCode?.trim() ? { faultCode: faultCode.trim() } : {}) }, controller.signal,
        event => { if (!controller.signal.aborted) setEvents(current => [...current, event]); });
      if (!controller.signal.aborted) setResult(response);
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '资料定位失败'); }
    finally { if (task.current === controller) { setBusy(false); onBusyChange(false); } }
  };
  const calls = events.filter(event => event.type === 'tool_start');
  const exportTrace = () => {
    if (!result) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(result.trace, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `diagnosis-trace-${result.trace.id}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <details className="mb-3 rounded-md border border-border bg-background/60 p-3 text-sm">
    <summary className="cursor-pointer">严格资料定位</summary>
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy || !query.trim()} onClick={() => void run()} className="rounded-md border border-border px-3 py-2 disabled:opacity-50">{busy ? '正在查找' : error ? '重试' : '查找本机依据'}</button>
        {busy && <button type="button" onClick={() => task.current?.abort()} className="rounded-md border border-border px-3 py-2">停止</button>}
        <span className="text-xs text-muted-foreground">本地规则规划</span>
      </div>
      <div aria-live="polite" className="space-y-3">
        {calls.map(call => {
          const end = events.find(event => event.call_id === call.call_id && (event.type === 'tool_end' || event.type === 'tool_error'));
          return <details key={call.call_id} className="rounded border border-border p-2"><summary>{toolName[call.tool ?? ''] ?? call.tool}：{end ? end.type === 'tool_error' ? '失败' : '完成' : busy ? '运行中' : '已停止'}</summary><p className="mt-1 text-xs text-muted-foreground">{end?.latency_ms !== undefined ? `${end.latency_ms} ms` : ''}{end?.error_code ? ` ${end.error_code}` : ''}</p></details>;
        })}
        {error && <p role="alert">{error}</p>}
        {result && <>
          <div className="rounded border border-amber-500/40 p-2" role="note">{result.safety.join('\n')}</div>
          <p>{result.content}</p>
          {result.citations.map((citation, index) => <details key={`${citation.chunk_id}-${citation.version}`} className="rounded border border-border p-2"><summary>[{index + 1}] {citation.doc_title}（机型精确匹配）</summary><p className="mt-2 text-xs text-muted-foreground">{citation.section_path}；PDF 页码：{citation.page ?? '未记录'}；版本：{citation.version ?? '未记录'}；{citation.chunk_id}</p><blockquote className="mt-2 whitespace-pre-wrap border-l border-border pl-3">{citation.snippet}</blockquote>{citation.scope_boundary && <p className="mt-2 text-xs text-muted-foreground">适用范围：{citation.scope_boundary}</p>}</details>)}
          {result.questions.map(question => <div key={question.id}><p>{question.label}</p>{question.options && <div className="mt-1 flex flex-wrap gap-2">{question.options.map(option => <button key={option} type="button" className="rounded border border-border px-2 py-1" onClick={() => onQuestion(`${question.label} ${option}`)}>{option}</button>)}</div>}</div>)}
          <button type="button" onClick={exportTrace} className="rounded border border-border px-3 py-2">导出执行记录</button>
        </>}
      </div>
    </div>
  </details>;
}

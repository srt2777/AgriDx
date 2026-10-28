import type { WorkflowResult } from '../../shared/agent';
/** Bounded content-free operational metrics. No user identity, query or document text is retained. */
export class WorkflowMetrics {
  private total = 0; private latencies: number[] = []; private steps = 0;
  private status: Record<string, number> = {}; private toolCounts: Record<string, number> = {}; private toolErrors = 0; private toolCalls = 0;
  record(result: WorkflowResult): void {
    this.total++; this.steps += result.trace.steps; this.status[result.status] = (this.status[result.status] ?? 0) + 1;
    this.latencies.push(result.trace.elapsed_ms); if (this.latencies.length > 256) this.latencies.shift();
    for (const event of result.trace.events) {
      if (event.type === 'tool_start' && event.tool) { this.toolCalls++; this.toolCounts[event.tool] = (this.toolCounts[event.tool] ?? 0) + 1; }
      if (event.type === 'tool_error') this.toolErrors++;
    }
  }
  snapshot() {
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const percentile = (p: number) => sorted.length ? sorted[Math.ceil(sorted.length * p) - 1] : null;
    return { total: this.total, status: { ...this.status }, toolCounts: { ...this.toolCounts }, toolCalls: this.toolCalls,
      toolSuccessRate: this.toolCalls ? (this.toolCalls - this.toolErrors) / this.toolCalls : null,
      averageSteps: this.total ? this.steps / this.total : null, latency: { sampleSize: sorted.length, p50_ms: percentile(0.5), p95_ms: percentile(0.95) },
      tokenUsage: null, tokenUsageReason: '本地规则提供器未调用模型；未估算或虚报模型 token。' };
  }
}

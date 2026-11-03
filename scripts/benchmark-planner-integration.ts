import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { planDiagnosticTurn } from '../server/diagnosis/plannerIntegration';
import type { PlannerContext } from '../agent/planner';

// Synthetic, in-process planner integration and reused Router only. No retrieval,
// database, HTTP, model, tool execution, or real device is measured.
const scope = { machineType: '拖拉机', brand: '东方红', model: 'LF1504' };
const topicRoot = '拖拉机旋耕时水温过高';
const context = (currentQuery: string): PlannerContext => ({ routerInput: {
  query: `东方红 LF1504 ${topicRoot} ${currentQuery}`, currentQuery, scope, retrieved: [],
  clarificationNeeded: false, requestedMode: 'knowledge_only', llmConfigured: false,
} });
const initial = { sessionId: 'benchmark-synthetic-session', sessionSeed: '0123456789abcdef0123456789abcdef', deviceId: 'benchmark-synthetic-device', revision: 0,
  topicRoot, currentQuery: topicRoot, scope, context: context(topicRoot) };
const prepared = planDiagnosticTurn(initial).commit.checkpoint;
if (!prepared) throw new Error('Synthetic planner fixture did not create a plan');
const followup = { ...initial, checkpoint: prepared, revision: 1, currentQuery: '冷却液泄漏检查正常',
  context: context('冷却液泄漏检查正常') };
const cases = [
  { name: 'initial-episode-and-proposal', run: () => planDiagnosticTurn(initial) },
  { name: 'restored-checkpoint-and-feedback', run: () => planDiagnosticTurn(followup) },
];
const results = [];
for (const item of cases) {
  for (let i = 0; i < 200; i++) item.run();
  const samples: number[] = [];
  for (let i = 0; i < 2000; i++) {
    const start = performance.now();
    item.run();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const quantile = (q: number) => Number(samples[Math.ceil(samples.length * q) - 1].toFixed(4));
  results.push({ scenario: item.name, samples: samples.length, p50Ms: quantile(.5), p95Ms: quantile(.95),
    p99Ms: quantile(.99), maxMs: quantile(1) });
}
console.log(JSON.stringify({ testType: 'Synthetic offline Planner integration + Router; no retrieval, SQLite, HTTP, LLM, tools or vehicle',
  node: process.version, platform: `${os.platform()} ${os.arch()}`, cpu: os.cpus()[0]?.model,
  warmupPerScenario: 200, results, processMaxRssKiB: process.resourceUsage().maxRSS }, null, 2));

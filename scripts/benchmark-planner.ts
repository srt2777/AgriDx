import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { advancePlan, reducePlan, type PlannerState } from '../agent/planner';
import { plan, step, context, manual } from '../tests/fixtures/planner';

// Entirely synthetic, offline input. Measures kernel plus the reused Router, not site latency.
const base = plan();
let dense = plan(Array.from({ length: 32 }, (_, i) => step(`s${i}`, { dependsOn: Array.from({ length: i }, (_, j) => `s${j}`) })));
for (let i = 0; i < 31; i++) dense = reducePlan(dense, { id: `e${i}`, episodeId: 'episode-1', type: 'observation', stepKey: `s${i}`, value: true, source: 'user_report' });
const candidates = Array.from({ length: 20 }, (_, i) => ({ ...manual, entryId: `TEST-BENCH-${i}`, heading: `TEST-BENCH-${i}｜合成性能测试`, indexedReference: { entryId: `TEST-BENCH-${i}`, sourceId: manual.sourceId! } }));
const waiting = advancePlan(base, context()).state;
let journal = reducePlan(base, { id: 'report-0', episodeId: 'episode-1', type: 'observation', stepKey: 'load', value: '合成'.repeat(190), source: 'user_report' });
for (let i = 1; i < 255; i++) journal = reducePlan(journal, { id: `report-${i}`, episodeId: 'episode-1', type: 'observation', stepKey: 'load', value: '合成'.repeat(190), source: 'user_report' });
const cases = [
  { name: 'initial-proposal', state: base, context: context() },
  { name: 'waiting-no-repeat', state: waiting, context: context() },
  { name: '32-step-dense-DAG-20-candidates', state: dense, context: context('auto', { retrieved: candidates }) },
  { name: 'near-event-limit-large-signatures', state: journal, context: context() },
  { name: 'high-risk-stop', state: base, context: context('ai_assisted', { query: '制动失灵怎么办', currentQuery: '制动失灵怎么办' }) },
];
const run = (c: typeof cases[number], i: number) => advancePlan(c.state as PlannerState, c.context,
  i % 2 ? undefined : { id: 'benchmark-continue', episodeId: 'episode-1', type: 'continue' });
const results = [];
for (const c of cases) {
  for (let i = 0; i < 200; i++) run(c, i);
  const samples: number[] = [];
  for (let i = 0; i < 2000; i++) { const start = performance.now(); run(c, i); samples.push(performance.now() - start); }
  samples.sort((a, b) => a - b);
  const quantile = (q: number) => Number(samples[Math.ceil(samples.length * q) - 1].toFixed(4));
  results.push({ scenario: c.name, samples: samples.length, p50Ms: quantile(.5), p95Ms: quantile(.95), p99Ms: quantile(.99), maxMs: quantile(1) });
}
console.log(JSON.stringify({ testType: 'Synthetic offline kernel + Router; no LLM/DB/tools/site request', node: process.version,
  platform: `${os.platform()} ${os.arch()}`, cpu: os.cpus()[0]?.model, warmupPerScenario: 200,
  results, targetP95Ms: 10, targetMet: results.every(r => r.p95Ms <= 10), processMaxRssKiB: process.resourceUsage().maxRSS }, null, 2));

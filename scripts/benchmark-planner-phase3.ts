import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { advancePlan, createPlan, decideNextAction } from '../agent/planner';
import { ToolRegistry } from '../agent/tool-registry';
import { MemoryStore } from '../server/memory/store';
import { dispatchPlannerTool } from '../server/diagnosis/plannerTools';

// Synthetic offline fixtures only: no model, network, HTTP or real device.
const scope = { machineType: '拖拉机', brand: '东方红', model: 'LF1504' };
const context = { routerInput: { query: '水温过高', currentQuery: '水温过高', scope, retrieved: [], clarificationNeeded: false, requestedMode: 'knowledge_only' as const, llmConfigured: false } };
const plan = createPlan({ planId: 'bench', episodeId: 'episode', scope, steps: [{ key: 'scope', title: '范围查询', kind: 'read_tool', tool: 'resolve_machine_scope', dependsOn: [], preconditions: [], expectedObservation: { slot: 'scope', label: '范围查询' }, evidenceIds: [], discriminationValue: 1, cost: 1 }] });
const summarize = (name: string, values: number[]) => {
  values.sort((a, b) => a - b);
  const at = (q: number) => Number(values[Math.ceil(values.length * q) - 1].toFixed(4));
  return { name, samples: values.length, p50Ms: at(.5), p95Ms: at(.95), p99Ms: at(.99), maxMs: at(1) };
};
for (let i = 0; i < 200; i++) decideNextAction(plan, context);
const rules = [];
for (let i = 0; i < 2000; i++) { const start = performance.now(); decideNextAction(plan, context); rules.push(performance.now() - start); }
const dispatch = [];
for (let i = 0; i < 100; i++) {
  const store = new MemoryStore(':memory:');
  try {
    const device = store.saveDevice('fixture', { ...scope, name: 'synthetic', hours: null, notes: '' });
    const session = store.createSession('fixture', device.id);
    store.appendTurn('fixture', session.id, 0, '水温过高', { content: 'fixture' }, [], { previous: null, checkpoint: { sessionId: session.id, deviceId: device.id, topicKey: 'overheat', state: advancePlan(plan, context).state } });
    const registry = new ToolRegistry();
    registry.register('resolve_machine_scope', 'synthetic read', { type: 'object' }, () => ({ sourceId: 'SRC-SYNTHETIC' }), { risk: 'read' });
    const start = performance.now();
    const result = await dispatchPlannerTool({ store, owner: 'fixture', sessionId: session.id, revision: 1, context, registry });
    dispatch.push(performance.now() - start);
    if (result.status !== 'completed') throw new Error('Synthetic dispatch failed');
  } finally { store.close(); }
}
console.log(JSON.stringify({ measuredAt: new Date().toISOString(), node: process.version, platform: `${os.platform()} ${os.arch()}`, cpu: os.cpus()[0]?.model,
  scope: 'Synthetic offline rule path and mock-tool dispatch with in-memory SQLite; no HTTP, LLM, network, real vehicle or production services',
  excludes: 'dispatch fixture setup and registry construction; no disk durability latency', budget: { maxCallsPerPlan: 2, maxCallsPerChatTurn: 1, defaultWaitMs: 1000, maxWaitMs: 2000 },
  results: [summarize('rules-with-router', rules), summarize('dispatch-reserve-execute-commit-replan', dispatch)] }, null, 2));

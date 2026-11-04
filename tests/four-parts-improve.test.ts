import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { runAgent } from '../agent/runner';
import { build_default_registry } from '../agent/default-tools';
import { ToolRegistry } from '../agent/tools';
import type { Provider, ToolChatResult } from '../server/llm/types';
import { decideNextAction } from '../agent/planner/policy';
import { createDiagnosticPlan, identifyPlannerTopic, plannerFaultChains, plannerStepAliases, topicEvidence, type PlannerTopic } from '../server/diagnosis/plannerPlans';
import { createApp } from '../server/app';
import { createDiagnosticService, type DiagnosticProvider } from '../server/diagnosis/service';
import { getKnowledgeCatalog } from '../server/knowledge/catalog';
import { loadKnowledgeBase, stats } from '../server/knowledge/retriever';
import { MemoryStore } from '../server/memory/store';
import { recentMessages } from '../server/memory/context';
import type { ChatResponse } from '../shared/chat';
import type { MemoryDevice, MemorySession, SessionDetail } from '../shared/memory';
import type { KnowledgeChunk } from '../server/knowledge/types';

// Step 2 — short-term memory stability.

test('recentMessages skips empty entries instead of dropping older history', () => {
  const kept = recentMessages([
    { role: 'user', content: '东方红 LF1504 水温过高' },
    { role: 'assistant', content: '' },
    { role: 'user', content: '冷却液泄漏检查正常' },
  ]);
  assert.deepEqual(kept.map(m => m.content), ['东方红 LF1504 水温过高', '冷却液泄漏检查正常']);
  const leadingEmpty = recentMessages([
    { role: 'assistant', content: '' },
    { role: 'user', content: '水温过高怎么办' },
  ]);
  assert.deepEqual(leadingEmpty.map(m => m.content), ['水温过高怎么办']);
});

// NOTE: silently dropping an invalid stored planner checkpoint was evaluated
// and rejected: planner-memory.test.ts deliberately requires a corrupt
// checkpoint to be rejected rather than treated as absent, so the store
// keeps throwing 409 there. The chat route below therefore degrades only
// transient storage failures, never deterministic MemoryErrors.
// Step 3 — planner topics, fault chains, and the evidence gate.

test('identifyPlannerTopic covers the four new topics and stays disjoint on known overlaps', () => {
  assert.equal(identifyPlannerTopic('拖拉机燃油滤清器堵塞，经常熄火'), 'fuel');
  assert.equal(identifyPlannerTopic('保险丝熔断，灯光不亮怎么办'), 'electrical');
  assert.equal(identifyPlannerTopic('农具提升缓慢抖动'), 'hydraulic');
  assert.equal(identifyPlannerTopic('离合器打滑，挂挡困难'), 'transmission');
  assert.equal(identifyPlannerTopic('液压油过热'), 'hydraulic');
  assert.equal(identifyPlannerTopic('电瓶不充电'), 'starting');
  assert.equal(identifyPlannerTopic('发动机熄火后无法启动'), undefined);
  assert.equal(identifyPlannerTopic('水温过高'), 'overheat');
  assert.equal(identifyPlannerTopic('拖拉机水温过高而且挂挡困难'), undefined);
});

test('new planner topics carry verified evidence, a tool mapping, and a matching fault chain', () => {
  const scope = { machineType: '拖拉机', brand: '约翰迪尔', model: '5E-850' };
  const expected: Record<PlannerTopic, [string, string]> = {
    overheat: ['cooling-leak', 'cooling-radiator'],
    starting: ['battery', 'starter'],
    fuel: ['fuel-filter', 'fuel-injector'],
    electrical: ['electrical-fuse', 'electrical-lighting'],
    hydraulic: ['hydraulic-lift', 'hydraulic-system'],
    transmission: ['clutch', 'gear-shift'],
  };
  for (const topic of Object.keys(expected) as PlannerTopic[]) {
    const plan = createDiagnosticPlan({ topic, scope, sessionSeed: 'cd'.repeat(16), revision: 0 });
    assert.deepEqual(plan.steps.map(s => s.key), expected[topic]);
    assert.deepEqual(plan.steps.map(s => s.discriminationValue), [20, 10]);
    assert.equal(plan.steps[1].dependsOn[0], plan.steps[0].key);
    assert.deepEqual(plan.evidence.map(e => e.entryId).sort(),
      topicEvidence[topic].map(e => e.entryId).sort());
    for (const step of plan.steps) {
      assert.deepEqual(step.evidenceIds, topicEvidence[topic].filter(e => step.evidenceIds.includes(e.entryId)).map(e => e.entryId));
      if (topic !== 'overheat' && topic !== 'starting') {
        assert.equal(step.evidenceIds.length, 1);
        assert.equal(step.toolName, 'search_knowledge');
      }
    }
    const chain = plannerFaultChains[topic];
    assert.equal(chain.causes.length, 2);
    for (const cause of chain.causes) {
      const step = plan.steps.find(s => s.key === cause.stepKey);
      assert.ok(step, `${topic} chain cause ${cause.stepKey} must map to a plan step`);
      assert.deepEqual([...cause.evidenceIds], [...step.evidenceIds]);
    }
  }
});

test('planner step aliases are non-empty and do not collide across steps', () => {
  const topics: PlannerTopic[] = ['overheat', 'starting', 'fuel', 'electrical', 'hydraulic', 'transmission'];
  const seen = new Map<string, string>();
  for (const topic of topics) {
    const plan = createDiagnosticPlan({ topic, scope: { machineType: '拖拉机', brand: '东方红', model: 'LF1504' }, sessionSeed: 'ef'.repeat(16), revision: 0 });
    for (const step of plan.steps) {
      const aliases = plannerStepAliases(step.key);
      assert.ok(aliases.length > 0, `${step.key} must have aliases`);
      for (const alias of aliases) {
        assert.ok(alias.length > 0);
        const owner = seen.get(alias);
        assert.ok(!owner || owner === step.key, `alias ${alias} collides between ${owner} and ${step.key}`);
        seen.set(alias, step.key);
      }
    }
  }
});

test('evidence gate proposes the fuel step only when its entry is an exact verified match', () => {
  const scope = { machineType: '拖拉机', brand: '约翰迪尔', model: '5E-850' };
  const plan = createDiagnosticPlan({ topic: 'fuel', scope, sessionSeed: 'ab'.repeat(16), revision: 0 });
  const chunk = {
    entryId: 'KB-JD-5E-D0-025', sourceId: 'SRC-JD-5E-D0-OMSJ34997', brand: '约翰迪尔', model: '5E-850', models: ['5E-850'],
    heading: 'KB-JD-5E-D0-025｜燃油滤清器每日排水和沉淀物', text: '燃油滤清器每日排水和沉淀物检查。',
    entryType: '操作/维护知识', status: '已核验', scopeBoundary: '约翰迪尔 5E 系列适用',
    indexedReference: { entryId: 'KB-JD-5E-D0-025', sourceId: 'SRC-JD-5E-D0-OMSJ34997' },
    applicability: 'matched' as const,
  } as unknown as KnowledgeChunk;
  const base = { query: '约翰迪尔 5E-850 燃油滤清器堵塞怎么办', currentQuery: '约翰迪尔 5E-850 燃油滤清器堵塞怎么办',
    scope, clarificationNeeded: false, llmConfigured: false };
  const withEvidence = decideNextAction(plan, { routerInput: { ...base, retrieved: [chunk] } });
  assert.equal(withEvidence.status, 'awaiting_user');
  assert.equal(withEvidence.action?.stepKey, 'fuel-filter');
  assert.ok(withEvidence.questions[0]?.text.includes('燃油滤清器'));
  const withoutEvidence = decideNextAction(plan, { routerInput: { ...base, retrieved: [] } });
  assert.equal(withoutEvidence.status, 'paused');
  assert.equal(withoutEvidence.reason, 'no_evidence');
});

// Step 4 — new read-only tools and same-turn call deduplication.

test('new tools are read-only and return real snapshot entries by exact model', async () => {
  loadKnowledgeBase();
  const registry = build_default_registry();
  for (const name of ['fault_chain', 'model_fault_index', 'maintenance_schedule']) {
    assert.ok(registry.names().includes(name), `${name} must be registered`);
    assert.equal(registry.get(name)?.risk, 'read');
  }
  const fuelChain = JSON.parse(await registry.call('fault_chain', { topic: 'fuel' })) as { topic: string; topEvent: string; causes: { stepKey: string; evidenceIds: string[] }[] };
  assert.equal(fuelChain.topic, 'fuel');
  assert.deepEqual(fuelChain.causes.map(c => c.stepKey), ['fuel-filter', 'fuel-injector']);
  const hydraulicChain = JSON.parse(await registry.call('fault_chain', { symptom: '农具提升缓慢抖动' })) as { topic: string };
  assert.equal(hydraulicChain.topic, 'hydraulic');
  const ambiguous = JSON.parse(await registry.call('fault_chain', { symptom: '发动机熄火后无法启动' })) as { error?: string };
  assert.equal(ambiguous.error, 'TOPIC_NOT_IDENTIFIED');
  const faultIndex = JSON.parse(await registry.call('model_fault_index', { brand: '约翰迪尔', model: '5E-850', limit: 20 })) as { entries: { entryId: string }[] };
  assert.ok(faultIndex.entries.some(e => e.entryId === 'KB-JD-5E-D0-070'), '5E fault index must include the gearbox entry');
  assert.ok(!faultIndex.entries.some(e => e.entryId === 'KB-JD-5E-D0-025'), 'fault index must not include operation/maintenance entries');
  const maintenance = JSON.parse(await registry.call('maintenance_schedule', { brand: '约翰迪尔', model: '5E-850', limit: 20 })) as { entries: { entryId: string }[] };
  assert.ok(maintenance.entries.some(e => e.entryId === 'KB-JD-5E-D0-025'), '5E maintenance index must include the fuel filter entry');
  const unknown = JSON.parse(await registry.call('model_fault_index', { brand: '约翰迪尔', model: '不存在的型号' })) as { entries: unknown[] };
  assert.deepEqual(unknown.entries, []);
});

test('runner executes an identical same-turn tool call once and maps the result to every id', async () => {
  const registry = new ToolRegistry();
  registry.register('resolve_machine_scope', 'scope', { type: 'object' }, () => ({ brand: 'test' }));
  let executions = 0;
  registry.register('search_knowledge', 'search', { type: 'object' }, () => { executions++; return { chunks: [] }; });
  const seenMessages: { role: string; tool_call_id?: string; content?: string }[][] = [];
  let calls = 0;
  const provider: Provider = { name: 'deepseek', model: 'fake', isConfigured: () => true,
    chat: async () => { throw new Error('unused'); },
    chatWithTools: async (messages): Promise<ToolChatResult> => {
      seenMessages.push(messages.map(m => ({ role: m.role, tool_call_id: (m as { tool_call_id?: string }).tool_call_id, content: typeof m.content === 'string' ? m.content : undefined })));
      calls++;
      return calls === 1
        ? { content: '', stopReason: 'tool_calls', toolCalls: [
          { id: 'a', name: 'search_knowledge', input: { query: '燃油滤清器' } },
          { id: 'b', name: 'search_knowledge', input: { query: '燃油滤清器' } }] }
        : { content: 'supported answer', stopReason: 'stop', toolCalls: [] };
    } };
  const result = await runAgent({ provider, registry, messages: [{ role: 'user', content: '燃油滤清器堵塞怎么办' }], query: '燃油滤清器堵塞怎么办',
    allowedTools: ['resolve_machine_scope', 'search_knowledge'], allowExternal: true, guard: (s: string) => s, timeoutMs: 5000 });
  assert.equal(result.status, 'answered');
  assert.equal(executions, 1, 'identical same-turn calls must execute once');
  assert.equal(result.toolEvents.filter(e => e.tool === 'search_knowledge').length, 1);
  const secondCallTools = seenMessages[1].filter(m => m.role === 'tool');
  assert.deepEqual(secondCallTools.map(m => m.tool_call_id), ['a', 'b']);
  assert.equal(secondCallTools[0].content, secondCallTools[1].content);
});

// Step 2 — chat route: a failed memory append must not discard the generated answer.

async function chatHarness(t: TestContext, appendTurn: (store: MemoryStore) => MemoryStore) {
  loadKnowledgeBase();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agridx-four-parts-chat-'));
  const filename = path.join(dir, 'memory.sqlite');
  const realStore = new MemoryStore(filename);
  const store = appendTurn(realStore);
  const provider: DiagnosticProvider = {
    hasAnyConfigured: () => false,
    chat: async () => { throw new Error('LLM must not be called in knowledge_only mode'); },
  };
  const app = createApp({ rootDirectory: process.cwd(), version: 'four-parts-test',
    diagnose: createDiagnosticService(provider, { config: { logDecisions: false } }),
    getKnowledgeStats: stats, getCatalog: getKnowledgeCatalog,
    getLlmStatus: () => ({}) as ReturnType<import('../server/llm/router').LlmRouter['getStatus']>,
    getMemoryStore: () => store as MemoryStore,
  });
  const server = await new Promise<http.Server>((resolve, reject) => {
    const listener = app.listen(0, '127.0.0.1', (error?: Error) => error ? reject(error) : resolve(listener));
  });
  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    realStore.close(); fs.rmSync(dir, { recursive: true, force: true });
  });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  function request<T>(url: string, method = 'GET', body?: unknown, cookie = ''): Promise<{ status: number; body: T; cookie: string }> {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port: address.port, path: url, method, agent: false,
        headers: { ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...(cookie ? { Cookie: cookie } : {}) } }, res => {
        let text = ''; res.setEncoding('utf8'); res.on('data', chunk => { text += chunk; }); res.on('error', reject);
        res.on('end', () => { try { resolve({ status: res.statusCode || 0, body: JSON.parse(text) as T,
          cookie: (res.headers['set-cookie']?.[0] ?? cookie).split(';')[0] }); } catch (e) { reject(e); } });
      });
      req.on('error', reject); req.end(payload);
    });
  }
  const bootstrap = await request<unknown>('/api/memory');
  const device = await request<MemoryDevice>('/api/memory/devices', 'POST',
    { name: '集成测试车辆', machineType: '拖拉机', brand: '东方红', model: 'LF1504', hours: null, notes: '' }, bootstrap.cookie);
  const session = await request<MemorySession>('/api/memory/sessions', 'POST', { deviceId: device.body.id }, bootstrap.cookie);
  assert.equal(device.status, 201); assert.equal(session.status, 201);
  const chat = (revision: number, content: string) => request<ChatResponse & { error?: string; code?: string }>('/api/chat', 'POST',
    { sessionId: session.body.id, revision, diagnosisMode: 'knowledge_only', messages: [{ role: 'user', content }] }, bootstrap.cookie);
  const detail = () => request<SessionDetail>(`/api/memory/sessions/${session.body.id}`, 'GET', undefined, bootstrap.cookie);
  return { chat, detail };
}

test('chat returns the generated answer with memorySaveFailed when the append fails, and the session is not bricked', async t => {
  const failing = (store: MemoryStore) => new Proxy(store, {
    get(target, prop, receiver) {
      if (prop === 'appendTurn') return () => { throw new Error('simulated storage failure'); };
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as unknown as MemoryStore;
  const h = await chatHarness(t, failing);
  const first = await h.chat(0, '东方红 LF1504 水温过高怎么办');
  assert.equal(first.status, 200, `expected 200, got ${first.status}: ${JSON.stringify(first.body)}`);
  assert.equal(first.body.memorySaveFailed, true);
  assert.equal(first.body.memory, undefined);
  assert.ok(first.body.choices[0].message.content.trim().length > 0, 'the generated answer must survive the storage failure');
  assert.equal(first.body.error, undefined);
  // Revision never advanced, so the next turn can still be attempted.
  const second = await h.chat(0, '冷却液泄漏检查正常');
  assert.equal(second.status, 200);
  assert.equal(second.body.memorySaveFailed, true);
  assert.ok(second.body.choices[0].message.content.trim().length > 0);
  const restored = await h.detail();
  assert.equal(restored.body.revision, 0, 'no turn was persisted, so the revision is unchanged');
});

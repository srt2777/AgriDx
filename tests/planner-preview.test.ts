import assert from 'node:assert/strict';
import { test } from 'node:test';
import { previewFetch } from '../src/dev-preview/api';
import { PreviewMemoryStore } from '../src/dev-preview/memory';
import { createDiagnosticService, PLANNER_COMMIT } from '../server/diagnosis/service';
import { parseDiagnosticRequest } from '../server/diagnosis/request';
import type { ChatApiMessage, ChatResponse } from '../shared/chat';
import type { MemorySession } from '../shared/memory';

test('browser preview multi-turn memory does not enable the server-only Planner or call a model', async t => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else Reflect.deleteProperty(globalThis, 'localStorage'); });
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('preview without configured model must never call a provider'); });
  const store = new PreviewMemoryStore(storage);
  const profile = { name: '预览测试', machineType: '拖拉机', brand: '东方红', model: 'LF1504', hours: null, notes: '' };
  const device = store.saveDevice(profile);
  const session = store.createSession(device.id);
  const post = async (messages: ChatApiMessage[], sessionId?: string, revision?: number) => {
    const result = await previewFetch('/api/chat', { method: 'POST', body: JSON.stringify({ ...profile,
      diagnosisMode: 'knowledge_only', messages, ...(sessionId ? { sessionId, revision } : {}) }) });
    assert.equal(result.status, 200);
    return await result.json() as ChatResponse & { memory?: MemorySession };
  };
  const firstUser = { role: 'user' as const, content: '东方红 LF1504 旋耕时水温过高' };
  const stateless = await post([firstUser]);
  const first = await post([firstUser], session.id, 0);
  assert.deepEqual(first.diagnosticReply?.questions, stateless.diagnosticReply?.questions);
  assert.equal(first.diagnosisTrace?.aiAttempts, 0);
  assert.equal(first.memory?.revision, 1);
  assert.doesNotMatch(JSON.stringify(first), /plannerCheckpoint|topicPending|acceptedEvents|scopeKey/);
  const restored = new PreviewMemoryStore(storage).session(session.id);
  assert.equal(restored.messages.length, 2);
  const nextUser = { role: 'user' as const, content: '散热器表面检查正常' };
  const history = [...restored.messages.map(({ role, content }) => ({ role, content })), nextUser];
  const statelessNext = await post(history);
  const second = await post([nextUser], session.id, restored.revision);
  assert.deepEqual(second.diagnosticReply?.questions, statelessNext.diagnosticReply?.questions);
  assert.equal(second.memory?.revision, 2);
  assert.equal(second.diagnosisTrace?.aiAttempts, 0);
  assert.doesNotMatch(JSON.stringify(second), /plannerCheckpoint|topicPending|acceptedEvents|scopeKey/);
  assert.doesNotMatch([...values.values()].join('\n'), /plannerCheckpoint|topicPending|acceptedEvents|scopeKey/);
  const service = createDiagnosticService({ hasAnyConfigured: () => false,
    chat: async () => { throw new Error('model must not be called'); } }, { config: { logDecisions: false } });
  const direct = await service(parseDiagnosticRequest({ ...profile, diagnosisMode: 'knowledge_only', messages: history }),
    { session: restored, priorReports: [] });
  assert.equal(direct[PLANNER_COMMIT], undefined, 'unseeded preview memory cannot produce a private commit');
  assert.equal(fetch.mock.callCount(), 0);
});

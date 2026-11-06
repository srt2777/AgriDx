import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  clearPendingForDevice,
  clearPendingForSession,
  createPendingTurn,
  isDeterministicMemoryCode,
  isSendBlocked,
  loadPendingTurn,
  pendingTurnExportText,
  resolvePendingAfterReload,
  savePendingTurn,
  syncStatusFor,
  validatePendingTurn,
  type PendingUnsavedTurn,
} from '../src/features/chat/sync-state';
import { loadKnowledgeBase, stats } from '../server/knowledge/retriever';
import { getKnowledgeCatalog } from '../server/knowledge/catalog';
import { createDiagnosticService, type DiagnosticProvider } from '../server/diagnosis/service';
import { createApp } from '../server/app';
import { MemoryStore } from '../server/memory/store';
import type { MemoryDevice, MemorySession, SessionDetail } from '../shared/memory';
import type { ChatResponse } from '../shared/chat';

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

const turn = (overrides: Partial<PendingUnsavedTurn> = {}): PendingUnsavedTurn => createPendingTurn({
  sessionId: 'session-a', deviceId: 'device-a', revision: 3,
  question: '水温过高怎么办', answer: '先检查冷却液。', ...overrides,
});

// --- Pure sync-state machine: these are the rules the UI and hooks must follow. ---

test('unsaved state blocks further sends, recovering also blocks, synced does not', () => {
  assert.equal(isSendBlocked(syncStatusFor({ sessionId: 'session-a', pending: turn() })), true);
  assert.equal(isSendBlocked(syncStatusFor({ sessionId: 'session-a', pending: turn(), recovering: true })), true);
  assert.equal(isSendBlocked(syncStatusFor({ sessionId: 'session-a', pending: null })), false);
  // A pending turn for another session must not block this session.
  assert.equal(isSendBlocked(syncStatusFor({ sessionId: 'session-b', pending: turn() })), false);
  // A recovered copy is kept but no longer blocks: the user may resubmit the draft.
  assert.equal(isSendBlocked(syncStatusFor({ sessionId: 'session-a', pending: turn({ recovered: true }) })), false);
});

test('pending turn survives a storage round-trip, and malformed or foreign records are discarded', () => {
  const store = storage();
  const saved = turn();
  assert.equal(savePendingTurn(store, saved), true);
  assert.deepEqual(loadPendingTurn(store), saved);
  assert.equal(validatePendingTurn({ sessionId: 'x' }), null);
  assert.equal(validatePendingTurn({ ...turn(), question: '' }), null);
  assert.equal(validatePendingTurn({ ...turn(), answer: 'x'.repeat(16001) }), null);
  const failing = { ...storage(), setItem: () => { throw new Error('QuotaExceeded'); } };
  assert.equal(savePendingTurn(failing, turn()), false);
  assert.equal(loadPendingTurn(storage()), null);
});

test('reload resolves the pending turn: saved on the server means no resubmit, otherwise the draft is kept', () => {
  const savedMessages = [{ role: 'user' as const, content: '水温过高怎么办' }, { role: 'assistant' as const, content: '已保存的回答' }];
  assert.equal(resolvePendingAfterReload(turn(), savedMessages), 'saved');
  assert.equal(resolvePendingAfterReload(turn(), [{ role: 'user', content: '另一个问题' }]), 'unsaved');
  assert.equal(resolvePendingAfterReload(turn(), []), 'unsaved');
  // An uncertain turn (outcome unknown after a network cut) is resolved the same way:
  // the reloaded record, not an automatic resend, decides whether it was saved.
  assert.equal(resolvePendingAfterReload(turn({ uncertain: true, answer: '' }), savedMessages), 'saved');
  assert.equal(resolvePendingAfterReload(turn({ uncertain: true, answer: '' }), []), 'unsaved');
});

test('switching, clearing and deleting never mix sessions or revive deleted content', () => {
  const kept = turn();
  assert.equal(clearPendingForSession(kept, 'session-a'), null);
  assert.deepEqual(clearPendingForSession(kept, 'session-b'), kept);
  assert.equal(clearPendingForDevice(kept, 'device-a'), null);
  assert.deepEqual(clearPendingForDevice(kept, 'device-b'), kept);
  assert.equal(clearPendingForSession(null, 'session-a'), null);
});

test('deterministic memory errors stay errors and are never folded into memorySaveFailed', () => {
  for (const code of ['memory_conflict', 'memory_limit', 'memory_busy', 'memory_device_changed', 'memory_not_found', 'bad_request']) {
    assert.equal(isDeterministicMemoryCode(code), true, code);
  }
  assert.equal(isDeterministicMemoryCode('memory_save_failed'), false);
  assert.equal(isDeterministicMemoryCode(undefined), false);
});

test('the exported pending copy keeps question and answer together, labelled as unsaved', () => {
  const text = pendingTurnExportText(turn());
  assert.match(text, /未保存到诊断记录/);
  assert.match(text, /水温过高怎么办/);
  assert.match(text, /先检查冷却液/);
  assert.match(text, /重新提交会生成新的回答/);
});

// --- Server route: two save failures keep the answer, the revision and the Planner checkpoint. ---

async function chatHarness(t: TestContext, appendTurn: (store: MemoryStore) => MemoryStore) {
  loadKnowledgeBase();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agridx-diagnosis-recovery-'));
  const filename = path.join(dir, 'memory.sqlite');
  const realStore = new MemoryStore(filename);
  const store = appendTurn(realStore);
  const provider: DiagnosticProvider = {
    hasAnyConfigured: () => false,
    chat: async () => { throw new Error('LLM must not be called in knowledge_only mode'); },
  };
  const app = createApp({
    rootDirectory: process.cwd(), version: 'diagnosis-recovery-test',
    diagnose: createDiagnosticService(provider, { config: { logDecisions: false } }),
    getKnowledgeStats: stats, getCatalog: getKnowledgeCatalog,
    getLlmStatus: () => ({}) as ReturnType<import('../server/llm/router').LlmRouter['getStatus']>,
    getMemoryStore: () => store as MemoryStore,
  });
  const server = await new Promise<http.Server>((resolve, reject) => {
    const listener = app.listen(0, '127.0.0.1', (error?: Error) => error ? reject(error) : resolve(listener));
  });
  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    realStore.close(); fs.rmSync(dir, { recursive: true, force: true });
  });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  function request<T>(url: string, method = 'GET', body?: unknown, cookie = ''): Promise<{ status: number; body: T; cookie: string }> {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1', port: address.port, path: url, method, agent: false,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
        },
      }, (res) => {
        let text = ''; res.setEncoding('utf8'); res.on('data', (chunk) => { text += chunk; }); res.on('error', reject);
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode || 0, body: JSON.parse(text) as T, cookie: (res.headers['set-cookie']?.[0] ?? cookie).split(';')[0] });
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject); req.end(payload);
    });
  }
  const bootstrap = await request<unknown>('/api/memory');
  const device = await request<MemoryDevice>('/api/memory/devices', 'POST',
    { name: '恢复测试车辆', machineType: '拖拉机', brand: '东方红', model: 'LF1504', hours: null, notes: '' }, bootstrap.cookie);
  const session = await request<MemorySession>('/api/memory/sessions', 'POST', { deviceId: device.body.id }, bootstrap.cookie);
  assert.equal(device.status, 201); assert.equal(session.status, 201);
  const chat = (revision: number, content: string) => request<ChatResponse & { error?: string; code?: string }>('/api/chat', 'POST',
    { sessionId: session.body.id, revision, diagnosisMode: 'knowledge_only', messages: [{ role: 'user', content }] }, bootstrap.cookie);
  const detail = () => request<SessionDetail>(`/api/memory/sessions/${session.body.id}`, 'GET', undefined, bootstrap.cookie);
  const messageCount = () => {
    const db = new DatabaseSync(filename, { readOnly: true });
    try { return (db.prepare('SELECT COUNT(*) AS n FROM memory_messages').get() as { n: number }).n; } finally { db.close(); }
  };
  return { chat, detail, messageCount };
}

test('two save failures keep both answers, do not advance the revision, and persist no Planner checkpoint', async (t) => {
  const failing = (store: MemoryStore) => new Proxy(store, {
    get(target, prop, receiver) {
      if (prop === 'appendTurn') return () => { throw new Error('simulated storage failure'); };
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as unknown as MemoryStore;
  const h = await chatHarness(t, failing);
  const first = await h.chat(0, '东方红 LF1504 水温过高怎么办');
  assert.equal(first.status, 200);
  assert.equal(first.body.memorySaveFailed, true);
  assert.ok(first.body.choices[0].message.content.trim().length > 0);
  const second = await h.chat(0, '冷却液泄漏检查正常');
  assert.equal(second.status, 200);
  assert.equal(second.body.memorySaveFailed, true);
  assert.ok(second.body.choices[0].message.content.trim().length > 0);
  const restored = await h.detail();
  assert.equal(restored.body.revision, 0, 'no turn was persisted, so the revision is unchanged');
  assert.equal(restored.body.messages.length, 0);
  assert.equal(h.messageCount(), 0, 'no message row was persisted, so no Planner checkpoint advanced either');
});

test('deterministic errors still return errors: revision conflict and device change are not memorySaveFailed', async (t) => {
  const h = await chatHarness(t, (store) => store);
  const saved = await h.chat(0, '东方红 LF1504 水温过高怎么办');
  assert.equal(saved.status, 200);
  assert.equal(saved.body.memorySaveFailed, undefined);
  const conflict = await h.chat(0, '用旧版本再问一次');
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, 'memory_conflict');
  assert.equal(conflict.body.memorySaveFailed, undefined);
  const wrongDevice = await h.chat(1, '换一台约翰迪尔试试');
  assert.equal(wrongDevice.status, 409);
  assert.equal(wrongDevice.body.code, 'memory_device_changed');
  assert.equal(wrongDevice.body.memorySaveFailed, undefined);
});

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { createApp } from '../server/app';
import { createDiagnosticService, type DiagnosticProvider } from '../server/diagnosis/service';
import { getKnowledgeCatalog } from '../server/knowledge/catalog';
import { loadKnowledgeBase, retrieve, stats } from '../server/knowledge/retriever';
import { MemoryStore } from '../server/memory/store';
import type { ChatResponse } from '../shared/chat';
import type { DiagnosisMode } from '../shared/diagnosis';
import type { MemoryDevice, MemorySession, SessionDetail } from '../shared/memory';

// HTTP and real SQLite, with the external model replaced by a deterministic fixture.
// These tests neither access a real tractor nor call an external provider.
let addressSequence = 0;
const profile = { name: '集成测试车辆', machineType: '拖拉机', brand: '东方红', model: 'LF1504', hours: null, notes: '' };
type JsonResult<T> = { status: number; body: T; cookie: string };

async function harness(t: TestContext, configured = false, beforeGeneration?: () => Promise<void>, noEvidence = false,
  fixtureAnswer = '请先记录已观察到的工况，不能确定具体原因。', retrieveFixture?: typeof retrieve) {
  loadKnowledgeBase();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agridx-planner-integration-'));
  const filename = path.join(dir, 'memory.sqlite');
  let store = new MemoryStore(filename);
  const generations: string[] = [];
  const provider: DiagnosticProvider = {
    hasAnyConfigured: () => configured,
    chat: async messages => {
      generations.push(JSON.stringify(messages));
      await beforeGeneration?.();
      return { result: { content: fixtureAnswer, model: 'fixture', provider: 'deepseek' },
        primary: 'deepseek', fellBack: false, attempts: 1 };
    },
  };
  const app = createApp({ rootDirectory: process.cwd(), version: 'planner-integration-test',
    diagnose: createDiagnosticService(provider, { config: { logDecisions: false },
      ...(noEvidence ? { retrieve: () => [] } : retrieveFixture ? { retrieve: retrieveFixture } : {}) }),
    getKnowledgeStats: stats, getCatalog: getKnowledgeCatalog,
    getLlmStatus: () => ({}) as ReturnType<import('../server/llm/router').LlmRouter['getStatus']>,
    getMemoryStore: () => store,
  });
  const server = await new Promise<http.Server>((resolve, reject) => {
    const listener = app.listen(0, '127.0.0.1', (error?: Error) => error ? reject(error) : resolve(listener));
  });
  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    store.close(); fs.rmSync(dir, { recursive: true, force: true });
  });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  function request<T>(url: string, method = 'GET', body?: unknown, cookie = ''): Promise<JsonResult<T>> {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port: address.port, path: url, method, agent: false,
        headers: { ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...(cookie ? { Cookie: cookie } : {}), 'X-Forwarded-For': `198.51.100.${++addressSequence % 250}` } }, res => {
        let text = ''; res.setEncoding('utf8'); res.on('data', chunk => { text += chunk; }); res.on('error', reject);
        res.on('end', () => { try { resolve({ status: res.statusCode || 0, body: JSON.parse(text) as T,
          cookie: res.headers['set-cookie']?.[0].split(';')[0] || cookie }); } catch (error) { reject(error); } });
      }); req.on('error', reject); req.end(payload);
    });
  }
  const bootstrap = await request<unknown>('/api/memory');
  const device = await request<MemoryDevice>('/api/memory/devices', 'POST', profile, bootstrap.cookie);
  const session = await request<MemorySession>('/api/memory/sessions', 'POST', { deviceId: device.body.id }, bootstrap.cookie);
  assert.equal(device.status, 201); assert.equal(session.status, 201);
  const owner = createHash('sha256').update(bootstrap.cookie.split('=')[1]).digest('hex');
  const chat = (revision: number, content: string, diagnosisMode: DiagnosisMode = 'knowledge_only', extra: Record<string, unknown> = {}) =>
    request<ChatResponse & { memory: MemorySession; code?: string }>('/api/chat', 'POST', {
      sessionId: session.body.id, revision, diagnosisMode, messages: [{ role: 'user', content }], ...extra,
    }, bootstrap.cookie);
  const checkpoint = () => store.plannerCheckpoint(owner, session.body.id);
  const detail = () => request<SessionDetail>(`/api/memory/sessions/${session.body.id}`, 'GET', undefined, bootstrap.cookie);
  const reopen = () => { store.close(); store = new MemoryStore(filename); };
  return { request, get store() { return store; }, reopen, owner, session: session.body, device: device.body,
    cookie: bootstrap.cookie, generations, chat, checkpoint, detail };
}

test('LF1504 session saves planner state atomically and resumes it after refreshing history', async t => {
  const h = await harness(t);
  const first = await h.chat(0, '东方红 LF1504 拖拉机旋耕时水温过高是什么原因');
  assert.equal(first.status, 200);
  const saved = h.checkpoint(); assert.ok(saved);
  assert.equal(saved.sessionId, h.session.id);
  assert.equal(saved.deviceId, h.device.id);
  assert.ok(saved.state.episodeId);
  assert.equal(saved.state.scope.model, 'LF1504');
  assert.equal(first.body.diagnosisTrace?.aiAttempts, 0);
  assert.ok((first.body.diagnosticReply?.questions.length ?? 0) <= 1);
  h.reopen();
  assert.deepEqual(h.checkpoint(), saved, 'checkpoint must survive closing and reopening SQLite');
  const restored = await h.detail();
  assert.equal(restored.status, 200); assert.equal(restored.body.revision, 1);
  assert.equal(restored.body.messages.length, 2);
  assert.doesNotMatch(JSON.stringify(restored.body), /_plannerCheckpoint|acceptedEvents|scopeKey/);
  const next = await h.chat(restored.body.revision, '冷却液泄漏检查正常');
  assert.equal(next.status, 200);
  const resumed = h.checkpoint(); assert.ok(resumed);
  assert.equal(resumed.state.episodeId, saved.state.episodeId);
  assert.ok(resumed.state.planVersion > saved.state.planVersion);
  assert.equal(resumed.state.observations['cooling-leak']?.value, 'normal');
  assert.equal(resumed.state.observations['cooling-leak']?.source, 'user_report');
  assert.ok(Object.values(resumed.state.observations).every(observation => observation.verification === 'unverified'));
  assert.equal(h.generations.length, 0);
});

test('battery normal feedback advances to a different observation and a later correction retains its basis', async t => {
  const h = await harness(t);
  const first = await h.chat(0, '东方红 LF1504 发动机启动不了');
  assert.equal(first.status, 200);
  assert.match(first.body.diagnosticReply?.questions[0]?.text ?? '', /电瓶/);
  const second = await h.chat(1, '电瓶检查正常');
  assert.equal(second.status, 200);
  const normal = h.checkpoint(); assert.ok(normal);
  const original = normal.state.observations.battery;
  assert.equal(original?.value, 'normal');
  assert.equal(original?.source, 'user_report'); assert.equal(original?.verification, 'unverified');
  assert.doesNotMatch(second.body.diagnosticReply?.questions[0]?.text ?? '', /电瓶/);
  const third = await h.chat(2, '更正电瓶检查异常');
  assert.equal(third.status, 200);
  const corrected = h.checkpoint(); assert.ok(corrected);
  assert.equal(corrected.state.observations.battery?.value, 'abnormal');
  assert.equal(corrected.state.observations.battery?.corrects, original.eventId);
  assert.ok(corrected.state.audit.some(event => event.eventId === original.eventId));
  assert.equal(h.generations.length, 0);
});

test('synonymous repeat does not create a new event or consume another action', async t => {
  const h = await harness(t);
  assert.equal((await h.chat(0, '东方红 LF1504 发动机启动不了')).status, 200);
  assert.equal((await h.chat(1, '电瓶检查正常')).status, 200);
  const before = h.checkpoint(); assert.ok(before);
  assert.equal((await h.chat(2, '电瓶没问题')).status, 200);
  const after = h.checkpoint(); assert.ok(after);
  assert.equal(after.state.episodeId, before.state.episodeId);
  assert.equal(after.state.observations.battery?.eventId, before.state.observations.battery?.eventId);
  assert.equal(after.state.budget.issuedActions, before.state.budget.issuedActions);
});

test('uncertain and ambiguous feedback never become invented observations', async t => {
  const h = await harness(t);
  assert.equal((await h.chat(0, '东方红 LF1504 发动机启动不了')).status, 200);
  const unknown = await h.chat(1, '不确定');
  assert.equal(unknown.status, 200);
  const saved = h.checkpoint(); assert.ok(saved);
  assert.equal(saved.state.observations.battery?.value, null);
  assert.equal(saved.state.observations.battery?.verification, 'unverified');
  const vague = await h.chat(2, '可能正常也可能异常');
  assert.equal(vague.status, 200);
  assert.equal(h.checkpoint()?.state.observations.battery?.value, null);
  assert.match(vague.body.diagnosticReply?.questions[0]?.text ?? '', /正常|异常|不确定/);
});

test('a later definite result refines an uncertain observation with an audit link', async t => {
  const h = await harness(t);
  assert.equal((await h.chat(0, '东方红 LF1504 发动机启动不了')).status, 200);
  assert.equal((await h.chat(1, '不确定')).status, 200);
  const unknown = h.checkpoint()?.state.observations.battery; assert.ok(unknown);
  assert.equal(unknown.value, null);
  assert.equal((await h.chat(2, '电瓶检查正常')).status, 200);
  const known = h.checkpoint()?.state.observations.battery; assert.ok(known);
  assert.equal(known.value, 'normal');
  assert.equal(known.corrects, unknown.eventId);
  assert.equal(known.verification, 'unverified');
});

test('checked without a result asks for the outcome and can later become normal', async t => {
  const h = await harness(t);
  assert.equal((await h.chat(0, '东方红 LF1504 发动机启动不了')).status, 200);
  const checked = await h.chat(1, '电瓶已检查');
  assert.equal(checked.status, 200);
  assert.match(checked.body.diagnosticReply?.questions[0]?.text ?? '', /正常|异常/);
  const unknown = h.checkpoint()?.state.observations.battery; assert.ok(unknown);
  assert.equal(unknown.value, null);
  assert.equal((await h.chat(2, '正常')).status, 200);
  const normal = h.checkpoint()?.state.observations.battery; assert.ok(normal);
  assert.equal(normal.value, 'normal');
  assert.equal(normal.corrects, unknown.eventId);
});

test('user cancellation is recorded and does not silently resume a terminated episode', async t => {
  const h = await harness(t, true);
  assert.equal((await h.chat(0, '东方红 LF1504 水温过高')).status, 200);
  const before = h.checkpoint(); assert.ok(before);
  const cancelled = await h.chat(1, '取消诊断', 'ai_assisted');
  assert.equal(cancelled.status, 200);
  assert.match(cancelled.body.choices[0].message.content, /停止|取消|结束/);
  assert.equal(h.generations.length, 0);
  const stopped = h.checkpoint(); assert.ok(stopped);
  assert.equal(stopped.state.episodeId, before.state.episodeId);
  assert.equal(stopped.state.status, 'cancelled');
  assert.equal(stopped.state.stopReason, 'user_cancelled');
  const followUp = await h.chat(2, '正常');
  assert.equal(followUp.status, 200);
  assert.equal(h.checkpoint()?.state.status, 'cancelled');
  assert.equal(h.checkpoint()?.state.observations['cooling-leak'], undefined);
});

test('pause and explicit resume need no external model and preserve the episode', async t => {
  const h = await harness(t, true);
  assert.equal((await h.chat(0, '东方红 LF1504 水温过高')).status, 200);
  const episode = h.checkpoint()?.state.episodeId; assert.ok(episode);
  const pause = await h.chat(1, '暂停诊断', 'ai_assisted');
  assert.equal(pause.status, 200);
  assert.match(pause.body.choices[0].message.content, /暂停/);
  assert.equal(h.checkpoint()?.state.status, 'paused');
  assert.equal(h.checkpoint()?.state.stopReason, 'user_paused');
  const resume = await h.chat(2, '恢复诊断', 'knowledge_only');
  assert.equal(resume.status, 200);
  assert.equal(h.checkpoint()?.state.episodeId, episode);
  assert.notEqual(h.checkpoint()?.state.status, 'paused');
  assert.equal(h.generations.length, 0);
});

test('switching fault topic creates a new episode without carrying the previous observation', async t => {
  const h = await harness(t);
  assert.equal((await h.chat(0, '东方红 LF1504 水温过高')).status, 200);
  assert.equal((await h.chat(1, '冷却液泄漏检查正常')).status, 200);
  const before = h.checkpoint(); assert.ok(before);
  const changed = await h.chat(2, '另外一个故障：发动机启动不了');
  assert.equal(changed.status, 200);
  const after = h.checkpoint(); assert.ok(after);
  assert.equal(after.topicKey, 'starting');
  assert.notEqual(after.state.episodeId, before.state.episodeId);
  assert.equal(after.state.observations['cooling-leak'], undefined);
});

test('a new symptom beginning with 现在 still switches to its own episode', async t => {
  const h = await harness(t);
  assert.equal((await h.chat(0, '东方红 LF1504 水温过高')).status, 200);
  assert.equal((await h.chat(1, '冷却液泄漏检查正常')).status, 200);
  const before = h.checkpoint(); assert.ok(before);
  assert.equal((await h.chat(2, '现在发动机启动不了')).status, 200);
  const after = h.checkpoint(); assert.ok(after);
  assert.equal(after.topicKey, 'starting');
  assert.notEqual(after.state.episodeId, before.state.episodeId);
  assert.equal(after.state.observations['cooling-leak'], undefined);
});

test('a different unrecognized symptom cannot retain the old starting diagnosis', async t => {
  const h = await harness(t);
  assert.equal((await h.chat(0, '东方红 LF1504 发动机启动不了')).status, 200);
  assert.equal((await h.chat(1, '电瓶检查正常')).status, 200);
  const previous = h.checkpoint(); assert.ok(previous);
  const next = await h.chat(2, '离合器打滑');
  assert.equal(next.status, 200);
  const checkpoint = h.checkpoint();
  if (checkpoint?.state.episodeId === previous.state.episodeId) {
    assert.equal(checkpoint.state.observations.battery?.eventId, previous.state.observations.battery?.eventId);
    assert.match(next.body.diagnosticReply?.questions[0]?.text ?? '', /另一个问题|对应的检查或故障现象/);
  }
  assert.doesNotMatch(next.body.diagnosticReply?.questions.map(question => question.text).join(' ') ?? '', /起动机已有检查结果/);
});

test('pending topic ambiguity blocks a later unqualified normal report from becoming an old observation', async t => {
  const h = await harness(t);
  assert.equal((await h.chat(0, '东方红 LF1504 水温过高')).status, 200);
  const original = h.checkpoint(); assert.ok(original);
  assert.equal((await h.chat(1, '离合器打滑')).status, 200);
  assert.equal((await h.chat(2, '正常')).status, 200);
  const after = h.checkpoint(); assert.ok(after);
  assert.equal(after.state.episodeId, original.state.episodeId);
  assert.equal(after.state.observations['cooling-leak'], undefined);
  assert.equal(after.state.budget.issuedActions, original.state.budget.issuedActions);
});

test('a scope change during an unknown topic cannot restore an old engine on a later turn', async t => {
  const h = await harness(t);
  assert.equal((await h.chat(0, '东方红 LF1504 水温过高', 'knowledge_only', { engineModel: 'TEST-E1' })).status, 200);
  assert.equal((await h.chat(1, '离合器打滑', 'knowledge_only', { engineModel: 'TEST-E2' })).status, 200);
  assert.equal((await h.chat(2, '正常')).status, 200);
  const after = h.checkpoint();
  assert.notEqual(after?.state.scope.engineModel, 'TEST-E1');
});

test('unknown topics cannot silently unpause an explicitly paused episode', async t => {
  const h = await harness(t);
  assert.equal((await h.chat(0, '东方红 LF1504 水温过高')).status, 200);
  assert.equal((await h.chat(1, '暂停诊断')).status, 200);
  assert.equal(h.checkpoint()?.state.stopReason, 'user_paused');
  assert.equal((await h.chat(2, '离合器打滑')).status, 200);
  const after = h.checkpoint(); assert.ok(after);
  assert.equal(after.state.status, 'paused'); assert.equal(after.state.stopReason, 'user_paused');
  assert.equal((await h.chat(3, '正常')).status, 200);
  const later = h.checkpoint(); assert.ok(later);
  assert.equal(later.state.status, 'paused'); assert.equal(later.state.stopReason, 'user_paused');
});

test('after ambiguous topic an explicit return and named result can resume the original diagnosis', async t => {
  const h = await harness(t);
  assert.equal((await h.chat(0, '东方红 LF1504 水温过高')).status, 200);
  const before = h.checkpoint(); assert.ok(before);
  assert.equal((await h.chat(1, '离合器打滑')).status, 200);
  assert.equal((await h.chat(2, '继续原故障')).status, 200);
  assert.equal((await h.chat(3, '冷却液泄漏检查正常')).status, 200);
  const after = h.checkpoint(); assert.ok(after);
  assert.equal(after.state.episodeId, before.state.episodeId);
  assert.equal(after.state.observations['cooling-leak']?.value, 'normal');
  assert.equal(after.state.observations['cooling-leak']?.verification, 'unverified');
});

test('pending-topic clarification and explicit return do not call an available AI provider', async t => {
  const h = await harness(t, true);
  assert.equal((await h.chat(0, '东方红 LF1504 水温过高')).status, 200);
  const unknown = await h.chat(1, '离合器打滑', 'ai_assisted');
  assert.equal(unknown.status, 200);
  assert.match(unknown.body.diagnosticReply?.questions[0]?.text ?? '', /故障|问题/);
  assert.equal(h.generations.length, 0);
  const original = await h.chat(2, '继续原故障', 'ai_assisted');
  assert.equal(original.status, 200);
  assert.equal(h.generations.length, 0);
});

test('high-risk input during pending topic retains Router safe and escalates the plan', async t => {
  const h = await harness(t, true);
  assert.equal((await h.chat(0, '东方红 LF1504 水温过高')).status, 200);
  assert.equal((await h.chat(1, '离合器打滑')).status, 200);
  const risk = await h.chat(2, '热车拧水箱盖', 'ai_assisted');
  assert.equal(risk.status, 200);
  assert.equal(risk.body.coordination?.route, 'safe');
  assert.equal(h.checkpoint()?.state.status, 'escalated');
  assert.equal(h.checkpoint()?.state.stopReason, 'safety_restriction');
  assert.equal(h.generations.length, 0);
});

test('supported feedback synonym survives conversation context resolution', async t => {
  const h = await harness(t);
  assert.equal((await h.chat(0, '东方红 LF1504 发动机启动不了')).status, 200);
  const before = h.checkpoint(); assert.ok(before);
  assert.equal((await h.chat(1, '电瓶检查没有问题')).status, 200);
  const after = h.checkpoint(); assert.ok(after);
  assert.equal(after.state.episodeId, before.state.episodeId);
  assert.equal(after.state.observations.battery?.value, 'normal');
});

test('unknown short feedback preserves the current episode and asks for clarification', async t => {
  const h = await harness(t);
  assert.equal((await h.chat(0, '东方红 LF1504 发动机启动不了')).status, 200);
  const before = h.checkpoint(); assert.ok(before);
  const response = await h.chat(1, '前面有点奇怪');
  assert.equal(response.status, 200);
  const after = h.checkpoint(); assert.ok(after);
  assert.equal(after.state.episodeId, before.state.episodeId);
  assert.equal(after.state.observations.battery, undefined);
  assert.match(response.body.diagnosticReply?.questions[0]?.text ?? '', /确认|正常|异常|不确定/);
});

test('omitted engine and fault-code fields inherit the episode scope; explicit change invalidates it', async t => {
  const h = await harness(t);
  assert.equal((await h.chat(0, '东方红 LF1504 水温过高', 'knowledge_only', { engineModel: 'TEST-E1', faultCodes: ['E001'] })).status, 200);
  const before = h.checkpoint(); assert.ok(before);
  assert.equal(before.state.scope.engineModel, 'TEST-E1');
  assert.deepEqual(before.state.scope.faultCodes, ['E001']);
  assert.equal((await h.chat(1, '冷却液泄漏检查正常')).status, 200);
  const inherited = h.checkpoint(); assert.ok(inherited);
  assert.equal(inherited.state.episodeId, before.state.episodeId);
  assert.equal(inherited.state.scope.engineModel, 'TEST-E1');
  assert.deepEqual(inherited.state.scope.faultCodes, ['E001']);
  assert.equal((await h.chat(2, '继续诊断', 'knowledge_only', { engineModel: 'TEST-E2', faultCodes: ['E002'] })).status, 200);
  const changed = h.checkpoint(); assert.ok(changed);
  assert.notEqual(changed.state.episodeId, before.state.episodeId);
  assert.equal(changed.state.scope.engineModel, 'TEST-E2');
  assert.deepEqual(changed.state.scope.faultCodes, ['E002']);
  assert.equal(changed.state.observations['cooling-leak'], undefined);
});

test('explicitly starting another incident of the same type creates a new episode', async t => {
  const h = await harness(t);
  assert.equal((await h.chat(0, '东方红 LF1504 水温过高')).status, 200);
  assert.equal((await h.chat(1, '冷却液泄漏检查正常')).status, 200);
  const before = h.checkpoint(); assert.ok(before);
  assert.equal((await h.chat(2, '另外一个故障，水温过高')).status, 200);
  const after = h.checkpoint(); assert.ok(after);
  assert.equal(after.topicKey, before.topicKey);
  assert.notEqual(after.state.episodeId, before.state.episodeId);
  assert.equal(after.state.observations['cooling-leak'], undefined);
});

test('correcting emission standard changes the episode and discards old-scope observations', async t => {
  const h = await harness(t);
  assert.equal((await h.chat(0, '东方红 LF1504 国三水温过高')).status, 200);
  assert.equal((await h.chat(1, '冷却液泄漏检查正常')).status, 200);
  const before = h.checkpoint(); assert.ok(before);
  assert.ok(before.state.scope.conditions?.includes('国三'));
  assert.equal((await h.chat(2, '更正为国四')).status, 200);
  const after = h.checkpoint(); assert.ok(after);
  assert.ok(after.state.scope.conditions?.includes('国四'));
  assert.notEqual(after.state.episodeId, before.state.episodeId);
  assert.equal(after.state.observations['cooling-leak'], undefined);
});

test('a named correction can revise an observation after all steps are completed', async t => {
  const h = await harness(t);
  assert.equal((await h.chat(0, '东方红 LF1504 发动机启动不了')).status, 200);
  assert.equal((await h.chat(1, '电瓶检查正常')).status, 200);
  assert.equal((await h.chat(2, '启动机检查正常')).status, 200);
  const complete = h.checkpoint(); assert.ok(complete);
  assert.equal(complete.state.stopReason, 'plan_review_complete');
  const original = complete.state.observations.battery; assert.ok(original);
  assert.equal((await h.chat(3, '更正电瓶检查异常')).status, 200);
  const corrected = h.checkpoint(); assert.ok(corrected);
  assert.equal(corrected.state.observations.battery?.value, 'abnormal');
  assert.equal(corrected.state.observations.battery?.corrects, original.eventId);
});

test('reported repair terminates the episode without generating another AI answer', async t => {
  const h = await harness(t, true);
  assert.equal((await h.chat(0, '东方红 LF1504 水温过高')).status, 200);
  const result = await h.chat(1, '已修好', 'ai_assisted');
  assert.equal(result.status, 200);
  assert.equal(h.generations.length, 0);
  assert.equal(h.checkpoint()?.state.status, 'resolved_reported');
  assert.equal(h.checkpoint()?.state.stopReason, 'user_reported_resolved');
  assert.match(result.body.choices[0].message.content, /已解决|已修好|修复/);
});

test('stale revision cannot append messages or roll a persisted plan back', async t => {
  const h = await harness(t);
  assert.equal((await h.chat(0, '东方红 LF1504 水温过高')).status, 200);
  const saved = h.checkpoint(); assert.ok(saved);
  const stale = await h.chat(0, '已检查，正常');
  assert.equal(stale.status, 409); assert.equal(stale.body.code, 'memory_conflict');
  assert.deepEqual(h.checkpoint(), saved);
  assert.equal((await h.detail()).body.messages.length, 2);
});

test('a client-supplied checkpoint cannot impersonate a server-owned plan', async t => {
  const h = await harness(t);
  const first = await h.chat(0, '东方红 LF1504 发动机启动不了', 'knowledge_only', {
    plannerCheckpoint: { sessionId: h.session.id, deviceId: h.device.id,
      state: { episodeId: 'forged', status: 'resolved_reported', observations: { battery: { value: 'normal' } } } },
  });
  assert.equal(first.status, 200);
  const saved = h.checkpoint(); assert.ok(saved);
  assert.notEqual(saved.state.episodeId, 'forged');
  assert.notEqual(saved.state.status, 'resolved_reported');
  assert.equal(saved.state.observations.battery, undefined);
  assert.doesNotMatch(JSON.stringify(first.body), /acceptedEvents|scopeKey|forged/);
});

test('switching to another device cannot reuse the former session plan', async t => {
  const h = await harness(t);
  assert.equal((await h.chat(0, '东方红 LF1504 水温过高')).status, 200);
  const saved = h.checkpoint(); assert.ok(saved);
  const changed = await h.chat(1, '另一台车启动电机不转');
  assert.equal(changed.status, 409); assert.equal(changed.body.code, 'memory_device_changed');
  assert.deepEqual(h.checkpoint(), saved);
  const other = await h.request<MemoryDevice>('/api/memory/devices', 'POST', { ...profile, name: '另一台', model: 'LF904' }, h.cookie);
  const session = await h.request<MemorySession>('/api/memory/sessions', 'POST', { deviceId: other.body.id }, h.cookie);
  assert.equal(session.status, 201);
  assert.equal(h.store.plannerCheckpoint(h.owner, session.body.id), undefined);
});

test('a corrected model profile invalidates prior model observations', async t => {
  const h = await harness(t);
  assert.equal((await h.chat(0, '东方红 LF1504 水温过高')).status, 200);
  assert.equal((await h.chat(1, '冷却液泄漏检查正常')).status, 200);
  const original = h.checkpoint(); assert.ok(original);
  const updated = await h.request<MemoryDevice>(`/api/memory/devices/${h.device.id}`, 'PATCH', { ...profile, model: 'LF904' }, h.cookie);
  assert.equal(updated.status, 200);
  const resumed = await h.chat(3, '继续诊断');
  assert.equal(resumed.status, 200);
  const current = h.checkpoint();
  if (current) {
    assert.notEqual(current.state.episodeId, original.state.episodeId);
    assert.equal(current.state.observations['cooling-leak'], undefined);
  }
});

test('a dangerous follow-up invokes the existing Router safety stop', async t => {
  const h = await harness(t, true);
  assert.equal((await h.chat(0, '东方红 LF1504 水温过高')).status, 200);
  const result = await h.chat(1, '热车拧水箱盖', 'ai_assisted');
  assert.equal(result.status, 200);
  assert.equal(result.body.coordination?.route, 'safe');
  assert.equal(result.body.diagnosisTrace?.aiAttempts, 0);
  assert.equal(h.checkpoint()?.state.status, 'escalated');
  assert.equal(h.checkpoint()?.state.stopReason, 'safety_restriction');
});

test('clearing a session removes its private planner state and invalidates old revisions', async t => {
  const h = await harness(t);
  assert.equal((await h.chat(0, '东方红 LF1504 水温过高')).status, 200);
  assert.ok(h.checkpoint());
  const cleared = await h.request<SessionDetail>(`/api/memory/sessions/${h.session.id}/clear`, 'POST', { revision: 1 }, h.cookie);
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.messages.length, 0);
  assert.equal(h.checkpoint(), undefined);
  assert.equal((await h.chat(1, '正常')).status, 409);
  assert.equal(h.checkpoint(), undefined);
});

test('late AI response after clear cannot restore a stale planner checkpoint', async t => {
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const h = await harness(t, true, async () => { entered(); await gate; });
  const pending = h.chat(0, '东方红 LF1504 旋耕时水温过高，可能是什么原因？', 'ai_assisted');
  await Promise.race([started, pending.then(() => { throw new Error('fixture expected an in-flight provider call'); })]);
  const cleared = await h.request<SessionDetail>(`/api/memory/sessions/${h.session.id}/clear`, 'POST', { revision: 0 }, h.cookie);
  assert.equal(cleared.status, 200);
  release();
  const late = await pending;
  assert.equal(late.status, 409); assert.equal(late.body.code, 'memory_conflict');
  assert.equal(h.checkpoint(), undefined);
  assert.equal((await h.detail()).body.messages.length, 0);
});

test('all three modes keep provider isolation with an unavailable external model', async t => {
  for (const mode of ['auto', 'knowledge_only', 'ai_assisted'] as const) {
    const h = await harness(t);
    const result = await h.chat(0, '东方红 LF1504 旋耕时水温过高', mode);
    assert.equal(result.status, 200);
    assert.equal(result.body.coordination?.requestedMode, mode);
    assert.equal(result.body.diagnosisTrace?.aiAttempts, 0);
    assert.equal(h.generations.length, 0);
    assert.ok((result.body.diagnosticReply?.questions.length ?? 0) <= 1);
    assert.ok(h.checkpoint());
  }
});

test('missing local evidence and provider safely retain an unverified observation plan', async t => {
  const h = await harness(t, false, undefined, true);
  const result = await h.chat(0, '东方红 LF1504 水温过高', 'auto');
  assert.equal(result.status, 200);
  assert.equal(result.body.knowledgeSources.length, 0);
  assert.equal(h.generations.length, 0);
  assert.ok(result.body.diagnosticReply?.causes.every(cause => cause.basis !== 'source_candidate'));
  assert.ok(h.checkpoint());
  assert.ok((result.body.diagnosticReply?.questions.length ?? 0) <= 1);
});

test('knowledge-only never calls configured provider while auto and AI-assisted keep their existing route', async t => {
  for (const mode of ['auto', 'knowledge_only', 'ai_assisted'] as const) {
    const h = await harness(t, true);
    const result = await h.chat(0, '东方红 LF1504 旋耕时水温过高，可能是什么原因？', mode);
    assert.equal(result.status, 200);
    assert.equal(result.body.coordination?.requestedMode, mode);
    assert.ok(h.generations.length <= 1);
    if (mode === 'knowledge_only') assert.equal(h.generations.length, 0);
    assert.ok(h.checkpoint());
  }
});

test('an AI follow-up does not spend budget on a Planner question that was not shown', async t => {
  const h = await harness(t, true, undefined, false, '故障原因尚需核实。作业时出现过报警吗？');
  const first = await h.chat(0, '东方红 LF1504 旋耕时水温过高，可能是什么原因？', 'ai_assisted');
  assert.equal(first.status, 200);
  assert.equal(h.generations.length, 1);
  assert.match(first.body.choices[0].message.content, /报警/);
  assert.equal(first.body.diagnosticReply?.questions.length, 0);
  const skipped = h.checkpoint(); assert.ok(skipped);
  assert.equal(skipped.state.budget.issuedActions, 0);
  assert.equal(skipped.state.askedKeys.length, 0);
  const second = await h.chat(1, '继续诊断', 'knowledge_only');
  assert.equal(second.status, 200);
  assert.match(second.body.diagnosticReply?.questions[0]?.text ?? '', /冷却液/);
  assert.equal(h.checkpoint()?.state.budget.issuedActions, 1);
  assert.equal(h.generations.length, 1);
});

test('feedback to the AI question is recorded even when Planner did not issue an action', async t => {
  const h = await harness(t, true, undefined, false, '启动原因尚未确定。电瓶已有检查结果是否正常？');
  const first = await h.chat(0, '东方红 LF1504 发动机启动不了，可能是什么原因？', 'ai_assisted');
  assert.equal(first.status, 200);
  assert.match(first.body.choices[0].message.content, /电瓶/);
  assert.equal(h.checkpoint()?.state.budget.issuedActions, 0);
  const second = await h.chat(1, '电瓶正常', 'knowledge_only');
  assert.equal(second.status, 200);
  const saved = h.checkpoint(); assert.ok(saved);
  assert.equal(saved.state.observations.battery?.value, 'normal');
  assert.equal(saved.state.observations.battery?.verification, 'unverified');
  assert.doesNotMatch(second.body.diagnosticReply?.questions[0]?.text ?? '', /电瓶已有检查结果/);
});

test('retained fault code reaches retrieval and excludes a conflicting local source on subsequent turns', async t => {
  const scopes: Parameters<typeof retrieve>[2][] = [];
  const fixture: ReturnType<typeof retrieve>[number] = {
    source: 'test-fault-code.md', entryId: 'TEST-FAULT-001', sourceId: 'SRC-TEST-FAULT',
    heading: '合成故障资料', text: '合成资料，仅供测试。',
    indexedReference: { entryId: 'TEST-FAULT-001', sourceId: 'SRC-TEST-FAULT' },
    brand: '东方红', model: 'LF1504', models: ['LF1504'], faultCodes: ['E001'],
    status: '原文已核验；未实车验证', applicability: 'matched', entryType: '维护/故障知识',
    diagnosticMetadata: { coverage: { symptom: true, causes: true, checks: true, repair: true }, riskLevel: 'low' },
    relevance: { score: 12, method: 'keyword-weighted-overlap', calibrated: false },
  };
  const h = await harness(t, false, undefined, false, undefined, (_query, _topK, scope) => {
    scopes.push(scope); return [fixture];
  });
  const first = await h.chat(0, '东方红 LF1504 水温过高', 'knowledge_only', { faultCodes: ['E002'] });
  assert.equal(first.status, 200);
  const second = await h.chat(1, '冷却液泄漏检查正常');
  assert.equal(second.status, 200);
  assert.deepEqual(scopes.at(-1)?.faultCodes, ['E002']);
  assert.ok(second.body.coordination?.candidates?.some(candidate => candidate.entryId === 'TEST-FAULT-001' && candidate.excluded));
  assert.ok(second.body.knowledgeSources.every(source => source.entryId !== 'TEST-FAULT-001'));
});

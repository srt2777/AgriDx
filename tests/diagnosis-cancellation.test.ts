import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { createDiagnosticService, type DiagnosticProvider } from '../server/diagnosis/service';
import { ProviderError } from '../server/llm/types';
import { createHash } from 'node:crypto';
import http from 'node:http';
import express from 'express';
import { createChatRoutes } from '../server/routes/chat';
import { MemoryStore } from '../server/memory/store';

const savedEnvironment = { mode: process.env.DIAGNOSIS_MODE, external: process.env.ALLOW_EXTERNAL_AI };
beforeEach(() => { process.env.DIAGNOSIS_MODE = 'auto'; process.env.ALLOW_EXTERNAL_AI = 'true'; });
afterEach(() => {
  if (savedEnvironment.mode === undefined) delete process.env.DIAGNOSIS_MODE; else process.env.DIAGNOSIS_MODE = savedEnvironment.mode;
  if (savedEnvironment.external === undefined) delete process.env.ALLOW_EXTERNAL_AI; else process.env.ALLOW_EXTERNAL_AI = savedEnvironment.external;
});
const request = { history: [{ role: 'user' as const, content: '指示灯间歇闪烁可能是什么原因？' }], diagnosisMode: 'ai_assisted' as const };
const lateAnswer = { result: { content: '迟到的模拟回答。', provider: 'deepseek' as const, model: 'fixture' }, primary: 'deepseek' as const, fellBack: false, attempts: 1 };

test('plain diagnosis forwards caller cancellation and records no successful generation', async () => {
  const controller = new AbortController();
  let calls = 0;
  const provider: DiagnosticProvider = {
    hasAnyConfigured: () => true,
    chat: async (_messages, options) => {
      calls++;
      assert.equal(options?.signal, controller.signal);
      controller.abort();
      throw new ProviderError('deepseek', 'cancelled');
    },
  };
  const diagnose = createDiagnosticService(provider, { retrieve: () => [], config: { logDecisions: false } });
  const result = await diagnose(request, undefined, controller.signal);
  assert.equal(calls, 1);
  assert.equal(result.diagnosisTrace?.aiSuccesses, 0);
  assert.equal(result.diagnosticReply?.aiSupplement, undefined);
  assert.match(result.choices[0].message.content, /已取消/);
  assert.doesNotMatch(result.choices[0].message.content, /请求超时/);
});

test('cancelled diagnosis rejects late results and never starts a shadow loop', async () => {
  const controller = new AbortController();
  let shadowCalls = 0;
  const provider: DiagnosticProvider = {
    hasAnyConfigured: () => true,
    chat: async () => { controller.abort(); return lateAnswer; },
    toolProvider: () => { shadowCalls++; return null; },
  };
  const diagnose = createDiagnosticService(provider, { retrieve: () => [], config: { logDecisions: false, agentLoop: 'shadow' } });
  const result = await diagnose(request, undefined, controller.signal);
  assert.equal(shadowCalls, 0);
  assert.equal(result.diagnosisTrace?.aiSuccesses, 0);
  assert.equal(result.provider, 'knowledge-base');
  assert.doesNotMatch(result.choices[0].message.content, /迟到的模拟回答/);
});

test('cancelled streaming diagnosis suppresses late deltas and final content', async () => {
  const controller = new AbortController();
  const deltas: string[] = [];
  const provider: DiagnosticProvider = {
    hasAnyConfigured: () => true,
    chat: async () => { throw new Error('must stream'); },
    chatStream: async (_messages, onDelta, options) => {
      assert.equal(options?.signal, controller.signal);
      onDelta('取消前的预览');
      controller.abort();
      onDelta('取消后的片段');
      return lateAnswer;
    },
  };
  const diagnose = createDiagnosticService(provider, { retrieve: () => [], config: { logDecisions: false } });
  const result = await diagnose(request, undefined, controller.signal, text => deltas.push(text));
  assert.deepEqual(deltas, ['取消前的预览']);
  assert.equal(result.diagnosisTrace?.aiSuccesses, 0);
  assert.equal(result.diagnosticReply?.aiSupplement, undefined);
});

test('disconnect during memory retry delay never saves the cancelled turn', { timeout: 5000 }, async t => {
  const store = new MemoryStore(':memory:');
  const token = 'a'.repeat(64);
  const owner = createHash('sha256').update(token).digest('hex');
  const device = store.saveDevice(owner, { name: '合成测试设备', machineType: '拖拉机', brand: '', model: '', hours: null, notes: '' });
  const session = store.createSession(owner, device.id);
  let attempts = 0;
  const firstAttempt = Promise.withResolvers<void>();
  const wrapped = new Proxy(store, {
    get(target, key) {
      if (key === 'appendTurn') return (...args: Parameters<MemoryStore['appendTurn']>) => {
        attempts++;
        if (attempts === 1) {
          client.destroy();
          firstAttempt.resolve();
          throw new Error('synthetic first save failure');
        }
        return target.appendTurn(...args);
      };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const app = express();
  app.use(express.json());
  app.use('/api', createChatRoutes(async () => ({ choices: [{ message: { role: 'assistant', content: '合成测试答复' } }],
    model: 'fixture', provider: 'knowledge-base', answerMode: 'local-evidence', fellBack: false, knowledgeChunks: 0, knowledgeSources: [] }), () => wrapped));
  const server = await new Promise<http.Server>(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    store.close();
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const client = http.request({ host: '127.0.0.1', port: address.port, path: '/api/chat', method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `agridx_memory=${token}` } });
  client.on('error', () => {}); // Expected socket close after the deliberate disconnect.
  client.end(JSON.stringify({ sessionId: session.id, revision: 0, messages: request.history }));
  await firstAttempt.promise;
  await new Promise(resolve => setTimeout(resolve, 300)); // The route retries at 200 ms.
  assert.equal(attempts, 1);
  const saved = store.session(owner, session.id);
  assert.equal(saved.revision, 0);
  assert.deepEqual(saved.messages, []);
});

import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { test } from 'node:test';
import { createChatRoutes } from '../server/routes/chat';

// No sessionId is sent, so the memory store is never touched; the stub
// below only guards against accidental use in this test.
const unusedStore = () => { throw new Error('memory store must not be used in this test'); };
const body = JSON.stringify({ machineType: '拖拉机', brand: '东方红', model: 'LF904S', messages: [{ role: 'user', content: '指示灯间歇闪烁怎么办' }] });
const payload = { choices: [{ message: { role: 'assistant', content: '先区分空载与负载' } }], model: 'fixture-model', provider: 'fixture' };

async function startServer(diagnose: (...args: unknown[]) => Promise<unknown>) {
  const app = express();
  app.use(express.json());
  app.use('/api', createChatRoutes(diagnose as never, unusedStore as never));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.on('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return { server, port: address.port };
}
async function stopServer(server: http.Server) {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
function post(port: number, acceptSse: boolean): Promise<{ status: number; contentType: string; body: string }> {
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: '127.0.0.1', port, path: '/api/chat', method: 'POST',
      headers: {
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
        ...(acceptSse ? { Accept: 'text/event-stream' } : {}),
      },
    }, response => {
      let output = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { output += chunk; });
      response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode ?? 0, contentType: response.headers['content-type'] ?? '', body: output }));
    });
    request.on('error', reject);
    request.end(body);
  });
}
function parseSse(raw: string): { event: string; data: string }[] {
  return raw.split('\n\n').filter(Boolean).map(block => {
    const event = block.match(/^event: (.+)$/m)?.[1] ?? '';
    const data = block.match(/^data: (.+)$/m)?.[1] ?? '';
    return { event, data };
  });
}

test('Accept: text/event-stream returns deltas in order and then the full JSON envelope', async () => {
  const seen: string[] = [];
  const { server, port } = await startServer(async (_input, _memory, _signal, onDelta) => {
    (onDelta as (text: string) => void)?.('先区分');
    seen.push('delta-before-done');
    (onDelta as (text: string) => void)?.('空载与负载');
    return payload;
  });
  try {
    const response = await post(port, true);
    assert.equal(response.status, 200);
    assert.match(response.contentType, /text\/event-stream/);
    const events = parseSse(response.body);
    assert.deepEqual(events.map(item => item.event), ['delta', 'delta', 'done']);
    assert.deepEqual(events.slice(0, 2).map(item => JSON.parse(item.data)), [{ text: '先区分' }, { text: '空载与负载' }]);
    assert.deepEqual(JSON.parse(events[2].data), payload);
    assert.deepEqual(seen, ['delta-before-done']);
  } finally { await stopServer(server); }
});

test('without Accept: text/event-stream the same diagnosis returns plain JSON', async () => {
  let streamed = false;
  const { server, port } = await startServer(async (_input, _memory, _signal, onDelta) => {
    if (onDelta) streamed = true;
    return payload;
  });
  try {
    const response = await post(port, false);
    assert.equal(response.status, 200);
    assert.match(response.contentType, /application\/json/);
    assert.doesNotMatch(response.body, /event: delta/);
    assert.deepEqual(JSON.parse(response.body), payload);
    assert.equal(streamed, false);
  } finally { await stopServer(server); }
});

test('a diagnosis failure after streaming started arrives as an SSE error event, not a JSON status', async () => {
  const { server, port } = await startServer(async () => { throw new Error('synthetic upstream failure'); });
  try {
    const response = await post(port, true);
    assert.equal(response.status, 200);
    assert.match(response.contentType, /text\/event-stream/);
    const events = parseSse(response.body);
    assert.deepEqual(events.map(item => item.event), ['error']);
    assert.deepEqual(JSON.parse(events[0].data), { error: '智能诊断服务暂时无法连接，请稍后重试。', code: 'llm_unavailable' });
    // The same failure without SSE still uses the JSON 502 path.
    const json = await post(port, false);
    assert.equal(json.status, 502);
    assert.deepEqual(JSON.parse(json.body), { error: '智能诊断服务暂时无法连接，请稍后重试。', code: 'llm_unavailable' });
  } finally { await stopServer(server); }
});

import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { afterEach, beforeEach, test } from 'node:test';
import { createChatRoutes } from '../server/routes/chat';

// No sessionId is sent, so the memory store is never touched; the stub
// below only guards against accidental use in this test.
const unusedStore = () => { throw new Error('memory store must not be used in this test'); };
const body = JSON.stringify({ machineType: '拖拉机', brand: '东方红', model: 'LF904S', messages: [{ role: 'user', content: '指示灯间歇闪烁怎么办' }] });

async function startServer(diagnose: (input: unknown) => Promise<unknown>) {
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
function post(port: number, destroyAfterMs?: number): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port, path: '/api/chat', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, response => {
      let output = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { output += chunk; });
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body: output }));
    });
    request.on('error', reject);
    request.end(body);
    // Destroy only after the request has reached the server; destroying
    // synchronously can abort before the handler ever runs.
    if (destroyAfterMs !== undefined) setTimeout(() => request.destroy(), destroyAfterMs);
  });
}
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

let warnings: string[];
let originalWarn: typeof console.warn;
beforeEach(() => {
  warnings = [];
  originalWarn = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };
});
afterEach(() => { console.warn = originalWarn; });

test('chat route logs a skip and does not throw when the client disconnects before the answer', async () => {
  const { server, port } = await startServer(async () => {
    await delay(60);
    return { choices: [{ message: { role: 'assistant', content: 'synthetic answer' } }], model: 'fixture-model', provider: 'fixture' };
  });
  try {
    // The client goes away while the answer is still being computed; the
    // server must notice the dead connection instead of writing to it.
    await post(port, 20).catch(() => {});
    await delay(300);
    assert.ok(warnings.some(message => message.includes('[chat] response skipped: client disconnected')),
      `expected a disconnect skip log, got: ${JSON.stringify(warnings)}`);
    // The server is still healthy afterwards: a normal request completes.
    const response = await post(port);
    assert.equal(response.status, 200);
    assert.match(response.body, /synthetic answer/);
  } finally { await stopServer(server); }
});

test('chat route does not throw when the diagnosis fails after the client disconnects', async () => {
  const { server, port } = await startServer(async () => {
    await delay(60);
    throw new Error('synthetic upstream failure');
  });
  try {
    await post(port, 20).catch(() => {});
    await delay(300);
    // The follow-up request proves the error path did not crash the route:
    // with the client still connected it reaches the normal 502 handling.
    const response = await post(port);
    assert.equal(response.status, 502);
  } finally { await stopServer(server); }
});

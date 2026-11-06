/**
 * PR1 依赖安全：body-parser 压缩请求拒绝服务回归测试。
 *
 * 根因 (GHSA-27r3-jxmh-p828)：body-parser < 2.4.0 在解压请求体后，
 * 把解压流留在无错误监听的已完成状态；一个合法 gzip 帧后跟尾随字节
 * 会在响应正常返回后抛出未捕获异常，导致整个 Node 进程崩溃。
 * 修复版本 body-parser >= 2.4.0。
 *
 * 全部请求都发往隔离子进程中的真实应用（tests/dep-security-server.ts），
 * 这样旧版本上的崩溃只杀死子进程，测试本身仍能报告失败而非连带崩溃。
 */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-fake-key';
process.env.DEEPSEEK_API_KEY = 'test-fake-key';
process.env.LLM_PROVIDER = 'auto';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let child: ChildProcess | undefined;
let port = 0;

function waitForReady(proc: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('dep-security-server did not become ready in 60s')), 60_000);
    proc.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const match = buffer.match(/READY (\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    proc.on('error', reject);
    proc.on('exit', (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`dep-security-server exited early with code=${code} signal=${signal}`));
    });
  });
}

function rawRequest(options: http.RequestOptions, body?: Buffer): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, agent: false, ...options }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function healthOk(): Promise<boolean> {
  try {
    const res = await rawRequest({ path: '/api/health', method: 'GET' });
    return res.status === 200;
  } catch {
    return false;
  }
}

before(async () => {
  child = spawn(
    process.execPath,
    ['--import', 'tsx', path.join(rootDir, 'tests', 'dep-security-server.ts')],
    {
      cwd: rootDir,
      env: { ...process.env, NODE_ENV: 'test', GEMINI_API_KEY: 'test-fake-key', DEEPSEEK_API_KEY: 'test-fake-key', LLM_PROVIDER: 'auto' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  child.stderr?.on('data', (chunk: Buffer) => process.stderr.write(`[dep-security-server] ${chunk.toString('utf8')}`));
  port = await waitForReady(child);
  assert.ok(await healthOk(), 'child server /api/health should answer 200 before tests');
});

after(async () => {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    await new Promise((resolve) => child?.once('exit', resolve));
  }
});

test('正常 JSON 请求被解析并路由（空诊断请求返回 400）', async () => {
  const payload = Buffer.from(JSON.stringify({}), 'utf8');
  const res = await rawRequest(
    { path: '/api/chat', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length } },
    payload,
  );
  assert.equal(res.status, 400);
});

test('gzip 压缩的正常 JSON 请求可解压处理', async () => {
  const payload = gzipSync(Buffer.from(JSON.stringify({}), 'utf8'));
  const res = await rawRequest(
    { path: '/api/chat', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip', 'Content-Length': payload.length } },
    payload,
  );
  assert.equal(res.status, 400);
  assert.ok(await healthOk(), 'health should stay 200 after a valid gzip request');
});

test('GHSA-27r3-jxmh-p828：合法 gzip 帧后跟尾随字节不得导致进程崩溃', async () => {
  // 官方 PoC（https://expressjs.com/en/blog/2026-10-28-cve-2026-111181/）：
  // 合法 gzip 帧 + 一个 0x00 字节（使 gunzip 在第一个成员后结束）
  // + 100KB 填充字节（在解码器结束后到达，触发未捕获异常）。
  const gzipped = gzipSync(Buffer.from(JSON.stringify({}), 'utf8'));
  const poisoned = Buffer.concat([gzipped, Buffer.from([0x00]), Buffer.alloc(100 * 1024, 0x58)]);
  const res = await rawRequest(
    { path: '/api/chat', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip', 'Content-Length': poisoned.length } },
    poisoned,
  );
  // 公告所述：旧版本上应用先正常响应，随后崩溃；因此先断言响应本身正常。
  assert.equal(res.status, 400);
  // 给已完成解码器上的异步错误留出触发时间，再确认进程仍存活。
  await sleep(700);
  assert.equal(child?.exitCode, null, 'server process must survive trailing bytes after a gzip body');
  assert.equal(child?.signalCode, null, 'server process must not be killed by trailing bytes after a gzip body');
  assert.ok(await healthOk(), '/api/health must still answer 200 after the poisoned request');
});

test('超限 JSON 请求返回 413', async () => {
  const payload = Buffer.from(JSON.stringify({ pad: 'x'.repeat(300_000) }), 'utf8');
  assert.ok(payload.length > 256 * 1024, 'payload must exceed the 256kb JSON limit');
  const res = await rawRequest(
    { path: '/api/chat', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length } },
    payload,
  );
  assert.equal(res.status, 413);
  assert.ok(await healthOk(), 'health should stay 200 after an over-limit request');
});

test('畸形 JSON 请求返回 400 且进程存活', async () => {
  const payload = Buffer.from('{"a":', 'utf8');
  const res = await rawRequest(
    { path: '/api/chat', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length } },
    payload,
  );
  assert.equal(res.status, 400);
  assert.ok(await healthOk(), 'health should stay 200 after malformed JSON');
});

test('无效 gzip 体返回 400 且进程存活', async () => {
  const payload = Buffer.from('not-gzip-at-all', 'utf8');
  const res = await rawRequest(
    { path: '/api/chat', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip', 'Content-Length': payload.length } },
    payload,
  );
  assert.equal(res.status, 400);
  await sleep(300);
  assert.equal(child?.exitCode, null, 'server process must survive an invalid gzip body');
  assert.ok(await healthOk(), 'health should stay 200 after an invalid gzip body');
});

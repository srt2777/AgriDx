/**
 * PR1 依赖安全：undici 与服务端 HTTP 边界回归测试。
 *
 * 根因：
 * - npm undici < 8.12.2 有多项公告未修复（GHSA-xjj6-f33q-929c 等 8 项，
 *   见 OSV 查询记录）：恶意上游返回 >5 个 content-encoding 并提前断开时，
 *   即使应用正确 catch 了 fetch() 的拒绝，孤儿内部流上的未处理错误仍会
 *   终止进程；另有 TLS 校验绕过、EventSource 内存无界、缓存投毒等。
 * - 运行时核实：Node v24.22.1 内置 Undici 为 7.30.1，恰好是已修复的 7.x
 *   版本（GHSA 修复线：6.29.1 / 7.30.1 / 8.12.2），因此无代理时的全局
 *   fetch 本就走已修复代码；npm 安装的 undici 只在配置代理时经
 *   server/config/environment.ts 的 setGlobalDispatcher(new ProxyAgent())
 *   进入请求路径，升级到 >= 8.12.2 才能覆盖该路径。
 *
 * 恶意上游用例全部在隔离子进程（tests/dep-security-undici-probe.ts）中
 * 运行，旧版本上的崩溃只杀死探针子进程，测试本身仍能报告失败。
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { fetchWithTimeout } from '../server/llm/http';

process.env.NODE_ENV = 'test';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

type Semver = [number, number, number];
function parseSemver(version: string): Semver {
  const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number);
  return [major, minor, patch];
}
function atLeast(version: string, floor: Semver): boolean {
  const [major, minor, patch] = parseSemver(version);
  if (major !== floor[0]) return major > floor[0];
  if (minor !== floor[1]) return minor > floor[1];
  return patch >= floor[2];
}
function installedVersion(packageName: string): string {
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'node_modules', packageName, 'package.json'), 'utf8')) as { version: string };
  return pkg.version;
}

/** 假上游：直连目标。/excessive-encodings 复现 GHSA-xjj6-f33q-929c。 */
let upstream: http.Server;
let upstreamPort = 0;
/** 极简正向代理：除 /excessive-encodings 直接返回恶意响应外，其余转发到假上游。 */
let proxy: http.Server;
let proxyPort = 0;

function startServer(handler: http.RequestListener): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      resolve({ server, port: address.port });
    });
  });
}

function sendExcessiveEncodings(res: http.ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/plain',
    'Content-Encoding': 'gzip, gzip, gzip, gzip, gzip, gzip',
    'Content-Length': '100',
  });
  res.flushHeaders();
  // 公告触发条件：编码数超过上限后、在发送正文前断开连接。
  res.socket?.destroy();
}

before(async () => {
  ({ server: upstream, port: upstreamPort } = await startServer((req, res) => {
    if (req.url === '/excessive-encodings') return sendExcessiveEncodings(res);
    if (req.url === '/ok') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.url === '/error') {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'boom' }));
      return;
    }
    if (req.url === '/slow') return; // 永不响应，用于超时 / 取消用例
    res.writeHead(404);
    res.end();
  }));
  ({ server: proxy, port: proxyPort } = await startServer((req, res) => {
    const target = req.url ?? '';
    if (target.endsWith('/excessive-encodings')) return sendExcessiveEncodings(res);
    let targetUrl: URL;
    try {
      targetUrl = new URL(target);
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    const forward = http.request(
      { host: '127.0.0.1', port: Number(targetUrl.port), path: `${targetUrl.pathname}${targetUrl.search}`, method: req.method, headers: req.headers },
      (upRes) => {
        res.writeHead(upRes.statusCode ?? 502, upRes.headers);
        upRes.pipe(res);
      },
    );
    forward.on('error', () => res.destroy());
    req.pipe(forward);
  }));
});

after(async () => {
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
  await new Promise<void>((resolve) => proxy.close(() => resolve()));
});

function runProbe(args: string[]): Promise<{ code: number | null; signal: NodeJS.Signals | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', path.join(rootDir, 'tests', 'dep-security-undici-probe.ts'), ...args],
      { cwd: rootDir, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let output = '';
    child.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString('utf8'); });
    child.stderr?.on('data', (chunk: Buffer) => { output += chunk.toString('utf8'); });
    child.on('error', reject);
    child.on('exit', (code, signal) => resolve({ code, signal, output }));
  });
}

test('npm 安装的 undici 版本 >= 8.12.2（公告修复线）', () => {
  const version = installedVersion('undici');
  assert.ok(atLeast(version, [8, 12, 2]), `undici ${version} must be >= 8.12.2`);
});

test('Node 内置 Undici 处于已修复版本线（6.29.1 / 7.30.1 / 8.12.2）', () => {
  const builtin = process.versions.undici;
  assert.ok(builtin, 'process.versions.undici should exist');
  const [major] = parseSemver(builtin);
  const floors: Record<number, Semver> = { 6: [6, 29, 1], 7: [7, 30, 1], 8: [8, 12, 2] };
  if (major >= 9) return; // 修复发布时 9.x 尚不存在，后续大版本包含该修复
  assert.ok(floors[major] && atLeast(builtin, floors[major]), `built-in undici ${builtin} is below its patched line`);
});

test('GHSA-xjj6-f33q-929c：全局 fetch 遇 >5 content-encoding 恶意响应时进程存活', async () => {
  const result = await runProbe(['--impl', 'global', '--case', 'excessive', '--upstream', `http://127.0.0.1:${upstreamPort}/excessive-encodings`]);
  assert.equal(result.signal, null, `probe must not be killed by signal (output: ${result.output})`);
  assert.equal(result.code, 0, `probe must exit 0 (output: ${result.output})`);
  assert.match(result.output, /SURVIVED/);
});

test('GHSA-xjj6-f33q-929c：npm undici fetch 遇 >5 content-encoding 恶意响应时进程存活', async () => {
  const result = await runProbe(['--impl', 'undici', '--case', 'excessive', '--upstream', `http://127.0.0.1:${upstreamPort}/excessive-encodings`]);
  assert.equal(result.signal, null, `probe must not be killed by signal (output: ${result.output})`);
  assert.equal(result.code, 0, `probe must exit 0 (output: ${result.output})`);
  assert.match(result.output, /SURVIVED/);
});

test('代理路径：经 npm Undici ProxyAgent 的全局 fetch 遇恶意响应时进程存活', async () => {
  const result = await runProbe([
    '--impl', 'global', '--case', 'excessive',
    '--upstream', `http://127.0.0.1:${upstreamPort}/excessive-encodings`,
    '--proxy', `http://127.0.0.1:${proxyPort}`,
  ]);
  assert.equal(result.signal, null, `probe must not be killed by signal (output: ${result.output})`);
  assert.equal(result.code, 0, `probe must exit 0 (output: ${result.output})`);
  assert.match(result.output, /SURVIVED/);
});

test('代理路径：经 npm Undici ProxyAgent 的正常请求可达假上游', async () => {
  const result = await runProbe([
    '--impl', 'global', '--case', 'ok',
    '--upstream', `http://127.0.0.1:${upstreamPort}/ok`,
    '--proxy', `http://127.0.0.1:${proxyPort}`,
  ]);
  assert.equal(result.code, 0, `probe must exit 0 (output: ${result.output})`);
  assert.match(result.output, /fetch ok: 200/);
});

test('fetchWithTimeout：直连正常响应与 consumeResponse', async () => {
  const response = await fetchWithTimeout(`http://127.0.0.1:${upstreamPort}/ok`, {}, 5_000);
  assert.equal(response.status, 200);
  const parsed = await fetchWithTimeout(
    `http://127.0.0.1:${upstreamPort}/ok`, {}, 5_000,
    async (res) => (await res.json()) as { ok: boolean },
  );
  assert.deepEqual(parsed, { ok: true });
});

test('fetchWithTimeout：上游异常响应（500）按响应返回，不抛错', async () => {
  const response = await fetchWithTimeout(`http://127.0.0.1:${upstreamPort}/error`, {}, 5_000);
  assert.equal(response.status, 500);
});

test('fetchWithTimeout：上游无响应时超时', async () => {
  await assert.rejects(
    fetchWithTimeout(`http://127.0.0.1:${upstreamPort}/slow`, {}, 200),
    (error: unknown) => error instanceof Error && error.message === 'timeout',
  );
});

test('fetchWithTimeout：外部取消信号导致取消', async () => {
  const controller = new AbortController();
  const pending = fetchWithTimeout(`http://127.0.0.1:${upstreamPort}/slow`, { signal: controller.signal }, 5_000);
  controller.abort();
  await assert.rejects(pending, (error: unknown) => error instanceof Error && error.message === 'cancelled');
});

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { controllerConfigured, verifyPublicSite } from '../scripts/tencent-deploy/verify-public.mjs';
import { productionBranch, publishReady } from '../scripts/tencent-deploy/publish-ready.mjs';

const commit = 'a'.repeat(40);
const other = 'b'.repeat(40);
const linuxOnly = process.platform !== 'linux' ? 'systemd 控制器需要 Linux' : false;

test('部署请求只接受最新main，幂等重跑、首次创建和快进更新均不强推', () => {
  for (const previous of [undefined, other, commit]) {
    const calls = [];
    const api = (endpoint, data, method) => {
      calls.push({ endpoint, data, method });
      if (endpoint === 'git/ref/heads/main') return { object: { sha: commit } };
      if (endpoint.startsWith('git/matching-refs/')) return previous
        ? [{ ref: `refs/heads/${productionBranch}`, object: { sha: previous } }] : [];
      return {};
    };
    assert.equal(publishReady(commit, api).ready, true);
    const writes = calls.filter(call => call.data);
    assert.equal(writes.length, previous === commit ? 0 : 1);
    if (previous === other) assert.deepEqual(writes[0].data, { sha: commit, force: false });
    if (!previous) assert.deepEqual(writes[0].data, { ref: `refs/heads/${productionBranch}`, sha: commit });
  }
  for (const advanceOn of [1, 2]) {
    let reads = 0;
    const writes = [];
    const api = (endpoint, data) => {
      if (data) writes.push(data);
      if (endpoint === 'git/ref/heads/main') return { object: { sha: ++reads >= advanceOn ? other : commit } };
      return [];
    };
    assert.deepEqual(publishReady(commit, api), { ready: false, reason: 'newer-main' });
    assert.equal(writes.length, 0);
  }
  assert.throws(() => publishReady('main', () => { throw new Error('must not call'); }), /40位/);
});

function shellFixture(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'agridx-production-sync-'));
  const bin = path.join(directory, 'bin'), log = path.join(directory, 'calls.jsonl');
  const current = path.join(directory, 'current'), state = path.join(directory, 'state');
  const tools = path.join(directory, 'tools'), units = path.join(directory, 'systemd');
  mkdirSync(bin); mkdirSync(path.join(current, 'dist'), { recursive: true }); mkdirSync(state); mkdirSync(units);
  writeFileSync(log, '');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const name of ['sync-main.sh', 'install-auto-pull.sh']) {
    let source = readFileSync(new URL(`../scripts/tencent-deploy/${name}`, import.meta.url), 'utf8');
    for (const [key, value] of Object.entries({ CURRENT: current, STATE_DIR: state, TOOL_DIR: tools,
      SYSTEMD_DIR: units, LOCK: path.join(directory, 'lock') })) {
      const expression = new RegExp(`^readonly ${key}=.*$`, 'm');
      if (expression.test(source)) source = source.replace(expression, `readonly ${key}=${value}`);
    }
    writeFileSync(path.join(directory, name), source);
  }
  const updater = path.join(directory, 'update-existing.sh');
  writeFileSync(updater, `#!/bin/bash\nexec '${process.execPath}' '${path.join(bin, 'update')}' "$@"\n`);
  const mock = `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path');
const name = path.basename(process.argv[1]), args = process.argv.slice(2);
fs.appendFileSync(process.env.SYNC_FIXTURE_LOG, JSON.stringify({ name, args }) + '\\n');
if (name === 'id') console.log(process.env.SYNC_FIXTURE_UID || '0');
else if (name === 'date') console.log(process.env.SYNC_FIXTURE_NOW || '2000000000');
else if (name === 'git') {
  if (process.env.SYNC_FIXTURE_GIT_FAILURE) process.exit(1);
  console.log((process.env.SYNC_FIXTURE_MAIN || '${commit}') + '\\trefs/heads/main');
  if (!process.env.SYNC_FIXTURE_NO_READY) console.log((process.env.SYNC_FIXTURE_READY || '${commit}') + '\\trefs/heads/tencent-production-ready');
} else if (name === 'update') {
  if (args[0] === '--check' && process.env.SYNC_FIXTURE_PREFLIGHT_FAILURE) process.exit(1);
  if (args[0] === '--deploy') {
    if (process.env.SYNC_FIXTURE_DEPLOY_FAILURE) process.exit(1);
    fs.writeFileSync(path.join(process.env.SYNC_FIXTURE_CURRENT, 'dist', 'deployment.json'), JSON.stringify({ commit: args[1] }));
  }
} else if (name === 'curl') {
  const url = args.find(value => value.startsWith('https://'));
  const target = args[args.indexOf('--output') + 1];
  fs.copyFileSync(path.join(process.env.SYNC_FIXTURE_ROOT, path.basename(url)), target);
} else if (name === 'install') {
  let mode; const operands = [];
  for (let i = 0; i < args.length; i++) {
    if (['-m', '-o', '-g'].includes(args[i])) {
      if (args[i] === '-m') mode = parseInt(args[i + 1], 8); i++;
    } else if (args[i] !== '-d') operands.push(args[i]);
  }
  if (args.includes('-d')) for (const item of operands) fs.mkdirSync(item, { recursive: true, mode });
  else {
    const target = operands.pop();
    for (const source of operands) {
      const file = fs.existsSync(target) && fs.statSync(target).isDirectory() ? path.join(target, path.basename(source)) : target;
      fs.copyFileSync(source, file); if (mode !== undefined) fs.chmodSync(file, mode);
    }
  }
} else if (name === 'systemctl' && args[0] === 'enable' && process.env.SYNC_FIXTURE_TIMER_FAILURE) process.exit(1);
`;
  for (const name of ['id', 'date', 'git', 'curl', 'install', 'systemctl', 'update']) {
    const file = path.join(bin, name); writeFileSync(file, mock); chmodSync(file, 0o755);
  }
  return { current, state, tools, units,
    run(script, args = [], extra = {}) {
      writeFileSync(log, '');
      return spawnSync('/bin/bash', [path.join(directory, script), ...args], { encoding: 'utf8',
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, SYNC_FIXTURE_ROOT: directory,
          SYNC_FIXTURE_LOG: log, SYNC_FIXTURE_CURRENT: current, ...extra } });
    },
    calls: () => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)),
  };
}

test('服务器控制器不部署旧请求、未检查main或已部署提交，且远端读取失败保留现状', { skip: linuxOnly }, t => {
  const fixture = shellFixture(t);
  for (const extra of [{ SYNC_FIXTURE_MAIN: other }, { SYNC_FIXTURE_NO_READY: '1' }, { SYNC_FIXTURE_GIT_FAILURE: '1' }]) {
    const result = fixture.run('sync-main.sh', [], extra);
    assert.equal(result.status, extra.SYNC_FIXTURE_GIT_FAILURE ? 1 : 0, result.stderr);
    assert.ok(!fixture.calls().some(call => call.name === 'update'));
  }
  assert.equal(fixture.run('sync-main.sh').status, 0);
  assert.deepEqual(fixture.calls().find(call => call.name === 'update').args, ['--deploy', commit]);
  assert.equal(fixture.run('sync-main.sh').status, 0);
  assert.ok(!fixture.calls().some(call => call.name === 'update'));
});

test('同一失败提交五分钟内不反复构建，新main可以立即重试', { skip: linuxOnly }, t => {
  const fixture = shellFixture(t);
  assert.equal(fixture.run('sync-main.sh', [], { SYNC_FIXTURE_DEPLOY_FAILURE: '1' }).status, 1);
  assert.ok(existsSync(path.join(fixture.state, 'last-failure')));
  assert.equal(fixture.run('sync-main.sh').status, 0);
  assert.ok(!fixture.calls().some(call => call.name === 'update'));
  assert.equal(fixture.run('sync-main.sh', [], { SYNC_FIXTURE_MAIN: other, SYNC_FIXTURE_READY: other }).status, 0);
  assert.deepEqual(fixture.calls().find(call => call.name === 'update').args, ['--deploy', other]);
  assert.equal(existsSync(path.join(fixture.state, 'last-failure')), false);
});

test('安装先检查现有服务器，失败不创建控制器或重启应用，成功安装root工具和20秒timer', { skip: linuxOnly }, t => {
  const fixture = shellFixture(t);
  assert.equal(fixture.run('install-auto-pull.sh', ['--install', commit], { SYNC_FIXTURE_PREFLIGHT_FAILURE: '1' }).status, 1);
  assert.equal(existsSync(fixture.tools), false);
  assert.ok(!fixture.calls().some(call => call.name === 'systemctl'));
  const result = fixture.run('install-auto-pull.sh', ['--install', commit]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(statSync(path.join(fixture.tools, 'sync-main.sh')).mode & 0o777, 0o700);
  assert.match(readFileSync(path.join(fixture.units, 'agridx-github-sync.timer'), 'utf8'), /OnUnitInactiveSec=20s/);
  assert.ok(fixture.calls().some(call => call.name === 'systemctl' && call.args.join(' ') === 'enable --now agridx-github-sync.timer'));
  assert.ok(!fixture.calls().some(call => call.name === 'update' && call.args[0] === '--deploy'));
  assert.ok(!fixture.calls().some(call => call.name === 'systemctl' && call.args.includes('agridx.service')));
  assert.equal(JSON.parse(readFileSync(path.join(fixture.current, 'dist', 'deployment-automation.json'), 'utf8')).configured, true);
});

test('安装后的服务PATH能执行仅在管理目录中的runuser和nginx', { skip: linuxOnly }, t => {
  const fixture = shellFixture(t);
  const installed = fixture.run('install-auto-pull.sh', ['--install', commit]);
  assert.equal(installed.status, 0, installed.stderr);
  const unit = readFileSync(path.join(fixture.units, 'agridx-github-sync.service'), 'utf8');
  const servicePath = unit.match(/^Environment=PATH=(.+)$/m)?.[1];
  assert.ok(servicePath, '应使用实际生成的服务PATH');
  const directory = mkdtempSync(path.join(os.tmpdir(), 'agridx-admin-path-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const mappings = new Map([['/usr/sbin', path.join(directory, 'usr-sbin')],
    ['/sbin', path.join(directory, 'sbin')]]);
  for (const [source, target] of mappings) {
    mkdirSync(target);
    const name = source === '/usr/sbin' ? 'runuser' : 'nginx';
    writeFileSync(path.join(target, name), `#!/bin/sh\nprintf '${name}-resolved\\n'\n`, { mode: 0o755 });
  }
  const result = spawnSync('/bin/bash', ['-c', 'runuser --path-probe && nginx --path-probe'], {
    encoding: 'utf8', env: { ...process.env,
      PATH: servicePath.split(':').map(value => mappings.get(value) || value).join(':') },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'runuser-resolved\nnginx-resolved\n');
});

test('安装拒绝未知systemd配置；timer启动失败撤下接入标志并保留原应用', { skip: linuxOnly }, t => {
  const fixture = shellFixture(t);
  const file = path.join(fixture.units, 'agridx-github-sync.service');
  writeFileSync(file, '# unrelated service\n');
  assert.equal(fixture.run('install-auto-pull.sh', ['--install', commit]).status, 1);
  assert.equal(readFileSync(file, 'utf8'), '# unrelated service\n');
  rmSync(file);
  assert.equal(fixture.run('install-auto-pull.sh', ['--install', commit], { SYNC_FIXTURE_TIMER_FAILURE: '1' }).status, 1);
  assert.equal(existsSync(path.join(fixture.state, 'controller.json')), false);
  assert.equal(existsSync(path.join(fixture.current, 'dist', 'deployment-automation.json')), false);
});

function publicFixture() {
  const bodies = new Map([
    ['/', '<div id="root"></div><script src="/assets/app.js"></script>'],
    ['/assets/app.js', 'console.log("fixture")'], ['/theme-init.js', '// fixture theme'],
  ]);
  const files = [...bodies].map(([resource, body]) => ({ path: resource === '/' ? '/index.html' : resource,
    sha256: createHash('sha256').update(body).digest('hex') }));
  const health = { ok: true, version: '3.4.8', knowledge: { archivedEntries: 2, chunks: 3 } };
  const catalog = { totals: { archivedEntries: 2, entries: 2 } };
  const manifest = { commit, version: '3.4.8', files };
  const options = { commit, version: '3.4.8', entries: 2, baseUrl: 'https://fixture.example/', attempts: 1, retryMs: 0,
    fetchImpl: async url => {
      const resource = url.pathname;
      const body = resource === '/api/health' ? JSON.stringify(health)
        : resource === '/deployment.json' ? JSON.stringify(manifest)
          : resource === '/api/knowledge/catalog' ? JSON.stringify(catalog) : bodies.get(resource);
      return new Response(body || 'missing', { status: body ? 200 : 404 });
    } };
  return { options, bodies, health, catalog, manifest };
}

test('公网验收核对后端版本、完整提交及所有首页资源摘要', async () => {
  const fixture = publicFixture();
  assert.deepEqual(await verifyPublicSite(fixture.options), { commit, version: '3.4.8', entries: 2, files: 3 });
});

test('防缓存资源全为新版但普通首页仍旧时，不得把源站就绪判作全站同步完成', async () => {
  const fixture = publicFixture();
  const healthyFetch = fixture.options.fetchImpl;
  const requests = [];
  fixture.options.fetchImpl = async (url, options) => {
    if (!url.searchParams.has('__agridx_check')) {
      return url.pathname === '/api/health'
        ? Response.json({ ok: true, version: '3.1.1', knowledge: { archivedEntries: 212, chunks: 221 } })
        : new Response('cached old webpage');
    }
    requests.push({ url, options });
    return healthyFetch(url, options);
  };
  const bareHealth = await fixture.options.fetchImpl(new URL('/api/health', fixture.options.baseUrl), {});
  assert.equal((await bareHealth.json()).version, '3.1.1');
  const barePage = await fixture.options.fetchImpl(new URL('/', fixture.options.baseUrl), {});
  assert.equal(await barePage.text(), 'cached old webpage');

  await assert.rejects(verifyPublicSite(fixture.options), /普通访问|CDN|缓存/);
  assert.deepEqual(requests.map(({ url }) => url.pathname).sort(),
    ['/', '/api/health', '/assets/app.js', '/deployment.json', '/theme-init.js'].sort());
  for (const { url, options } of requests) {
    assert.match(url.searchParams.get('__agridx_check'), /^\d+$/);
    assert.equal(url.searchParams.size, 1);
    assert.equal(options.cache, 'no-store');
    assert.equal(options.headers['Cache-Control'], 'no-cache');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
  }
});

test('普通首页、发布清单、健康或目录缓存各自落后时均拒绝验收并提示CDN修复', async () => {
  for (const stalePath of ['/', '/deployment.json', '/api/health', '/api/knowledge/catalog']) {
    const fixture = publicFixture();
    const fetchGood = fixture.options.fetchImpl;
    let staleReads = 0;
    fixture.options.attempts = 3;
    fixture.options.fetchImpl = async (url, options) => {
      if (!url.searchParams.size && url.pathname === stalePath) {
        staleReads++;
        assert.equal(options.cache, 'default');
        assert.equal(options.headers['Cache-Control'], undefined, '普通入口验收不能用强制回源头伪装用户访问');
        if (stalePath === '/') return new Response('old cached homepage');
        if (stalePath === '/deployment.json') return Response.json({ ...fixture.manifest, commit: other });
        if (stalePath === '/api/health') return Response.json({ ...fixture.health, version: '3.2.0' });
        return Response.json({ totals: { archivedEntries: 212, entries: 212 } });
      }
      return fetchGood(url, options);
    };
    await assert.rejects(verifyPublicSite(fixture.options), error =>
      error.code === 'cdn_cache_stale' && /普通访问.*CDN/.test(error.message), stalePath);
    assert.equal(staleReads, 1, '已证实的CDN旧缓存立即报告，不用60次源站重试掩盖');
  }
});

test('普通入口请求无查询参数、无防缓存头，验收保留同源与禁止重定向边界', async () => {
  const fixture = publicFixture();
  const fetchGood = fixture.options.fetchImpl;
  const seen = [];
  fixture.options.fetchImpl = (url, options) => {
    if (!url.searchParams.size) {
      seen.push(url.pathname);
      assert.equal(url.origin, 'https://fixture.example');
      assert.equal(options.cache, 'default');
      assert.deepEqual(options.headers, {});
      assert.equal(options.redirect, 'error');
      assert.ok(options.signal instanceof AbortSignal);
    }
    return fetchGood(url, options);
  };
  assert.equal((await verifyPublicSite(fixture.options)).commit, commit);
  assert.deepEqual(seen.sort(), ['/', '/deployment.json', '/api/health', '/api/knowledge/catalog'].sort());
});

test('公网200但旧后端、旧提交、旧首页或旧JS均不能判定同步完成', async () => {
  const mutations = [fixture => { fixture.health.version = '3.1.1'; },
    fixture => { fixture.manifest.commit = other; },
    fixture => { fixture.bodies.set('/', 'old homepage'); },
    fixture => { fixture.bodies.set('/assets/app.js', 'old JavaScript'); }];
  for (const mutate of mutations) {
    const fixture = publicFixture();
    mutate(fixture);
    await assert.rejects(verifyPublicSite(fixture.options), /不一致|旧版/);
  }
});

test('公网清单不能诱导访问外站或父目录，短暂缓存失败后重试并重新核对', async () => {
  for (const resource of ['https://other.example/x.js', '/assets/../private.js']) {
    const fixture = publicFixture();
    fixture.manifest.files[1].path = resource;
    await assert.rejects(verifyPublicSite(fixture.options), /格式错误/);
  }
  const fixture = publicFixture();
  const healthyFetch = fixture.options.fetchImpl;
  let transient = true;
  fixture.options.fetchImpl = async (url, options) => {
    if (url.pathname === '/deployment.json' && transient) {
      transient = false;
      return new Response('warming', { status: 404 });
    }
    return healthyFetch(url, options);
  };
  fixture.options.attempts = 2;
  assert.equal((await verifyPublicSite(fixture.options)).commit, commit);
});


test('服务器尚未安装时只发布请求，HTTP故障不能被宣称为已接入', async () => {
  for (const response of [new Response('not found', { status: 404 }), new Response('<html>legacy page</html>')]) {
    assert.equal(await controllerConfigured('https://fixture.example/', async () => response), false);
  }
  assert.equal(await controllerConfigured('https://fixture.example/', async () => Response.json({
    controller: 'agridx-github-sync', repository: 'srt2777/AgriDx-v3', configured: true })), true);
  await assert.rejects(controllerConfigured('https://fixture.example/', async () => new Response('down', { status: 503 })), /503/);
});

test('控制器接入检查也通过独立时间戳和no-store绕过旧404缓存', async () => {
  let requests = 0;
  const fetchImpl = async (url, options) => {
    if (!url.searchParams.has('__agridx_check')) return new Response('cached missing controller', { status: 404 });
    requests++;
    assert.equal(url.pathname, '/deployment-automation.json');
    assert.match(url.searchParams.get('__agridx_check'), /^\d+$/);
    assert.equal(options.cache, 'no-store');
    assert.equal(options.headers['Cache-Control'], 'no-cache');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json({ controller: 'agridx-github-sync', repository: 'srt2777/AgriDx-v3', configured: true });
  };
  assert.equal((await fetchImpl(new URL('https://fixture.example/deployment-automation.json'), {})).status, 404);
  assert.equal(await controllerConfigured('https://fixture.example/', fetchImpl), true);
  assert.equal(requests, 1);
});

test('main在等待中更新时，旧验收任务提前停止且不宣称部署通过', async () => {
  const fixture = publicFixture();
  assert.deepEqual(await verifyPublicSite({ ...fixture.options, isCurrent: () => false,
    fetchImpl: () => { throw new Error('obsolete must not fetch'); } }), { obsolete: true, commit });
});

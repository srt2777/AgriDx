import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { get } from 'node:http';
import { createServer } from 'node:net';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync,
  readdirSync, rmSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(new URL('../scripts/tencent-deploy/update-existing.sh', import.meta.url));
const commit = '9be3056878c6519851ea2f9f7b4924c62601fa3e';
const marker = '# Managed by scripts/tencent-deploy/update-existing.sh';
const unixOnly = process.platform !== 'linux' ? '部署流程需要 Linux Bash；其他平台仍执行项目自身测试' : false;

interface CommandCall {
  command: string;
  args: string[];
  target?: string;
  cache?: string;
}

// The production script has a fixed, deliberately narrow filesystem layout.
// Relocate only that layout in a fixture copy; no production TEST_MODE/root bypass
// is introduced. Its Bash control flow, health parser and rollback run unchanged.
function relocate(source: string, before: string, after: string) {
  assert.equal(source.split(before).length, 2, `fixture location must occur exactly once: ${before}`);
  return source.replace(before, after);
}

function fixture(t: { after: (cleanup: () => void) => void }, options: {
  failure?: 'preflight' | 'build' | 'stage' | 'production' | 'nginx';
  previousDropin?: boolean;
  blockedNpmCache?: boolean;
  expandedArchive?: boolean;
} = {}) {
  const temporaryRoot = path.resolve(os.tmpdir());
  const directory = mkdtempSync(path.join(temporaryRoot, 'agridx-tencent-deploy-'));
  const appRoot = path.join(directory, 'app');
  const releases = path.join(appRoot, 'releases');
  const previous = path.join(releases, 'previous');
  const current = path.join(appRoot, 'current');
  const dropinDirectory = path.join(directory, 'systemd', 'agridx.service.d');
  const dropin = path.join(dropinDirectory, '90-agridx-manual-release.conf');
  const envFile = path.join(directory, 'agridx.env');
  const nginxFile = path.join(directory, 'nginx.conf');
  const commands = path.join(directory, 'commands.jsonl');
  const bin = path.join(directory, 'bin');
  const legacyCache = path.join(appRoot, '.npm');
  const previousDropin = `${marker}\n[Service]\nEnvironment=OLD_FIXTURE_SETTING=preserved\n`;
  const envContent = 'MOCK_SETTING=original-production-setting\n';
  const dotenvContent = 'MOCK_SETTING=original-dotenv-setting\n';
  const nginxContent = 'user www-data;\nserver {\n root /opt/agridx/current/dist;\n proxy_pass http://127.0.0.1:8787;\n}\n';
  mkdirSync(path.join(previous, 'server'), { recursive: true });
  mkdirSync(dropinDirectory, { recursive: true });
  mkdirSync(bin);
  writeFileSync(path.join(previous, 'package.json'), JSON.stringify({ version: '3.0.0' }));
  writeFileSync(path.join(previous, '.env'), dotenvContent);
  writeFileSync(path.join(previous, 'server', '.env'), dotenvContent);
  symlinkSync(previous, current);
  if (options.previousDropin !== false) writeFileSync(dropin, previousDropin);
  writeFileSync(envFile, envContent, { mode: 0o600 });
  writeFileSync(nginxFile, nginxContent);
  writeFileSync(commands, '');
  mkdirSync(legacyCache);
  writeFileSync(path.join(legacyCache, 'legacy-marker'), 'existing cache retained');
  chmodSync(legacyCache, 0o500);
  t.after(() => {
    assert.equal(path.dirname(path.resolve(directory)), temporaryRoot);
    assert.match(path.basename(directory), /^agridx-tencent-deploy-/);
    chmodSync(legacyCache, 0o700);
    rmSync(directory, { recursive: true, force: true });
  });

  const commandMock = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const name = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const root = process.env.AGRIDX_FIXTURE_ROOT;
const current = path.join(root, 'app', 'current');
const previous = path.join(root, 'app', 'releases', 'previous');
const failure = process.env.AGRIDX_FIXTURE_FAILURE;
const record = { command: name, args };
if (name === 'npm') record.cache = process.env.npm_config_cache;
if (name === 'systemctl' && args[0] === 'restart') record.target = fs.readlinkSync(current);
fs.appendFileSync(path.join(root, 'commands.jsonl'), JSON.stringify(record) + '\\n');
function run(command, rest, extra = {}) {
  const result = spawnSync(command, rest, { env: { ...process.env, ...extra }, stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exit(result.status === null ? 1 : result.status);
}
function health(version) {
  const expanded = version !== '3.0.0' && process.env.AGRIDX_FIXTURE_EXPANDED === '1';
  console.log(JSON.stringify({ ok: true, version, knowledge: { chunks: expanded ? 1222 : 221, archivedEntries: expanded ? 1213 : 212 } }));
}
if (name === 'id') {
  if (args.join(' ') !== '-u') process.exit(90);
  console.log('0');
} else if (name === 'uname') {
  console.log('x86_64');
} else if (name === 'awk') {
  if (args[args.length - 1] === '/etc/os-release') {
    console.log(args.join(' ').includes('VERSION_ID') ? '24.04' : 'ubuntu');
  } else run('/usr/bin/awk', args);
} else if (name === 'runuser') {
  const separator = args.indexOf('--');
  if (separator < 0 || args[0] !== '-u' || !['agridx', 'www-data'].includes(args[1])) process.exit(91);
  run(args[separator + 1], args.slice(separator + 2));
} else if (name === 'nginx') {
  if (args.join(' ') !== '-T') process.exit(92);
  process.stdout.write(fs.readFileSync(path.join(root, 'nginx.conf'), 'utf8'));
} else if (name === 'systemctl') {
  if (args[0] === 'show') {
    const property = args.find(value => value.startsWith('--property='))?.slice(11);
    const values = {
      LoadState: 'loaded', ActiveState: 'active', User: 'agridx', WorkingDirectory: current, Type: 'simple',
      EnvironmentFiles: path.join(root, 'agridx.env') + ' (ignore_errors=no)',
      MainPID: process.env.AGRIDX_FIXTURE_STAGE_PID,
      FragmentPath: path.join(root, 'systemd', 'agridx.service'),
      DropInPaths: fs.existsSync(path.join(root, 'systemd', 'agridx.service.d', '90-agridx-manual-release.conf'))
        ? path.join(root, 'systemd', 'agridx.service.d', '90-agridx-manual-release.conf') : '',
      ExecStartPre: '', ExecStartPost: '',
    };
    if (property?.includes(',')) {
      for (const key of property.split(',')) {
        if (!(key in values)) process.exit(93);
        console.log(key + '=' + values[key]);
      }
    } else {
      if (!(property in values)) process.exit(93);
      console.log(values[property]);
    }
  } else if (!['stop', 'reset-failed', 'restart', 'daemon-reload'].includes(args[0])) process.exit(94);
} else if (name === 'systemd-run') {
  if (!args.includes('--property=PrivateNetwork=yes')) process.exit(95);
} else if (name === 'nsenter') {
  const separator = args.indexOf('--net');
  if (separator < 0) process.exit(96);
  run(args[separator + 1], args.slice(separator + 2));
} else if (name === 'curl') {
  const url = args[args.length - 1];
  if (url.startsWith('http://127.0.0.1/')) {
    if (!args.includes('Host: 43.128.40.157')) process.exit(97);
    if (url === 'http://127.0.0.1/api/health') health('3.1.0');
    else if (failure === 'nginx') console.log('<title>stale page</title>');
    else {
      const resource = url === 'http://127.0.0.1/' ? 'index.html' : url.slice('http://127.0.0.1/'.length);
      if (!['index.html', 'assets/fixture.js', 'theme-init.js', 'deployment.json'].includes(resource)) process.exit(97);
      process.stdout.write(fs.readFileSync(path.join(current, 'dist', resource)));
    }
    process.exit(0);
  }
  if (!/^http:\\/\\/127\\.0\\.0\\.1:878[78]\\/(api\\/health)?$/.test(url)) process.exit(97);
  if (url.endsWith(':8788/')) console.log('<!doctype html><title>staged page</title>');
  else if (url.includes(':8788/')) {
    if (failure === 'stage') process.exit(22);
    health('3.1.0');
  } else if (failure === 'preflight') {
    console.log(JSON.stringify({ ok: true, version: '3.0.0', knowledge: { chunks: 0, archivedEntries: 212 } }));
  } else {
    const target = fs.readlinkSync(current);
    if (failure === 'production' && target !== previous) process.exit(22);
    health(target === previous ? '3.0.0' : '3.1.0');
  }
} else if (name === 'git') {
  if (args[0] === 'clone') {
    const release = args[args.length - 1];
    fs.mkdirSync(path.join(release, 'server'), { recursive: true });
    fs.mkdirSync(path.join(release, 'public', 'models'), { recursive: true });
    fs.writeFileSync(path.join(release, 'package.json'), JSON.stringify({ version: '3.1.0' }));
    const archive = path.join(release, '知识库', '整理后的知识库', '农用拖拉机知识库');
    fs.mkdirSync(archive, { recursive: true });
    const entries = process.env.AGRIDX_FIXTURE_EXPANDED === '1' ? 1213 : 212;
    fs.writeFileSync(path.join(archive, 'entries.jsonl'), Array.from({ length: entries }, (_, i) => JSON.stringify({ id: i })).join('\\n'));
    fs.writeFileSync(path.join(release, 'server.ts'), '// fixture application');
    fs.writeFileSync(path.join(release, 'public', 'models', 'tractor-detailed-v1.glb'), 'fixture model');
  } else if (args[0] === '-C' && args[2] === 'checkout') {
    fs.writeFileSync(path.join(args[1], 'checked-out-commit'), args[args.length - 1]);
  } else if (args[0] === '-C' && args[2] === 'rev-parse') {
    console.log(fs.readFileSync(path.join(args[1], 'checked-out-commit'), 'utf8'));
  } else if (!(args[0] === '-C' && args[2] === 'fetch')) process.exit(98);
} else if (name === 'npm') {
  if (args[0] !== '--version' && process.env.AGRIDX_FIXTURE_BLOCKED_CACHE === '1') {
    const cacheOption = args.indexOf('--cache');
    const cache = cacheOption < 0 ? process.env.npm_config_cache : args[cacheOption + 1];
    if (!cache || !fs.existsSync(cache) || !(fs.statSync(cache).mode & 0o222)) {
      console.error('EACCES: permission denied, npm cache');
      process.exit(1);
    }
    fs.writeFileSync(path.join(cache, 'npm-write-probe'), 'release cache writable');
  }
  if (args[0] === '--version') console.log('11.0.0');
  else if (args[0] === 'run' && args[1] === 'build') {
    if (failure === 'build') process.exit(1);
    fs.mkdirSync(path.join(process.cwd(), 'dist', 'assets'), { recursive: true });
    fs.writeFileSync(path.join(process.cwd(), 'dist', 'index.html'), '<title>built fixture</title><script src="/assets/fixture.js"></script>');
    fs.writeFileSync(path.join(process.cwd(), 'dist', 'assets', 'fixture.js'), '// fixture application');
    fs.writeFileSync(path.join(process.cwd(), 'dist', 'theme-init.js'), '// theme bootstrap');
  } else if (!['ci', 'prune'].includes(args[0])) process.exit(99);
} else if (name === 'install') {
  const operands = [];
  let mode;
  for (let index = 0; index < args.length; index++) {
    if (['-m', '-o', '-g'].includes(args[index])) {
      if (args[index] === '-m') mode = Number.parseInt(args[index + 1], 8);
      index++;
    } else if (args[index] !== '-d') operands.push(args[index]);
  }
  for (const operand of operands) {
    if (!(operand === root || operand.startsWith(root + path.sep))) process.exit(100);
  }
  if (args.includes('-d')) {
    for (const operand of operands) fs.mkdirSync(operand, { recursive: true, mode });
  } else {
    fs.copyFileSync(operands[0], operands[1]);
    if (mode !== undefined) fs.chmodSync(operands[1], mode);
  }
} else if (name !== 'sleep') process.exit(101);
`;
  for (const name of ['id', 'uname', 'awk', 'runuser', 'nginx', 'systemctl', 'systemd-run',
    'nsenter', 'curl', 'git', 'npm', 'install', 'sleep']) {
    writeFileSync(path.join(bin, name), commandMock, { mode: 0o755 });
  }
  // Keep the real JSON health parser and version extraction. A separate node
  // wrapper preserves the production script's resolved node/npm dispatch.
  writeFileSync(path.join(bin, 'node'), `#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' "$@"\n`, { mode: 0o755 });
  let source = readFileSync(scriptPath, 'utf8');
  source = relocate(source, 'readonly APP_ROOT=/opt/agridx', `readonly APP_ROOT=${appRoot}`);
  source = relocate(source, 'readonly DROPIN_DIR=/etc/systemd/system/agridx.service.d', `readonly DROPIN_DIR=${dropinDirectory}`);
  source = relocate(source, '/run/lock/agridx-deploy.lock', path.join(directory, 'deploy.lock'));
  const executable = path.join(directory, 'update-existing.sh');
  writeFileSync(executable, source);
  chmodSync(executable, 0o755);
  const childEnvironment = {
    ...process.env, PATH: `${bin}:/usr/local/bin:/usr/bin:/bin`,
    AGRIDX_FIXTURE_ROOT: directory, AGRIDX_FIXTURE_FAILURE: options.failure ?? '',
    AGRIDX_FIXTURE_STAGE_PID: String(process.pid),
    AGRIDX_FIXTURE_BLOCKED_CACHE: options.blockedNpmCache ? '1' : '',
    AGRIDX_FIXTURE_EXPANDED: options.expandedArchive ? '1' : '',
    npm_config_cache: legacyCache, NPM_CONFIG_CACHE: legacyCache,
  };
  // These fake commands make no HTTP calls; an inherited project test loader is
  // unnecessary for their many short-lived real Node JSON parser processes.
  delete childEnvironment.NODE_OPTIONS;
  // Forty health polls spawn Node-backed mocks; allow slow CI to finish rollback assertions.
  const execute = (mode = '--deploy') => spawnSync('bash', [executable, mode, ...(mode === '--deploy' ? [commit] : [])], {
    cwd: directory, env: childEnvironment, encoding: 'utf8', shell: false, timeout: 90_000,
  });
  const calls = () => readFileSync(commands, 'utf8').trim().split('\n').filter(Boolean)
    .map(line => JSON.parse(line) as CommandCall);
  const assertPreserved = () => {
    assert.equal(readFileSync(envFile, 'utf8'), envContent);
    assert.equal(statSync(envFile).mode & 0o777, 0o600);
    assert.equal(readFileSync(nginxFile, 'utf8'), nginxContent);
    assert.ok(calls().filter(call => call.command === 'nginx').every(call => call.args.join(' ') === '-T'));
    assert.equal(readFileSync(path.join(previous, '.env'), 'utf8'), dotenvContent);
  };
  return { execute, calls, current, previous, releases, dropin, previousDropin, dotenvContent, legacyCache, assertPreserved };
}

test('腾讯只读诊断检查真实 Bash 流程且不创建版本或重启服务', { skip: unixOnly }, t => {
  const context = fixture(t);
  const result = context.execute('--check');
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.equal(readlinkSync(context.current), context.previous);
  assert.deepEqual(readdirSync(context.releases), ['previous']);
  assert.equal(readFileSync(context.dropin, 'utf8'), context.previousDropin);
  assert.equal(context.calls().filter(call => call.command === 'systemctl' && call.args[0] === 'restart').length, 0);
  context.assertPreserved();
});

for (const failure of ['preflight', 'build', 'stage'] as const) {
  test(`腾讯更新在 ${failure} 失败时保留旧目录/drop-in，原服务没有重启`, { skip: unixOnly }, t => {
    const context = fixture(t, { failure });
    const result = context.execute();
    assert.equal(result.status, 1, result.stderr || result.error?.message);
    assert.equal(readlinkSync(context.current), context.previous);
    assert.equal(readFileSync(context.dropin, 'utf8'), context.previousDropin);
    assert.equal(context.calls().filter(call => call.command === 'systemctl' && call.args[0] === 'restart').length, 0);
    if (failure === 'preflight') {
      assert.deepEqual(readdirSync(context.releases), ['previous']);
      assert.match(result.stderr, /现有8787健康检查未通过/);
    } else if (failure === 'build') {
      assert.ok(context.calls().some(call => call.command === 'npm' && call.args[0] === 'run' && call.args[1] === 'build'));
      assert.ok(!context.calls().some(call => call.command === 'systemd-run'));
    } else {
      assert.ok(context.calls().some(call => call.command === 'systemd-run'));
      assert.match(result.stderr, /独立版本健康检查未通过/);
    }
    context.assertPreserved();
  });
}

for (const previousDropin of [true, false]) {
  test(`腾讯正式健康失败恢复旧软链接和${previousDropin ? '既有' : '不存在的'} drop-in并重启旧服务`, { skip: unixOnly }, t => {
    const context = fixture(t, { failure: 'production', previousDropin });
    const result = context.execute();
    assert.equal(result.status, 1, result.stderr || result.error?.message);
    assert.equal(readlinkSync(context.current), context.previous);
    if (previousDropin) assert.equal(readFileSync(context.dropin, 'utf8'), context.previousDropin);
    else assert.equal(existsSync(context.dropin), false);
    const restarts = context.calls().filter(call => call.command === 'systemctl' && call.args[0] === 'restart');
    assert.equal(restarts.length, 2);
    assert.notEqual(restarts[0].target, context.previous);
    assert.equal(restarts[1].target, context.previous);
    assert.match(result.stderr, /正式服务健康检查未通过/);
    assert.match(result.stderr, /已恢复上一目录/);
    context.assertPreserved();
  });
}

test('腾讯 API 已健康但 Nginx 返回旧页面时仍回退，保留既有 Nginx 配置', { skip: unixOnly }, t => {
  const context = fixture(t, { failure: 'nginx' });
  const result = context.execute();
  assert.equal(result.status, 1, result.stderr || result.error?.message);
  assert.match(result.stderr, /Nginx 网页、脚本或 API 检查未通过/);
  assert.equal(readlinkSync(context.current), context.previous);
  assert.equal(readFileSync(context.dropin, 'utf8'), context.previousDropin);
  const restarts = context.calls().filter(call => call.command === 'systemctl' && call.args[0] === 'restart');
  assert.equal(restarts.length, 2);
  assert.equal(restarts[1].target, context.previous);
  context.assertPreserved();
});

test('腾讯成功更新使用完整 SHA，保留旧目录/env/Nginx且临时检查不加载生产 EnvironmentFile', { skip: unixOnly }, t => {
  const context = fixture(t);
  const result = context.execute();
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  const release = readlinkSync(context.current);
  assert.notEqual(release, context.previous);
  assert.equal(path.dirname(release), context.releases);
  assert.equal(readFileSync(path.join(release, 'checked-out-commit'), 'utf8'), commit);
  assert.ok(existsSync(path.join(context.previous, 'package.json')));
  assert.equal(readFileSync(path.join(release, '.env'), 'utf8'), context.dotenvContent);
  assert.equal(readFileSync(path.join(release, 'server', '.env'), 'utf8'), context.dotenvContent);
  assert.equal(statSync(path.join(release, '.env')).mode & 0o777, 0o600);
  const manifest = JSON.parse(readFileSync(path.join(release, 'dist', 'deployment.json'), 'utf8'));
  assert.equal(manifest.commit, commit);
  assert.equal(manifest.version, '3.1.0');
  assert.deepEqual(manifest.files.map((file: { path: string }) => file.path),
    ['/index.html', '/theme-init.js', '/assets/fixture.js']);
  const dropin = readFileSync(context.dropin, 'utf8');
  assert.ok(dropin.startsWith(`${marker}\n`));
  assert.match(dropin, /NODE_ENV=production PORT=8787/);
  assert.match(dropin, /--import tsx server\.ts\n/);
  assert.ok(!dropin.includes('EnvironmentFile'));
  const calls = context.calls();
  const clone = calls.find(call => call.command === 'git' && call.args[0] === 'clone');
  assert.ok(clone?.args.includes('https://github.com/srt2777/AgriDx.git'));
  const checkout = calls.find(call => call.command === 'git' && call.args[2] === 'checkout');
  assert.equal(checkout?.args.at(-1), commit);
  const stage = calls.find(call => call.command === 'systemd-run');
  assert.ok(stage?.args.includes('--property=PrivateNetwork=yes'));
  assert.ok(stage?.args.every(argument => !argument.includes('EnvironmentFile')));
  assert.equal(calls.filter(call => call.command === 'systemctl' && call.args[0] === 'restart').length, 1);
  context.assertPreserved();
});

test('腾讯默认 npm 缓存不可写时使用独立缓存完成安装、构建和裁剪', { skip: unixOnly }, t => {
  const context = fixture(t, { blockedNpmCache: true });
  const result = context.execute();
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  const release = readlinkSync(context.current);
  const cache = path.join(release, '.npm-cache');
  assert.equal(statSync(cache).mode & 0o777, 0o700);
  assert.equal(readFileSync(path.join(cache, 'npm-write-probe'), 'utf8'), 'release cache writable');
  const npmPhases = context.calls().filter(call => call.command === 'npm' && call.args[0] !== '--version');
  assert.deepEqual(npmPhases.map(call => call.args[0]), ['ci', 'run', 'prune']);
  for (const call of npmPhases) {
    assert.equal(call.cache, cache);
    assert.equal(call.args[call.args.indexOf('--cache') + 1], cache);
  }
  assert.equal(statSync(context.legacyCache).mode & 0o777, 0o500);
  assert.equal(readFileSync(path.join(context.legacyCache, 'legacy-marker'), 'utf8'), 'existing cache retained');
  context.assertPreserved();
});

test('腾讯正式启动命令从 current 软链接工作目录启动真实 TypeScript 服务', {
  skip: unixOnly, timeout: 60_000,
}, async t => {
  const context = fixture(t);
  const result = context.execute();
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  const command = readFileSync(context.dropin, 'utf8').split('\n')
    .find(line => line.startsWith('ExecStart=') && line.includes('--import tsx'));
  const entry = command?.match(/--import tsx (\S+)$/)?.[1];
  assert.ok(entry, '正式命令必须有明确的 TypeScript 入口');

  const projectRoot = fileURLToPath(new URL('../', import.meta.url));
  const alias = path.join(path.dirname(context.current), 'runtime-current');
  symlinkSync(projectRoot, alias, 'dir');
  // Map the generated current path to this fixture's real project symlink.
  // An absolute symlink entry reproduces the main-entry guard failure; a
  // relative entry lets Node resolve it from the physical working directory.
  const runtimeEntry = entry.replace(context.current, alias);
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const address = listener.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  listener.close();
  await once(listener, 'close');

  const child = spawn(process.execPath, ['--import', 'tsx', runtimeEntry], {
    cwd: alias, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port), GEMINI_API_KEY: '', DEEPSEEK_API_KEY: '' },
  });
  let output = '';
  child.stdout.on('data', value => { output = (output + String(value)).slice(-8000); });
  child.stderr.on('data', value => { output = (output + String(value)).slice(-8000); });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
  });
  const health = () => new Promise<{ version: string; knowledge: { archivedEntries: number; chunks: number } }>((resolve, reject) => {
    const request = get(`http://127.0.0.1:${port}/api/health`, response => {
      let body = '';
      response.on('data', value => { body += String(value); });
      response.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    });
    request.on('error', reject);
    request.setTimeout(250, () => request.destroy(new Error('local health timeout')));
  });
  let status: Awaited<ReturnType<typeof health>> | undefined;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null) break;
    try { status = await health(); break; } catch { await new Promise(resolve => setTimeout(resolve, 50)); }
  }
  assert.ok(status, `真实入口未开始监听：${output}`);
  assert.equal(status.version, JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8')).version);
  const archivedEntries = readFileSync(path.join(projectRoot,
    '知识库/整理后的知识库/农用拖拉机知识库/entries.jsonl'), 'utf8')
    .trim().split(/\r?\n/).length;
  const learningEntries = ['docs/tractor-knowledge/index.jsonl', 'docs/tractor-knowledge/expansion-5000/index.jsonl']
    .reduce((total, file) => total + readFileSync(path.join(projectRoot, file), 'utf8').trim().split(/\r?\n/).length, 0);
  assert.deepEqual(status.knowledge, { chunks: archivedEntries + learningEntries + 9, archivedEntries, learningEntries, totalEntries: archivedEntries + learningEntries });
});


test('腾讯旧212条版本可更新到1213条，暂存和正式服务数量一致且主题初始化脚本经过Nginx核对', { skip: unixOnly }, t => {
  const context = fixture(t, { expandedArchive: true });
  const result = context.execute();
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.match(result.stdout, /chunks=1222 archivedEntries=1213/);
  assert.ok(context.calls().some(call => call.command === 'curl' && call.args.at(-1) === 'http://127.0.0.1/theme-init.js'));
  context.assertPreserved();
});

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { releaseCacheControl } from '../server/http/release-cache.ts';

const script = fileURLToPath(new URL('../scripts/tencent-deploy/install-release-cache-headers.sh', import.meta.url));
const linuxOnly = process.platform !== 'linux' ? '缓存头安装脚本只在 Ubuntu 正式站执行' : false;

test('发布清单和控制器标志禁止共享缓存，带内容哈希的资源沿用原策略', () => {
  assert.equal(releaseCacheControl('/deployment.json'), 'no-store');
  assert.equal(releaseCacheControl('/deployment.json?__agridx_check=1'), 'no-store');
  assert.equal(releaseCacheControl('/deployment-automation.json'), 'no-store');
  assert.equal(releaseCacheControl('/index.html'), 'no-cache');
  assert.equal(releaseCacheControl('/'), 'no-cache');
  assert.equal(releaseCacheControl('/theme-init.js'), 'no-cache');
  assert.equal(releaseCacheControl('/assets/index-abc123.js'), undefined);
});

function nginxFixture(t: { after: (cleanup: () => void) => void }, options: { failTest?: boolean } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'agridx-cache-headers-'));
  const bin = path.join(root, 'bin');
  const confDir = path.join(root, 'nginx');
  const snippetDir = path.join(root, 'snippets');
  const calls = path.join(root, 'calls.jsonl');
  const conf = path.join(confDir, 'agridx.conf');
  mkdirSync(bin);
  mkdirSync(confDir);
  writeFileSync(calls, '');
  const original = [
    'server {',
    '    root /opt/agridx/current/dist;',
    '    proxy_pass http://127.0.0.1:8787;',
    '}',
    '',
  ].join('\n');
  writeFileSync(conf, original);
  const nginx = `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.AGRIDX_CALLS, JSON.stringify(args) + '\\n');
if (args[0] === '-T') {
  process.stdout.write('# configuration file ' + process.env.AGRIDX_CONF + ':\\n');
  process.stdout.write(fs.readFileSync(process.env.AGRIDX_CONF, 'utf8'));
  process.exit(0);
}
if (args[0] === '-t') process.exit(process.env.AGRIDX_NGINX_TEST_FAIL === '1' ? 1 : 0);
if (args[0] === '-s' && args[1] === 'reload') process.exit(0);
process.exit(2);
`;
  writeFileSync(path.join(bin, 'nginx'), nginx);
  chmodSync(path.join(bin, 'nginx'), 0o755);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const run = () => spawnSync('/bin/bash', [script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      AGRIDX_NGINX_SNIPPET_DIR: snippetDir,
      AGRIDX_NGINX_CONF_ROOT: confDir,
      AGRIDX_CONF: conf,
      AGRIDX_CALLS: calls,
      AGRIDX_NGINX_TEST_FAIL: options.failTest ? '1' : '',
    },
  });
  return { conf, original, snippetDir, run, calls: () => readFileSync(calls, 'utf8') };
}

test('缓存头安装只给发布清单加 no-store，nginx -t 失败时恢复原文件', { skip: linuxOnly }, t => {
  const ok = nginxFixture(t);
  const installed = ok.run();
  assert.equal(installed.status, 0, installed.stderr);
  assert.match(readFileSync(ok.conf, 'utf8'), /include .*agridx-release-cache\.conf;/);
  const snippet = readFileSync(path.join(ok.snippetDir, 'agridx-release-cache.conf'), 'utf8');
  assert.match(snippet, /location = \/deployment\.json \{[^}]*add_header Cache-Control "no-store" always;/s);
  assert.match(snippet, /location = \/deployment-automation\.json/);
  assert.doesNotMatch(snippet, /\/assets\//);
  assert.match(ok.calls(), /-s","reload"/);
  const again = ok.run();
  assert.equal(again.status, 0, again.stderr);
  assert.equal(readFileSync(ok.conf, 'utf8').match(/agridx-release-cache\.conf/g)?.length, 1);

  const failed = nginxFixture(t, { failTest: true });
  const result = failed.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(failed.conf, 'utf8'), failed.original);
  assert.match(result.stderr, /已恢复原配置/);
});

test('缓存头安装不改允许目录以外的配置', { skip: linuxOnly }, t => {
  const fixture = nginxFixture(t);
  const outsideDir = mkdtempSync(path.join(os.tmpdir(), 'agridx-outside-nginx-'));
  const outside = path.join(outsideDir, 'agridx.conf');
  const original = 'server {\n    root /opt/agridx/current/dist;\n}\n';
  writeFileSync(outside, original);
  t.after(() => rmSync(outsideDir, { recursive: true, force: true }));
  const run = spawnSync('/bin/bash', [script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${path.join(path.dirname(fixture.conf), '..', 'bin')}:${process.env.PATH}`,
      AGRIDX_NGINX_SNIPPET_DIR: path.join(path.dirname(fixture.conf), '..', 'snippets'),
      AGRIDX_NGINX_CONF_ROOT: path.dirname(fixture.conf),
      AGRIDX_CONF: outside,
      AGRIDX_CALLS: path.join(path.dirname(fixture.conf), '..', 'calls.jsonl'),
    },
  });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(readFileSync(outside, 'utf8'), original);
  assert.match(run.stderr, /不在允许目录/);
});

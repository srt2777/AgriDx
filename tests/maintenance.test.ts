import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateVersionState } from '../scripts/check-version.mjs';
import { assertSyncState, pushArguments } from '../scripts/sync.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

function metadata(version = '3.0.1') {
  return {
    packageJson: { version },
    lockJson: { version, packages: { '': { version } } },
    readme: `当前项目版本：**${version}**。历史版本3.0.0不替换。`,
    changelog: `# 日志\n\n## ${version} — 2026-10-10\n\n修复\n\n## 3.0.0 — 2026-10-10\n`,
  };
}

test('版本元数据一致时允许历史版本继续保留', () => {
  assert.equal(validateVersionState(metadata()), '3.0.1');
});

test('锁文件根版本与当前README、最新日志任一缺失或滞后时拒绝通过', () => {
  const changed = metadata();
  changed.lockJson.packages[''].version = '3.0.0';
  assert.throws(() => validateVersionState(changed), /根包/);
  assert.throws(() => validateVersionState({ ...metadata(), readme: '当前项目版本：**3.0.0**' }), /README/);
  assert.throws(() => validateVersionState({ ...metadata(), changelog: '## 3.0.0 — 2026-10-10' }), /CHANGELOG/);
  assert.throws(() => validateVersionState({ ...metadata(), changelog: '# 没有版本记录' }), /缺失/);
});

test('项目版本拒绝前导零、非稳定版本与非字符串', () => {
  for (const version of ['03.0.1', '3.0.1-rc.1', 'v3.0.1', '3.0', undefined]) {
    assert.throws(() => validateVersionState({ ...metadata(), packageJson: { version } }), /规范/);
  }
});

test('项目版本按整数分段比较，允许3.12.0上限并拒绝所有越界版本', () => {
  for (const version of ['3.3.10', '3.4.9', '3.4.10', '3.7.99', '3.8.0', '3.8.1', '3.8.99', '3.9.0', '3.9.1', '3.9.10', '3.9.99', '3.10.0', '3.10.1', '3.10.2', '3.10.3', '3.10.99', '3.11.0', '3.11.1', '3.11.2', '3.11.99', '3.12.0']) {
    assert.equal(validateVersionState(metadata(version)), version);
  }
  for (const version of ['3.12.1', '3.13.0', '3.100.0', '4.0.0']) {
    assert.throws(() => validateVersionState(metadata(version)), /不得超过 3\.12\.0/);
  }
});

test('同步保护main/master、远端默认分支和detached HEAD', () => {
  for (const branch of ['main', 'master', 'stable']) {
    assert.throws(() => assertSyncState({ branch, status: '', defaultBranch: 'stable' }), /稳定主线/);
  }
  assert.throws(() => assertSyncState({ branch: '', status: '' }), /detached HEAD/);
});

test('同步拒绝未跟踪、工作区修改和已暂存但未提交的文件', () => {
  for (const status of ['?? new.ts\n', ' M tracked.ts\n', 'M  staged.ts\n']) {
    assert.throws(() => assertSyncState({ branch: 'codex/task', status }), /未提交或未跟踪/);
  }
  assert.doesNotThrow(() => assertSyncState({ branch: 'codex/task', status: '' }));
  assert.deepEqual(pushArguments('codex/task'), [
    'push', '--no-follow-tags', '--set-upstream', 'origin', 'HEAD:refs/heads/codex/task',
  ]);
});

function fixture(t: { after: (cleanup: () => void) => void }) {
  const temporaryRoot = path.resolve(os.tmpdir());
  const directory = mkdtempSync(path.join(temporaryRoot, 'agridx-v3-maintenance-'));
  const repo = path.join(directory, 'repo');
  mkdirSync(path.join(repo, 'scripts', 'lib'), { recursive: true });
  for (const name of ['sync.mjs', 'lib/process.mjs']) {
    cpSync(path.join(projectRoot, 'scripts', name), path.join(repo, 'scripts', name));
  }
  t.after(() => {
    // Only remove this fixture's newly created child of the OS temporary directory.
    assert.equal(path.dirname(path.resolve(directory)), temporaryRoot);
    assert.match(path.basename(directory), /^agridx-v3-maintenance-/);
    rmSync(directory, { recursive: true, force: true });
  });
  const git = (...args: string[]) => {
    const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8', shell: false });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    return result.stdout.trim();
  };
  git('init', '--initial-branch=main');
  git('config', 'user.name', 'Maintenance Test');
  git('config', 'user.email', 'maintenance-test@example.invalid');
  writeFileSync(path.join(repo, '.gitignore'), 'ignored.env\n');
  git('add', 'scripts', '.gitignore');
  git('commit', '-m', 'test fixture');
  const execute = () => spawnSync(process.execPath, ['scripts/sync.mjs'], {
    cwd: repo, encoding: 'utf8', shell: false,
  });
  return { directory, repo, git, execute };
}

test('实际Git仓库中的主线、游离状态和未跟踪文件均在推送前拦截', (t) => {
  const { repo, git, execute } = fixture(t);
  let result = execute();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /稳定主线/);
  git('checkout', '--detach');
  result = execute();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /detached HEAD/);
  git('checkout', '-b', 'codex/test');
  writeFileSync(path.join(repo, 'untracked.txt'), 'pending');
  result = execute();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /未提交或未跟踪/);
  assert.equal(git('status', '--porcelain'), '?? untracked.txt');
});

test('从目录链接启动同步脚本仍执行主线保护，而非静默成功退出', (t) => {
  const { directory, repo, git } = fixture(t);
  const alias = path.join(directory, 'alias');
  // The alias stays inside this fixture and targets only its own temporary repository.
  symlinkSync(repo, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const result = spawnSync(process.execPath, [path.join(alias, 'scripts', 'sync.mjs')], {
    cwd: alias, encoding: 'utf8', shell: false,
  });
  assert.equal(result.status, 1, result.stderr || result.error?.message);
  assert.match(result.stderr, /稳定主线/);
  assert.equal(git('status', '--porcelain'), '');
});

test('Windows目录大小写变化不跳过同步入口或误判Git仓库根目录', {
  skip: process.platform !== 'win32',
}, (t) => {
  const { directory, git } = fixture(t);
  const differentlyCasedRepo = path.join(directory, 'REPO');
  const result = spawnSync(process.execPath, [path.join(differentlyCasedRepo, 'scripts', 'sync.mjs')], {
    cwd: differentlyCasedRepo, encoding: 'utf8', shell: false,
  });
  assert.equal(result.status, 1, result.stderr || result.error?.message);
  assert.match(result.stderr, /稳定主线/);
  assert.equal(git('status', '--porcelain'), '');
});

test('Windows短路径启动同步脚本仍正确识别Git根目录并执行主线保护', {
  skip: process.platform !== 'win32',
}, (t) => {
  const { repo, git } = fixture(t);
  const shortPathResult = spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); " +
    "$ErrorActionPreference = 'Stop'; " +
    "$pathProbe = New-Object -ComObject Scripting.FileSystemObject; " +
    "$pathProbe.GetFolder($env:AGRIDX_TEST_REPO).ShortPath",
  ], { env: { ...process.env, AGRIDX_TEST_REPO: repo }, encoding: 'utf8', shell: false });
  assert.equal(shortPathResult.status, 0, shortPathResult.stderr || shortPathResult.error?.message);
  const shortRepo = shortPathResult.stdout.trim();
  assert.ok(shortRepo, 'Windows短路径查询应返回目录');
  if (shortRepo.toLowerCase() === repo.toLowerCase()) {
    t.skip('此Windows卷未提供与原路径不同的8.3短路径');
    return;
  }
  const result = spawnSync(process.execPath, [path.join(shortRepo, 'scripts', 'sync.mjs')], {
    cwd: shortRepo, encoding: 'utf8', shell: false,
  });
  assert.equal(result.status, 1, result.stderr || result.error?.message);
  assert.match(result.stderr, /稳定主线/);
  assert.equal(git('status', '--porcelain'), '');
});

test('实际推送只保存当前分支，即使Git配置followTags也不推标签或主线', (t) => {
  const { directory, repo, git, execute } = fixture(t);
  const remote = path.join(directory, 'remote.git');
  git('init', '--bare', remote);
  git('remote', 'add', 'origin', remote);
  git('checkout', '-b', 'codex/test');
  git('config', 'push.followTags', 'true');
  git('tag', '-a', 'v3.0.1', '-m', 'test tag stays local');
  writeFileSync(path.join(repo, 'ignored.env'), 'local test configuration');
  const result = execute();
  assert.equal(result.status, 0, result.stderr);
  const refs = git('ls-remote', '--heads', '--tags', 'origin');
  assert.match(refs, /refs\/heads\/codex\/test$/);
  assert.doesNotMatch(refs, /refs\/heads\/main|refs\/tags\//);
  assert.equal(git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'), 'origin/codex/test');
  assert.equal(readFileSync(path.join(repo, 'ignored.env'), 'utf8'), 'local test configuration');
});

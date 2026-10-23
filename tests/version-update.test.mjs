import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { nextVersion, updateVersion, parseArguments } from '../scripts/version-update.mjs';
import { validateVersionState } from '../scripts/check-version.mjs';

test('知识扩充和修复均升补丁，功能和不兼容变化受当前上限保护', () => {
  for (const kind of ['knowledge', 'fix', 'maintenance']) assert.equal(nextVersion('3.4.4', kind), '3.4.5');
  assert.equal(nextVersion('3.3.9', 'feature'), '3.4.0');
  assert.equal(nextVersion('3.4.9', 'knowledge'), '3.4.10');
  assert.equal(nextVersion('3.7.9', 'feature'), '3.8.0');
  assert.equal(nextVersion('3.8.0', 'knowledge'), '3.8.1');
  assert.equal(nextVersion('3.8.9', 'feature'), '3.9.0');
  assert.equal(nextVersion('3.9.0', 'knowledge'), '3.9.1');
  assert.equal(nextVersion('3.9.9', 'fix'), '3.9.10');
  assert.equal(nextVersion('3.9.1', 'feature'), '3.10.0');
  assert.equal(nextVersion('3.10.0', 'knowledge'), '3.10.1');
  assert.equal(nextVersion('3.10.1', 'maintenance'), '3.10.2');
  for (const [version, kind] of [['3.12.0', 'knowledge'], ['3.12.0', 'feature'], ['3.9.10', 'breaking'], ['3.4.4', 'breaking']]) assert.throws(() => nextVersion(version, kind), /上限/);
  assert.throws(() => nextVersion('3.4.4', 'unknown'), /类型/);
});

test('整批同步四处版本，预演不写入，重跑不升版，旧批次不能复用', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'agrid-version-'));
  const put = (name, value) => writeFileSync(path.join(directory, name), value);
  const get = name => readFileSync(path.join(directory, name), 'utf8');
  try {
    put('package.json', JSON.stringify({ version: '3.4.4' }));
    put('package-lock.json', JSON.stringify({ version: '3.4.4', packages: { '': { version: '3.4.4' }, dep: { version: '1.0.0' } } }));
    put('README.md', '当前项目版本：**3.4.4**\n历史 3.1.0');
    put('CHANGELOG.md', '# 日志\n\n## 3.4.4 — 2026-10-12\n旧记录');
    const options = { directory, kind: 'knowledge', batch: 'kb-001', summary: '扩充资料', date: new Date('2026-10-12T17:00:00Z') };
    assert.equal(updateVersion({ ...options, dryRun: true }).version, '3.4.5');
    assert.equal(JSON.parse(get('package.json')).version, '3.4.4');
    updateVersion(options);
    assert.equal(JSON.parse(get('package-lock.json')).packages.dep.version, '1.0.0');
    assert.match(get('README.md'), /3.4.5/);
    assert.match(get('CHANGELOG.md'), /3.4.5 — 2026-10-13/);
    assert.match(get('CHANGELOG.md'), /## 3.4.4/);
    for (const title of ['详细改动', '知识库变化', '兼容性', '验证结果', '关联 PR', '部署记录']) {
      assert.ok(get('CHANGELOG.md').includes('### ' + title), title);
    }
    assert.ok(get('CHANGELOG.md').includes('- 未记录'));
    const before = get('CHANGELOG.md');
    assert.equal(updateVersion(options).repeated, true);
    assert.equal(get('CHANGELOG.md'), before);
    assert.throws(() => updateVersion({ ...options, kind: 'feature' }), /类型不能改变/);
    updateVersion({ ...options, batch: 'kb-002' });
    assert.throws(() => updateVersion(options), /旧批次/);
    put('README.md', '当前项目版本：**3.4.0**');
    assert.throws(() => updateVersion({ ...options, batch: 'kb-003' }), /不一致/);
    assert.equal(JSON.parse(get('package.json')).version, '3.4.6');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('参数错误和多行说明拒绝处理', () => {
  assert.throws(() => parseArguments(['--kind', 'knowledge', '--kind', 'fix']), /重复参数/);
  assert.throws(() => parseArguments(['--unknown']), /无效/);
  assert.throws(() => updateVersion({ batch: 'bad/id', summary: '资料' }), /批次/);
  assert.throws(() => updateVersion({ batch: 'kb', summary: 'a\nb' }), /单行/);
});

test('版本检查拦截并行合并造成的重复批次和未同步版本', () => {
  const state = { packageJson: { version: '3.4.5' }, lockJson: { version: '3.4.5', packages: { '': { version: '3.4.5' } } }, readme: '当前项目版本：**3.4.5**', changelog: '## 3.4.5', batches: { schema: 1, batches: [{ id: 'kb-a', version: '3.4.5' }] } };
  assert.equal(validateVersionState(state), '3.4.5');
  state.batches.batches.push({ id: 'kb-a', version: '3.4.5' });
  assert.throws(() => validateVersionState(state), /批次/);
  state.batches.batches = [{ id: 'kb-b', version: '3.4.4' }];
  assert.throws(() => validateVersionState(state), /批次/);
});

test('版本上限按整数分段比较：3.10.0 大于 3.9.x，而非按字符串比较', () => {
  assert.equal(nextVersion('3.9.9', 'knowledge'), '3.9.10');
  assert.equal(nextVersion('3.9.10', 'feature'), '3.10.0');
  assert.equal(nextVersion('3.10.1', 'maintenance'), '3.10.2');
  assert.equal(nextVersion('3.10.2', 'maintenance'), '3.10.3');
  assert.equal(nextVersion('3.10.2', 'feature'), '3.11.0');
  assert.equal(nextVersion('3.11.0', 'maintenance'), '3.11.1');
  assert.equal(nextVersion('3.11.1', 'feature'), '3.12.0');
  assert.throws(() => nextVersion('3.12.0', 'maintenance'), /上限 3\.12\.0/);
  assert.throws(() => nextVersion('3.12.0', 'feature'), /上限 3\.12\.0/);
});

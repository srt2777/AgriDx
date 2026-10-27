import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { parseVersionHistory, readVersionHistory, versionHistoryPlugin } from '../scripts/version-history.mjs';

test('history: integer version order, missing evidence and v2 drafts are preserved independently', () => {
  const data = parseVersionHistory('# 日志\n\n## 3.9.9 — 2026-10-20\n\n- 修复界面。\n\n## 3.10.0 — 2026-10-22\n\n- 新增页面。\n- 更新类型：feature；验证：2项通过。\n\n## 草稿分支 2.2.4 — 2026-10-06\n\n草稿，不发布。\n\n## 2.2.4 — 2026-10-07\n\n正式历史。\n\n## 2.0.0 — 既有版本\n\n保留原记录。', { currentVersion: '3.10.0' });
  assert.deepEqual(data.releases.map(item => item.id), ['3.10.0', '3.9.9', '2.2.4', '2.0.0', 'draft-2.2.4']);
  const missing = data.releases.find(item => item.version === '2.0.0');
  for (const key of ['date', 'kind', 'verification', 'knowledge', 'compatibility', 'deployment']) assert.equal(missing[key], null, key);
  assert.equal(data.releases[0].kind, 'feature');
  assert.equal(data.releases[0].verification, '- 更新类型：feature；验证：2项通过。');
  assert.equal(data.releases[2].legacy, true);
});

test('history: duplicate, missing current, empty content, malformed dates and versions fail before publish', () => {
  const options = { currentVersion: '3.0.0' };
  assert.throws(() => parseVersionHistory('## 3.0.0\n- a\n## 3.0.0\n- b', options), /重复/);
  assert.throws(() => parseVersionHistory('## 3.0.0\n', options), /为空/);
  assert.throws(() => parseVersionHistory('## 3.0.0 — 2026-02-30\n- a', options), /日期无效/);
  assert.throws(() => parseVersionHistory('## 草稿分支 3.0.0\n- a', options), /缺少当前版本/);
  assert.throws(() => parseVersionHistory('## 3.0.0\n- a', { currentVersion: '03.0.0' }), /版本无效/);
  assert.throws(() => parseVersionHistory('## 3.0.0\n- a', { ...options, repository: 'https://evil.test' }), /仓库标识/);
});

test('history: fenced headings do not become releases; explicit evidence and original PR links survive', () => {
  const original = '- 新增知识。\n\n### 兼容性\n- 保留旧接口。\n\n### 验证结果\n- 真实测试通过。\n\n### 部署记录\n- 未部署，合入后发布。\n\n### 关联 PR\n[旧仓库](https://github.com/old-owner/old-repo/pull/4)\n\n```markdown\n## 99.0.0\n这不是版本\n```';
  const data = parseVersionHistory('## 3.0.0 — 2026-10-22\n' + original, { currentVersion: '3.0.0' });
  assert.equal(data.releases.length, 1);
  const entry = data.releases[0];
  assert.equal(entry.details, original);
  assert.equal(entry.compatibility, '- 保留旧接口。');
  assert.equal(entry.deployment, '- 未部署，合入后发布。');
  assert.deepEqual(entry.prs, ['https://github.com/old-owner/old-repo/pull/4']);
});

test('history: real changelog current package, all historical sections and virtual build output agree', () => {
  const data = readVersionHistory();
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  assert.equal(data.currentVersion, pkg.version);
  assert.ok(data.releases.length >= 76);
  assert.equal(data.releases[0].version, pkg.version);
  const historical = data.releases.find(item => item.version === '2.0.0');
  assert.equal(historical.date, null);
  assert.ok(data.releases.some(item => item.draft));
  const plugin = versionHistoryPlugin();
  const id = plugin.resolveId('virtual:agridx-version-history');
  const watched = [];
  const source = plugin.load.call({ addWatchFile: file => watched.push(file) }, id);
  assert.deepEqual(JSON.parse(source.slice('export default '.length, -1)), data);
  assert.equal(watched.length, 4);
  let message;
  plugin.handleHotUpdate({ file: watched[0], server: { ws: { send: value => { message = value; } } } });
  assert.deepEqual(message, { type: 'full-reload' });
});

test('split history reads all files and preserves original release bodies', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const dir = mkdtempSync(path.join(tmpdir(), 'agridx-history-'));
  try {
    mkdirSync(path.join(dir, 'docs/changelog'), { recursive: true });
    const sections = ['## 4.0.0\n- 当前版本\n', '## 草稿分支 3.1.0\n- 草稿\n## 3.0.0\n- 历史\n', '## 2.0.0\n- 更早历史\n'];
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '4.0.0' }));
    ['CHANGELOG.md', 'docs/changelog/3.x.md', 'docs/changelog/2.x.md'].forEach((file, i) => writeFileSync(path.join(dir, file), sections[i]));
    assert.deepEqual(readVersionHistory(dir), parseVersionHistory(sections.join('\n'), { currentVersion: '4.0.0' }));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


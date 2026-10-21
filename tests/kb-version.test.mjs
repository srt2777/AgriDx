import assert from 'node:assert/strict';
import test from 'node:test';
import { checkKbVersion, computeKbState, nextKbVersion, validateKbVersion } from '../scripts/kb-version.mjs';
import { validateLatestChangelog } from '../scripts/check-version.mjs';

test('committed kb-version.json matches knowledge content', () => {
  assert.match(checkKbVersion(), /^20\d{2}\.\d{2}\.\d+$/);
});

test('changed content without a kb_version bump fails', () => {
  const state = computeKbState();
  const record = { kb_version: '2026.10.1', ...state, content_hash: { ...state.content_hash, entries: 'x' } };
  assert.throws(() => validateKbVersion(record, state), /entries/);
  assert.throws(() => validateKbVersion({ ...state, kb_version: '3.7.2' }, state), /YYYY\.MM\.N/);
});

test('kb_version increments within a month and resets on a new month', () => {
  assert.equal(nextKbVersion('2026.10.1', '2026-10-21'), '2026.10.2');
  assert.equal(nextKbVersion('2026.10.4', '2026-11-01'), '2026.11.1');
  assert.equal(nextKbVersion(undefined, '2026-10-21'), '2026.10.1');
});

test('latest changelog section must name batch, update kind and verification', () => {
  const batches = { batches: [{ id: 'b-1', version: '3.7.2' }] };
  const ok = '# log\n\n## 3.7.2 — d\n\n- x\n- 更新类型：maintenance；批次：b-1。验证：通过。\n\n## 3.7.1 — d\n';
  assert.equal(validateLatestChangelog(ok, batches), '3.7.2');
  assert.throws(() => validateLatestChangelog(ok.replace('b-1', 'b-2'), batches), /批次/);
  assert.throws(() => validateLatestChangelog(ok.replace('更新类型：maintenance；', ''), batches), /更新类型/);
  assert.throws(() => validateLatestChangelog(ok.replace('验证：通过。', ''), batches), /验证/);
});

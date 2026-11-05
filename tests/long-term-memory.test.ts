import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemoryStore, MemoryError, LONG_TERM_MAX_PER_DEVICE } from '../server/memory/store';
import { memoryPrompt } from '../server/memory/context';

const profile = { name: '1号拖拉机', machineType: '拖拉机', brand: '纽荷兰', model: 'WORKMASTER25', hours: 260, notes: '' };
const FACT = '热车后难启动，每周至少复现一次';

function setup() {
  const store = new MemoryStore(':memory:');
  const device = store.saveDevice('a', profile);
  const one = store.createSession('a', device.id);
  const two = store.createSession('a', device.id);
  return { store, device, one, two };
}

test('T1/T2: long-term entries are always user_reported and reject bad kinds or lengths', () => {
  const { store, device, one } = setup();
  try {
    const entry = store.recordLongTermObservation('a', device.id, one.id, 'fault_pattern', FACT);
    assert.equal(entry.source, 'user_reported');
    assert.equal(entry.status, 'candidate');
    assert.equal(entry.confirmations, 1);
    for (const bad of [
      () => store.recordLongTermObservation('a', device.id, one.id, 'manual_fact', FACT),
      () => store.recordLongTermObservation('a', device.id, one.id, 'fault_pattern', '太短'),
      () => store.recordLongTermObservation('a', device.id, one.id, 'fault_pattern', 'x'.repeat(1001)),
    ]) assert.throws(bad, (e) => e instanceof MemoryError && e.status === 400);
  } finally { store.close(); }
});

test('T3: cross-owner and cross-device long-term access is rejected', () => {
  const { store, device, one } = setup();
  try {
    const other = store.saveDevice('a', { ...profile, name: '2号拖拉机' });
    const otherSession = store.createSession('a', other.id);
    assert.throws(() => store.longTerm('b', device.id), /不存在/);
    assert.throws(() => store.recordLongTermObservation('b', device.id, one.id, 'fault_pattern', FACT), /不存在/);
    assert.throws(() => store.recordLongTermObservation('a', device.id, otherSession.id, 'fault_pattern', FACT), /不存在/);
    assert.throws(() => store.recordLongTermObservation('a', other.id, one.id, 'fault_pattern', FACT), /不存在/);
  } finally { store.close(); }
});

test('T4/T5: same-session repeats do not promote; a second distinct session does; repeats are idempotent', () => {
  const { store, device, one, two } = setup();
  try {
    const first = store.recordLongTermObservation('a', device.id, one.id, 'fault_pattern', `  ${FACT}  `);
    const repeat = store.recordLongTermObservation('a', device.id, one.id, 'fault_pattern', FACT);
    assert.equal(repeat.id, first.id);
    assert.equal(repeat.status, 'candidate');
    assert.equal(repeat.confirmations, 1);
    assert.equal(store.longTerm('a', device.id).length, 1);
    const promoted = store.recordLongTermObservation('a', device.id, two.id, 'fault_pattern', FACT);
    assert.equal(promoted.id, first.id);
    assert.equal(promoted.status, 'promoted');
    assert.equal(promoted.confirmations, 2);
    assert.deepEqual(promoted.evidenceSessions, [one.id, two.id]);
  } finally { store.close(); }
});

test('T6: per-device long-term capacity rejects new distinct content at 50 active entries', () => {
  const { store, device, one } = setup();
  try {
    for (let i = 0; i < LONG_TERM_MAX_PER_DEVICE; i++) {
      store.recordLongTermObservation('a', device.id, one.id, 'device_fact', `设备事实编号${i}内容`);
    }
    assert.equal(store.longTerm('a', device.id).length, LONG_TERM_MAX_PER_DEVICE);
    assert.throws(() => store.recordLongTermObservation('a', device.id, one.id, 'device_fact', '超出上限的新事实内容'),
      (e) => e instanceof MemoryError && e.code === 'memory_limit');
    // Re-confirming an existing entry is not new content and must still work at capacity.
    const again = store.recordLongTermObservation('a', device.id, one.id, 'device_fact', '设备事实编号0内容');
    assert.equal(again.status, 'candidate');
  } finally { store.close(); }
});

test('T7: prune drops stale candidates and demotes long-unconfirmed promoted entries only', () => {
  const { store, device, one, two } = setup();
  try {
    const old = new Date('2026-01-01T00:00:00.000Z').toISOString();
    const promoted = store.recordLongTermObservation('a', device.id, one.id, 'fault_pattern', FACT, { now: old });
    store.recordLongTermObservation('a', device.id, two.id, 'fault_pattern', FACT, { now: old });
    assert.equal(store.longTerm('a', device.id).find((e) => e.id === promoted.id)?.status, 'promoted');
    const candidate = store.recordLongTermObservation('a', device.id, one.id, 'device_fact', '一直未再确认的设备事实', { now: old });
    const fresh = store.recordLongTermObservation('a', device.id, one.id, 'device_fact', '最近新记录的设备事实');
    const result = store.pruneLongTerm('a', device.id, '2026-08-01T00:00:00.000Z');
    assert.deepEqual(result, { demoted: 1, dropped: 1 });
    const remaining = store.longTerm('a', device.id);
    assert.equal(remaining.find((e) => e.id === promoted.id)?.status, 'stale');
    assert.equal(remaining.find((e) => e.id === candidate.id), undefined);
    assert.ok(remaining.find((e) => e.id === fresh.id));
  } finally { store.close(); }
});

test('T8: superseding marks the old entry and restarts confirmation for the new one', () => {
  const { store, device, one, two } = setup();
  try {
    const oldEntry = store.recordLongTermObservation('a', device.id, one.id, 'fault_pattern', FACT);
    store.recordLongTermObservation('a', device.id, two.id, 'fault_pattern', FACT);
    const replacement = store.recordLongTermObservation('a', device.id, one.id, 'fault_pattern', '冷车启动也困难，每周复现', { supersedesId: oldEntry.id });
    assert.equal(replacement.status, 'candidate');
    const oldAfter = store.longTerm('a', device.id).find((e) => e.id === oldEntry.id)!;
    assert.equal(oldAfter.status, 'superseded');
    assert.equal(oldAfter.supersededBy, replacement.id);
    assert.throws(() => store.recordLongTermObservation('a', device.id, one.id, 'fault_pattern', '另一条新内容', { supersedesId: oldEntry.id }),
      (e) => e instanceof MemoryError && e.status === 409);
  } finally { store.close(); }
});

test('T9/T10: device identity change demotes promoted entries; clearing a session keeps long-term; deleting a device cascades', () => {
  const { store, device, one, two } = setup();
  try {
    const entry = store.recordLongTermObservation('a', device.id, one.id, 'fault_pattern', FACT);
    store.recordLongTermObservation('a', device.id, two.id, 'fault_pattern', FACT);
    assert.equal(entry.status, 'candidate');
    store.saveDevice('a', { ...profile, model: 'WORKMASTER25S' }, device.id);
    const after = store.longTerm('a', device.id).find((e) => e.id === entry.id)!;
    assert.equal(after.status, 'stale');
    assert.equal(after.reason, 'device_identity_changed');
    // Re-promote on the corrected identity, then clear one session: long-term survives.
    const again = store.recordLongTermObservation('a', device.id, one.id, 'fault_pattern', FACT);
    assert.equal(again.status, 'candidate');
    store.clearSession('a', one.id, store.session('a', one.id).revision);
    // Clearing a session keeps long-term entries: the stale original plus the new candidate.
    assert.equal(store.longTerm('a', device.id).length, 2);
    store.deleteDevice('a', device.id);
    assert.throws(() => store.longTerm('a', device.id), /不存在/);
  } finally { store.close(); }
});

test('T11: prompt includes only promoted entries, bounded to five, always labelled user-reported pending verification', () => {
  const { store, device, one, two } = setup();
  try {
    const promoted: string[] = [];
    for (let i = 0; i < 7; i++) {
      const content = `复现故障模式编号${i}内容`;
      store.recordLongTermObservation('a', device.id, one.id, 'fault_pattern', content);
      store.recordLongTermObservation('a', device.id, two.id, 'fault_pattern', content);
      promoted.push(content);
    }
    store.recordLongTermObservation('a', device.id, one.id, 'fault_pattern', '仅候选、尚未晋升的故障模式');
    store.demoteLongTerm('a', device.id, store.longTerm('a', device.id).find((e) => e.content === promoted[0])!.id, 'outdated');
    const session = store.session('a', one.id);
    const prompt = memoryPrompt(session, [], store.longTerm('a', device.id));
    assert.match(prompt, /待核实/);
    assert.ok(!prompt.includes('仅候选、尚未晋升的故障模式'));
    assert.ok(!prompt.includes(promoted[0]));
    // Five promoted entries remain visible at most (one of seven was demoted, so six promoted -> five shown).
    const shown = promoted.slice(1).filter((c) => prompt.includes(c));
    assert.equal(shown.length, 5);
    assert.ok(!prompt.includes('已验证事实') || prompt.includes('不是已验证事实'));
  } finally { store.close(); }
});

test('demote rejects bad reasons and terminal entries', () => {
  const { store, device, one } = setup();
  try {
    const entry = store.recordLongTermObservation('a', device.id, one.id, 'fault_pattern', FACT);
    assert.throws(() => store.demoteLongTerm('a', device.id, entry.id, 'nope'), (e) => e instanceof MemoryError && e.status === 400);
    const demoted = store.demoteLongTerm('a', device.id, entry.id, 'corrected');
    assert.equal(demoted.status, 'demoted');
    assert.equal(demoted.reason, 'corrected');
    assert.throws(() => store.demoteLongTerm('a', device.id, entry.id, 'other'), (e) => e instanceof MemoryError && e.status === 409);
  } finally { store.close(); }
});

test('long-term entries persist across database reopen', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agridx-longterm-'));
  const filename = path.join(dir, 'memory.sqlite');
  let store = new MemoryStore(filename);
  try {
    const device = store.saveDevice('owner-a', profile);
    const s1 = store.createSession('owner-a', device.id);
    const s2 = store.createSession('owner-a', device.id);
    store.recordLongTermObservation('owner-a', device.id, s1.id, 'fault_pattern', FACT);
    store.recordLongTermObservation('owner-a', device.id, s2.id, 'fault_pattern', FACT);
    store.close(); store = new MemoryStore(filename);
    const entries = store.longTerm('owner-a', device.id);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].status, 'promoted');
    assert.equal(entries[0].confirmations, 2);
  } finally { store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

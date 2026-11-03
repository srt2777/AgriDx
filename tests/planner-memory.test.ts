import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createPlan, reducePlan } from '../agent/planner';
import { MemoryError, MemoryStore, type PlannerCheckpoint } from '../server/memory/store';

const profile = { name: '1号拖拉机', machineType: '拖拉机', brand: '东方红', model: 'LF1504', hours: null, notes: '' };
const state = () => createPlan({ planId: 'plan-1', episodeId: 'episode-1', scope: { model: 'LF1504' }, steps: [
  { key: 'battery', title: '电瓶检查记录', kind: 'ask_user', dependsOn: [], preconditions: [],
    expectedObservation: { slot: 'battery', label: '电瓶检查结果' }, evidenceIds: [], discriminationValue: 1, cost: 1 },
] });
const checkpoint = (sessionId: string, deviceId: string): PlannerCheckpoint => ({ sessionId, deviceId, topicKey: '水温过高', state: state() });

test('checkpoint commits atomically with transcript, survives reopen and stays private', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'planner-memory-'));
  const filename = path.join(dir, 'memory.sqlite');
  let store = new MemoryStore(filename);
  try {
    const device = store.saveDevice('a', profile), session = store.createSession('a', device.id);
    const record = checkpoint(session.id, device.id);
    store.appendTurn('a', session.id, 0, '水温过高', { content: '请描述检查记录' }, [], { checkpoint: record, previous: null });
    store.close(); store = new MemoryStore(filename);
    assert.deepEqual(store.plannerCheckpoint('a', session.id), record);
    assert.equal(store.session('a', session.id).revision, 1);
    assert.ok(!JSON.stringify(store.session('a', session.id)).includes('_plannerCheckpoint'));
    assert.throws(() => store.plannerCheckpoint('b', session.id), (error) => error instanceof MemoryError && error.status === 404);
    assert.throws(() => store.appendTurn('a', session.id, 0, '过期', { content: '过期' }, [], { checkpoint: record, previous: null }), /已更新/);
    assert.equal(store.session('a', session.id).messages.length, 2);
  } finally { store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('legacy messages do not erase checkpoint, explicit tombstone and clear do', () => {
  const store = new MemoryStore(':memory:');
  try {
    const device = store.saveDevice('a', profile), session = store.createSession('a', device.id), record = checkpoint(session.id, device.id);
    store.appendTurn('a', session.id, 0, '问题', { content: '回答' }, [], { checkpoint: record, previous: null });
    store.appendTurn('a', session.id, 1, '旧版消息', { content: '旧版回答' });
    assert.deepEqual(store.plannerCheckpoint('a', session.id), record);
    store.appendTurn('a', session.id, 2, '换话题', { content: '好的' }, [], { checkpoint: null, previous: { episodeId: record.state.episodeId, planVersion: record.state.planVersion } });
    assert.equal(store.plannerCheckpoint('a', session.id), undefined);
    store.clearSession('a', session.id, 3);
    assert.equal(store.plannerCheckpoint('a', session.id), undefined);
  } finally { store.close(); }
});

test('plan compare-and-save rejects stale versions, wrong device and stale device revisions', () => {
  const store = new MemoryStore(':memory:');
  try {
    const device = store.saveDevice('a', profile), session = store.createSession('a', device.id), record = checkpoint(session.id, device.id);
    store.appendTurn('a', session.id, 0, '问题', { content: '回答' }, [], { checkpoint: record, previous: null });
    const advanced = { ...record, state: reducePlan(record.state, { type: 'observation', id: 'feedback-1', episodeId: 'episode-1', stepKey: 'battery', value: 'normal', source: 'user_report' }) };
    assert.throws(() => store.appendTurn('a', session.id, 1, '检查了', { content: '继续' }, [], { checkpoint: advanced, previous: null }), /诊断计划已更新/);
    assert.throws(() => store.appendTurn('a', session.id, 1, '检查了', { content: '继续' }, [], { checkpoint: { ...advanced, deviceId: 'wrong' }, previous: { episodeId: 'episode-1', planVersion: 1 } }), /格式无效/);
    store.appendTurn('a', session.id, 1, '检查了', { content: '继续' }, [], { checkpoint: advanced, previous: { episodeId: 'episode-1', planVersion: 1 } });
    assert.throws(() => store.appendTurn('a', session.id, 2, '过期', { content: '过期' }, [], { checkpoint: record, previous: { episodeId: 'episode-1', planVersion: advanced.state.planVersion } }), /版本无效/);
    store.saveDevice('a', { ...profile, model: '另一型号' }, device.id);
    assert.throws(() => store.appendTurn('a', session.id, 2, '旧车', { content: '旧车' }), /已更新/);
    assert.equal(store.session('a', session.id).messages.length, 4);
  } finally { store.close(); }
});

test('feedback event resolves original user message after independent revision changes without leaking IDs', () => {
  const store = new MemoryStore(':memory:');
  try {
    const device = store.saveDevice('a', profile), session = store.createSession('a', device.id), record = checkpoint(session.id, device.id);
    store.appendTurn('a', session.id, 0, '水温过高', { content: '请提供检查结果' }, [], { checkpoint: record, previous: null });
    store.updateProgress('a', session.id, 1, '单独修改进度');
    const feedback = reducePlan(record.state, { type: 'observation', id: 'turn-2', episodeId: 'episode-1', stepKey: 'battery', value: 'normal', source: 'user_report' });
    store.appendTurn('a', session.id, 2, '电瓶已经检查，结果正常', { content: '收到' }, [],
      { checkpoint: { ...record, state: feedback }, previous: { episodeId: 'episode-1', planVersion: record.state.planVersion } });
    assert.equal(store.plannerTurnEvidence('a', session.id, feedback.observations.battery.eventId)?.content, '电瓶已经检查，结果正常');
    assert.equal(store.plannerTurnEvidence('a', session.id, 'turn-1'), undefined);
    assert.throws(() => store.plannerTurnEvidence('b', session.id, 'turn-2'), (error) => error instanceof MemoryError && error.status === 404);
    const second = store.createSession('a', device.id);
    assert.equal(store.plannerTurnEvidence('a', second.id, 'turn-2'), undefined);
    assert.ok(!JSON.stringify(store.session('a', session.id)).includes('_plannerTurnEventId'));
  } finally { store.close(); }
});

test('corrupt checkpoint is rejected rather than treated as absent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'planner-corrupt-'));
  const filename = path.join(dir, 'memory.sqlite');
  const store = new MemoryStore(filename);
  try {
    const device = store.saveDevice('a', profile), session = store.createSession('a', device.id), record = checkpoint(session.id, device.id);
    store.appendTurn('a', session.id, 0, '问题', { content: '回答' }, [], { checkpoint: record, previous: null });
    const raw = new DatabaseSync(filename);
    try { raw.prepare("UPDATE memory_messages SET payload = json_set(payload, '$._plannerCheckpoint.state.scopeKey', 'corrupt') WHERE json_extract(payload, '$.role') = 'assistant'").run(); }
    finally { raw.close(); }
    // A corrupt scope key cannot pass restore checks even if JSON is syntactically valid.
    assert.throws(() => store.plannerCheckpoint('a', session.id), /无法安全恢复/);
  } finally { store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

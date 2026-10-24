import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PreviewMemoryStore } from '../src/dev-preview/memory';
import { MemoryError } from '../../shared/memory-validation';

function setup() {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const store = new PreviewMemoryStore(storage);
  const device = store.saveDevice({ name: '1号车', machineType: '拖拉机', brand: '纽荷兰', model: 'WORKMASTER25', hours: 120, notes: '用户报告' });
  const session = store.createSession(device.id);
  return { store, storage, device, session };
}
test('browser preview memory persists a complete conversation and progress across reconstruction', () => {
  const { store, storage, session } = setup();
  const reply = store.appendTurn(session.id, 0, '无法启动', { content: '候选资料', provider: 'knowledge-base' }, []);
  store.update(session.id, reply.revision, '已检查电瓶，待核实');
  const restored = new PreviewMemoryStore(storage).session(session.id);
  assert.equal(restored.messages.length, 2); assert.equal(restored.progress, '已检查电瓶，待核实');
  assert.equal(restored.device.hours, 120);
});
test('browser preview clearing and device corrections reject stale answers; deleting a device cascades', () => {
  const { store, device, session } = setup();
  store.update(session.id, 0, '', true);
  assert.throws(() => store.appendTurn(session.id, 0, '迟到', { content: '旧答复' }, []), (e: unknown) => e instanceof MemoryError && e.status === 409);
  const current = store.session(session.id);
  store.saveDevice({ ...device, model: '另一型号' }, device.id);
  assert.throws(() => store.appendTurn(session.id, current.revision, '迟到', { content: '旧答复' }, []), MemoryError);
  store.deleteDevice(device.id);
  assert.deepEqual(store.overview(), { devices: [], sessions: [] });
  assert.throws(() => store.session(session.id), (e: unknown) => e instanceof MemoryError && e.status === 404);
});
test('browser storage failures leave existing records untouched and are never reported as saved', () => {
  const { store, storage, session } = setup();
  const blocked = new PreviewMemoryStore({ ...storage, setItem: () => { throw new Error('QuotaExceeded'); } });
  assert.throws(() => blocked.appendTurn(session.id, 0, '问题', { content: '答复' }, []), /QuotaExceeded/);
  assert.equal(store.session(session.id).revision, 0); assert.equal(store.session(session.id).messages.length, 0);
});
test('preview retrieves only relevant user checks for the same device and excludes assistant speculation', () => {
  const { store, device, session } = setup();
  const first = store.appendTurn(session.id, 0, '热车无法启动', { content: '可能是喷油器坏了，未验证' }, []);
  store.update(session.id, first.revision, '电瓶已检查，用户报告正常');
  const next = store.createSession(device.id);
  const other = store.saveDevice({ ...device, name: '另一台' });
  assert.equal(store.priorReports(other.id, next.id, '热车无法启动').length, 0);
  const reports = store.priorReports(device.id, next.id, '又出现热车无法启动');
  assert.equal(reports.length, 1); assert.match(reports[0].progress, /电瓶/);
  assert.doesNotMatch(JSON.stringify(reports), /喷油器/);
});

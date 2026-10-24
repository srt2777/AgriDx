import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canAutoReload, canAutoReloadUrl, hasUnsavedProfile, registerUpdateGuard, subscribeUpdateSafety } from '../src/features/updates/update-safety';

test('knowledge browsing reloads but unmounted protected routes and administrator pages do not', () => {
  assert.equal(canAutoReload('/knowledge'), true);
  assert.equal(canAutoReload('/'), true);
  for (const route of ['/chat', '/models', '/developer', '/unknown']) assert.equal(canAutoReload(route), false);
});

test('unsaved and busy page guards defer updates until cleared, then notify without user confirmation', () => {
  let changes = 0;
  const unsubscribe = subscribeUpdateSafety(() => { changes++; });
  const removeBusy = registerUpdateGuard('request', '/chat', true);
  const removeSafe = registerUpdateGuard('saved', '/chat', false);
  assert.equal(canAutoReload('/chat'), false);
  assert.equal(canAutoReload('/knowledge'), true);
  removeBusy();
  assert.equal(canAutoReload('/chat'), true);
  removeSafe();
  assert.equal(canAutoReload('/chat'), false);
  assert.equal(changes, 4);
  unsubscribe();
});

test('live hash routing protects navigation into a not-yet-mounted diagnosis or model page', () => {
  assert.equal(canAutoReloadUrl('https://agridx.test/?__agridx_build=x#/knowledge?model=LX1004'), true);
  assert.equal(canAutoReloadUrl('https://agridx.test/#/chat'), false);
  assert.equal(canAutoReloadUrl('https://agridx.test/#/models'), false);
  assert.equal(canAutoReloadUrl('not a URL'), false);
});

test('saved populated device profiles are safe while each edited field is protected', () => {
  const saved = { name: '1号拖拉机', machineType: '拖拉机', brand: '东方红', model: 'LX1004', hours: 300, notes: '用户提供的保养记录' };
  assert.equal(hasUnsavedProfile({ ...saved }, saved), false);
  for (const key of ['name', 'machineType', 'brand', 'model', 'hours', 'notes'] as const) {
    assert.equal(hasUnsavedProfile({ ...saved, [key]: key === 'hours' ? 301 : '已修改' }, saved), true, key);
  }
  assert.equal(hasUnsavedProfile({ name: '我的设备', machineType: '', brand: '', model: '', hours: null, notes: '' }), false);
  assert.equal(hasUnsavedProfile({ ...saved }), true);
});

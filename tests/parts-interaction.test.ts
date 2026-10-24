import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { bindPartFocusInterrupt, createPartGesture, isPartTap, partFocusDistance, partListIndex, partOutlines, restorePartFocus } from '../src/components/parts-tractor/parts-interaction';
import { partVisual } from '../src/components/parts-tractor/parts-motion';

test('mobile/coarse input defaults to no outline while an explicit local choice wins', () => {
  assert.equal(partOutlines(true, false, null), false);
  assert.equal(partOutlines(false, true, null), false);
  assert.equal(partOutlines(false, false, null), true);
  assert.equal(partOutlines(true, true, true), true);
  assert.equal(partOutlines(false, false, false), false);
  for (const presentation of ['solid', 'isolate', 'xray'] as const) {
    const visual = partVisual({ partId: 'battery_box', selected: true, hovered: true, hasSelection: true, presentation, faultPartId: null, outlineEnabled: false });
    assert.equal(visual.outline, false, presentation);
    assert.equal(visual.opacity, 1, 'disabling outlines must retain the selected part');
  }
  const fault = partVisual({ partId: 'battery_box', selected: true, hovered: false, hasSelection: true, presentation: 'solid', faultPartId: 'battery_box', outlineEnabled: false });
  assert.equal(fault.outline, false); assert.equal(fault.pulse, true);
});

test('tap filtering rejects drag, pan and secondary pointers without blocking small touch movement', () => {
  assert.equal(isPartTap(0, 0), true);
  assert.equal(isPartTap(5, 0), true);
  for (const movement of [5.1, 20, -1, NaN, Infinity]) assert.equal(isPartTap(movement, 0), false);
  assert.equal(isPartTap(0, 2), false);
  assert.equal(isPartTap(0, 0, false), false);
});

test('portrait focus fits the horizontal view, keeps a minimum distance, and handles invalid bounds', () => {
  const portrait = partFocusDistance(1, 38, .5, .32), landscape = partFocusDistance(1, 38, 1.6, .32);
  assert.ok(portrait > landscape);
  const horizontalHalf = Math.atan(Math.tan(38 * Math.PI / 360) * .5);
  assert.ok(portrait * Math.sin(horizontalHalf) > 1);
  assert.equal(partFocusDistance(0, 38, .5, 2.4), 2.4);
  for (const invalid of [NaN, Infinity, -1, 0]) assert.ok(Number.isFinite(partFocusDistance(invalid, invalid, invalid, .32)));
  assert.equal(partFocusDistance(1e9, 38, .5, .32), 80);
});

test('gesture primary status comes from pointerdown, rejects cancellation and resets for the next touch', () => {
  const gesture = createPartGesture();
  gesture.start(true); assert.equal(gesture.accepts(0, 0), true);
  gesture.start(false); assert.equal(gesture.accepts(0, 0), false);
  gesture.start(true); assert.equal(gesture.accepts(12, 0), false);
  gesture.cancel(); assert.equal(gesture.accepts(0, 0), false);
  gesture.start(true); assert.equal(gesture.accepts(1, 0), true);
});

test('manual orbit interrupts active focus and unmount removes the controls listener', () => {
  const controls = new THREE.EventDispatcher<{ start: object }>();
  const transition = { active: true };
  const cleanup = bindPartFocusInterrupt(controls, transition);
  controls.dispatchEvent({ type: 'start' }); assert.equal(transition.active, false);
  transition.active = true; cleanup();
  controls.dispatchEvent({ type: 'start' }); assert.equal(transition.active, true);
});

test('part list arrows and endpoints work without hijacking Enter, Space or inputs', () => {
  assert.equal(partListIndex(0, 14, 'ArrowUp'), 0);
  assert.equal(partListIndex(0, 14, 'ArrowDown'), 1);
  assert.equal(partListIndex(13, 14, 'ArrowRight'), 13);
  assert.equal(partListIndex(13, 14, 'ArrowLeft'), 12);
  assert.equal(partListIndex(5, 14, 'Home'), 0);
  assert.equal(partListIndex(5, 14, 'End'), 13);
  assert.equal(partListIndex(-1, 14, 'ArrowDown'), 0);
  for (const key of ['Enter', ' ', 'Tab', 'Escape']) assert.equal(partListIndex(2, 14, key), null);
  assert.equal(partListIndex(0, 0, 'Home'), null);
});

test('closing details restores a connected launcher or the current 2D part when the launcher disappeared', () => {
  let launcherCalls = 0, fallbackCalls = 0;
  const launcher = { isConnected: true, disabled: false, focus: () => launcherCalls++ };
  const fallback = { isConnected: true, focus: () => fallbackCalls++ };
  assert.equal(restorePartFocus(launcher, fallback), true); assert.equal(launcherCalls, 1);
  launcher.isConnected = false;
  assert.equal(restorePartFocus(launcher, fallback), true); assert.equal(fallbackCalls, 1);
  launcher.isConnected = true; launcher.disabled = true;
  assert.equal(restorePartFocus(launcher, fallback), true); assert.equal(fallbackCalls, 2);
  fallback.isConnected = false;
  assert.equal(restorePartFocus(null, fallback), false);
});

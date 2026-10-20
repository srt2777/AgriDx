import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PRESS_SELECTOR,
  TILT_SELECTOR,
  TOOLTIP_DELAY_MS,
  countFrame,
  isTypingTarget,
  typingElement,
  pointerTilt,
  scrollProgress,
  shortcutRows,
  shortcutToggleKey,
  tiltAllowed,
  tiltAmount,
  tooltipPlacement,
} from '../src/lib/delight';

test('玻璃卡片只在细指针且未减少动态时倾斜，宽面板保持平整', () => {
  assert.equal(tiltAllowed({ fine: true, reduced: false }), true);
  assert.equal(tiltAllowed({ fine: false, reduced: false }), false);
  assert.equal(tiltAllowed({ fine: true, reduced: true }), false);
  assert.equal(tiltAmount(280), 4.5);
  assert.equal(tiltAmount(520), 2.5);
  assert.equal(tiltAmount(900), 0);
  const tilt = pointerTilt({ left: 0, top: 0, width: 200, height: 100 }, 200, 0);
  assert.ok(tilt);
  assert.equal(tilt.y, 4.5);
  assert.equal(tilt.x, 4.5);
  assert.equal(pointerTilt({ left: 0, top: 0, width: 800, height: 200 }, 100, 40), null);
  assert.match(TILT_SELECTOR, /\.hall-card/);
  assert.match(PRESS_SELECTOR, /\.expo-start-button/);
  assert.match(PRESS_SELECTOR, /glass-button:not\(\.glass-secondary\)/);
});

test('阅读进度、数字跳动、提示和问号快捷键', () => {
  assert.equal(scrollProgress(0, 400, 400), 0);
  assert.equal(scrollProgress(50, 250, 150), 0.5);
  assert.equal(scrollProgress(200, 250, 150), 1);
  assert.equal(countFrame(10, 0, 900, false), 0);
  assert.equal(countFrame(10, 900, 900, false), 10);
  assert.equal(countFrame(10, 0, 900, true), 10);
  assert.ok(TOOLTIP_DELAY_MS >= 200 && TOOLTIP_DELAY_MS <= 500);
  const place = tooltipPlacement({ left: 100, top: 80, width: 40, height: 20 }, { width: 80, height: 24 }, { width: 400, height: 300 });
  assert.equal(place.above, true);
  assert.ok(place.top < 80);
  assert.equal(shortcutToggleKey({ key: '?', metaKey: false, ctrlKey: false, altKey: false }), true);
  assert.equal(shortcutToggleKey({ key: '？', metaKey: false, ctrlKey: false, altKey: false }), true);
  assert.equal(shortcutToggleKey({ key: '?', metaKey: true, ctrlKey: false, altKey: false }), false);
  assert.equal(shortcutToggleKey({ key: 'k', metaKey: false, ctrlKey: false, altKey: false }), false);
  assert.equal(typingElement('INPUT', false), true);
  assert.equal(typingElement('DIV', true), true);
  assert.equal(typingElement('BUTTON', false), false);
  assert.equal(isTypingTarget(null), false);
  const zh = shortcutRows('zh');
  assert.equal(zh[0]?.keys, '?');
  assert.match(zh.map((row) => row.keys).join(' '), /Ctrl K/);
  assert.match(zh.map((row) => row.label).join(' '), /快速前往/);
  assert.equal(shortcutRows('en').some((row) => row.keys === '/'), true);
});

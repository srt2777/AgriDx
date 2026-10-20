import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  TOOLTIP_DELAY_MS,
  countFrame,
  isTypingTarget,
  scrollProgress,
  shortcutRows,
  shortcutToggleKey,
  typingElement,
  tooltipPlacement,
} from '../src/lib/delight';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('克制后不再保留跟手倾斜、扫描线和磁吸光标', () => {
  const files = [
    'src/components/delight.css',
    'src/components/NewVersionDelight.tsx',
    'src/new-version-polish.css',
    'src/pages/HallPage/hall.css',
    'src/pages/HallPage/HallPage.tsx',
    'src/components/NewVersionShell.tsx',
    'src/pages/ExhibitionPage/ExhibitionPage.tsx',
  ].map((file) => readFileSync(path.join(root, file), 'utf8')).join('\n');
  assert.equal(files.includes('is-tilting'), false);
  assert.equal(files.includes('hall-scan'), false);
  assert.equal(files.includes('pointer-glow'), false);
  assert.equal(files.includes('MagneticPointer'), false);
  assert.equal(files.includes('hall-marker-pulse'), false);
  assert.equal(files.includes('class="magnetic"') || files.includes(' magnetic'), false);
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

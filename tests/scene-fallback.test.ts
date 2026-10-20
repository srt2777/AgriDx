import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { sceneFallbackCopy } from '../src/lib/scene-fallback-copy';
import { MOTION, easeOutCubic, frameEase, motionTokenCss, rateFor } from '../src/lib/motion-tokens';
import { probeWebGL } from '../src/lib/webgl';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('运动时长只定义一次，样式和三维缓动都引用它', () => {
  const css = motionTokenCss();
  assert.match(css, new RegExp(`--motion-enter:\\s*${MOTION.ms.enter}ms`));
  assert.match(css, new RegExp(`--motion-ease-out:\\s*${MOTION.ease.out.replace(/[().]/g, '\\$&')}`));
  assert.equal(rateFor(MOTION.ms.enter), 3000 / MOTION.ms.enter);
  assert.equal(frameEase(rateFor(MOTION.ms.enter), 0.05, true), 1);
  assert.equal(easeOutCubic(0), 0);
  assert.equal(easeOutCubic(1), 1);
  const hall = readFileSync(path.join(root, 'src/pages/HallPage/hall.css'), 'utf8');
  const polish = readFileSync(path.join(root, 'src/new-version-polish.css'), 'utf8');
  assert.match(hall, /var\(--motion-enter/);
  assert.match(polish, /var\(--motion-rise/);
});

test('没有 WebGL 时探测失败，静态示意仍说明展区可用', () => {
  assert.equal(probeWebGL(), false);
  const lost = sceneFallbackCopy('hall', 'lost', 'zh');
  const missing = sceneFallbackCopy('campus', 'unsupported', 'zh');
  assert.match(lost.note, /静态示意/);
  assert.match(lost.note, /展区导航/);
  assert.match(missing.note, /WebGL/);
  assert.match(missing.title, /园区/);
});

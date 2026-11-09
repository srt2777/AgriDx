import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('新版聚光只跟指针写 CSS 变量，粗指针和减少动态不启用，且不打开五项高级动效', () => {
  const hook = read('../src/components/motion/useCardSpotlight.ts');
  const css = read('../src/components/motion/card-spotlight.css');
  const flag = read('../src/components/motion/flag.ts');
  const host = read('../src/components/motion/CardSpotlight.tsx');
  assert.match(flag, /PREMIUM_MOTION_ENABLED = false/);
  assert.match(hook, /requestAnimationFrame/);
  assert.match(hook, /pointermove/);
  assert.match(hook, /pointerType !== 'mouse'/);
  assert.match(hook, /event\.pointerType &&/);
  assert.match(hook, /\(pointer: coarse\)/);
  assert.match(hook, /!coarse\.matches/);
  assert.match(hook, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(hook, /useState\(/);
  assert.match(hook, /--spot-x/);
  assert.match(hook, /--spot-y/);
  assert.match(css, /radial-gradient/);
  assert.match(css, /mask-composite: exclude/);
  assert.match(css, /pointer-events: none/);
  assert.match(css, /\(pointer: coarse\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(host, /bindCardSpotlight\(document\)/);
  assert.match(read('../src/app.tsx'), /<CardSpotlight \/>/);
});

test('旧版章节边缘淡出不监听滚动，不挡住点击，手机高度单独收束', () => {
  const css = read('../src/pages/HomePage/home-stage.css');
  const page = read('../src/pages/HomePage/HomePage.tsx');
  const stage = read('../src/pages/HomePage/HomeStage.tsx');
  assert.match(css, /pointer-events: none/);
  assert.match(css, /backdrop-filter: blur\(12px\)/);
  assert.match(css, /position: sticky/);
  assert.match(css, /bottom: 46svh/);
  assert.match(css, /@media \(max-width: 390px\)/);
  assert.match(css, /height: 28px/);
  assert.match(css, /height: 24px/);
  assert.doesNotMatch(page, /addEventListener\('scroll'/);
  assert.match(stage, /addEventListener\('scroll', schedule, \{ passive: true \}\)/);
  assert.match(read('../src/lib/page-loaders.ts'), /classic: \(\) => import\('@\/pages\/HomePage\/HomePage'\)/);
});

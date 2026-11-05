import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SCROLL_COUNT_MS, scrollCountFrame } from '../src/lib/scroll-count';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

test('count-up eases out once and respects reduced motion', () => {
  assert.ok(SCROLL_COUNT_MS >= 1200 && SCROLL_COUNT_MS <= 1400);
  assert.equal(scrollCountFrame(100, 0, false), 0);
  assert.equal(scrollCountFrame(100, SCROLL_COUNT_MS, false), 100);
  assert.equal(scrollCountFrame(100, SCROLL_COUNT_MS / 2, false) > 50, true);
  assert.equal(scrollCountFrame(80, 0, true), 80);
  assert.equal(scrollCountFrame(Number.NaN, 10, false), 0);
});

test('spring glass stays off the premium-motion flag and keeps reduced motion', () => {
  const flag = read('src/components/motion/flag.ts');
  const css = read('src/spring-glass.css');
  const home = read('src/pages/HomePage/HomePage.tsx');
  const workbench = read('src/pages/WorkbenchPage/WorkbenchPage.tsx');
  const stage = read('src/pages/HomePage/home-stage.css');
  const choreography = read('src/pages/HomePage/home-stage.ts');
  assert.match(flag, /PREMIUM_MOTION_ENABLED = false/);
  assert.match(css, /backdrop-filter: blur\(16px\) saturate\(1\.45\)/);
  assert.match(css, /translate3d\(130%, 0, 0\)/);
  assert.match(css, /scale\(0\.97\)/);
  assert.match(css, /cubic-bezier\(0\.34, 1\.56, 0\.64, 1\)/);
  assert.match(css, /font-variant-numeric: tabular-nums/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(home, /IntersectionObserver/);
  assert.match(workbench, /IntersectionObserver/);
  assert.doesNotMatch(workbench, /scrollTo\(/);
  assert.doesNotMatch(home, /scroll-behavior|preventDefault\(\)/);
  assert.match(stage, /translate3d\(0, 14px, 0\)/);
  assert.match(stage, /90ms/);
  assert.match(stage, /cubic-bezier\(0\.16, 1, 0\.3, 1\)/);
  assert.match(choreography, /export function scrollProgress/);
  assert.doesNotMatch(choreography, /chapter-line|IntersectionObserver/);
});

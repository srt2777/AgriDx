import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = read('../src/components/motion/premium-motion.css');
const hall = read('../src/pages/HallPage/HallPage.tsx');
const studio = read('../src/components/parts-tractor/PartsStudio.tsx');
const chat = read('../src/pages/ChatPage/ChatPage.tsx');
const campus = read('../src/pages/ExhibitionPage/ExhibitionPage.tsx');
const fallback = read('../src/components/SceneFallback.tsx');

test('premium motion respects reduced motion and keeps the five patterns', () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\.glass-press::after/);
  assert.match(css, /border-beam-spin/);
  assert.match(css, /orb-search/);
  assert.match(css, /orb-solve-core/);
  assert.match(css, /\.spring-drawer-scrim/);
  assert.match(css, /animation: none !important/);
});

test('新版 surfaces wire the five animations into real flows', () => {
  assert.match(campus, /expo-start-button glass-press/);
  assert.match(campus, /expo-zone-card is-beamed/);
  assert.match(campus, /beam/);
  assert.match(hall, /SpringDrawer/);
  assert.match(hall, /is-beamed/);
  assert.match(hall, /glass-press/);
  assert.match(studio, /MorphingPanel/);
  assert.match(studio, /TiltCard/);
  assert.match(studio, /BorderBeam/);
  assert.match(studio, /TwinQuery/);
  assert.match(chat, /ThinkingOrbs/);
  assert.match(chat, /MorphingPanel/);
  assert.match(chat, /useDiagnosisOrb/);
  assert.match(fallback, /ThinkingOrbs/);
  assert.doesNotMatch(fallback, /scene-fallback-ring/);
});

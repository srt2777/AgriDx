import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = read('../src/components/motion/premium-motion.css');
const flag = read('../src/components/motion/flag.ts');
const hall = read('../src/pages/HallPage/HallPage.tsx');
const studio = read('../src/components/parts-tractor/PartsStudio.tsx');
const chat = read('../src/pages/ChatPage/ChatPage.tsx');
const campus = read('../src/pages/ExhibitionPage/ExhibitionPage.tsx');
const fallback = read('../src/components/SceneFallback.tsx');
const shell = read('../src/ui/WorkspaceShell.tsx');
const beam = read('../src/components/motion/BorderBeam.tsx');
const tilt = read('../src/components/motion/TiltCard.tsx');
const drawer = read('../src/components/motion/SpringDrawer.tsx');
const morph = read('../src/components/motion/MorphingPanel.tsx');
const orbs = read('../src/components/motion/ThinkingOrbs.tsx');

test('premium motion code stays and defaults off behind one flag', () => {
  assert.match(flag, /PREMIUM_MOTION_ENABLED = false/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\.glass-press::after/);
  assert.match(css, /border-beam-spin/);
  assert.match(css, /orb-search/);
  assert.match(css, /orb-solve-core/);
  assert.match(css, /\.spring-drawer-scrim/);
  assert.match(css, /animation: none !important/);
  assert.match(beam, /if \(!PREMIUM_MOTION_ENABLED\) return null/);
  assert.match(tilt, /if \(!PREMIUM_MOTION_ENABLED\) return <>\{children\}<\/>/);
  assert.match(drawer, /if \(!PREMIUM_MOTION_ENABLED\)/);
  assert.match(drawer, /<aside className=\{className\} aria-labelledby=\{labelledBy\}>/);
  assert.match(morph, /if \(!PREMIUM_MOTION_ENABLED\) return <>\{children\}<\/>/);
  assert.match(orbs, /if \(!PREMIUM_MOTION_ENABLED\) return null/);
});

test('layout rules that change the studio only apply when the flag is on', () => {
  assert.match(css, /\[data-premium-motion='on'\] \.parts-studio \{ overflow-x: clip; \}/);
  assert.match(css, /\[data-premium-motion='on'\] \.parts-studio \.parts-drawer/);
  assert.doesNotMatch(css, /^(\s*)\.parts-studio \{ overflow-x: clip; \}/m);
});

test('新版 surfaces keep the five animations behind the flag and restore the quiet UI', () => {
  for (const source of [campus, hall, studio, chat, fallback]) {
    assert.match(source, /PREMIUM_MOTION_ENABLED/);
  }
  assert.doesNotMatch(shell, /glass-press|from ['"]framer-motion['"]/);
  assert.match(campus, /expo-start-button glass-press/);
  assert.match(campus, /expo-zone-card is-beamed/);
  assert.match(hall, /SpringDrawer/);
  assert.match(hall, /is-beamed/);
  assert.match(studio, /MorphingPanel/);
  assert.match(studio, /TiltCard/);
  assert.match(studio, /parts-detail/);
  assert.match(chat, /ThinkingOrbs/);
  assert.match(chat, /useDiagnosisOrb/);
  assert.match(chat, /minLoadingMs: version === 'new' && PREMIUM_MOTION_ENABLED \? 900 : 0/);
  assert.match(fallback, /ThinkingOrbs/);
  assert.match(fallback, /scene-fallback-ring/);
});

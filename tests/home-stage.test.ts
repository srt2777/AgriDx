import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  DESKTOP_BEATS,
  MOBILE_BEATS,
  damp,
  presentPose,
  sampleBeats,
  scrollIndex,
  smoothstep,
  stageIndex,
} from '../src/pages/HomePage/home-stage.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('滚动关键帧按 smoothstep 插值，手机步数更少、横向位移更小', () => {
  assert.equal(smoothstep(0), 0);
  assert.equal(smoothstep(1), 1);
  assert.ok(smoothstep(0.25) < 0.25);
  assert.equal(sampleBeats(DESKTOP_BEATS, 0).focus, null);
  assert.equal(sampleBeats(DESKTOP_BEATS, 0).turn, DESKTOP_BEATS[0].pose.turn);
  const mid = sampleBeats(DESKTOP_BEATS, 0.25);
  const eased = smoothstep(0.25);
  const from = DESKTOP_BEATS[0].pose;
  const to = DESKTOP_BEATS[1].pose;
  assert.ok(Math.abs(mid.x - (from.x + (to.x - from.x) * eased)) < 1e-9);
  assert.equal(sampleBeats(DESKTOP_BEATS, 2).focus, 'body_shell');
  assert.equal(sampleBeats(DESKTOP_BEATS, 3).focus, 'gps_antenna');
  assert.equal(sampleBeats(DESKTOP_BEATS, 7).explode, 0.72);
  assert.equal(sampleBeats(DESKTOP_BEATS, 8).explode, 0);
  assert.ok(MOBILE_BEATS.length < DESKTOP_BEATS.length);
  const desktopShift = Math.max(...DESKTOP_BEATS.map(beat => Math.abs(beat.pose.x)));
  const mobileShift = Math.max(...MOBILE_BEATS.map(beat => Math.abs(beat.pose.x)));
  assert.ok(mobileShift < desktopShift);
  assert.ok(mobileShift < 0.2);
});

test('滚动索引、短列表映射、阻尼和减少动效', () => {
  assert.equal(scrollIndex([100, 300, 500], 0, 200), 0);
  const between = scrollIndex([100, 300, 500], 100, 200);
  assert.ok(Math.abs(between - 0.42) < 1e-9);
  assert.equal(scrollIndex([100, 300, 500], 1000, 200), 2);
  assert.equal(stageIndex(0, 9, 9), 0);
  assert.equal(stageIndex(8, 9, 4), 3);
  assert.equal(damp(0, 10, 0, 5), 0);
  assert.ok(damp(0, 10, 0.5, 8) > 4);
  const reduced = presentPose(DESKTOP_BEATS[0].pose, true);
  assert.equal(reduced.turn, 0);
  assert.equal(reduced.explode, 0);
  assert.equal(reduced.scale, DESKTOP_BEATS[0].pose.scale);
  const exploded = presentPose(DESKTOP_BEATS[7].pose, true);
  assert.equal(exploded.explode, 0);
  assert.equal(presentPose(DESKTOP_BEATS[7].pose, false).explode, 0.72);
});

test('旧版首页只有一个固定舞台，T70 仍走工坊 Meshopt 与照片色', () => {
  const hero = read('../src/pages/HomePage/sections/HeroSection.tsx');
  const page = read('../src/pages/HomePage/HomePage.tsx');
  const stage = read('../src/pages/HomePage/HomeStage.tsx');
  const loader = read('../src/components/parts-tractor/load-parts-tractor.ts');
  assert.equal(hero.includes('TractorViewer'), false);
  assert.match(hero, /鸿鹄 T70/);
  assert.match(page, /lazy\(\(\) => import\('\.\/HomeStage'\)\)/);
  assert.match(page, /home-immersive/);
  assert.match(stage, /loadPartsTractor\(HONGHU_T70_PARTS_URL/);
  assert.match(stage, /frameloop="demand"/);
  assert.match(stage, /visibilitychange/);
  assert.match(stage, /prefers-reduced-motion/);
  assert.match(stage, /setFrameloop\(document\.hidden \? 'never' : 'demand'\)/);
  assert.match(loader, /paint\.vertexColors = false/);
  assert.match(loader, /loader\.setMeshoptDecoder\(MeshoptDecoder\)/);
  for (const id of ['hero', 'capabilities', 'painpoints', 'knowledge', 'techroute', 'scenarios', 'details', 'closing']) {
    assert.match(`${page}\n${hero}\n${read('../src/pages/HomePage/sections/PainPointsSection.tsx')}\n${read('../src/components/KnowledgeCoverage.tsx')}\n${read('../src/pages/HomePage/sections/TechRouteSection.tsx')}\n\n${read('../src/pages/HomePage/sections/ScenariosSection.tsx')}\n${read('../src/pages/HomePage/sections/ClosingSection.tsx')}`, new RegExp(`data-home-beat="${id}"`));
  }
});

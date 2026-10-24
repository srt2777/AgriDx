import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CAMPUS_INTRO_MS, CAMPUS_TITLE_REVEAL_MS, campusIntroPlan } from '../src/pages/ExhibitionPage/intro-timing';
import { MOTION } from '../src/lib/motion-tokens';

test('新版园区开场约五秒，减少动态时不播放', () => {
  const play = campusIntroPlan(false);
  assert.equal(play.play, true);
  assert.equal(play.holdMs, CAMPUS_INTRO_MS);
  assert.equal(play.holdMs, 4800);
  assert.equal(play.titleMs, CAMPUS_TITLE_REVEAL_MS);
  assert.ok(play.titleMs < play.holdMs);
  assert.ok(MOTION.ms.cinematic < play.holdMs);
  assert.ok(MOTION.ms.cinematic > 2000);
  assert.deepEqual(campusIntroPlan(true), { play: false, holdMs: 0, titleMs: 0 });
});

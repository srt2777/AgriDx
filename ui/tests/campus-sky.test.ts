import assert from 'node:assert/strict';
import { test } from 'node:test';
import { campusPeriod, campusSky, shanghaiHour, type CampusSky } from '../src/pages/ExhibitionPage/campus-sky';

function channels(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

function assertBlueTeal(hex: string, label: string) {
  const [red, green, blue] = channels(hex);
  assert.ok(blue + 8 >= red, `${label} ${hex} lets red lead`);
  assert.ok(blue + 24 >= green, `${label} ${hex} leaves the teal range`);
}

function assertFrame(sky: CampusSky, label: string) {
  for (const key of ['fog', 'top', 'horizon', 'sun'] as const) assertBlueTeal(sky[key], `${label} ${key}`);
}

test('园区天空停在青蓝里，黎明黄昏只在地平线加一点暖边', () => {
  assert.equal(campusPeriod(2), 'night');
  assert.equal(campusPeriod(6.5), 'dawn');
  assert.equal(campusPeriod(12), 'day');
  assert.equal(campusPeriod(18), 'dusk');
  assert.equal(shanghaiHour(new Date('2026-10-21T06:30:00+08:00')), 6.5);

  for (const theme of ['dark', 'light'] as const) {
    for (const hour of [2, 6.5, 12, 18]) assertFrame(campusSky(theme, hour), `${theme} ${hour}`);
  }

  const dawn = campusSky('dark', 6.5);
  const night = campusSky('dark', 2);
  const noon = campusSky('dark', 12);
  const dusk = campusSky('dark', 18);
  assert.equal(night.glowAmount, 0);
  assert.equal(noon.glowAmount, 0);
  assert.ok(dawn.glowAmount > 0.2 && dawn.glowAmount < 0.55);
  assert.ok(dusk.glowAmount > 0.2 && dusk.glowAmount < 0.45);
  const [glowRed, , glowBlue] = channels(dawn.glow);
  assert.ok(glowRed > glowBlue);
  assert.notEqual(dawn.fog, '#2c241c');
  assert.notEqual(dawn.top, '#4a3424');
  assert.ok(channels(dawn.horizon)[2] > channels(dawn.horizon)[0]);
});

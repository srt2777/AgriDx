import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { resolveSignallingUrl, streamStatusText } from '../src/pages/HomePage/sections/pixel-streaming.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('像素流信令地址：空表示未接入，ws/wss 通过，其他协议与脏格式判失败', () => {
  assert.deepEqual(resolveSignallingUrl(undefined), { url: null, problem: null });
  assert.deepEqual(resolveSignallingUrl('  '), { url: null, problem: null });
  assert.deepEqual(resolveSignallingUrl('wss://stream.example.invalid:443'), {
    url: 'wss://stream.example.invalid:443',
    problem: null,
  });
  assert.deepEqual(resolveSignallingUrl('ws://127.0.0.1:80'), { url: 'ws://127.0.0.1:80', problem: null });
  assert.deepEqual(resolveSignallingUrl('https://stream.example.invalid'), { url: null, problem: 'unsupported-scheme' });
  assert.deepEqual(resolveSignallingUrl('not a url'), { url: null, problem: 'invalid-url' });
  assert.equal(streamStatusText('unconfigured', 'zh'), '像素流未接入');
  assert.equal(streamStatusText('failed', 'zh'), '连接失败');
  assert.equal(streamStatusText('connected', 'en'), 'Connected');
});

test('回落 T70 零件：与 parts.json 的 14 个零件一致，且不含柴油内件', () => {
  const parts = JSON.parse(read('../public/models/t70-parts/parts.json')).parts as { name: string; label_zh: string }[];
  const expected = [
    'battery_box', 'body_shell', 'gps_antenna',
    'hub_fl', 'hub_fr', 'hub_rl', 'hub_rr',
    'roof_cap', 'sensor_roof_l', 'sensor_roof_r',
    'wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr',
  ];
  assert.equal(parts.length, 14);
  assert.deepEqual(parts.map(part => part.name).sort(), [...expected].sort());
  for (const forbidden of ['engine', 'gearbox', 'pto', 'hydraulic_lift', 'clutch', 'fuel_tank']) {
    assert.ok(!parts.some(part => part.name === forbidden), `T70 must not contain ${forbidden}`);
  }
  const hero = read('../src/pages/HomePage/sections/PixelStreamHero.tsx');
  assert.match(hero, /lib-pixelstreamingfrontend-ue5\.6/);
  assert.match(hero, /VITE_PIXEL_STREAMING_URL/);
  assert.match(hero, /像素流未接入/);
  const scene = read('../src/pages/HomePage/sections/T70FallbackScene.tsx');
  assert.match(scene, /loadPartsTractor\(HONGHU_T70_PARTS_URL/);
  assert.match(scene, /catalogByName\(name, 't70'\)/);
  assert.doesNotMatch(scene, /DepthOfField/);
  const home = read('../src/pages/HomePage/HomePage.tsx');
  assert.match(home, /PixelStreamHero/);
  assert.doesNotMatch(home, /<HomeStage/);
  const plan = read('../docs/deployment/unreal-pixel-streaming-plan.md');
  assert.match(plan, /不含虚幻工程文件/);
  assert.match(plan, /VITE_PIXEL_STREAMING_URL/);
});

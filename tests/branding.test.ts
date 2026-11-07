import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import content from '../src/data/content';
import { notFoundCopy } from '../src/lib/command-routes';

test('page metadata, public introductions and unavailable pages use the same product name', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const metadata = JSON.parse(readFileSync(new URL('../metadata.json', import.meta.url), 'utf8'));
  assert.match(html, /<title>司稼/);
  assert.match(metadata.name, /^司稼/);
  assert.match(content.HERO.desc.zh, /司稼/);
  assert.match(content.HERO.desc.en, /Sijia/);
  assert.equal(notFoundCopy('zh').kicker, '司稼');
  assert.equal(notFoundCopy('en').kicker, 'SIJIA');
  assert.doesNotMatch([html, metadata.name, content.HERO.desc.zh, content.HERO.desc.en].join('\n'), /耕知|耘诊|Gengzhi|Yunzhen/i);
});

test('schematic model uses the current scene name while retaining its original attribution', () => {
  const file = readFileSync(new URL('../public/models/tractor-detailed-v1.glb', import.meta.url));
  const jsonLength = file.readUInt32LE(12);
  const gltf = JSON.parse(file.subarray(20, 20 + jsonLength).toString('utf8'));
  assert.equal(gltf.scenes[0].name, 'Sijia schematic tractor');
  assert.equal(gltf.scenes[0].extras.creator, 'AgriDx-v2');
});

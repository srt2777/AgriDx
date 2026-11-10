import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ENGINE_PALETTES } from '../src/pages/KnowledgePage/knowledge-engine-renderer';
import { palette, paletteLight } from '../src/pages/KnowledgePage/taxonomy-graph-layout';

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(index => {
    const value = Number.parseInt(hex.slice(index, index + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

test('经典图谱浅色底是暖纸面、标签深色可读，深色保持原有深底', () => {
  assert.equal(ENGINE_PALETTES.light.background, '#f7f2e7');
  assert.equal(ENGINE_PALETTES.dark.background, '#0e1211');
  assert.ok(luminance(ENGINE_PALETTES.light.labelText) < luminance(ENGINE_PALETTES.light.background), '浅色标签文字应比纸面深');
  assert.ok(luminance(ENGINE_PALETTES.dark.labelText) > luminance(ENGINE_PALETTES.dark.background), '深色标签文字应比深底浅');
  assert.ok(luminance(ENGINE_PALETTES.light.labelChip) > luminance(ENGINE_PALETTES.light.background), '浅色标签底应比纸面略浅');
});

test('浅色/深色调色板在背景、连线、标签上均不同', () => {
  for (const key of Object.keys(ENGINE_PALETTES.light) as (keyof typeof ENGINE_PALETTES.light)[]) {
    assert.notEqual(ENGINE_PALETTES.light[key], ENGINE_PALETTES.dark[key], `${key} 应随主题变化`);
  }
});

test('关系图浅色调色板与原调色板同序同色相、但更深，在纸面上可读', () => {
  assert.equal(paletteLight.length, palette.length, '浅色调色板长度应与原调色板一致');
  for (let index = 0; index < palette.length; index++) {
    assert.ok(luminance(paletteLight[index]!) < luminance(palette[index]!), `浅色 ${paletteLight[index]} 应比原色 ${palette[index]} 更深`);
    assert.ok(luminance(paletteLight[index]!) < luminance('#f7f2e7'), `浅色 ${paletteLight[index]} 应比纸面深`);
  }
});

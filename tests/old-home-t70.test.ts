import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const hero = read('../src/pages/HomePage/sections/HeroSection.tsx');
const model = read('../src/components/TractorModel.tsx');
const info = read('../src/components/tractor-model-info.ts');
const loader = read('../src/components/parts-tractor/load-parts-tractor.ts');

test('旧版首页换成鸿鹄 T70 Meshopt 模型，并沿用工坊的解码与顶点色处理', () => {
  assert.match(info, /models\/t70-parts\/t70_parts_meshopt\.glb/);
  assert.match(hero, /modelUrl=\{HONGHU_T70_PARTS_URL\}/);
  assert.match(hero, /lazy\(\(\) => import\('@\/components\/TractorViewer'\)\)/);
  assert.match(model, /three\/examples\/jsm\/libs\/meshopt_decoder\.module\.js/);
  assert.match(model, /loader\.setMeshoptDecoder\(MeshoptDecoder\)/);
  assert.match(model, /await MeshoptDecoder\.ready/);
  assert.match(model, /copy\.vertexColors = false/);
  assert.match(loader, /paint\.vertexColors = false/);
  assert.match(loader, /loader\.setMeshoptDecoder\(MeshoptDecoder\)/);
});

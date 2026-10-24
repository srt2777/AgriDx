import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('旧版首页鸿鹄 T70 由沉浸舞台加载，解码与顶点色仍与工坊一致', () => {
  const info = read('../src/components/tractor-model-info.ts');
  const stage = read('../src/pages/HomePage/HomeStage.tsx');
  const model = read('../src/components/TractorModel.tsx');
  const loader = read('../src/components/parts-tractor/load-parts-tractor.ts');
  assert.match(info, /models\/t70-parts\/t70_parts_meshopt\.glb/);
  assert.match(stage, /loadPartsTractor\(HONGHU_T70_PARTS_URL/);
  assert.match(stage, /catalogByName\(name, 't70'\)/);
  assert.match(model, /three\/examples\/jsm\/libs\/meshopt_decoder\.module\.js/);
  assert.match(model, /loader\.setMeshoptDecoder\(MeshoptDecoder\)/);
  assert.match(model, /await MeshoptDecoder\.ready/);
  assert.match(model, /copy\.vertexColors = false/);
  assert.match(loader, /paint\.vertexColors = false/);
  assert.match(loader, /loader\.setMeshoptDecoder\(MeshoptDecoder\)/);
});

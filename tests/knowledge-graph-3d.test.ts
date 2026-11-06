import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildForceGraphData,
  findGraphNode,
  labelVisible,
  levelColor,
  nodeSize,
  LABEL_NODE_LIMIT,
  MAX_INITIAL_NODES,
  MAX_TOTAL_NODES,
  type ForceGraphData,
} from '../src/pages/KnowledgePage/knowledge-graph-3d-data';
import type { TaxonomyNode } from '../src/pages/KnowledgePage/knowledge-taxonomy-data';

function node(id: string, label: string, level: TaxonomyNode['level'], parent: string | undefined, count: number): TaxonomyNode {
  return { id, label, level, parent, order: 0, count, query: { brand: 'a' } };
}

/** Small brand → model → component → part tree plus a second brand. */
function fixture(): TaxonomyNode[] {
  return [
    node('["a"]', '品牌A', 'brand', undefined, 10),
    node('["a","a1"]', '机型A1', 'model', '["a"]', 8),
    node('["a","a1","c1"]', '部件C1', 'component', '["a","a1"]', 5),
    node('["a","a1","c1","p1"]', '零件P1', 'part', '["a","a1","c1"]', 2),
    node('["a","a1","c1","p2"]', '零件P2', 'part', '["a","a1","c1"]', 1),
    node('["a","a1","c2"]', '部件C2', 'component', '["a","a1"]', 3),
    node('["b"]', '品牌B', 'brand', undefined, 4),
    node('["b","b1"]', '机型B1', 'model', '["b"]', 3),
  ];
}

function assertLinksValid(data: ForceGraphData) {
  const ids = new Set(data.nodes.map(item => item.id));
  assert.equal(ids.size, data.nodes.length, '节点 id 不可重复');
  for (const link of data.links) {
    assert.ok(ids.has(link.source), `连线起点 ${link.source} 必须存在`);
    assert.ok(ids.has(link.target), `连线终点 ${link.target} 必须存在`);
  }
}

test('初始视图只显示品牌与机型聚合层，连线完整且不改动输入', () => {
  const nodes = fixture();
  const original = structuredClone(nodes);
  const data = buildForceGraphData(nodes);
  assert.deepEqual(data.nodes.map(item => item.level).sort(), ['brand', 'brand', 'model', 'model']);
  assert.equal(data.links.length, 2);
  assertLinksValid(data);
  assert.equal(data.truncated, false);
  assert.equal(data.omitted, 0);
  assert.equal(data.totalAvailable, nodes.length);
  assert.deepEqual(nodes, original);
});

test('初始节点数受上限保护，超限时截断并报告省略数', () => {
  const many: TaxonomyNode[] = Array.from({ length: 300 }, (_, i) => node(`["b${i}"]`, `品牌${i}`, 'brand', undefined, 1));
  const data = buildForceGraphData(many, { maxInitialNodes: 10 });
  assert.equal(data.nodes.length, 10);
  assert.equal(data.truncated, true);
  assert.equal(data.omitted, 290);
});

test('展开机型加入其部件，展开部件加入其零件，父链始终保留', () => {
  const nodes = fixture();
  const expanded = buildForceGraphData(nodes, { expandedIds: ['["a","a1"]'] });
  assert.ok(expanded.nodes.some(item => item.id === '["a","a1","c1"]'));
  assert.ok(expanded.nodes.some(item => item.id === '["a","a1","c2"]'));
  assert.ok(!expanded.nodes.some(item => item.level === 'part'));
  assertLinksValid(expanded);
  const deeper = buildForceGraphData(nodes, { expandedIds: ['["a","a1"]', '["a","a1","c1"]'] });
  assert.ok(deeper.nodes.some(item => item.id === '["a","a1","c1","p1"]'));
  assert.ok(deeper.nodes.some(item => item.id === '["a","a1","c1","p2"]'));
  assertLinksValid(deeper);
});

test('展开受总节点上限保护，超限时截断并保留已展开部分', () => {
  const nodes = fixture();
  const data = buildForceGraphData(nodes, { expandedIds: ['["a","a1"]', '["a","a1","c1"]'], maxTotalNodes: 6 });
  assert.equal(data.nodes.length, 6);
  assert.equal(data.truncated, true);
  assert.ok(data.omitted > 0);
  assertLinksValid(data);
});

test('空目录得到空图，不截断', () => {
  const data = buildForceGraphData([]);
  assert.deepEqual(data, { nodes: [], links: [], truncated: false, omitted: 0, totalAvailable: 0 });
});

test('层级颜色互不相同，节点尺寸按层级递减且随条数微增', () => {
  const colors = new Set(['brand', 'model', 'component', 'part'].map(level => levelColor(level as TaxonomyNode['level'])));
  assert.equal(colors.size, 4);
  for (const color of colors) assert.match(color, /^#[0-9a-f]{6}$/);
  const data = buildForceGraphData(fixture(), { expandedIds: ['["a","a1"]', '["a","a1","c1"]'] });
  const byId = new Map(data.nodes.map(item => [item.id, item]));
  const brand = byId.get('["a"]')!;
  const model = byId.get('["a","a1"]')!;
  const component = byId.get('["a","a1","c1"]')!;
  const part = byId.get('["a","a1","c1","p1"]')!;
  assert.ok(nodeSize(brand) > nodeSize(model));
  assert.ok(nodeSize(model) > nodeSize(component));
  assert.ok(nodeSize(component) > nodeSize(part));
  assert.ok(nodeSize({ ...model, count: 100 }) > nodeSize(model));
  assert.equal(model.color, levelColor('model'));
});

test('标签可见规则：品牌与机型始终显示，深层节点只在节点较少时显示', () => {
  const data = buildForceGraphData(fixture(), { expandedIds: ['["a","a1"]', '["a","a1","c1"]'] });
  const byId = new Map(data.nodes.map(item => [item.id, item]));
  assert.equal(labelVisible(byId.get('["a"]')!, data.nodes.length), true);
  assert.equal(labelVisible(byId.get('["a","a1"]')!, data.nodes.length), true);
  assert.equal(labelVisible(byId.get('["a","a1","c1"]')!, data.nodes.length), true);
  assert.equal(labelVisible(byId.get('["a","a1","c1","p1"]')!, LABEL_NODE_LIMIT + 1), false);
  assert.equal(labelVisible(byId.get('["a","a1","c1","p1"]')!, LABEL_NODE_LIMIT), true);
});

test('findGraphNode 按 id 查找，未找到返回 undefined', () => {
  const data = buildForceGraphData(fixture());
  assert.equal(findGraphNode(data, '["b","b1"]')?.label, '机型B1');
  assert.equal(findGraphNode(data, '不存在'), undefined);
});

test('默认上限覆盖真实规模：品牌加机型 168 个节点在初始上限内', () => {
  assert.ok(168 <= MAX_INITIAL_NODES, `168 <= ${MAX_INITIAL_NODES}`);
  assert.ok(MAX_INITIAL_NODES < MAX_TOTAL_NODES);
  assert.ok(MAX_TOTAL_NODES <= 600, '总上限 600，避免一次渲染数千节点');
});

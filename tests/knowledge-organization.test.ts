import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getKnowledgeCatalog, loadKnowledgeCatalog } from '../server/knowledge/catalog';
import { parseKnowledgeCatalog } from '../src/features/knowledge/catalog-api';
import { learningTaxonomy } from '../src/pages/KnowledgePage/knowledge-learning-graph';
import { learningNetwork } from '../src/pages/KnowledgePage/knowledge-engine-model';
import type { LibraryKind } from '../shared/knowledge-catalog';

const catalog = loadKnowledgeCatalog();
const organization = catalog.organization!;

test('三类整理互不重叠并逐页覆盖原始知识编号和用途', () => {
  const ids = new Set<string>();
  for (const kind of ['archive', 'general', 'terminology'] as const) {
    const first = getKnowledgeCatalog({ kind }).library!;
    assert.equal(first.total, organization.counts[kind]);
    for (let page = 1; page <= Math.ceil(first.total / first.pageSize); page++) {
      const library = getKnowledgeCatalog({ kind, page: String(page) }).library!;
      for (const entry of library.entries) {
        assert.ok(!ids.has(entry.entryId), `duplicate ${entry.entryId}`);
        ids.add(entry.entryId);
        if (kind === 'archive') assert.equal(entry.collection, 'archive');
        else {
          assert.equal(entry.collection, 'learning');
          if (entry.collection === 'learning') {
            assert.equal(entry.diagnosticEvidence, false);
            assert.equal(entry.learningKind === 'terminology', kind === 'terminology');
          }
        }
      }
    }
  }
  assert.equal(ids.size, catalog.totals.entries);
  assert.equal(organization.counts.archive, catalog.totals.archivedEntries);
  assert.equal(organization.counts.general + organization.counts.terminology, catalog.totals.learningEntries);
});

test('每个学习主题及归档类型都能准确筛选并保留现有来源类别', () => {
  for (const topic of organization.topics) {
    const page = getKnowledgeCatalog({ kind: topic.kind, topic: topic.name }).library!;
    assert.equal(page.total, topic.count, topic.name);
    assert.ok(page.entries.every(entry => entry.collection === 'learning' && entry.topic === topic.name &&
      (entry.learningKind === 'terminology') === (topic.kind === 'terminology')));
  }
  for (const type of organization.archiveTypes) {
    const page = getKnowledgeCatalog({ kind: 'archive', entryType: type.name }).library!;
    assert.equal(page.total, type.count, type.name);
    assert.ok(page.entries.every(entry => entry.collection === 'archive' && entry.entryType === type.name));
  }
  const topic = organization.topics.find(item => item.kind === 'general')!;
  assert.equal(getKnowledgeCatalog({ collection: 'archive', kind: 'general' }).library!.total, 0);
  assert.equal(getKnowledgeCatalog({ kind: 'general', topic: topic.name, role: 'cause' }).library!.total, 0);
  assert.equal(getKnowledgeCatalog({ kind: 'archive', topic: topic.name }).library!.total, 0);
  assert.equal(getKnowledgeCatalog({ kind: 'general', topic: '不存在的学习主题' }).library!.total, 0);
});

test('主题图谱与已有主题一一对应，仅创建归属边和原目录查询', () => {
  const before = structuredClone(organization);
  const nodes = learningTaxonomy(organization, { general: '通用原理', terminology: '农业术语' });
  assert.equal(nodes.length, organization.topics.length + 2);
  assert.equal(new Set(nodes.map(node => node.id)).size, nodes.length);
  const roots = nodes.filter(node => !node.parent), byId = new Map(nodes.map(node => [node.id, node]));
  assert.equal(roots.length, 2);
  assert.equal(roots.reduce((sum, root) => sum + root.count, 0), catalog.totals.learningEntries);
  for (const node of nodes.filter(node => node.parent)) {
    const parent = byId.get(node.parent!)!;
    assert.equal(parent.query.kind, node.query.kind);
    assert.equal(node.query.collection, 'learning');
    assert.equal(node.query.topic, node.label);
    assert.equal(getKnowledgeCatalog(node.query as { kind: LibraryKind; topic: string }).library!.total, node.count);
  }
  const network = learningNetwork(nodes);
  assert.equal(network.edges.length, nodes.length - roots.length);
  assert.ok(network.edges.every(edge => nodes[edge.to].parent === nodes[edge.from].id));
  const rootPoints = network.hubs.map(index => network.nodes[index]);
  assert.ok(Math.abs(rootPoints[0].x - rootPoints[1].x) > 2, 'learning collections have separate visible centers');
  assert.deepEqual(organization, before);
});

test('前端拒绝伪造统计、重复主题及不一致的整理数据', () => {
  assert.equal(parseKnowledgeCatalog(catalog), catalog);
  const bad = structuredClone(catalog);
  bad.organization!.counts.general++;
  assert.throws(() => parseKnowledgeCatalog(bad), /Invalid knowledge catalog/);
  const duplicated = structuredClone(catalog);
  duplicated.organization!.topics.push({ ...duplicated.organization!.topics[0] });
  assert.throws(() => parseKnowledgeCatalog(duplicated), /Invalid knowledge catalog/);
});

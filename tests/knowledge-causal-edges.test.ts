import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { getKnowledgeCatalog } from '../server/knowledge/catalog';
import { buildCausalEdges, causalEdgesForChunks, formatCausalEdgesForPrompt, getCausalEdges } from '../server/knowledge/causal';
import { buildKnowledgeRelations } from '../server/knowledge/relations';
import { computeSnapshotSha256, computeSnapshotSha256FromContents } from '../server/knowledge/snapshot-sha';
import { sha256Hex } from '../shared/sha256';
import { loadKnowledgeSnapshot } from '../server/knowledge/snapshot';
import { buildSystemPrompt } from '../server/knowledge/systemPrompt';
import { graphTaxonomyNodes } from '../src/pages/KnowledgePage/knowledge-taxonomy-data';
import { parseKnowledgeRelations, relationsMatchCatalog } from '../src/features/knowledge/relations-api';
import type { KnowledgeCatalog } from '../shared/knowledge-catalog';

const INDEX_ROOT = path.resolve('知识库/整理后的知识库/农用拖拉机知识库');
const SHA = /^[a-f0-9]{64}$/;

test('causal edges load from the same snapshot: every edge validates, none claims a probability', () => {
  const snapshot = loadKnowledgeSnapshot();
  const causal = getCausalEdges();
  const symptoms = new Set(causal.edges.map(edge => edge.symptomEntryId));
  const withThreshold = causal.edges.filter(edge => edge.threshold);
  console.log(`[causal] ${causal.edges.length} edges, ${symptoms.size} symptoms, ${withThreshold.length} with threshold, sha ${causal.snapshotSha256?.slice(0, 12)}`);
  assert.ok(causal.edges.length >= 2000);
  assert.deepEqual(causal.degraded, []);
  assert.match(causal.snapshotSha256 ?? '', SHA);
  assert.equal(causal.snapshotSha256, snapshot.snapshotSha256);
  assert.equal(causal.kbVersion, snapshot.kbVersion);
  const byId = new Map(snapshot.chunks.filter(chunk => chunk.entryId).map(chunk => [chunk.entryId!, chunk]));
  for (const edge of causal.edges) {
    assert.equal(edge.strengthBasis, '故障表候选');
    assert.ok(edge.evidenceKind === '故障表' || edge.evidenceKind === '知识卡选摘');
    assert.ok(!('strength' in edge), 'causal edges carry no numeric strength');
    assert.ok(edge.threshold === null || (typeof edge.threshold === 'string' && edge.remedy.includes(edge.threshold)));
    const chunk = byId.get(edge.symptomEntryId);
    assert.ok(chunk && chunk.entryType === '维护/故障知识');
    assert.equal(edge.sourceId, chunk.sourceId);
  }
});

test('shared SHA-256 matches the standard vectors and the disk computation', () => {
  // FIPS 180-4 vectors: the pure-JS implementation must agree with node:crypto,
  // because the dev-preview browser bundle cannot import node:crypto.
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'), '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  const fromDisk = computeSnapshotSha256(INDEX_ROOT);
  const fromMemory = computeSnapshotSha256FromContents({
    'hierarchy.json': readFileSync(path.join(INDEX_ROOT, 'hierarchy.json'), 'utf8'),
    'entries.jsonl': readFileSync(path.join(INDEX_ROOT, 'entries.jsonl'), 'utf8'),
    'sources.json': readFileSync(path.join(INDEX_ROOT, 'sources.json'), 'utf8'),
  });
  assert.equal(fromMemory, fromDisk);
});

test('snapshot SHA is deterministic and moves on any index-file change', () => {
  const first = computeSnapshotSha256(INDEX_ROOT);
  const second = computeSnapshotSha256(INDEX_ROOT);
  assert.match(first ?? '', SHA);
  assert.equal(first, second);
  assert.equal(computeSnapshotSha256(path.join(tmpdir(), 'agrix-no-such-dir')), null);
  const root = mkdtempSync(path.join(tmpdir(), 'causal-sha-'));
  try {
    mkdirSync(root, { recursive: true });
    for (const name of ['hierarchy.json', 'entries.jsonl', 'sources.json']) {
      copyFileSync(path.join(INDEX_ROOT, name), path.join(root, name));
    }
    const before = computeSnapshotSha256(root);
    assert.equal(before, first);
    writeFileSync(path.join(root, 'hierarchy.json'), readFileSync(path.join(root, 'hierarchy.json'), 'utf8') + '\n');
    const after = computeSnapshotSha256(root);
    assert.match(after ?? '', SHA);
    assert.notEqual(after, before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('causal loader drops edges that no longer match the snapshot instead of serving them', () => {
  const snapshot = loadKnowledgeSnapshot();
  const causal = getCausalEdges();
  const victim = 'KB-LX2620-003';
  const victimCount = causal.edges.filter(edge => edge.symptomEntryId === victim).length;
  assert.ok(victimCount > 0);
  const withoutVictim = snapshot.chunks.filter(chunk => chunk.entryId !== victim);
  const rebuilt = buildCausalEdges(withoutVictim, snapshot.kbVersion, snapshot.snapshotSha256);
  assert.equal(rebuilt.edges.length, causal.edges.length - victimCount);
  assert.equal(rebuilt.degraded.length, 1);
  assert.match(rebuilt.degraded[0], /剔除/);
  assert.ok(!rebuilt.edges.some(edge => edge.symptomEntryId === victim));
  const empty = buildCausalEdges([], snapshot.kbVersion, snapshot.snapshotSha256);
  assert.equal(empty.edges.length, 0);
  assert.ok(empty.degraded.length > 0);
});

test('diagnosis expansion only follows retrieved, already hard-filtered chunks', () => {
  const snapshot = loadKnowledgeSnapshot();
  const causal = getCausalEdges();
  const target = snapshot.chunks.find(chunk => chunk.entryId === 'KB-LX2620-003');
  assert.ok(target);
  const expanded = causalEdgesForChunks([target], causal);
  assert.ok(expanded.length > 0);
  assert.ok(expanded.every(edge => edge.symptomEntryId === 'KB-LX2620-003'));
  assert.ok(expanded.some(edge => edge.cause === '供油不畅'));
  const other = snapshot.chunks.find(chunk => chunk.entryId && chunk.entryId !== 'KB-LX2620-003' && chunk.entryType === '维护/故障知识');
  assert.ok(other);
  assert.ok(causalEdgesForChunks([other], causal).every(edge => edge.symptomEntryId === other.entryId));
  const prompt = buildSystemPrompt({
    query: '久保田LX2620启动困难', retrieved: [target], brand: '久保田', model: 'LX2620-LX2620SU',
  }).message.content;
  assert.match(prompt, /因果候选/);
  assert.match(prompt, /供油不畅/);
  assert.match(prompt, /未确诊/);
  assert.doesNotMatch(prompt, /已确诊|确诊为供油不畅/);
  const overheat = snapshot.chunks.find(chunk => chunk.entryId === 'KB-LX2620-005');
  assert.ok(overheat);
  const overheatBlock = formatCausalEdgesForPrompt(causalEdgesForChunks([overheat], causal));
  assert.match(overheatBlock, /约 5 分钟/);
  assert.equal(formatCausalEdgesForPrompt([]), '');
});

test('graph sync: nodes derive from the catalog, a classification change switches the whole graph', () => {
  const catalog = getKnowledgeCatalog();
  const relations = buildKnowledgeRelations(catalog);
  assert.match(catalog.snapshotSha256 ?? '', SHA);
  assert.equal(relations.snapshotSha256, catalog.snapshotSha256);
  assert.equal(relationsMatchCatalog(relations, catalog), true);
  assert.equal(relationsMatchCatalog(relations, { ...catalog, snapshotSha256: 'b'.repeat(64) }), false);
  assert.equal(relationsMatchCatalog({ ...relations, snapshotSha256: null }, catalog), false);
  assert.equal(relationsMatchCatalog({ ...relations, kbVersion: '2099.01.1' }, catalog), false);

  const nodes = graphTaxonomyNodes(catalog);
  const nodeIds = new Set(nodes.map(node => node.id));
  assert.equal(parseKnowledgeRelations(relations, nodeIds), relations);

  const modified: KnowledgeCatalog = JSON.parse(JSON.stringify(catalog));
  const brand = modified.brands.find(item => item.models.some(model => model.components.some(component => component.parts.length)));
  assert.ok(brand);
  const model = brand.models.find(item => item.components.some(component => component.parts.length))!;
  const component = model.components.find(item => item.parts.length)!;
  const removedIds = new Set([JSON.stringify([brand.id, model.id, component.id]),
    ...component.parts.map(part => JSON.stringify([brand.id, model.id, component.id, part.id]))]);
  model.components = model.components.filter(item => item.id !== component.id);
  const newNodes = graphTaxonomyNodes(modified);
  assert.ok(newNodes.length < nodes.length);
  assert.ok([...removedIds].every(id => !newNodes.some(node => node.id === id)), 'removed classification leaves no stale node');
  assert.ok(newNodes.every(node => nodeIds.has(node.id)), 'switched graph invents no node');
  assert.throws(() => parseKnowledgeRelations(relations, new Set(newNodes.map(node => node.id))), /Invalid relation node/);
  const switched = buildKnowledgeRelations({ ...modified, snapshotSha256: 'c'.repeat(64) });
  assert.equal(switched.snapshotSha256, 'c'.repeat(64));
  assert.deepEqual(new Set(switched.nodes), new Set(newNodes.map(node => node.id)));
  assert.equal(relationsMatchCatalog(switched, { ...modified, snapshotSha256: 'c'.repeat(64) }), true);
});

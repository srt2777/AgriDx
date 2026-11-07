import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sha256Hex } from '../shared/sha256';
import { loadKnowledgeSnapshot } from '../server/knowledge/snapshot';
import type { KnowledgeChunk } from '../server/knowledge/types';
import {
  buildCommunityReports,
  checkCommunityReportSet,
  communityReportsForSnapshot,
  getCommunityReports,
  isCommunityReportCurrent,
  pageCommunityReports,
} from '../server/knowledge/community-reports';
import {
  COMMUNITY_REPORT_EXCLUDED_BRAND,
  isCommunityReportCurrent as isCurrent,
  validateCommunityReportSet,
  type CommunityReportSet,
} from '../shared/knowledge-community-reports';

let cached: { set: CommunityReportSet; chunks: Map<string, KnowledgeChunk> } | undefined;

function load(): { set: CommunityReportSet; chunks: Map<string, KnowledgeChunk> } {
  if (!cached) {
    const snapshot = loadKnowledgeSnapshot();
    const set = communityReportsForSnapshot(snapshot);
    const chunks = new Map<string, KnowledgeChunk>();
    for (const chunk of snapshot.chunks) {
      if (chunk.entryId && chunk.diagnosticEvidence !== false && !chunks.has(chunk.entryId)) chunks.set(chunk.entryId, chunk);
    }
    cached = { set, chunks };
  }
  return cached;
}

function checkSources(set: CommunityReportSet, chunks: Map<string, KnowledgeChunk>): { sentences: number; sources: number } {
  let sentences = 0;
  let sources = 0;
  for (const report of set.reports) {
    assert.ok(report.limitations.some((line) => line.includes('不用于单次故障确诊')), `report ${report.id} must carry the no-diagnosis boundary`);
    assert.ok(report.title.includes(report.brand) && report.title.includes(report.model) && report.title.includes(report.componentName));
    assert.equal(report.status, 'current');
    for (const sentence of report.sentences) {
      sentences++;
      assert.ok(!sentence.text.includes('确诊'), `sentence must not claim a diagnosis: ${sentence.text}`);
      assert.ok(sentence.sources.length >= 1, `sentence without sources in ${report.id}: ${sentence.text}`);
      for (const source of sentence.sources) {
        sources++;
        const chunk = chunks.get(source.entry_id);
        assert.ok(chunk, `unknown entry_id ${source.entry_id} in ${report.id}`);
        assert.equal(source.source_id, chunk.sourceId, `source_id mismatch for ${source.entry_id}`);
        assert.deepEqual(source.pages, chunk.pages ?? null, `pages mismatch for ${source.entry_id}`);
        assert.equal(source.locator, chunk.locator ?? '', `locator mismatch for ${source.entry_id}`);
      }
    }
  }
  return { sentences, sources };
}

test('pure-TS SHA-256 matches node:crypto, so the snapshot hash works in the browser bundle too', () => {
  const vectors = ['', 'abc', 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', 'x'.repeat(1000), '久保田 LX2620 拖拉机发动机故障'];
  for (const value of vectors) {
    assert.equal(sha256Hex(value), createHash('sha256').update(value).digest('hex'));
  }
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('community reports group exactly like the catalog and cover every archived entry', () => {
  const { set, chunks } = load();
  const snapshot = loadKnowledgeSnapshot();
  const catalog = snapshot.getCatalog();
  assert.equal(set.kbVersion, snapshot.kbVersion);
  assert.equal(set.snapshotSha, snapshot.snapshotSha);
  assert.match(set.snapshotSha, /^[0-9a-f]{64}$/);
  assert.equal(set.formulaVersion, '1.0.0');
  assert.equal(set.status, 'current');

  const catalogGroups = new Map<string, number>();
  for (const brand of catalog.brands) {
    if (brand.name === COMMUNITY_REPORT_EXCLUDED_BRAND) continue;
    for (const model of brand.models) {
      for (const component of model.components) {
        if (component.entryCount > 0) catalogGroups.set(JSON.stringify([brand.name, model.name, component.id]), component.entryCount);
      }
    }
  }
  assert.equal(set.totalReports, catalogGroups.size);
  assert.equal(set.reports.length, catalogGroups.size);
  assert.ok(!set.reports.some((report) => report.brand === COMMUNITY_REPORT_EXCLUDED_BRAND));
  const reportIds = new Set(set.reports.map((report) => report.id));
  assert.equal(reportIds.size, set.reports.length);
  for (const report of set.reports) {
    assert.equal(report.entryCount, catalogGroups.get(report.id), `entryCount mismatch for ${report.id}`);
  }

  const covered = new Set<string>();
  for (const report of set.reports) {
    for (const sentence of report.sentences) {
      if (sentence.kind !== 'overview') continue;
      for (const source of sentence.sources) covered.add(source.entry_id);
    }
  }
  const expected = [...chunks.values()].filter((chunk) => chunk.brand !== COMMUNITY_REPORT_EXCLUDED_BRAND).length;
  assert.equal(covered.size, expected);
  assert.equal(set.totalEntries, expected);
  console.log(`[community-reports] ${set.totalReports} reports, ${set.totalEntries} entries, kbVersion=${set.kbVersion} snapshotSha=${set.snapshotSha.slice(0, 12)}`);
});

test('every community report sentence carries resolvable sources', () => {
  const { set, chunks } = load();
  const { sentences, sources } = checkSources(set, chunks);
  assert.ok(sentences > 0 && sources > 0);
  console.log(`[community-reports] ${sentences} sentences, ${sources} sources, unsourced=0`);
});

test('report counts are consistent with the cited entries', () => {
  const { set, chunks } = load();
  for (const report of set.reports) {
    const overview = report.sentences.find((sentence) => sentence.kind === 'overview');
    assert.ok(overview);
    assert.equal(overview.sources.length, report.entryCount);
    assert.equal(new Set(overview.sources.map((source) => source.source_id)).size, report.sourceCount);
    const typeTotal = report.sentences.filter((sentence) => sentence.kind === 'entry-type')
      .reduce((total, sentence) => total + sentence.sources.length, 0);
    assert.equal(typeTotal, report.entryCount, `entry-type counts must add up in ${report.id}`);
    for (const sentence of report.sentences.filter((sentence) => sentence.kind === 'role')) {
      for (const source of sentence.sources) {
        const chunk = chunks.get(source.entry_id)!;
        assert.ok(chunk.roles?.length, `role sentence cites untagged entry ${source.entry_id}`);
      }
    }
    const sourceSentences = report.sentences.filter((sentence) => sentence.kind === 'source');
    assert.ok(sourceSentences.length >= 1 && sourceSentences.length <= 3);
  }
});

test('20-report audit sample: every sentence source resolves', () => {
  const { set, chunks } = load();
  const sample = [...set.reports].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, 20);
  assert.equal(sample.length, 20);
  console.log('[community-reports-audit] report | entries | sentences | sources | result');
  for (const report of sample) {
    const subset: CommunityReportSet = { ...set, reports: [report], totalReports: 1, totalEntries: report.entryCount };
    const { sentences, sources } = checkSources(subset, chunks);
    console.log(`[community-reports-audit] ${report.id} | ${report.entryCount} | ${sentences} | ${sources} | 全对`);
  }
});

test('stale reports are explicit, never silently reused', () => {
  const { set } = load();
  const snapshot = loadKnowledgeSnapshot();
  const report = set.reports[0];
  assert.ok(isCommunityReportCurrent(report, snapshot.kbVersion, snapshot.snapshotSha));
  assert.ok(isCurrent(report, snapshot.kbVersion, snapshot.snapshotSha));
  assert.equal(checkCommunityReportSet(set, snapshot).status, 'current');
  assert.equal(checkCommunityReportSet(set, snapshot).reason, null);
  const otherSha = '0'.repeat(64);
  assert.ok(!isCommunityReportCurrent(report, snapshot.kbVersion, otherSha));
  const stale = checkCommunityReportSet({ ...set, snapshotSha: otherSha }, snapshot);
  assert.equal(stale.status, 'stale');
  assert.match(stale.reason ?? '', /快照/);
  assert.ok(!isCommunityReportCurrent(report, '2099.01.01', snapshot.snapshotSha));
});

test('community reports are deterministic and cached per snapshot generation', () => {
  const { set } = load();
  const snapshot = loadKnowledgeSnapshot();
  assert.equal(communityReportsForSnapshot(snapshot), set);
  assert.equal(getCommunityReports(), set);
  const again = buildCommunityReports(snapshot);
  const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  assert.equal(hash(again), hash(set));
});

test('community report paging mirrors the relations endpoint', () => {
  const { set } = load();
  const page = pageCommunityReports(set, new URLSearchParams('offset=10&limit=25'));
  assert.deepEqual(page.reports, set.reports.slice(10, 35));
  assert.equal(page.page?.total, set.reports.length);
  assert.equal(page.page?.hasMore, 10 + 25 < set.reports.length);
  assert.equal(pageCommunityReports(set, new URLSearchParams()), set);
  assert.throws(() => pageCommunityReports(set, new URLSearchParams('limit=1001')), /分页/);
  assert.throws(() => pageCommunityReports(set, new URLSearchParams('offset=1&offset=2')), /分页/);
});

test('transported report sets are validated, including the zero-unsourced-sentence rule', () => {
  const { set } = load();
  assert.equal(validateCommunityReportSet(set), set);
  const small = [...set.reports].sort((a, b) => a.entryCount - b.entryCount)[0];
  const tiny: CommunityReportSet = { ...set, reports: [small], totalReports: 1, totalEntries: small.entryCount };
  assert.deepEqual(validateCommunityReportSet(JSON.parse(JSON.stringify(tiny))), tiny);
  const noSources = JSON.parse(JSON.stringify(tiny)) as CommunityReportSet;
  noSources.reports[0].sentences[0].sources = [];
  assert.throws(() => validateCommunityReportSet(noSources), /来源/);
  const badSha = JSON.parse(JSON.stringify(tiny)) as CommunityReportSet;
  badSha.snapshotSha = 'not-a-sha';
  assert.throws(() => validateCommunityReportSet(badSha), /snapshotSha/);
  const duplicate = JSON.parse(JSON.stringify(tiny)) as CommunityReportSet;
  duplicate.reports.push(JSON.parse(JSON.stringify(small)));
  duplicate.totalReports = 2;
  assert.throws(() => validateCommunityReportSet(duplicate), /id/);
});

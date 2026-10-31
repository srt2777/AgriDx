import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import type { KnowledgeCatalog } from '../shared/knowledge-catalog';
import { loadArchive } from '../server/knowledge/archive';
import { getKnowledgeCatalog, loadKnowledgeCatalog } from '../server/knowledge/catalog';

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = '';
process.env.DEEPSEEK_API_KEY = '';
process.env.LLM_PROVIDER = 'auto';

const archive = loadArchive().chunks;
const catalog = loadKnowledgeCatalog();
const { default: app } = await import('../server/index');
let server: http.Server;
let port: number;

before(async () => {
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  port = address.port;
});
after(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

// Exercise the local server directly, including when the app configures a global outbound fetch proxy.
function requestCatalog(query: string | URLSearchParams) {
  return new Promise<{ status: number; json: () => Promise<unknown> }>((resolve, reject) => {
    const request = http.get({ hostname: '127.0.0.1', port, path: `/api/knowledge/catalog?${query}`, agent: false }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => { body += chunk; });
      response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode ?? 0, json: async () => JSON.parse(body) as unknown }));
    });
    request.on('error', reject);
  });
}

test('catalogue adds learning and archive counts while preserving archive-only hierarchy and evidence counts', () => {
  assert.equal(catalog.totals.entries, archive.length + 6875);
  assert.equal(catalog.totals.archivedEntries, archive.length);
  assert.equal(catalog.totals.learningEntries, 6875);
  assert.equal(catalog.totals.mappedEntries, archive.length);
  assert.equal(catalog.totals.sources, new Set(archive.map((chunk) => chunk.sourceId)).size);
  assert.equal(catalog.totals.faultEntries, archive.filter((chunk) => chunk.entryType === '维护/故障知识').length);
  assert.ok(catalog.brands.every(brand => brand.entryTypes?.length));
  assert.equal(catalog.expansion.status, 'reached');
  assert.equal(catalog.expansion.targetLabel, '1w+');
  assert.equal(catalog.expansion.countingUnit, 'indexed-entry');
  assert.equal(catalog.selected, undefined);
  assert.ok(catalog.limitations.some((line) => line.includes('尚未实现')));
  assert.ok(catalog.limitations.some((line) => line.includes('分层计数不可相加')));
  const directory = JSON.stringify(catalog);
  assert.ok(archive.every((chunk) => !directory.includes(JSON.stringify(chunk.text).slice(1, -1))),
    'directory does not duplicate the fact bodies as the archive grows');
});

test('part browsing returns original evidence paragraphs and their applicability limits', () => {
  const selected = getKnowledgeCatalog({ brand: '东方红', model: 'LF804S', component: 'electrical', part: 'starter' }).selected!;
  const entryIds = selected.entries.map((entry) => entry.entryId);
  assert.ok(['KB-YTO-LF-MANUAL-007', 'KB-YTO-LF-MANUAL-008'].every((id) => entryIds.includes(id)),
    'existing starter evidence remains available as the archive grows');
  for (const entry of selected.entries) {
    const chunk = archive.find((item) => item.entryId === entry.entryId)!;
    assert.equal(entry.content, chunk.text);
    assert.equal(entry.sourceId, chunk.sourceId);
    assert.equal(entry.sourceUrl, chunk.sourceUrl);
    assert.equal(entry.locator, chunk.locator);
    assert.equal(entry.version, chunk.version);
    assert.equal(entry.scopeBoundary, chunk.scopeBoundary);
    assert.match(entry.locator, /PDF.*66/);
    assert.match(entry.scopeBoundary, /LF804S/);
  }
});

test('catalogue preserves exact CAB subsets and never exposes their entries to SU configurations', () => {
  const cab = getKnowledgeCatalog({ brand: '久保田', model: 'LX2620HSDC', component: 'cab' }).selected!;
  assert.ok(cab.entries.some((entry) => entry.entryId === 'KB-LX2620-014' && entry.configuration === 'CAB'));
  const su = getKnowledgeCatalog({ brand: '久保田', model: 'LX2620SUHSD', component: 'cab' }).selected!;
  assert.ok(su.entries.length > 0, 'SU has its own archived ROPS evidence');
  assert.ok(su.entries.some((entry) => entry.configuration === 'ROPS'), 'SU retains its ROPS-specific evidence');
  assert.ok(su.entries.every((entry) => entry.configuration !== 'CAB'), 'shared seat and seat-belt safety may cover both configurations; CAB-specific facts remain excluded');
  assert.ok(su.entries.every((entry) => !['KB-LX2620-014', 'KB-LX2620-015'].includes(entry.entryId)));
  assert.throws(() => getKnowledgeCatalog({ brand: '久保田', model: 'LX2620HSDCX' }), RangeError);
  assert.throws(() => getKnowledgeCatalog({ brand: '东方红', model: 'LF1504(G4)' }), RangeError);
});

test('series ranges, missing manuals and navigation systems remain distinct from whole-machine coverage', () => {
  const series = catalog.brands.find((brand) => brand.name === '雷沃')!.models.find((model) => model.name === '欧豹TG系列')!;
  assert.equal(series.scope, 'series');
  const unknown = catalog.brands.find((brand) => brand.name === '东风')!.models[0];
  assert.equal(unknown.scope, 'pending');
  const t70 = getKnowledgeCatalog({ brand: '鸿鹄', model: 'T70' }).selected!;
  assert.equal(t70.entries.filter((entry) => entry.entryType === '维护/故障知识').length, 0);
  assert.ok(t70.gaps.some((line) => line.includes('不提供对应维修事实')));
  const navigation = catalog.brands.find((brand) => brand.name === '华测')!.models.find((model) => model.name === 'NX510')!;
  assert.equal(navigation.machineType, '配套导航系统');
  assert.ok(navigation.components.every((component) => ['navigation', 'documents'].includes(component.id)));
  assert.throws(() => getKnowledgeCatalog({ brand: '鸿鹄', model: 'NX510' }), RangeError);
});

test('every advertised part has matching evidence and counts are independently deduplicated', () => {
  for (const brand of catalog.brands) {
    for (const model of brand.models) {
      const modelEntries = getKnowledgeCatalog({ brand: brand.name, model: model.name }).selected!.entries;
      assert.equal(model.entryCount, modelEntries.length);
      assert.equal(model.sourceCount, new Set(modelEntries.map((entry) => entry.sourceId)).size);
      for (const component of model.components) {
        for (const part of component.parts) {
          const partEntries = getKnowledgeCatalog({ brand: brand.name, model: model.name, component: component.id, part: part.id }).selected!.entries;
          assert.equal(part.entryCount, partEntries.length);
          assert.equal(part.faultCount, partEntries.filter((entry) => entry.entryType === '维护/故障知识').length);
          assert.ok(partEntries.length > 0);
        }
      }
    }
  }
});

test('read-only catalogue HTTP API rejects malformed hierarchy filters and unknown parts', async () => {
  for (const query of ['model=LF804S', 'component=electrical', 'part=starter', 'brand=a&brand=b', 'brand=',
    'symptom=starter-slow&symptom=starter-stopped', 'configuration=unknown', 'driveConfiguration=AWD', 'emissionStage=Tier4',
    'collection=unknown', 'kind=unknown', 'kind=general&kind=archive', 'topic=', 'page=0', 'page=-1', 'page=1.5', 'page=1000000', 'page=1&page=2', 'q=']) {
    const response = await requestCatalog(query);
    assert.equal(response.status, 400, query);
    assert.equal((await response.json() as { code: string }).code, 'bad_request');
  }
  const query = new URLSearchParams({ brand: '东方红', model: 'LF804S', component: 'electrical', part: 'unknown-part' });
  const response = await requestCatalog(query);
  assert.equal(response.status, 404);
  assert.equal((await response.json() as { code: string }).code, 'knowledge_not_found');
});

test('organization HTTP filters return the selected source category and exact topic', async () => {
  const topic = catalog.organization!.topics.find(item => item.kind === 'general')!;
  const query = new URLSearchParams({ collection: 'learning', kind: topic.kind, topic: topic.name });
  const response = await requestCatalog(query);
  assert.equal(response.status, 200);
  const result = await response.json() as KnowledgeCatalog;
  assert.equal(result.library!.total, topic.count);
  assert.ok(result.library!.entries.every(entry => entry.collection === 'learning' && entry.topic === topic.name && !entry.learningKind));
});

test('unified library HTTP serves both original learning batches and archive evidence', async () => {
  for (const [q, collection] of [['TK-0001', 'learning'], ['TK-6000', 'learning'], ['KB-YTO-LF-MANUAL-007', 'archive']]) {
    const response = await requestCatalog(new URLSearchParams({ collection: 'all', q }));
    assert.equal(response.status, 200);
    const result = await response.json() as KnowledgeCatalog;
    assert.equal(result.totals.entries, archive.length + 6875);
    assert.equal(result.library!.total, 1);
    assert.equal(result.library!.entries[0].entryId, q);
    assert.equal(result.library!.entries[0].collection, collection);
    assert.ok(result.library!.entries[0].content.length > 10);
  }
});

test('通用表现HTTP入口不返回维修正文，完整型号查询与未知配置保留原范围', async () => {
  const generic = await requestCatalog('symptom=starter-stopped');
  assert.equal(generic.status, 200);
  const overview = await generic.json() as KnowledgeCatalog;
  assert.equal(overview.selected, undefined);
  assert.equal(overview.common?.selectedSymptom, 'starter-stopped');
  const model = await requestCatalog(new URLSearchParams({ brand: '东方红', model: 'LF804S', symptom: 'starter-stopped' }));
  const selected = await model.json() as KnowledgeCatalog;
  assert.deepEqual(selected.selected?.entries.map(x => x.entryId), ['KB-YTO-LF-MANUAL-007']);
  const unverified = await requestCatalog(new URLSearchParams({ brand: '东方红', model: 'LF804S', symptom: 'starter-stopped', emissionStage: '国四' }));
  assert.deepEqual((await unverified.json() as KnowledgeCatalog).selected?.entries, []);
  assert.equal((await requestCatalog('symptom=unknown')).status, 404);
});

test('catalogue HTTP selection serves source-backed content without asking an external model', async () => {
  const query = new URLSearchParams({ brand: '纽荷兰', model: 'WORKMASTER25', component: 'cooling', part: 'radiator' });
  const response = await requestCatalog(query);
  assert.equal(response.status, 200);
  const result = await response.json() as KnowledgeCatalog;
  assert.equal(result.selected!.entries[0].entryId, 'NH-WM25-006');
  assert.match(result.selected!.entries[0].content, /立即停止发动机/);
  assert.equal(result.selected!.entries[0].sourceId, 'SRC-NH-WM25-92157408');
});

test('catalog API reports the knowledge-base version from kb-version.json', async () => {
  const response = await requestCatalog('');
  assert.equal(response.status, 200);
  const body = await response.json() as KnowledgeCatalog;
  assert.match(String(body.kbVersion), /^20\d{2}\.\d{2}\.\d+$/);
});

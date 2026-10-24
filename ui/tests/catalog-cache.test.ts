import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { KnowledgeCatalog } from '../../shared/knowledge-catalog';
import { clearCachedKnowledgeCatalog, getCachedKnowledgeCatalog, requestKnowledgeCatalog } from '../src/features/knowledge/catalog-api';

function catalogFor(query: string): KnowledgeCatalog {
  const model = new URLSearchParams(query).get('model');
  return {
    totals: { entries: 0, archivedEntries: 0, learningEntries: 0, sources: 0, brands: 1, models: 2, faultEntries: 0, mappedEntries: 0 },
    expansion: { targetLabel: '1w+', countingUnit: 'indexed-entry', status: 'planned' },
    limitations: ['测试目录，非维修资料'],
    brands: [{ id: 'test', name: 'test', entryCount: 0, faultCount: 0, sourceCount: 0,
      models: ['CAB', 'SU'].map(id => ({ id, name: id, scope: 'exact', machineType: '拖拉机',
        entryCount: 0, faultCount: 0, sourceCount: 0, components: [] })) }],
    ...(model ? { selected: { brand: 'test', model, entries: [], gaps: [`${model} 无测试维修条目`] } } : {}),
  };
}

const signal = () => new AbortController().signal;

test('tab-local catalog reuse skips another download and preserves full model/filter isolation', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async (url: string) =>
    Response.json(catalogFor(url.split('?')[1] ?? '')));
  clearCachedKnowledgeCatalog('');
  const directory = await requestKnowledgeCatalog('', signal());
  assert.equal(await requestKnowledgeCatalog('', signal()), directory);
  assert.equal(fetch.mock.callCount(), 1);
  const cabQuery = 'brand=test&model=CAB&component=cab&part=seat';
  const cab = await requestKnowledgeCatalog(cabQuery, signal());
  const su = await requestKnowledgeCatalog('brand=test&model=SU&component=cab&part=seat', signal());
  assert.equal(cab.selected?.model, 'CAB');
  assert.equal(su.selected?.model, 'SU');
  assert.equal(await requestKnowledgeCatalog('part=seat&component=cab&model=CAB&brand=test', signal()), cab);
  assert.equal(fetch.mock.callCount(), 3);
  assert.equal(directory.selected, undefined);
});

test('catalog expiry and explicit retry fetch fresh validated data, including when a cache exists', async t => {
  let now = 1_000_000;
  t.mock.method(Date, 'now', () => now);
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json(catalogFor('')));
  const query = 'brand=expiry-test';
  const initial = await requestKnowledgeCatalog(query, signal());
  now += 299_999;
  assert.equal(await requestKnowledgeCatalog(query, signal()), initial);
  now += 1;
  assert.equal(getCachedKnowledgeCatalog(query), null);
  const refreshed = await requestKnowledgeCatalog(query, signal());
  assert.notEqual(refreshed, initial);
  clearCachedKnowledgeCatalog(query);
  assert.notEqual(await requestKnowledgeCatalog(query, signal()), refreshed);
  assert.equal(fetch.mock.callCount(), 3);
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(requestKnowledgeCatalog(query, cancelled.signal), { name: 'AbortError' });
  assert.equal(fetch.mock.callCount(), 3);
});

test('failed HTTP and malformed catalog data never become a successful cached directory', async t => {
  const query = 'brand=failure-test';
  const responses = [new Response('{}', { status: 503 }), Response.json({ totals: {} }), Response.json(catalogFor(''))];
  const fetch = t.mock.method(globalThis, 'fetch', async () => responses.shift()!);
  await assert.rejects(requestKnowledgeCatalog(query, signal()));
  assert.equal(getCachedKnowledgeCatalog(query), null);
  await assert.rejects(requestKnowledgeCatalog(query, signal()), /Invalid knowledge catalog/);
  assert.equal(getCachedKnowledgeCatalog(query), null);
  assert.ok(await requestKnowledgeCatalog(query, signal()));
  assert.equal(fetch.mock.callCount(), 3);
});

test('cancelled response bodies are discarded rather than reused by a later route', async t => {
  const query = 'brand=cancelled-test';
  const controller = new AbortController();
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => {
    controller.abort();
    return catalogFor('');
  } }) as Response);
  await assert.rejects(requestKnowledgeCatalog(query, controller.signal), { name: 'AbortError' });
  assert.equal(getCachedKnowledgeCatalog(query), null);
});

test('browsing many selections bounds retained catalog data and evicts older selections', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json(catalogFor('')));
  for (let index = 0; index < 33; index++) {
    await requestKnowledgeCatalog(`brand=bounded-test-${index}`, signal());
  }
  assert.equal(getCachedKnowledgeCatalog('brand=bounded-test-0'), null);
  assert.ok(getCachedKnowledgeCatalog('brand=bounded-test-32'));
});

import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import express from 'express';
import { requestJson, type FetchImplementation } from '../ui/src/lib/api-client';
import { createStatusRoutes } from '../server/routes/status';
import { createCatalogRoutes } from '../server/routes/catalog';
import type { ServerRuntime } from '../server/runtime';

test('release-bound public reads bypass an intermediary that returns stale JSON even with no-cache headers', async t => {
  t.mock.method(Date, 'now', () => 1_792_200_000_123);
  const calls: { url: URL; options: RequestInit }[] = [];
  const intermediary: FetchImplementation = async (input, options = {}) => {
    const url = new URL(String(input), 'https://agridx.test');
    calls.push({ url, options });
    return Response.json(url.searchParams.has('__agridx_check')
      ? { version: '3.5.1', entries: 4853 }
      : { version: '3.2.0', entries: 212 });
  };
  for (const path of ['/api/health', '/api/knowledge/catalog']) {
    const old = await intermediary(path, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } });
    assert.equal((await old.json()).entries, 212, 'the fixture reproduces stale bare-URL responses');
    assert.deepEqual(await requestJson(path, {}, intermediary), { version: '3.5.1', entries: 4853 });
    const fresh = calls.at(-1)!;
    assert.equal(fresh.url.pathname, path);
    assert.equal(fresh.url.searchParams.get('__agridx_check'), '1792200000123');
    assert.equal(fresh.options.cache, 'no-store');
    assert.equal(new Headers(fresh.options.headers).get('cache-control'), 'no-cache');
  }
});

test('freshness transport preserves filters, headers, signal, credentials and caller-owned inputs', async t => {
  t.mock.method(Date, 'now', () => 1_792_200_000_456);
  for (const method of ['GET', 'HEAD', 'get']) {
    const signal = new AbortController().signal;
    const headers = new Headers({ 'X-Test': 'preserved', 'Cache-Control': 'max-age=600' });
    const options: RequestInit = { method, signal, headers, credentials: 'same-origin', cache: 'force-cache' };
    const query = new URLSearchParams({ brand: '东方红', model: 'LX1004', component: 'electrical', part: 'battery',
      configuration: 'CAB', driveConfiguration: '4WD', emissionStage: '国三', __agridx_check: 'old' });
    const path = `/api/knowledge/catalog?${query}&__agridx_check=older`;
    const transport: FetchImplementation = async (input, actual = {}) => {
      const url = new URL(String(input), 'https://agridx.test');
      for (const [key, value] of query) {
        assert.equal(url.searchParams.get(key), key === '__agridx_check' ? '1792200000456' : value);
      }
      assert.deepEqual(url.searchParams.getAll('__agridx_check'), ['1792200000456']);
      assert.equal(actual.method, method);
      assert.equal(actual.signal, signal);
      assert.equal(actual.credentials, 'same-origin');
      assert.equal(actual.cache, 'no-store');
      assert.equal(new Headers(actual.headers).get('x-test'), 'preserved');
      assert.equal(new Headers(actual.headers).get('cache-control'), 'no-cache');
      return Response.json({ ok: true });
    };
    await requestJson(path, options, transport);
    assert.equal(options.headers, headers);
    assert.equal(headers.get('cache-control'), 'max-age=600', 'do not mutate the caller headers');
    assert.equal(options.cache, 'force-cache');
    assert.equal(query.get('__agridx_check'), 'old');
  }
});

test('private, unrelated and non-read requests retain their exact path and options', async () => {
  for (const [path, method] of [
    ['/api/memory', 'GET'], ['/api/memory/sessions/private', 'GET'],
    ['/api/chat', 'POST'], ['/api/health', 'POST'], ['/api/knowledge/catalog?brand=test', 'PATCH'],
    ['/api/health-extra', 'GET'], ['/api/knowledge/catalog/entry', 'GET'],
    ['https://other.test/api/health', 'GET'],
  ]) {
    const options: RequestInit = { method, headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      signal: new AbortController().signal, ...(method === 'POST' || method === 'PATCH' ? { body: '{}' } : {}) };
    const transport: FetchImplementation = async (actualPath, actualOptions) => {
      assert.equal(actualPath, path);
      assert.equal(actualOptions, options);
      return Response.json({ ok: true });
    };
    await requestJson(path, options, transport);
  }
});

test('actual health and catalog routes disallow caching for success and invalid/missing selections', async t => {
  const runtime: ServerRuntime = {
    rootDirectory: process.cwd(), version: '3.5.1',
    getKnowledgeStats: () => ({ chunks: 0, archivedEntries: 4853, learningEntries: 6000, totalEntries: 10853 }),
    getLlmStatus: () => ({ preference: 'auto', configValid: true, configured: false,
      primary: null, proxyConfigured: false, providers: [] }),
    getCatalog: filters => {
      if (filters.brand === 'missing') throw new RangeError('No matching archived model');
      return { totals: { entries: 10853, archivedEntries: 4853, learningEntries: 6000, sources: 0, brands: 0, models: 0, faultEntries: 0, mappedEntries: 4853 },
        brands: [], limitations: [], expansion: { targetLabel: '1w+', countingUnit: 'indexed-entry', status: 'reached' } };
    },
    diagnose: async () => { throw new Error('diagnosis is outside this read-only test'); },
  };
  const app = express();
  app.use('/api', createStatusRoutes(runtime), createCatalogRoutes(runtime.getCatalog));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  for (const [path, expectedStatus] of [
    ['/api/health', 200], ['/api/health?__agridx_check=123', 200],
    ['/api/knowledge/catalog', 200], ['/api/knowledge/catalog?__agridx_check=123', 200],
    ['/api/knowledge/catalog?model=LX1004&__agridx_check=123', 400],
    ['/api/knowledge/catalog?brand=missing&__agridx_check=123', 404],
  ] as const) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, expectedStatus, path);
    assert.equal(response.headers.get('cache-control'), 'no-store', path);
    await response.arrayBuffer();
  }
});

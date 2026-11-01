import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { test } from 'node:test';
import { buildShadowReviewRecord, InMemoryShadowReviewStore } from '../agent/shadow-review';
import { createShadowReviewRoutes } from '../server/routes/shadow-review';

const base = {
  mainEvidenceIds: ['KB-001'],
  plannerSteps: ['0:resolve_machine_scope', '1:search_knowledge'],
  toolResults: [{ tool: 'search_knowledge', ok: true, error_type: null, duration_ms: 12, source: '混合资料' }],
  mainRoute: 'ai',
  durationMs: 120,
  timedOut: false,
  highRisk: false,
};

function storeWithRecords() {
  const store = new InMemoryShadowReviewStore();
  store.append(buildShadowReviewRecord({ ...base, sessionId: 'route-1', shadowEvidenceIds: ['KB-002'] }));
  store.append(buildShadowReviewRecord({ ...base, sessionId: 'route-2', shadowEvidenceIds: ['KB-001'] }));
  store.append(buildShadowReviewRecord({ ...base, sessionId: 'route-3', shadowEvidenceIds: ['KB-003'], highRisk: true }));
  return store;
}

async function serve(t: { after: (cleanup: () => Promise<void>) => void }, store: InMemoryShadowReviewStore) {
  const app = express();
  app.use(express.json({ limit: '256kb' }));
  app.use('/api', createShadowReviewRoutes(() => store));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return `http://127.0.0.1:${address.port}`;
}

async function request(baseUrl: string, path: string, body?: unknown, headers?: Record<string, string>) {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const response = await fetch(`${baseUrl}${path}`, {
    method: payload === undefined ? 'GET' : 'POST',
    headers: { ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    body: payload,
  });
  return { status: response.status, headers: response.headers, body: await response.json().catch(() => null) };
}

test('GET /api/shadow-review returns view items and the new-evidence candidate subset, never answer content', async (t) => {
  const store = storeWithRecords();
  const baseUrl = await serve(t, store);
  const { status, headers, body } = await request(baseUrl, '/api/shadow-review');
  assert.equal(status, 200);
  assert.equal(headers.get('cache-control'), 'no-store');
  assert.equal(body.items.length, 3);
  assert.equal(body.candidates.length, 1);
  assert.equal(body.candidates[0].sessionId, 'route-1');
  assert.deepEqual(body.candidates[0].candidateEvidenceIds, ['KB-002']);
  assert.equal(body.items[0].comparisonLabel, '补新证据');
  assert.equal(body.items[2].comparison, 'high_risk');
  // View items carry no answer text, no full tool output, no credentials:
  // only the view fields, with evidence surfaced as ids, not content.
  assert.deepEqual(Object.keys(body.items[0]).sort(), ['candidateEvidenceIds', 'comparison', 'comparisonLabel', 'durationMs',
    'mainRoute', 'plannerSteps', 'reviewOnly', 'safety', 'sessionId', 'timedOut', 'toolResults']);
  assert.ok(!('content' in body.items[0]) && !('answer' in body.items[0]) && !('choices' in body.items[0]));
  // The route read, but did not change, the store.
  assert.equal(store.list().length, 3);
});

test('GET /api/shadow-review on an empty store returns empty lists', async (t) => {
  const baseUrl = await serve(t, new InMemoryShadowReviewStore());
  const { status, body } = await request(baseUrl, '/api/shadow-review');
  assert.equal(status, 200);
  assert.deepEqual(body, { items: [], candidates: [] });
});

test('POST promotion-check approves only the gate inputs and rejects the four gate reasons, without changing the store', async (t) => {
  const store = storeWithRecords();
  const baseUrl = await serve(t, store);
  const approved = await request(baseUrl, '/api/shadow-review/promotion-check',
    { sessionId: 'route-1', reviewer: 'reviewer-1', verified: true });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.checkOnly, true);
  assert.equal(approved.body.decision.approved, true);
  assert.deepEqual(approved.body.decision.candidateEvidenceIds, ['KB-002']);
  assert.match(approved.body.note, /不是执行推广/);
  for (const [body, reason] of [
    [{ sessionId: 'route-1', reviewer: '  ', verified: true }, 'missing_reviewer'],
    [{ sessionId: 'route-1', reviewer: 'reviewer-1', verified: false }, 'not_verified'],
    [{ sessionId: 'route-2', reviewer: 'reviewer-1', verified: true }, 'not_new_evidence'],
    [{ sessionId: 'route-3', reviewer: 'reviewer-1', verified: true }, 'high_risk'],
  ] as const) {
    const result = await request(baseUrl, '/api/shadow-review/promotion-check', body);
    assert.equal(result.status, 200);
    assert.equal(result.body.checkOnly, true);
    assert.deepEqual(result.body.decision, { approved: false, reason });
  }
  const missing = await request(baseUrl, '/api/shadow-review/promotion-check',
    { sessionId: 'no-such-session', reviewer: 'reviewer-1', verified: true });
  assert.equal(missing.status, 404);
  const bad = await request(baseUrl, '/api/shadow-review/promotion-check', { reviewer: 'reviewer-1', verified: true });
  assert.equal(bad.status, 400);
  // A check never promotes, persists or mutates anything in the store.
  assert.equal(store.list().length, 3);
  assert.equal(store.candidatesForPromotion().length, 1);
});

test('shadow-review routes reject cross-site requests the same way the chat/memory routes do', async (t) => {
  const baseUrl = await serve(t, storeWithRecords());
  const crossSite = await request(baseUrl, '/api/shadow-review', undefined, { Origin: 'https://evil.example' });
  assert.equal(crossSite.status, 403);
  assert.equal(crossSite.body.code, 'memory_origin');
  const crossSitePost = await request(baseUrl, '/api/shadow-review/promotion-check',
    { sessionId: 'route-1', reviewer: 'reviewer-1', verified: true }, { 'Sec-Fetch-Site': 'cross-site' });
  assert.equal(crossSitePost.status, 403);
});

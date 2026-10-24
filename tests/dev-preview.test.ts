import { renderDiagnosticReply } from '../server/diagnosis/reply';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
import { knowledgeSnapshotPlugin, createKnowledgeSnapshot } from '../scripts/lib/dev-preview.mjs';
import { getKnowledgeCatalog, loadKnowledgeCatalog } from '../server/knowledge/catalog';
import { loadKnowledgeBase } from '../server/knowledge/retriever';
import { createDiagnosticService } from '../server/diagnosis/service';
import { parseDiagnosticRequest } from '../server/diagnosis/request';
import { createReadOnlyFileSystem } from '../src/dev-preview/filesystem.mjs';
import browserPath from '../src/dev-preview/path.mjs';
import type { ChatResponse } from '../shared/chat';
const transported = (value: unknown) => JSON.parse(JSON.stringify(value));

/** Durations differ by runtime; every other response field must match the server contract. */
function responseWithoutTimings(response: ChatResponse) {
  assert.ok(response.diagnosisTrace, 'preview must retain the diagnosis trace');
  const { timings, ...trace } = response.diagnosisTrace;
  assert.deepEqual(Object.keys(timings).sort(), ['decisionMs', 'externalAiMs', 'retrievalMs', 'totalMs']);
  for (const [name, duration] of Object.entries(timings)) {
    assert.equal(typeof duration, 'number', `${name} must be numeric`);
    assert.ok(Number.isFinite(duration) && duration >= 0, `${name} must be finite and non-negative`);
  }
  assert.equal(timings.externalAiMs, 0, 'the browser preview must never spend time in an external AI call');
  assert.equal(trace.aiAttempts, 0);
  assert.equal(trace.aiSuccesses, 0);
  return transported({ ...response, diagnosisTrace: trace });
}

test('开发快照只包含已索引资料，路径不会暴露本机文件或原始说明书', () => {
  const snapshot = createKnowledgeSnapshot();
  assert.ok(Object.keys(snapshot).length > 3);
  assert.ok(Object.keys(snapshot).every((file) => file.endsWith('.md') || /\/(entries.jsonl|entry-roles.jsonl|index.jsonl|sources.json|hierarchy.json|kb-version.json|通用框架.json)$/.test(file)));
  assert.match(JSON.parse(snapshot['/知识库/整理后的知识库/农用拖拉机知识库/kb-version.json']).kb_version, /^20\d{2}\.\d{2}\.\d+$/);
  assert.ok(snapshot['/docs/tractor-knowledge/01.md']);
  assert.ok(snapshot['/docs/tractor-knowledge/expansion-5000/60.md']);
  assert.ok(Object.keys(snapshot).every((file) => !/\.env|原始农机说明书|00_说明/.test(file)));
  const fs = createReadOnlyFileSystem(snapshot);
  assert.throws(() => fs.readFileSync('/etc/agridx.env'));
  assert.throws(() => fs.realpathSync('/server/.env'));
  assert.equal(fs.realpathSync('/知识库/整理后的知识库'), '/知识库/整理后的知识库');
  for (const file of Object.keys(snapshot)) {
    assert.equal(browserPath.relative('/知识库/整理后的知识库', file), path.posix.relative('/知识库/整理后的知识库', file));
  }
  assert.equal(browserPath.relative('/知识库/整理后的知识库', '/etc/agridx.env'), '../../etc/agridx.env');
});

test('实际浏览器构建保持完整知识目录、诊断来源与型号隔离，且无需生产接口', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'agridx-preview-'));
  try {
    await build({
      configFile: false, logLevel: 'silent', plugins: [knowledgeSnapshotPlugin()],
      define: { __AGRIDX_PREVIEW_RELEASE__: JSON.stringify({ version: 'test', commit: 'test' }) },
      build: { outDir: directory, lib: { entry: path.resolve('src/dev-preview/api.ts'), formats: ['es'], fileName: () => 'api.mjs' } },
    });
    const { previewFetch } = await import(pathToFileURL(path.join(directory, 'api.mjs')).href);
    loadKnowledgeBase();
    loadKnowledgeCatalog();
    const catalog = await (await previewFetch('/api/knowledge/catalog')).json();
    assert.match(catalog.kbVersion, /^20\d{2}\.\d{2}\.\d+$/);
    assert.deepEqual(catalog, getKnowledgeCatalog());
    let selections = 0;
    for (const brand of catalog.brands) {
      for (const model of brand.models) {
        const filters = { brand: brand.name, model: model.name };
        const actual = await (await previewFetch(`/api/knowledge/catalog?${new URLSearchParams(filters)}`)).json();
        assert.deepEqual(actual, transported(getKnowledgeCatalog(filters)));
        selections++;
        for (const component of model.components) {
          for (const part of component.parts) {
            const selected = { ...filters, component: component.id, part: part.id };
            const result = await (await previewFetch(`/api/knowledge/catalog?${new URLSearchParams(selected)}`)).json();
            assert.deepEqual(result, transported(getKnowledgeCatalog(selected)));
            selections++;
          }
        }
      }
    }
    assert.ok(selections > 500);
    assert.equal((await previewFetch('/api/knowledge/catalog?model=5E')).status, 400);
    assert.equal((await previewFetch('/api/knowledge/catalog?brand=a&brand=b')).status, 400);
    assert.equal((await previewFetch('/api/knowledge/catalog?brand=unknown&model=unknown')).status, 404);
    for (const filters of [
      { symptom: 'starter-stopped' },
      { brand: '东方红', model: 'LF804S', symptom: 'starter-stopped' },
      { brand: '约翰迪尔', model: '5E-1004', symptom: 'engine-power', emissionStage: '国四' as const },
    ]) {
      const actual = await (await previewFetch(`/api/knowledge/catalog?${new URLSearchParams(filters)}`)).json();
      assert.deepEqual(actual, transported(getKnowledgeCatalog(filters)));
    }
    assert.equal((await previewFetch('/api/knowledge/catalog?symptom=unknown')).status, 404);
    assert.equal((await previewFetch('/api/knowledge/catalog?configuration=unknown')).status, 400);
    for (const filters of [
      { collection: 'all' as const }, { collection: 'learning' as const, q: 'TK-6000' },
      { collection: 'archive' as const, q: 'KB-YTO-LF-MANUAL-007' }, { collection: 'learning' as const, page: '300' },
    ]) {
      const response = await previewFetch(`/api/knowledge/catalog?${new URLSearchParams(filters)}`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), transported(getKnowledgeCatalog(filters)));
    }
    for (const query of ['collection=unknown', 'page=0', 'page=1.5', 'page=1&page=2']) {
      assert.equal((await previewFetch(`/api/knowledge/catalog?${query}`)).status, 400);
    }
    const provider = { hasAnyConfigured: () => false, chat: async () => { throw new Error('Must not call an external model'); } };
    const diagnose = createDiagnosticService(provider);
    for (const model of ['5E-1004', '不存在的型号']) {
      const body = { messages: [{ role: 'user', content: '发动机无法启动' }], machineType: '拖拉机', brand: '约翰迪尔', model };
      const actual = await (await previewFetch('/api/chat', { method: 'POST', body: JSON.stringify(body) })).json();
      const expected = await diagnose({ ...parseDiagnosticRequest(body), diagnosisMode: 'knowledge_only' });
      // The preview must disclose its local-only environment; that is the only
      // allowed display difference. Provenance, scope, routing and zero-call
      // metadata remain subject to the original complete parity comparison.
      assert.ok(expected.diagnosticReply);
      expected.diagnosticReply.understanding += '当前为仅本地检索的开发预览，本次没有调用外部 AI。';
      expected.localSummary = renderDiagnosticReply(expected.diagnosticReply);
      expected.choices[0].message.content = expected.localSummary;
      assert.deepEqual(responseWithoutTimings(actual), responseWithoutTimings(expected));
      assert.equal(actual.provider, 'knowledge-base');
    }
    assert.equal((await previewFetch('/api/chat', { method: 'POST', body: '{' })).status, 400);
    assert.equal((await previewFetch('/api/chat', { method: 'POST', body: '{}' })).status, 400);
    assert.equal((await previewFetch('/api/chat', { method: 'GET' })).status, 404);
    assert.equal((await previewFetch('/api/unknown')).status, 404);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(previewFetch('/api/health', { signal: controller.signal }), { name: 'AbortError' });
    const health = await (await previewFetch('/api/health')).json();
    assert.equal(health.knowledge.archivedEntries, catalog.totals.archivedEntries);
    assert.equal(health.knowledge.learningEntries, 6000);
    assert.equal(health.knowledge.totalEntries, catalog.totals.entries);
    assert.equal(health.llm.configured, false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

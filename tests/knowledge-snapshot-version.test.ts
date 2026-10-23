import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import express from 'express';
import { getKnowledgeCatalog } from '../server/knowledge/catalog';
import { loadKnowledgeSnapshot, reloadKnowledgeSnapshot } from '../server/knowledge/snapshot';
import { retrieve, stats } from '../server/knowledge/retriever';
import { createCatalogRoutes } from '../server/routes/catalog';

const root = path.resolve('知识库/整理后的知识库/农用拖拉机知识库');
const versionFile = path.join(root, 'kb-version.json');

test('目录HTTP使用同一快照版次，重复请求不再独立读取元数据', async t => {
  const original = fs.readFileSync;
  let reads = 0;
  t.mock.method(fs, 'readFileSync', (...args: Parameters<typeof fs.readFileSync>) => {
    if (String(args[0]) === versionFile) reads++;
    return original(...args);
  });
  const snapshot = reloadKnowledgeSnapshot();
  assert.equal(snapshot.kbVersion, JSON.parse(original(versionFile, 'utf8')).kb_version);
  assert.equal(reads, 1);
  const app = express();
  app.use('/api', createCatalogRoutes(getKnowledgeCatalog));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  for (const query of ['', '?brand=东方红&model=LF804S', '?collection=learning&page=2']) {
    const response = await fetch('http://127.0.0.1:' + address.port + '/api/knowledge/catalog' + encodeURI(query));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const catalog = await response.json();
    assert.equal(catalog.kbVersion, snapshot.kbVersion);
    assert.equal(catalog.totals.entries, snapshot.getCatalog().totals.entries);
  }
  assert.equal(reads, 1);
});

test('两个目录路由实例尊重各自注入的版本，不读取隐式全局文件', async t => {
  const catalog = getKnowledgeCatalog();
  let reads = 0;
  const original = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', (...args: Parameters<typeof fs.readFileSync>) => {
    if (String(args[0]) === versionFile) reads++;
    return original(...args);
  });
  const app = express();
  app.use('/left', createCatalogRoutes(() => ({ ...catalog, kbVersion: '2026.10.101' })));
  app.use('/right', createCatalogRoutes(() => ({ ...catalog, kbVersion: '2026.10.102' })));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  for (const [route, version] of [['left', '2026.10.101'], ['right', '2026.10.102']]) {
    const response = await fetch('http://127.0.0.1:' + address.port + '/' + route + '/knowledge/catalog');
    assert.equal(response.status, 200);
    assert.equal((await response.json()).kbVersion, version);
  }
  assert.equal(reads, 0);
});

test('快照重载成功时目录数据与版次整体切换，旧快照和来源保持不变', t => {
  const previous = loadKnowledgeSnapshot();
  const original = fs.readFileSync;
  const before = getKnowledgeCatalog({ brand: '东方红', model: 'LF804S' });
  const nextVersion = '2026.10.999';
  t.mock.method(fs, 'readFileSync', (...args: Parameters<typeof fs.readFileSync>) => String(args[0]) === versionFile
    ? JSON.stringify({ kb_version: nextVersion }) : original(...args));
  t.after(() => { t.mock.restoreAll(); reloadKnowledgeSnapshot(); });
  const next = reloadKnowledgeSnapshot();
  assert.notEqual(next, previous);
  assert.equal(next.kbVersion, nextVersion);
  assert.equal(getKnowledgeCatalog().kbVersion, nextVersion);
  const selected = getKnowledgeCatalog({ brand: '东方红', model: 'LF804S' });
  assert.equal(selected.kbVersion, nextVersion);
  assert.deepEqual(selected.selected, before.selected);
  assert.equal(previous.getCatalog().kbVersion, previous.kbVersion);
  assert.notEqual(previous.kbVersion, nextVersion);
  assert.throws(() => { next.kbVersion = 'corrupted'; }, TypeError);
  assert.throws(() => { selected.kbVersion = 'corrupted'; }, TypeError);
});

test('无效知识重载不会发布新版本元数据或切换检索与统计', t => {
  const previous = loadKnowledgeSnapshot();
  const original = fs.readFileSync;
  const question = '东方红 LF804S 启动机不转';
  const reply = retrieve(question);
  const counts = stats();
  t.mock.method(fs, 'readFileSync', (...args: Parameters<typeof fs.readFileSync>) => {
    const file = String(args[0]);
    if (file === versionFile) return JSON.stringify({ kb_version: '2026.10.999' });
    if (file === path.join(root, 'hierarchy.json')) return '{ malformed';
    return original(...args);
  });
  assert.throws(() => reloadKnowledgeSnapshot(), SyntaxError);
  assert.equal(loadKnowledgeSnapshot(), previous);
  assert.equal(getKnowledgeCatalog(), previous.getCatalog());
  assert.equal(getKnowledgeCatalog().kbVersion, previous.kbVersion);
  assert.deepEqual(retrieve(question), reply);
  assert.deepEqual(stats(), counts);
});

test('可选版本记录缺失、损坏或非字符串时仍按原契约返回null', t => {
  const original = fs.readFileSync;
  let mode = 'missing';
  t.mock.method(fs, 'readFileSync', (...args: Parameters<typeof fs.readFileSync>) => {
    if (String(args[0]) !== versionFile) return original(...args);
    if (mode === 'missing') throw Object.assign(new Error('missing metadata'), { code: 'ENOENT' });
    return mode === 'invalid-json' ? '{ malformed' : JSON.stringify({ kb_version: 42 });
  });
  t.after(() => { t.mock.restoreAll(); reloadKnowledgeSnapshot(); });
  for (mode of ['missing', 'invalid-json', 'invalid-type']) {
    const snapshot = reloadKnowledgeSnapshot();
    assert.equal(snapshot.kbVersion, null, mode);
    assert.equal(getKnowledgeCatalog().kbVersion, null, mode);
    assert.equal(getKnowledgeCatalog({ collection: 'archive' }).kbVersion, null, mode);
  }
});


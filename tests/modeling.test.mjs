import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { createWorker, validateInput, validateGlb } from '../integrations/img2threejs/worker.mjs';
import { createModelingRoutes } from '../server/routes/modeling.ts';

const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
const input = { identity: '测试拖拉机', photos: [{ angle: 'front', dataUrl: image }] };
function glb(external = false) {
  const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], accessors: [{ componentType: 5126, count: 3, type: 'VEC3' }], buffers: [{ byteLength: 0, ...(external ? { uri: 'https://example.com/mesh.bin' } : {}) }] }));
  const length = Math.ceil(json.length / 4) * 4; const bytes = Buffer.alloc(20 + length, 32);
  bytes.writeUInt32LE(0x46546c67, 0); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(bytes.length, 8); bytes.writeUInt32LE(length, 12); bytes.writeUInt32LE(0x4e4f534a, 16); json.copy(bytes, 20); return bytes;
}
test('reference admission rejects forged formats, duplicate angles and oversized uploads', () => {
  assert.equal(validateInput(input).length, 1);
  assert.throws(() => validateInput({ ...input, photos: [...input.photos, ...input.photos] }));
  assert.throws(() => validateInput({ ...input, photos: [{ angle: 'front', dataUrl: 'data:image/png;base64,' + Buffer.alloc(100).toString('base64') }] }));
  assert.throws(() => validateInput({ ...input, photos: [{ angle: '../bad', dataUrl: image }] }));
  assert.throws(() => validateInput({ ...input, identity: 'x'.repeat(121) }));
  const large = Buffer.alloc(2 * 1024 * 1024 + 1); large[0] = 255; large[1] = 216; large[2] = 255;
  assert.throws(() => validateInput({ ...input, photos: [{ angle: 'front', dataUrl: 'data:image/jpeg;base64,' + large.toString('base64') }] }));
});
test('GLB admission rejects external resource references and incorrect binary lengths', () => {
  validateGlb(glb()); assert.throws(() => validateGlb(glb(true)));
  const bytes = glb(); bytes.writeUInt32LE(100, 8); assert.throws(() => validateGlb(bytes));
});
async function fixture(t, complete = true) {
  const directory = await mkdtemp(join(tmpdir(), 'agridx-modeling-')); const skill = join(directory, 'skill');
  await mkdir(skill); await writeFile(join(skill, 'SKILL.md'), 'test-only fixture');
  const runner = join(directory, 'runner.mjs'); await writeFile(runner, '// test-only runner');
  const token = 'test-token-'.repeat(4);
  const execute = async (_exe, args) => {
    if (args[1] === '--check') return '';
    if (args.includes('--state')) return `LOCAL_STATE status=${complete ? 'complete' : 'running'} step=review pass=form`;
    const job = args[1]; await mkdir(join(job, 'src'));
    await writeFile(join(job, 'model.glb'), glb()); await writeFile(join(job, 'src/createObjectModel.ts'), '// test-only model');
    await writeFile(join(job, 'object-sculpt-spec.json'), '{}'); await writeFile(join(job, 'review.json'), JSON.stringify({ limitations: '模拟任务，不代表真实建模验收。' })); return '';
  };
  const worker = await createWorker({ dataDir: join(directory, 'jobs'), token, skillDir: skill, runner, execute });
  await new Promise(resolve => worker.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${worker.address().port}`;
  t.after(async () => { worker.closeAllConnections(); await new Promise(resolve => worker.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  return { url, token, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } };
}
test('private worker authenticates, queues, verifies upstream completion and delivers artifacts', async t => {
  const { url, headers } = await fixture(t);
  assert.equal((await fetch(`${url}/health`)).status, 401);
  assert.equal((await (await fetch(`${url}/health`, { headers })).json()).ready, true);
  const response = await fetch(`${url}/jobs`, { method: 'POST', headers, body: JSON.stringify(input) }); assert.equal(response.status, 202);
  const job = await response.json(); assert.match(job.id, /^[a-f0-9]{64}$/);
  let status;
  for (let i = 0; i < 100; i++) {
    status = await (await fetch(`${url}/jobs/${job.id}`, { headers })).json(); if (!['queued', 'running'].includes(status.status)) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(status.status, 'succeeded');
  validateGlb(Buffer.from(await (await fetch(`${url}/jobs/${job.id}/model.glb`, { headers })).arrayBuffer()));
  assert.equal((await fetch(`${url}/jobs/${'0'.repeat(64)}`, { headers })).status, 404);
});
test('an incomplete official state blocks download despite a successful runner and existing GLB', async t => {
  const { url, headers } = await fixture(t, false);
  const job = await (await fetch(`${url}/jobs`, { method: 'POST', headers, body: JSON.stringify(input) })).json();
  let status;
  for (let i = 0; i < 100; i++) {
    status = await (await fetch(`${url}/jobs/${job.id}`, { headers })).json(); if (status.status === 'failed') break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(status.status, 'failed'); assert.equal((await fetch(`${url}/jobs/${job.id}/model.glb`, { headers })).status, 409);
});
test('website proxy keeps worker credentials on the server and limits submissions', async t => {
  const { url, token } = await fixture(t);
  const oldUrl = process.env.IMG2THREEJS_SERVICE_URL, oldToken = process.env.IMG2THREEJS_SERVICE_TOKEN;
  process.env.IMG2THREEJS_SERVICE_URL = url; process.env.IMG2THREEJS_SERVICE_TOKEN = token;
  t.after(() => { if (oldUrl === undefined) delete process.env.IMG2THREEJS_SERVICE_URL; else process.env.IMG2THREEJS_SERVICE_URL = oldUrl; if (oldToken === undefined) delete process.env.IMG2THREEJS_SERVICE_TOKEN; else process.env.IMG2THREEJS_SERVICE_TOKEN = oldToken; });
  const app = express(); app.use('/api/modeling', createModelingRoutes()); const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve)); t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}/api/modeling`;
  const cap = await (await fetch(`${base}/capabilities`)).json(); assert.equal(cap.available, true); assert.ok(!JSON.stringify(cap).includes(token));
  const options = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) };
  const first = await fetch(`${base}/jobs`, options); assert.equal(first.status, 202);
  const job = await first.json(); assert.equal((await fetch(`${base}/jobs`, options)).status, 429);
  for (let i = 0; i < 100; i++) {
    const result = await (await fetch(`${base}/jobs/${job.id}`)).json();
    if (!['queued', 'running'].includes(result.status)) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
});

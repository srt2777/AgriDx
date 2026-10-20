import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, rm, stat, realpath } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_RESULT = 25 * 1024 * 1024;
const TTL = 24 * 60 * 60 * 1000;
const artifactPaths = { 'model.glb': 'model.glb', 'source.ts': 'src/createObjectModel.ts', 'spec.json': 'object-sculpt-spec.json', 'review.json': 'review.json' };
export function validateInput(input) {
  if (!input || typeof input.identity !== 'string' || input.identity.length > 120 || !Array.isArray(input.photos) || !input.photos.length || input.photos.length > 4) throw new Error('请选择 1 至 4 张参考图片。');
  const seen = new Set();
  return input.photos.map(photo => {
    if (!photo || !['front', 'left', 'back', 'right'].includes(photo.angle) || seen.has(photo.angle)) throw new Error('参考视角重复或无效。');
    seen.add(photo.angle);
    const match = typeof photo.dataUrl === 'string' && /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(photo.dataUrl);
    if (!match) throw new Error('图片格式无效。');
    const bytes = Buffer.from(match[2], 'base64');
    const valid = match[1] === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      : match[1] === 'jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
    if (!valid || bytes.length < 24 || bytes.length > MAX_IMAGE_BYTES) throw new Error('每张图片须为 JPG、PNG 或 WebP，且不超过 2 MB。');
    return { angle: photo.angle, extension: match[1] === 'jpeg' ? 'jpg' : match[1], bytes };
  });
}
export function validateGlb(bytes) {
  if (bytes.length < 24 || bytes.length > MAX_RESULT || bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length || bytes.readUInt32LE(16) !== 0x4e4f534a) throw new Error('invalid_glb');
  const length = bytes.readUInt32LE(12);
  if (length > bytes.length - 20) throw new Error('invalid_glb');
  const json = JSON.parse(bytes.toString('utf8', 20, 20 + length));
  if (!json.meshes?.some(mesh => mesh.primitives?.some(primitive => (json.accessors?.[primitive.attributes?.POSITION]?.count ?? 0) >= 3)) || [...(json.buffers ?? []), ...(json.images ?? [])].some(asset => asset.uri && !asset.uri.startsWith('data:'))) throw new Error('invalid_glb');
}
export async function readBounded(file, max = MAX_RESULT, root) {
  if (root && !(await realpath(file)).startsWith((await realpath(root)) + sep)) throw new Error('artifact_outside_job');
  const info = await stat(file);
  if (!info.isFile() || info.size > max) throw new Error('invalid_artifact');
  return readFile(file);
}
export function runProcess(executable, args, { cwd, env, timeout = 30 * 60 * 1000 } = {}) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(executable, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    let output = '';
    const collect = bytes => { output = (output + bytes.toString()).slice(-16_000); };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    function kill() { try { if (process.platform === 'win32') child.kill('SIGKILL'); else process.kill(-child.pid, 'SIGKILL'); } catch { /* exited */ } }
    process.once('exit', kill);
    const timer = setTimeout(kill, timeout);
    child.on('error', error => { clearTimeout(timer); process.removeListener('exit', kill); reject(error); });
    child.on('close', code => { clearTimeout(timer); process.removeListener('exit', kill); if (code === 0) resolveResult(output); else reject(new Error('process_failed')); });
  });
}

/** Separate service: no web-server .env import and no production keys inherited by agents. */
export async function createWorker({ dataDir, token, skillDir, runner, runnerEnv = {}, execute = runProcess }) {
  if (!token || token.length < 32) throw new Error('IMG2THREEJS_WORKER_TOKEN must contain at least 32 characters');
  const root = resolve(dataDir);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const jobs = new Map();
  let active = false;
  let reservations = 0;
  let readiness = { at: 0, value: false };
  const persist = job => writeFile(join(root, job.id, 'job.json'), JSON.stringify(job), { mode: 0o600 });
  for (const id of await readdir(root)) {
    if (!/^[a-f0-9]{64}$/.test(id)) continue;
    try {
      const job = JSON.parse(await readFile(join(root, id, 'job.json'), 'utf8'));
      if (Date.now() - Date.parse(job.createdAt) >= TTL) { await rm(join(root, id), { recursive: true, force: true }); continue; }
      if (['queued', 'running'].includes(job.status)) { job.status = 'failed'; job.message = '建模进程重启，任务已中断，请重新提交。'; await persist(job); }
      jobs.set(id, job);
    } catch { /* An incomplete directory is not an accepted job. */ }
  }
  const expire = async () => {
    for (const [id, job] of jobs) if (!['queued', 'running'].includes(job.status) && Date.now() - Date.parse(job.createdAt) >= TTL) {
      jobs.delete(id); await rm(join(root, id), { recursive: true, force: true });
    }
  };
  async function ready() {
    if (Date.now() - readiness.at < 30_000) return readiness.value;
    let value = false;
    try {
      if (runner && (await stat(runner)).isFile() && (await stat(join(skillDir, 'SKILL.md'))).isFile()) {
        await execute(process.execPath, [runner, '--check'], { env: { PATH: process.env.PATH, ...runnerEnv, IMG2THREEJS_SKILL_DIR: skillDir }, timeout: 15_000 });
        value = true;
      }
    } catch { /* A missing credential/runtime is unavailable, not ready. */ }
    readiness = { at: Date.now(), value }; return value;
  }
  async function drain() {
    if (active) return;
    const job = [...jobs.values()].find(item => item.status === 'queued');
    if (!job) return;
    active = true;
    const directory = join(root, job.id);
    job.status = 'running'; job.message = '正在执行图片分析、分阶段建模与视觉校验。';
    try {
      await persist(job);
      await execute(process.execPath, [runner, directory], { cwd: directory, env: { PATH: process.env.PATH, ...runnerEnv, IMG2THREEJS_SKILL_DIR: skillDir, PYTHONDONTWRITEBYTECODE: '1' } });
      // A launcher exiting successfully is insufficient: re-run the upstream state gate.
      const gate = await execute(runnerEnv.IMG2THREEJS_PYTHON || 'python3', [join(skillDir, 'forge/next.py'), '--state', join(directory, '.img2threejs/state.json')], { cwd: directory, env: { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: '1' }, timeout: 60_000 });
      if (!/^LOCAL_STATE status=complete(?:\s|$)/m.test(gate)) throw new Error('incomplete_pipeline');
      const review = JSON.parse(await readBounded(join(directory, 'review.json'), 64 * 1024, directory));
      if (typeof review.limitations !== 'string' || !review.limitations.trim()) throw new Error('missing_review');
      for (const file of Object.values(artifactPaths)) await readBounded(join(directory, file), MAX_RESULT, directory);
      validateGlb(await readBounded(join(directory, 'model.glb'), MAX_RESULT, directory));
      job.status = 'succeeded'; job.message = review.limitations.slice(0, 1000);
    } catch {
      job.status = 'failed'; job.message = '建模或质量校验未完成。未返回替代模型，请管理员检查运行环境与任务记录。';
    } finally { try { await persist(job); } finally { active = false; void drain().catch(() => {}); } }
  }
  const server = http.createServer(async (req, res) => {
    const send = (code, value) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); };
    const auth = Buffer.from(req.headers.authorization ?? ''); const expected = Buffer.from(`Bearer ${token}`);
    if (auth.length !== expected.length || !timingSafeEqual(auth, expected)) { send(401, { error: 'Unauthorized' }); return; }
    try {
      await expire();
      const path = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && path === '/health') { send(200, { ready: await ready(), engine: 'img2threejs' }); return; }
      if (req.method === 'POST' && path === '/jobs') {
        if (!(await ready())) { send(503, { error: 'img2threejs 运行环境未配置。' }); return; }
        if (reservations + [...jobs.values()].filter(job => ['queued', 'running'].includes(job.status)).length >= 3 || jobs.size + reservations >= 100) { send(429, { error: '建模队列已满，请稍后再试。' }); return; }
        reservations++;
        try {
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 12 * 1024 * 1024) { send(413, { error: '图片总量超限。' }); return; } chunks.push(chunk); }
        let input, photos;
        try { input = JSON.parse(Buffer.concat(chunks)); photos = validateInput(input); }
        catch (error) { send(400, { error: error.message }); return; }
        const id = randomBytes(32).toString('hex'); const directory = join(root, id);
        await mkdir(join(directory, 'references'), { recursive: true, mode: 0o700 });
        const references = [];
        for (const photo of photos) { const file = `references/${photo.angle}.${photo.extension}`; await writeFile(join(directory, file), photo.bytes, { mode: 0o600 }); references.push({ angle: photo.angle, file }); }
        await writeFile(join(directory, 'request.json'), JSON.stringify({ identity: input.identity, references }), { mode: 0o600 });
        const job = { id, createdAt: new Date().toISOString(), status: 'queued', message: '已进入 img2threejs 建模队列。' };
        await persist(job); jobs.set(id, job); send(202, job); void drain().catch(() => {}); return;
        } finally { reservations--; }
      }
      const match = /^\/jobs\/([a-f0-9]{64})(?:\/(model\.glb|source\.ts|spec\.json|review\.json))?$/.exec(path);
      const job = match && jobs.get(match[1]);
      if (!job) { send(404, { error: '任务不存在或已过期。' }); return; }
      if (req.method !== 'GET') { send(405, { error: 'Method not allowed' }); return; }
      if (!match[2]) { send(200, job); return; }
      if (job.status !== 'succeeded') { send(409, { error: '生成结果尚不可用。' }); return; }
      const bytes = await readBounded(join(root, job.id, artifactPaths[match[2]]), MAX_RESULT, join(root, job.id));
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(bytes);
    } catch { send(500, { error: '建模服务内部错误。' }); }
  });
  return server;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await createWorker({
    dataDir: process.env.IMG2THREEJS_DATA_DIR || './work/img2threejs', token: process.env.IMG2THREEJS_WORKER_TOKEN,
    skillDir: resolve(process.env.IMG2THREEJS_SKILL_DIR || './missing-img2threejs'),
    runner: resolve(process.env.IMG2THREEJS_RUNNER || './integrations/img2threejs/run-codex.mjs'),
    runnerEnv: { HOME: process.env.IMG2THREEJS_AGENT_HOME, CODEX_HOME: process.env.IMG2THREEJS_CODEX_HOME, IMG2THREEJS_RUNTIME_DIR: process.env.IMG2THREEJS_RUNTIME_DIR, IMG2THREEJS_PYTHON: process.env.IMG2THREEJS_PYTHON },
  });
  server.requestTimeout = 60_000;
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
    server.closeAllConnections(); server.close(); process.exit(0);
  });
  server.listen(Number(process.env.IMG2THREEJS_WORKER_PORT || 3011), process.env.IMG2THREEJS_BIND || '127.0.0.1', () => console.log('img2threejs worker listening'));
}

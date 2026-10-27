import { handleAiRequest, aiStatus, gatewayInfo } from './ai.js';

const artifactOrigin = 'https://raw.githubusercontent.com/srt2777/AgriDx/dev-preview-built/';
const types = {
  html: 'text/html; charset=utf-8', js: 'application/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', glb: 'model/gltf-binary', woff2: 'font/woff2',
  txt: 'text/plain; charset=utf-8',
};

export async function servePreview(request, upstreamFetch = fetch) {
  const url = new URL(request.url);
  if (!['GET', 'HEAD'].includes(request.method)) {
    return Response.json({ error: '开发预览的诊断在浏览器本地运行。' }, { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  let file;
  try { file = decodeURIComponent(url.pathname).slice(1) || 'index.html'; }
  catch { return new Response('Invalid path', { status: 400 }); }
  if (file === 'api/health') {
    const response = await upstreamFetch(`${artifactOrigin}dev-preview.json?t=${Date.now()}`, { redirect: 'manual' });
    if (!response.ok) return Response.json({ ok: false, environment: 'development-preview' }, { status: 503 });
    return Response.json({
      ...await response.json(), ok: true, environment: 'development-preview',
      llm: { configured: false, primary: null },
    }, { headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
  }
  if (file.split('/').some((part) => !part || part === '.' || part === '..') || /[\\\u0000-\u001f]/.test(file) ||
    !(/^(assets|images|models|licenses|fonts)\//.test(file) || ['index.html', 'favicon.svg', 'dev-preview.json', 'theme-init.js'].includes(file))) {
    return new Response('Not found', { status: 404 });
  }
  const mutable = !/^assets\/.+-[A-Za-z0-9_-]{8}\.(js|css)$/.test(file);
  const target = `${artifactOrigin}${file}${mutable ? `?t=${Date.now()}` : ''}`;
  try {
    // Forward no visitor cookies, login headers, query parameters or production traffic.
    const response = await upstreamFetch(target, { redirect: 'manual' });
    if (!response.ok) return new Response('Preview asset unavailable', { status: response.status === 404 ? 404 : 502 });
    const extension = file.split('.').at(-1);
    const headers = {
      'Content-Type': types[extension] || 'application/octet-stream',
      'Cache-Control': mutable ? 'no-store' : 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer',
    };
    return new Response(request.method === 'HEAD' ? null : response.body, { headers });
  } catch (error) {
    console.error('[dev-preview] upstream fetch failed:', error instanceof Error ? error.message : 'unknown');
    return new Response('Development preview temporarily unavailable', { status: 502 });
  }
}

const repository = 'srt2777/AgriDx';
const adminCookie = '__Host-agridx-admin';
const visitorCookie = '__Host-agridx-visitor';
const day = 86_400_000;
const privateHeaders = { 'Cache-Control': 'private, no-store', Vary: 'Cookie', 'X-Robots-Tag': 'noindex', 'X-Content-Type-Options': 'nosniff' };
const apiJson = (data, status = 200, headers = {}) => Response.json(data, { status, headers: { ...privateHeaders, ...headers } });
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const text = (value, max = 100) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const token = () => [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join('');
const hash = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(b => b.toString(16).padStart(2, '0')).join('');
const cookie = (name, value, age) => `${name}=${value}; Path=/; Max-Age=${age}; HttpOnly; Secure; SameSite=Strict`;
function readCookie(request, name) {
  return request.headers.get('Cookie')?.split(';').map(v => v.trim()).find(v => v.startsWith(`${name}=`))?.slice(name.length + 1) ?? '';
}
async function bodyJson(request, maxBytes = 12_000) {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) fail(415, '请使用 JSON 请求。');
  if (Number(request.headers.get('Content-Length')) > maxBytes) fail(413, '请求内容过长。');
  const reader = request.body?.getReader();
  if (!reader) fail(400, '请求内容缺失。');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0, raw = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); fail(413, '请求内容过长。'); }
    try { raw += decoder.decode(value, { stream: true }); } catch { fail(400, '请求编码无效。'); }
  }
  try {
    const data = JSON.parse(raw + decoder.decode());
    if (!data || typeof data !== 'object' || Array.isArray(data)) fail(400, '请求格式错误。');
    return data;
  } catch { fail(400, '请求格式错误。'); }
}
async function rateLimit(request, db, kind, limit) {
  const now = Date.now(), minute = Math.floor(now / 60_000);
  // Raw IPs are never stored. This digest is used only for a short-lived abuse limit.
  const network = request.headers.get('CF-Connecting-IP') || 'unknown-network';
  const key = `${kind}:${minute}:${await hash(`agridx-dev:${network}`)}`;
  await db.prepare('INSERT INTO preview_rate_limits (key, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1').bind(key, now + 120_000).run();
  const row = await db.prepare('SELECT count FROM preview_rate_limits WHERE key = ?').bind(key).first();
  if (row.count > limit) fail(429, '请求频率过高，请稍后重试。');
}
async function session(request, db) {
  const value = readCookie(request, adminCookie);
  if (!/^[a-f0-9]{64}$/.test(value) || !db) return null;
  return db.prepare('SELECT github_login AS login, github_id AS id, expires_at AS expiresAt FROM preview_admin_sessions WHERE token_hash = ? AND expires_at > ?').bind(await hash(value), Date.now()).first();
}
function visitorDetails(request) {
  const ua = request.headers.get('User-Agent') || '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Other';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Other';
  const device = /iPad|Tablet/.test(ua) ? 'tablet' : /Mobi|Android|iPhone/.test(ua) ? 'mobile' : 'desktop';
  const country = request.cf?.country || request.headers.get('CF-IPCountry') || '--';
  return { browser, os, device, country: /^[A-Z]{2}$/.test(country) ? country : '--' };
}
async function visitor(request, db) {
  const existing = readCookie(request, visitorCookie);
  if (/^[a-f0-9]{64}$/.test(existing)) {
    const row = await db.prepare('SELECT id FROM preview_visitors WHERE id = ?').bind(existing).first();
    if (row) {
      await db.prepare('UPDATE preview_visitors SET last_seen = ? WHERE id = ?').bind(Date.now(), existing).run();
      return { id: existing, headers: {} };
    }
  }
  const id = token(), now = Date.now(), info = visitorDetails(request);
  await db.prepare('INSERT INTO preview_visitors (id, first_seen, last_seen, browser, os, device, country) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, now, now, info.browser, info.os, info.device, info.country).run();
  return { id, headers: { 'Set-Cookie': cookie(visitorCookie, id, 30 * 86_400) } };
}
let lastCleanup = 0;
function cleanup(db, ctx) {
  if (!ctx.waitUntil || Date.now() - lastCleanup < 3_600_000) return;
  lastCleanup = Date.now();
  const now = Date.now(), cutoff = now - 30 * day;
  ctx.waitUntil(db.batch([
    db.prepare('DELETE FROM preview_visits WHERE occurred_at < ?').bind(cutoff),
    db.prepare('DELETE FROM preview_questions WHERE occurred_at < ?').bind(cutoff),
    db.prepare('DELETE FROM preview_visitors WHERE last_seen < ?').bind(cutoff),
    db.prepare('DELETE FROM preview_admin_sessions WHERE expires_at < ?').bind(now),
    db.prepare('DELETE FROM preview_rate_limits WHERE expires_at < ?').bind(now),
  ]).catch(() => console.error('[dev-admin] record cleanup failed')));
}
function range(url) {
  const days = Number(url.searchParams.get('days') || 7);
  if (![1, 7, 30].includes(days)) fail(400, '时间范围须为 1、7 或 30 天。');
  const start = Math.floor((Date.now() + 8 * 3_600_000) / day) * day - 8 * 3_600_000 - (days - 1) * day;
  return { days, start };
}
async function summary(db, url) {
  const { days, start } = range(url);
  const results = await db.batch([
    db.prepare('SELECT COUNT(*) AS views, COUNT(DISTINCT visitor_id) AS visitors FROM preview_visits WHERE occurred_at >= ?').bind(start),
    db.prepare("SELECT COUNT(*) AS questions, SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END) AS answered, SUM(CASE WHEN outcome = 'success' AND knowledge_chunks > 0 THEN 1 ELSE 0 END) AS grounded, ROUND(AVG(latency_ms)) AS latencyMs FROM preview_questions WHERE occurred_at >= ?").bind(start),
    db.prepare("SELECT strftime('%Y-%m-%d', occurred_at / 1000, 'unixepoch', '+8 hours') AS date, COUNT(*) AS views, COUNT(DISTINCT visitor_id) AS visitors FROM preview_visits WHERE occurred_at >= ? GROUP BY date ORDER BY date").bind(start),
    db.prepare('SELECT path, COUNT(*) AS views FROM preview_visits WHERE occurred_at >= ? GROUP BY path ORDER BY views DESC LIMIT 8').bind(start),
    db.prepare("SELECT COALESCE(NULLIF(model, ''), '未指定型号') AS model, COUNT(*) AS questions FROM preview_questions WHERE occurred_at >= ? GROUP BY model ORDER BY questions DESC LIMIT 8").bind(start),
    db.prepare('SELECT MIN(first_seen) AS firstSeen FROM preview_visitors'),
  ]);
  return {
    days, ...results[0].results[0], ...results[1].results[0],
    trend: Array.from({ length: days }, (_, i) => {
      const date = new Date(start + i * day + 8 * 3_600_000).toISOString().slice(0, 10);
      return results[2].results.find(row => row.date === date) || { date, views: 0, visitors: 0 };
    }), pages: results[3].results, models: results[4].results,
    firstSeen: results[5].results[0].firstSeen, retentionDays: 30, observedAt: Date.now(),
  };
}
async function listRecords(db, url, kind, exporting = false) {
  const { start } = range(url);
  const page = Number(url.searchParams.get('page') || 1);
  if (!Number.isInteger(page) || page < 1 || page > 100_000) fail(400, '页码无效。');
  const query = text(url.searchParams.get('q'), 100);
  const like = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
  const questions = kind === 'questions';
  const fields = questions ? 'id, visitor_id AS visitorId, occurred_at AS occurredAt, question, machine_type AS machineType, brand, model, outcome, knowledge_chunks AS knowledgeChunks, latency_ms AS latencyMs, release' : 'id, first_seen AS firstSeen, last_seen AS lastSeen, browser, os, device, country, (SELECT COUNT(*) FROM preview_visits v WHERE v.visitor_id = preview_visitors.id AND v.occurred_at >= ?) AS views, (SELECT COUNT(*) FROM preview_questions q WHERE q.visitor_id = preview_visitors.id AND q.occurred_at >= ?) AS questions';
  const table = questions ? 'preview_questions' : 'preview_visitors';
  const timestamp = questions ? 'occurred_at' : 'last_seen';
  const filter = questions ? "(question LIKE ? ESCAPE '\\' OR model LIKE ? ESCAPE '\\' OR visitor_id LIKE ? ESCAPE '\\')" : "(id LIKE ? ESCAPE '\\' OR browser LIKE ? ESCAPE '\\' OR os LIKE ? ESCAPE '\\')";
  const where = `${timestamp} >= ? AND ${filter}`;
  const args = [start, like, like, like];
  const size = exporting ? 5000 : 25;
  const results = await db.batch([
    db.prepare(`SELECT ${fields} FROM ${table} WHERE ${where} ORDER BY ${timestamp} DESC, id DESC LIMIT ? OFFSET ?`).bind(...(questions ? [] : [start, start]), ...args, size, exporting ? 0 : (page - 1) * size),
    db.prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE ${where}`).bind(...args),
  ]);
  return { rows: results[0].results, total: results[1].results[0].total, page, pageSize: size, observedAt: Date.now() };
}
let githubCache;
async function systemStatus(upstreamFetch) {
  const now = Date.now();
  const get = async (path) => {
    const r = await upstreamFetch(`https://api.github.com/repos/${repository}/${path}`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'AgriDx-development-console', 'X-GitHub-Api-Version': '2022-11-28' }, redirect: 'manual', signal: AbortSignal.timeout(8000) });
    if (!r.ok) fail(502, `GitHub 状态暂不可用（${r.status}）。`);
    return r.json();
  };
  const github = async () => {
    if (githubCache && now - githubCache.observedAt < 300_000) return githubCache;
    const [commit, runs] = await Promise.all([get('commits/main'), get('actions/runs?branch=main&per_page=8')]);
    githubCache = {
      observedAt: now, error: null,
      main: { sha: commit.sha, message: commit.commit.message.split('\n')[0], date: commit.commit.committer.date, url: commit.html_url },
      runs: runs.workflow_runs.map(r => ({ id: r.id, name: r.name, status: r.status, conclusion: r.conclusion, sha: r.head_sha, updatedAt: r.updated_at, url: r.html_url })),
    };
    return githubCache;
  };
  const [git, artifact] = await Promise.allSettled([
    github(),
    upstreamFetch(`${artifactOrigin}dev-preview.json?t=${now}`, { redirect: 'manual', signal: AbortSignal.timeout(8000) }).then(async r => { if (!r.ok) fail(502, '开发版本记录暂不可用。'); return r.json(); }),
  ]);
  return {
    observedAt: now, repository,
    github: git.status === 'fulfilled' ? git.value : { error: git.reason.message, stale: githubCache ?? null },
    artifact: artifact.status === 'fulfilled' ? artifact.value : null,
    artifactError: artifact.status === 'rejected' ? artifact.reason.message : null,
    gateway: { runtime: 'Cloudflare Workers', storage: 'Cloudflare D1', ...(globalThis.__AGRIDX_GATEWAY_RELEASE__ || {}) },
    servers: [{ name: '腾讯云正式站', url: 'https://agridx.xyz', status: 'not-connected', detail: '本轮仅接入开发站；未读取正式站访问、问答或服务器日志。' }],
  };
}
function csv(data, kind) {
  const fields = data.rows.length ? Object.keys(data.rows[0]) : kind === 'questions' ? ['id', 'visitorId', 'occurredAt', 'question', 'machineType', 'brand', 'model', 'outcome', 'knowledgeChunks', 'latencyMs', 'release'] : ['id', 'firstSeen', 'lastSeen', 'browser', 'os', 'device', 'country', 'views', 'questions'];
  const cell = value => {
    let s = String(value ?? '');
    if (/^[=+@\-\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replaceAll('"', '""')}"`;
  };
  return '\ufeff' + [fields.map(cell).join(','), ...data.rows.map(row => fields.map(key => cell(row[key])).join(','))].join('\r\n');
}

/** Private records stay behind server-side GitHub authorization; public collection has no read API. */
export async function serveDevelopment(request, env = {}, ctx = {}, upstreamFetch = fetch) {
  const url = new URL(request.url), path = url.pathname;
  if (path === '/api/health' && request.method === 'GET') {
    const response = await servePreview(request, upstreamFetch);
    if (!response.ok) return response;
    let status = { enabled: false, provider: null, model: null };
    try { if (env.DB) status = await aiStatus(env.DB, env); } catch { /* Old gateways without the AI migration retain local diagnosis. */ }
    return apiJson({ ...await response.json(), ...gatewayInfo, gatewaySourceHash: globalThis.__AGRIDX_GATEWAY_RELEASE__?.sourceHash || null, llm: { configured: status.enabled, primary: status.provider, model: status.model }, coordination: { defaultMode: status.enabled ? 'auto' : 'knowledge_only', allowExternalAi: status.enabled, configValid: true } });
  }
  if (!path.startsWith('/api/dev-admin/') && !path.startsWith('/api/dev-events/') && !path.startsWith('/api/dev-ai/')) return servePreview(request, upstreamFetch);
  try {
    const db = env.DB;
    if (path === '/api/dev-admin/session' && request.method === 'GET') return apiJson({ user: await session(request, db), configured: Boolean(db), repository, ...gatewayInfo, gatewaySourceHash: globalThis.__AGRIDX_GATEWAY_RELEASE__?.sourceHash || null });
    if (request.method === 'POST' && request.headers.get('Origin') !== url.origin) fail(403, '此操作须从开发站页面发起。');
    const collection = path.startsWith('/api/dev-events/');
    const publicAi = path.startsWith('/api/dev-ai/');
    const loggingIn = path === '/api/dev-admin/login';
    const user = collection || loggingIn || publicAi ? null : await session(request, db);
    if (!collection && !loggingIn && !publicAi && !user) fail(401, '请先使用 GitHub 管理员账号登录。');
    if (!db) fail(503, '内部数据存储尚未配置。');
    cleanup(db, ctx);
    const aiResponse = await handleAiRequest(request, env, { user, readJson: bodyJson, rateLimit, json: apiJson }, upstreamFetch);
    if (aiResponse) return aiResponse;
    if (loggingIn && request.method === 'POST') {
      await rateLimit(request, db, 'login', 8);
      const body = await bodyJson(request);
      if (typeof body.token !== 'string' || !/^[A-Za-z0-9_]{20,255}$/.test(body.token)) fail(400, '请填写有效的 GitHub 令牌。');
      if (body.remember !== undefined && typeof body.remember !== 'boolean') fail(400, '记住设备的选项格式无效。');
      const headers = { Authorization: `Bearer ${body.token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'AgriDx-development-console', 'X-GitHub-Api-Version': '2022-11-28' };
      const profileResponse = await upstreamFetch('https://api.github.com/user', { headers, redirect: 'manual', signal: AbortSignal.timeout(8000) });
      if (profileResponse.status === 401) fail(401, 'GitHub 令牌无效或已过期。');
      if (!profileResponse.ok) fail(502, 'GitHub 身份验证暂不可用，请稍后重试。');
      const profile = await profileResponse.json();
      const repoResponse = await upstreamFetch(`https://api.github.com/repos/${repository}`, { headers, redirect: 'manual', signal: AbortSignal.timeout(8000) });
      if (!repoResponse.ok) fail(403, '无法确认仓库管理权限。');
      const repo = await repoResponse.json();
      if (!repo.permissions?.admin && !repo.permissions?.maintain) fail(403, '只有该仓库的管理员或维护者可以查看内部数据。');
      if (typeof profile.login !== 'string' || !Number.isSafeInteger(profile.id)) fail(502, 'GitHub 身份响应无效。');
      const lifetime = body.remember ? 30 * 86_400 : 3600;
      const value = token(), expiresAt = Date.now() + lifetime * 1000;
      await db.prepare('INSERT INTO preview_admin_sessions (token_hash, github_login, github_id, expires_at) VALUES (?, ?, ?, ?)').bind(await hash(value), profile.login, profile.id, expiresAt).run();
      return apiJson({ user: { login: profile.login, id: profile.id, expiresAt } }, 200, { 'Set-Cookie': cookie(adminCookie, value, lifetime) });
    }
    if (path === '/api/dev-admin/logout' && request.method === 'POST') {
      await db.prepare('DELETE FROM preview_admin_sessions WHERE token_hash = ?').bind(await hash(readCookie(request, adminCookie))).run();
      return apiJson({ ok: true }, 200, { 'Set-Cookie': cookie(adminCookie, '', 0) });
    }
    if (collection && request.method === 'POST' && ['/api/dev-events/visit', '/api/dev-events/question'].includes(path)) {
      await rateLimit(request, db, 'events', 120);
      const data = await bodyJson(request);
      if (typeof data.id !== 'string' || !/^[A-Za-z0-9-]{16,64}$/.test(data.id)) fail(400, '记录编号无效。');
      if (path.endsWith('/visit') && !['/', '/chat', '/knowledge', '/models'].includes(data.path)) fail(400, '访问页面无效。');
      if (path.endsWith('/question') && (typeof data.question !== 'string' || !data.question.trim() || data.question.length > 2000 || !['success', 'error', 'cancelled'].includes(data.outcome))) fail(400, '提问记录无效。');
      const v = await visitor(request, db);
      if (path.endsWith('/visit')) {
        let referrer = '';
        try { referrer = new URL(text(data.referrer, 500)).hostname; } catch { /* Direct visits have no referrer. */ }
        await db.prepare('INSERT OR IGNORE INTO preview_visits (id, visitor_id, occurred_at, path, referrer) VALUES (?, ?, ?, ?, ?)').bind(data.id, v.id, Date.now(), data.path, referrer).run();
      } else {
        const chunks = Math.max(0, Math.min(1000, Math.round(Number(data.knowledgeChunks) || 0)));
        const latency = Math.max(0, Math.min(600_000, Math.round(Number(data.latencyMs) || 0)));
        await db.prepare('INSERT OR IGNORE INTO preview_questions (id, visitor_id, occurred_at, question, machine_type, brand, model, outcome, knowledge_chunks, latency_ms, release) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(data.id, v.id, Date.now(), data.question.trim(), text(data.machineType), text(data.brand), text(data.model), data.outcome, chunks, latency, text(data.release, 64)).run();
      }
      return apiJson({ ok: true }, 202, v.headers);
    }
    if (request.method === 'GET') {
      if (path === '/api/dev-admin/summary') return apiJson(await summary(db, url));
      if (path === '/api/dev-admin/system') return apiJson(await systemStatus(upstreamFetch));
      if (path === '/api/dev-admin/visitors' || path === '/api/dev-admin/questions') return apiJson(await listRecords(db, url, path.split('/').at(-1)));
      if (path === '/api/dev-admin/export') {
        const kind = url.searchParams.get('kind');
        if (!['visitors', 'questions'].includes(kind)) fail(400, '导出类型无效。');
        const data = await listRecords(db, url, kind, true);
        return new Response(csv(data, kind), { headers: { ...privateHeaders, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="agridx-${kind}.csv"` } });
      }
    }
    return apiJson({ error: '接口或请求方式不存在。' }, 404);
  } catch (error) {
    if (!error.status) console.error('[dev-admin] request failed');
    return apiJson({ error: error.status ? error.message : '内部数据服务暂不可用，请稍后重试。', ...(error.kind ? { errorKind: error.kind } : {}) }, error.status || 503, error.status === 429 ? { 'Retry-After': '60' } : {});
  }
}

export default { fetch: (request, env, ctx) => serveDevelopment(request, env, ctx) };

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { serveDevelopment } from '../scripts/dev-preview-gateway/worker.js';

const origin = 'https://preview.example';
const fakeCredential = 'notARealGitHubCredential123456789';
function database() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../scripts/dev-preview-gateway/drizzle/', import.meta.url)).filter(f => f.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(new URL(`../scripts/dev-preview-gateway/drizzle/${file}`, import.meta.url), 'utf8'));
  }
  const db = {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql);
      let values: any[] = [];
      const prepared = {
        bind(...args: any[]) { values = args; return prepared; },
        async first() { return statement.get(...values) ?? null; },
        async all() { return { results: statement.all(...values), success: true }; },
        async run() { const result = statement.run(...values); return { success: true, meta: { changes: Number(result.changes) } }; },
      };
      return prepared;
    },
    async batch(statements: any[]) {
      sqlite.exec('BEGIN');
      try { const rows = []; for (const statement of statements) rows.push(await statement.all()); sqlite.exec('COMMIT'); return rows; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  return { db, sqlite };
}
const upstream = async (url: string, options?: RequestInit) => {
  assert.equal(new URL(url).hostname, 'api.github.com');
  assert.equal((options?.headers as Record<string, string>).Authorization, `Bearer ${fakeCredential}`);
  assert.equal(options?.redirect, 'manual');
  return Response.json(url.endsWith('/user') ? { login: 'owner', id: 123 } : { permissions: { admin: true } });
};
function post(path: string, body: object = {}, cookies = '', requestOrigin = origin) {
  return new Request(`${origin}${path}`, { method: 'POST', headers: { Origin: requestOrigin, 'Content-Type': 'application/json', Cookie: cookies, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0 Safari/537.36 Edg/140.0', 'CF-Connecting-IP': '192.0.2.5' }, body: JSON.stringify(body) });
}
function get(path: string, cookies = '') { return new Request(`${origin}${path}`, { headers: { Cookie: cookies } }); }
const cookieValue = (response: Response) => response.headers.get('Set-Cookie')!.split(';')[0];
async function login(db: any) { return cookieValue(await serveDevelopment(post('/api/dev-admin/login', { token: fakeCredential }), { DB: db }, {}, upstream)); }

test('内部记录、版本和CSV接口拒绝匿名及伪造身份，不读取外部接口', async t => {
  const { db, sqlite } = database(); t.after(() => sqlite.close());
  const reject = async () => { throw new Error('Must not perform an external request'); };
  for (const path of ['summary', 'visitors', 'questions', 'system', 'export?kind=questions']) {
    const response = await serveDevelopment(get(`/api/dev-admin/${path}`, '__Host-agridx-admin=' + 'a'.repeat(64)), { DB: db }, {}, reject);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    assert.equal(response.headers.get('Set-Cookie'), null);
    assert.match((await response.json()).error, /登录/);
  }
  const forged = new Request(`${origin}/api/dev-admin/summary`, { headers: { 'oai-authenticated-user-id': 'forged', 'oai-authenticated-user-email': 'owner@example.com' } });
  assert.equal((await serveDevelopment(forged, { DB: db }, {}, reject)).status, 401);
  const session = await (await serveDevelopment(get('/api/dev-admin/session'), { DB: db }, {}, reject)).json();
  assert.equal(session.user, null);
  assert.equal(session.configured, true);
  assert.equal(session.repository, 'srt2777/AgriDx');
  assert.equal(session.schemaVersion, 2);
  assert.equal(session.capabilities.toolCalls, false);
});

test('GitHub验证管理员权限，令牌不落库，会话仅存摘要且能过期与退出', async t => {
  const { db, sqlite } = database(); t.after(() => sqlite.close());
  const response = await serveDevelopment(post('/api/dev-admin/login', { token: fakeCredential }), { DB: db }, {}, upstream);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Set-Cookie')!, /HttpOnly; Secure; SameSite=Strict/);
  const cookies = cookieValue(response);
  const saved = sqlite.prepare('SELECT * FROM preview_admin_sessions').all();
  assert.equal(saved.length, 1);
  assert.equal(JSON.stringify(saved).includes(fakeCredential), false);
  assert.notEqual(saved[0].token_hash, cookies.split('=')[1]);
  assert.equal((await (await serveDevelopment(get('/api/dev-admin/session', cookies), { DB: db })).json()).user.login, 'owner');
  const out = await serveDevelopment(post('/api/dev-admin/logout', {}, cookies), { DB: db });
  assert.equal(out.status, 200); assert.match(out.headers.get('Set-Cookie')!, /Max-Age=0/);
  assert.equal((await serveDevelopment(get('/api/dev-admin/summary', cookies), { DB: db })).status, 401);
  const expires = await login(db);
  sqlite.prepare('UPDATE preview_admin_sessions SET expires_at = 0').run();
  assert.equal((await serveDevelopment(get('/api/dev-admin/questions', expires), { DB: db })).status, 401);
});

test('记住设备可在一小时后恢复登录，期限固定为30天且到期拒绝读取', async t => {
  const { db, sqlite } = database(); t.after(() => sqlite.close());
  const startedAt = Date.now();
  let now = startedAt;
  t.mock.method(Date, 'now', () => now);
  const response = await serveDevelopment(post('/api/dev-admin/login', { token: fakeCredential, remember: true }), { DB: db }, {}, upstream);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Set-Cookie')!, /Max-Age=2592000; HttpOnly; Secure; SameSite=Strict/);
  const cookies = cookieValue(response);
  const expiresAt = startedAt + 30 * 86_400_000;
  assert.equal((await response.json()).user.expiresAt, expiresAt);
  const saved = sqlite.prepare('SELECT * FROM preview_admin_sessions').get()!;
  assert.equal(saved.expires_at, expiresAt);
  assert.equal(JSON.stringify(saved).includes(fakeCredential), false);
  assert.notEqual(saved.token_hash, cookies.split('=')[1]);

  for (const elapsed of [2 * 3_600_000, 29 * 86_400_000, 30 * 86_400_000 - 1]) {
    now = startedAt + elapsed;
    const restored = await serveDevelopment(get('/api/dev-admin/session', cookies), { DB: db });
    assert.deepEqual((await restored.json()).user, { login: 'owner', id: 123, expiresAt });
    assert.equal(restored.headers.get('Set-Cookie'), null);
    assert.equal((await serveDevelopment(get('/api/dev-admin/summary', cookies), { DB: db })).status, 200);
    assert.equal(sqlite.prepare('SELECT expires_at FROM preview_admin_sessions').get()!.expires_at, expiresAt);
  }
  now = expiresAt;
  assert.equal((await (await serveDevelopment(get('/api/dev-admin/session', cookies), { DB: db })).json()).user, null);
  for (const path of ['questions', 'visitors', 'export?kind=questions']) {
    assert.equal((await serveDevelopment(get(`/api/dev-admin/${path}`, cookies), { DB: db })).status, 401);
  }
});

test('取消记住设备及旧客户端保留一小时会话，并按服务器期限失效', async t => {
  const { db, sqlite } = database(); t.after(() => sqlite.close());
  const startedAt = Date.now();
  let now = startedAt;
  t.mock.method(Date, 'now', () => now);
  const cookies: string[] = [];
  for (const option of [{ remember: false }, {}]) {
    const response = await serveDevelopment(post('/api/dev-admin/login', { token: fakeCredential, ...option }), { DB: db }, {}, upstream);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('Set-Cookie')!, /Max-Age=3600;/);
    assert.equal((await response.json()).user.expiresAt, startedAt + 3_600_000);
    cookies.push(cookieValue(response));
  }
  now = startedAt + 3_600_000 - 1;
  for (const value of cookies) assert.equal((await (await serveDevelopment(get('/api/dev-admin/session', value), { DB: db })).json()).user.login, 'owner');
  now++;
  for (const value of cookies) {
    assert.equal((await (await serveDevelopment(get('/api/dev-admin/session', value), { DB: db })).json()).user, null);
    assert.equal((await serveDevelopment(get('/api/dev-admin/summary', value), { DB: db })).status, 401);
  }
});

test('记住设备仍需有效会话，退出立即撤销所有读取和导出权限', async t => {
  const { db, sqlite } = database(); t.after(() => sqlite.close());
  const response = await serveDevelopment(post('/api/dev-admin/login', { token: fakeCredential, remember: true }), { DB: db }, {}, upstream);
  const cookies = cookieValue(response);
  assert.equal((await (await serveDevelopment(get('/api/dev-admin/session'), { DB: db })).json()).user, null);
  assert.equal((await (await serveDevelopment(get('/api/dev-admin/session', '__Host-agridx-admin=' + 'a'.repeat(64)), { DB: db })).json()).user, null);
  const out = await serveDevelopment(post('/api/dev-admin/logout', {}, cookies), { DB: db });
  assert.equal(out.status, 200);
  assert.match(out.headers.get('Set-Cookie')!, /^__Host-agridx-admin=; Path=\/; Max-Age=0; HttpOnly; Secure; SameSite=Strict$/);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM preview_admin_sessions').get()!.count, 0);
  assert.equal((await (await serveDevelopment(get('/api/dev-admin/session', cookies), { DB: db })).json()).user, null);
  for (const path of ['summary', 'questions', 'visitors', 'system', 'export?kind=questions']) {
    assert.equal((await serveDevelopment(get(`/api/dev-admin/${path}`, cookies), { DB: db })).status, 401);
  }
});

test('记住设备选项拒绝非布尔值，验证失败不访问GitHub或创建会话', async t => {
  const { db, sqlite } = database(); t.after(() => sqlite.close());
  const reject = async () => { throw new Error('Must not perform an external request'); };
  for (const remember of ['false', 1, null, {}, []]) {
    const response = await serveDevelopment(post('/api/dev-admin/login', { token: fakeCredential, remember }), { DB: db }, {}, reject);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /选项格式无效/);
    assert.equal(response.headers.get('Set-Cookie'), null);
  }
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM preview_admin_sessions').get()!.count, 0);
});

test('普通GitHub用户、无效令牌及跨站登录无法建立管理员会话', async t => {
  const { db, sqlite } = database(); t.after(() => sqlite.close());
  const reader = async (url: string) => Response.json(url.endsWith('/user') ? { login: 'reader', id: 999 } : { permissions: { pull: true, push: true } });
  assert.equal((await serveDevelopment(post('/api/dev-admin/login', { token: fakeCredential, remember: true }), { DB: db }, {}, reader)).status, 403);
  assert.equal((await serveDevelopment(post('/api/dev-admin/login', { token: fakeCredential, remember: true }), { DB: db }, {}, async () => new Response('', { status: 401 }))).status, 401);
  assert.equal((await serveDevelopment(post('/api/dev-admin/login', { token: fakeCredential, remember: true }, '', 'https://attacker.example'), { DB: db }, {}, upstream)).status, 403);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM preview_admin_sessions').get()!.count, 0);
});

test('集中采集访问与当前提问，重复上报去重，保留机型、结果并可筛选分页', async t => {
  const { db, sqlite } = database(); t.after(() => sqlite.close());
  const first = await serveDevelopment(post('/api/dev-events/visit', { id: 'visit-event-000001', path: '/chat', referrer: 'https://search.example/path?secret=ignored' }), { DB: db });
  assert.equal(first.status, 202); const visitor = cookieValue(first);
  assert.equal((await serveDevelopment(post('/api/dev-events/visit', { id: 'visit-event-000001', path: '/chat' }, visitor), { DB: db })).status, 202);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM preview_visits').get()!.count, 1);
  assert.equal(sqlite.prepare('SELECT referrer FROM preview_visits').get()!.referrer, 'search.example');
  for (let i = 0; i < 26; i++) {
    const r = await serveDevelopment(post('/api/dev-events/question', { id: `question-event-${String(i).padStart(6, '0')}`, question: i === 0 ? '发动机难启动，含100%与_符号' : `问题${i}`, brand: 'John Deere', model: '6B-1204', outcome: i === 25 ? 'error' : 'success', knowledgeChunks: i === 25 ? 0 : 4, latencyMs: 32, release: 'a'.repeat(40) }, visitor), { DB: db });
    assert.equal(r.status, 202);
  }
  const admin = await login(db);
  await serveDevelopment(post('/api/dev-events/question', { id: 'question-event-000000', question: '重复请求不会覆盖原记录', outcome: 'success' }, visitor), { DB: db });
  const stats = await (await serveDevelopment(get('/api/dev-admin/summary?days=7', admin), { DB: db })).json();
  assert.equal(stats.views, 1); assert.equal(stats.visitors, 1); assert.equal(stats.questions, 26); assert.equal(stats.answered, 25); assert.equal(stats.grounded, 25);
  assert.equal(stats.trend.length, 7); assert.equal(stats.trend.reduce((n: number, row: any) => n + row.views, 0), 1);
  const firstPage = await (await serveDevelopment(get('/api/dev-admin/questions?page=1', admin), { DB: db })).json();
  const secondPage = await (await serveDevelopment(get('/api/dev-admin/questions?page=2', admin), { DB: db })).json();
  assert.equal(firstPage.rows.length, 25); assert.equal(secondPage.rows.length, 1); assert.equal(firstPage.total, 26);
  const filter = await (await serveDevelopment(get('/api/dev-admin/questions?q=100%25', admin), { DB: db })).json();
  assert.equal(filter.rows.length, 1); assert.match(filter.rows[0].question, /发动机/);
  const injection = await (await serveDevelopment(get('/api/dev-admin/questions?q=%27%20OR%201%3D1%20--', admin), { DB: db })).json();
  assert.equal(injection.rows.length, 0);
  const people = await (await serveDevelopment(get('/api/dev-admin/visitors', admin), { DB: db })).json();
  assert.equal(people.rows.length, 1); assert.equal(people.rows[0].browser, 'Edge'); assert.equal(people.rows[0].os, 'Windows');
  assert.equal(people.rows[0].views, 1); assert.equal(people.rows[0].questions, 26);
  assert.equal(JSON.stringify(people).includes('192.0.2.5'), false);
});

test('采集拒绝非法路径、过大内容、跨站请求，存储缺失不假报成功', async t => {
  const { db, sqlite } = database(); t.after(() => sqlite.close());
  assert.equal((await serveDevelopment(post('/api/dev-events/visit', { id: 'visit-event-000001', path: '/developer' }), { DB: db })).status, 400);
  assert.equal((await serveDevelopment(post('/api/dev-events/question', { id: 'question-event-000001', question: 'x'.repeat(2001), outcome: 'success' }), { DB: db })).status, 400);
  assert.equal((await serveDevelopment(post('/api/dev-events/visit', { id: 'visit-event-000001', path: '/' }, '', 'https://attacker.example'), { DB: db })).status, 403);
  assert.equal((await serveDevelopment(post('/api/dev-events/visit', { id: 'visit-event-000001', path: '/', arbitrary: 'x'.repeat(12_000) }), { DB: db })).status, 413);
  assert.equal((await serveDevelopment(post('/api/dev-events/visit', { id: 'visit-event-000001', path: '/' }), {})).status, 503);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM preview_visits').get()!.count, 0);
});

test('CSV保留问题文本并阻止公式执行，退出操作同样受跨站保护', async t => {
  const { db, sqlite } = database(); t.after(() => sqlite.close());
  const v = cookieValue(await serveDevelopment(post('/api/dev-events/question', { id: 'question-event-000001', question: '=SUM(1,2)\n"原文"', outcome: 'success', knowledgeChunks: 0, latencyMs: 10 }), { DB: db }));
  assert.match(v, /agridx-visitor/);
  const admin = await login(db);
  const r = await serveDevelopment(get('/api/dev-admin/export?kind=questions', admin), { DB: db });
  assert.equal(r.status, 200); assert.match(r.headers.get('Content-Type')!, /text\/csv/);
  assert.match(await r.text(), /"'=SUM\(1,2\)\n""原文"""/);
  assert.equal((await serveDevelopment(post('/api/dev-admin/logout', {}, admin, 'https://attacker.example'), { DB: db })).status, 403);
  assert.equal((await serveDevelopment(get('/api/dev-admin/questions', admin), { DB: db })).status, 200);
});

test('登录及采集有独立速率限制，不能无限调用GitHub验证', async t => {
  const { db, sqlite } = database(); t.after(() => sqlite.close());
  let calls = 0;
  const bad = async () => { calls++; return new Response('', { status: 401 }); };
  for (let i = 0; i < 8; i++) assert.equal((await serveDevelopment(post('/api/dev-admin/login', { token: fakeCredential }), { DB: db }, {}, bad)).status, 401);
  const blocked = await serveDevelopment(post('/api/dev-admin/login', { token: fakeCredential }), { DB: db }, {}, bad);
  assert.equal(blocked.status, 429); assert.equal(blocked.headers.get('Retry-After'), '60'); assert.equal(calls, 8);
});

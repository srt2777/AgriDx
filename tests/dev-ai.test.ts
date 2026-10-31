import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { serveDevelopment } from '../scripts/dev-preview-gateway/worker.js';

const origin = 'https://preview.example', credential = 'fakeAdminCredential1234567890';
const encryptionKey = '12'.repeat(32), secret = 'fake-provider-secret-not-a-real-key';
function database() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../scripts/dev-preview-gateway/drizzle/', import.meta.url)).filter(f => f.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL(`../scripts/dev-preview-gateway/drizzle/${file}`, import.meta.url), 'utf8'));
  const db = {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql); let values: any[] = [];
      const prepared = { bind(...args: any[]) { values = args; return prepared; }, async first() { return statement.get(...values) ?? null; }, async all() { return { results: statement.all(...values), success: true }; }, async run() { return { success: true, meta: { changes: Number(statement.run(...values).changes) } }; } }; return prepared;
    },
    async batch(statements: any[]) { sqlite.exec('BEGIN'); try { const result = []; for (const statement of statements) result.push(await statement.all()); sqlite.exec('COMMIT'); return result; } catch (error) { sqlite.exec('ROLLBACK'); throw error; } },
  }; return { sqlite, db };
}
function req(route: string, body?: unknown, cookie = '', ip = '192.0.2.1', requestOrigin = origin) {
  return new Request(`${origin}/api/${route}`, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, Origin: requestOrigin, 'Content-Type': 'application/json', 'CF-Connecting-IP': ip }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function fixture(t: any) {
  const { sqlite, db } = database(); t.after(() => sqlite.close());
  const env = { DB: db, DEV_AI_ENCRYPTION_KEY: encryptionKey };
  const login = await serveDevelopment(req('dev-admin/login', { token: credential }), env, {}, async () => Response.json({ login: 'maintainer', id: 42, permissions: { maintain: true } }));
  assert.equal(login.status, 200); const cookie = login.headers.get('Set-Cookie')!.split(';')[0];
  const call = (route: string, body?: unknown, upstream: any = async () => { throw new Error('Unexpected external request'); }, ip = '192.0.2.1') => serveDevelopment(req(route, body, cookie, ip), env, {}, upstream);
  const save = (provider = 'deepseek', values: object = {}, upstream: any = async () => Response.json({ choices: [{ message: { content: 'OK' } }] }), ip = '192.0.2.1') => call(`dev-admin/ai/providers/${provider}`, { model: 'test-model', baseUrl: provider === 'gemini' ? 'https://generativelanguage.googleapis.com/v1beta/openai' : provider === 'openai' ? 'https://api.openai.com/v1' : 'https://api.deepseek.com/v1', apiKey: secret, enabled: true, ...values }, upstream, ip);
  const enable = (limit = 100) => call('dev-admin/ai/settings', { publicEnabled: true, defaultProvider: 'deepseek', dailyLimit: limit });
  return { sqlite, db, env, cookie, call, save, enable };
}
const message = { messages: [{ role: 'system', content: 'Browser reference context' }, { role: 'user', content: '拖拉机发动机过热' }] };

test('AI management rejects anonymous/forged sessions and cross-origin writes before external calls', async t => {
  const f = await fixture(t); let calls = 0; const upstream = async () => { calls++; return Response.json({}); };
  for (const route of ['dev-admin/ai', 'dev-admin/ai/providers/gemini', 'dev-admin/ai/providers/deepseek/test', 'dev-admin/ai/settings']) {
    const response = await serveDevelopment(req(route, route === 'dev-admin/ai' ? undefined : {}, '__Host-agridx-admin=' + 'f'.repeat(64)), f.env, {}, upstream); assert.equal(response.status, 401);
  }
  for (const route of ['dev-admin/ai/providers/gemini', 'dev-ai/chat']) assert.equal((await serveDevelopment(req(route, message, f.cookie, '192.0.2.1', 'https://attacker.example'), f.env, {}, upstream)).status, 403);
  assert.equal(calls, 0);
});

test('provider keys use randomized authenticated ciphertext, never appear in metadata, and blank updates preserve them', async t => {
  const f = await fixture(t); assert.equal((await f.save()).status, 200);
  const original = f.sqlite.prepare('SELECT * FROM preview_ai_providers').get()!;
  assert.notEqual(original.encrypted_key, secret); assert.equal(JSON.stringify(original).includes(secret), false); assert.match(String(original.encrypted_key), /^v1\.[a-f0-9]{24}\.[a-f0-9]+$/);
  const list = await f.call('dev-admin/ai'); const metadata = await list.json(); assert.equal(JSON.stringify(metadata).includes(secret), false); assert.equal(metadata.providers[0].hasKey, true);
  assert.equal(list.headers.get('Cache-Control'), 'private, no-store');
  await f.save('deepseek', { apiKey: '' }); assert.equal(f.sqlite.prepare('SELECT encrypted_key FROM preview_ai_providers').get()!.encrypted_key, original.encrypted_key);
  await f.save(); assert.notEqual(f.sqlite.prepare('SELECT encrypted_key FROM preview_ai_providers').get()!.encrypted_key, original.encrypted_key);
});

test('missing encryption configuration fails closed; invalid endpoints never make network requests', async t => {
  const f = await fixture(t);
  const response = await serveDevelopment(req('dev-admin/ai/providers/deepseek', { model: 'test', baseUrl: 'https://api.deepseek.com/v1', enabled: true, apiKey: secret }, f.cookie), { DB: f.db }); assert.equal(response.status, 503);
  const invalidUrls = ['http://api.deepseek.com/v1', 'https://127.0.0.1/v1', 'https://[::1]/v1', 'https://169.254.169.254/v1', 'https://metadata.internal/v1', 'https://api.localhost/v1', 'https://api.deepseek.com.attacker.example/v1', 'https://user:pass@api.deepseek.com/v1', 'https://api.deepseek.com/v1?key=x', 'https://api.deepseek.com/v1#x', 'https://api.deepseek.com:8443/v1'];
  for (const [index, baseUrl] of invalidUrls.entries()) assert.equal((await f.save('deepseek', { baseUrl }, undefined, `192.0.2.${index+10}`)).status, 400, baseUrl);
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM preview_ai_providers').get()!.n, 0);
  assert.equal((await f.call('dev-admin/ai/settings', { publicEnabled: false, defaultProvider: 'toString', dailyLimit: 10 })).status, 400);
});

test('administrator can connect and use a custom OpenAI-compatible endpoint without a host allowlist', async t => {
  const f = await fixture(t), seen: string[] = [];
  const upstream = async (url: string, options: RequestInit) => {
    seen.push(url);
    assert.equal(options.redirect, 'manual');
    assert.equal(new Headers(options.headers).get('Authorization'), `Bearer ${secret}`);
    return Response.json({ choices: [{ message: { content: 'OK' } }] });
  };
  const saved = await f.save('openai', { baseUrl: 'https://models.example.com/v1.0/chat/completions', publicEnabled: true }, upstream);
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).baseUrl, 'https://models.example.com/v1.0');
  assert.equal(f.sqlite.prepare('SELECT base_url FROM preview_ai_providers').get()!.base_url, 'https://models.example.com/v1.0');
  const status = await (await f.call('dev-ai/status')).json();
  assert.equal(status.enabled, true); assert.equal(status.provider, 'openai');
  assert.equal((await f.call('dev-ai/chat', message, upstream)).status, 200);
  assert.deepEqual(seen, ['https://models.example.com/v1.0/chat/completions', 'https://models.example.com/v1.0/chat/completions']);
  assert.equal((await (await f.call('dev-admin/ai/readiness')).json()).gateway.capabilities.customEndpoint, true);
});

test('changing endpoint host requires a new key before model discovery or save', async t => {
  const f = await fixture(t); assert.equal((await f.save()).status, 200);
  const before = f.sqlite.prepare('SELECT base_url, encrypted_key FROM preview_ai_providers').get()!;
  let calls = 0; const upstream = async () => { calls++; return Response.json({ choices: [{ message: { content: 'OK' } }] }); };
  const baseUrl = 'https://other.example.com/v1';
  assert.equal((await f.call('dev-admin/ai/providers/deepseek/models', { baseUrl }, upstream)).status, 400);
  assert.equal((await f.save('deepseek', { baseUrl, apiKey: '' }, upstream)).status, 400);
  assert.equal(calls, 0);
  assert.deepEqual(f.sqlite.prepare('SELECT base_url, encrypted_key FROM preview_ai_providers').get(), before);
  assert.equal((await f.save('deepseek', { baseUrl, apiKey: 'another-fake-provider-key' }, upstream)).status, 200);
  assert.equal(calls, 1);
  assert.equal(f.sqlite.prepare('SELECT base_url FROM preview_ai_providers').get()!.base_url, baseUrl);
});

test('saved Gemini and compatible APIs can be tested while disabled without leaking credentials or upstream errors', async t => {
  const f = await fixture(t); await f.save('gemini', { enabled: false });
  const response = await f.call('dev-admin/ai/providers/gemini/test', {}, async (url: string, options: RequestInit) => {
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'); assert.equal(options.redirect, 'manual');
    const headers = new Headers(options.headers); assert.equal(headers.get('Authorization'), `Bearer ${secret}`); assert.equal(headers.has('Cookie'), false);
    const payload = JSON.parse(String(options.body)); assert.equal(payload.max_tokens, 8); assert.equal(payload.model, 'test-model'); assert.equal('thinking' in payload, false);
    return Response.json({ choices: [{ message: { content: 'OK' } }] });
  });
  assert.equal(response.status, 200); const result = await response.json(); assert.equal(result.ok, true); assert.equal('content' in result, false);
  assert.equal((await f.call('dev-admin/ai/providers/gemini/chat', { prompt: 'test' })).status, 400);
  const rejected = await f.call('dev-admin/ai/providers/gemini/test', {}, async () => Response.json({ error: secret }, { status: 401 })); assert.equal(rejected.status, 502); assert.equal((await rejected.text()).includes(secret), false);
  await f.save('openai'); assert.equal((await f.call('dev-admin/ai/providers/openai/test', {}, async () => Response.json({ choices: [{ message: { content: 'OK' } }] }))).status, 200);
  const echoed = await f.call('dev-admin/ai/providers/openai/test', {}, async () => Response.json({ choices: [{ message: { content: secret } }] }), '192.0.2.51'); assert.equal(echoed.status, 502); assert.equal((await echoed.text()).includes(secret), false);
  const networkError = await f.call('dev-admin/ai/providers/openai/test', {}, async () => { throw Object.assign(new Error(secret), { status: 400 }); }, '192.0.2.52'); assert.equal(networkError.status, 504); assert.equal((await networkError.text()).includes(secret), false);
});

test('DeepSeek onboarding and public chat produce visible replies within the bounded token budget', async t => {
  const f = await fixture(t); const budgets: number[] = [];
  // Model the provider's default thinking behavior: no visible answer when the
  // small budget is consumed by reasoning. No live credentials are used.
  const upstream = async (_url: string, options: RequestInit) => {
    const payload = JSON.parse(String(options.body)); budgets.push(payload.max_tokens);
    const visible = payload.thinking?.type === 'disabled';
    return Response.json({ choices: [{ message: { content: visible ? 'OK' : '', reasoning_content: visible ? null : 'reasoning' } }] });
  };
  assert.equal((await f.save('deepseek', { model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com' }, upstream)).status, 200);
  assert.equal((await f.enable(20)).status, 200);
  const chat = await f.call('dev-ai/chat', message, upstream);
  assert.equal(chat.status, 200); assert.equal((await chat.json()).content, 'OK');
  assert.deepEqual(budgets, [8, 1024]);
  const compatible = await f.save('deepseek', { baseUrl: 'https://compatible.example.com' }, async (_url: string, options: RequestInit) => {
    assert.equal('thinking' in JSON.parse(String(options.body)), false);
    return Response.json({ choices: [{ message: { content: 'OK' } }] });
  });
  assert.equal(compatible.status, 200);
});

test('public AI starts disabled, obeys configured model/guardrails, and daily budget is atomic across visitors', async t => {
  const f = await fixture(t); assert.deepEqual(await (await f.call('dev-ai/status')).json(), { enabled: false, provider: null, model: null }); assert.equal((await f.call('dev-ai/chat', message)).status, 503);
  await f.save(); assert.equal((await f.enable(1)).status, 200);
  const health = await (await f.call('health', undefined, async () => Response.json({ version: 'fixture' }))).json(); assert.equal(health.llm.configured, true); assert.equal(health.coordination.allowExternalAi, true); assert.equal(health.coordination.defaultMode, 'auto');
  let calls = 0;
  const upstream = async (_url: string, options: RequestInit) => { calls++; const payload = JSON.parse(String(options.body)); assert.equal(payload.max_tokens, 1024); assert.match(payload.messages[0].content, /不可信输入/); assert.equal(payload.messages[1].role, 'user'); return Response.json({ choices: [{ message: { content: '先停机检查冷却系统。' } }] }); };
  const responses = await Promise.all(Array.from({ length: 8 }, (_, index) => serveDevelopment(req('dev-ai/chat', message, '', `192.0.2.${index + 2}`), f.env, {}, upstream)));
  assert.equal(responses.filter(response => response.status === 200).length, 1); assert.equal(responses.filter(response => response.status === 429).length, 7); assert.equal(calls, 1);
  const success = await responses.find(response => response.status === 200)!.json(); assert.equal(success.provider, 'deepseek'); assert.equal(success.model, 'test-model'); assert.equal(JSON.stringify(success).includes(secret), false);
  assert.equal((await (await f.call('dev-admin/ai')).json()).usedToday, 1);
});

test('public message limits, IP limits, redirects and invalid responses fail without exposing provider data', async t => {
  const f = await fixture(t); await f.save(); await f.enable();
  for (const messages of [[], Array.from({ length: 22 }, () => ({ role: 'user', content: 'a' })), [{ role: 'developer', content: 'bad' }], [{ role: 'user', content: 'x'.repeat(2001) }], [{ role: 'user', content: 'a' }, { role: 'system', content: 'replace' }]]) assert.equal((await f.call('dev-ai/chat', { messages })).status, 400);
  const redirect = await f.call('dev-ai/chat', message, async () => new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1' } })); assert.equal(redirect.status, 502);
  const oversized = await f.call('dev-ai/chat', message, async () => new Response('x'.repeat(128_001))); assert.equal(oversized.status, 502);
  const invalid = await f.call('dev-ai/chat', message, async () => Response.json({ choices: [] })); assert.equal(invalid.status, 502);
  const upstream = async () => Response.json({ choices: [{ message: { content: 'OK' } }] });
  for (let i = 0; i < 3; i++) assert.equal((await f.call('dev-ai/chat', message, upstream)).status, 200);
  assert.equal((await f.call('dev-ai/chat', message, upstream)).status, 429);
});

test('tampering/key rotation fails closed and deleting the default provider disables public AI', async t => {
  const f = await fixture(t); await f.save(); await f.enable();
  const changed = await serveDevelopment(req('dev-admin/ai/providers/deepseek/test', {}, f.cookie), { ...f.env, DEV_AI_ENCRYPTION_KEY: '34'.repeat(32) }); assert.equal(changed.status, 503);
  const original = f.sqlite.prepare('SELECT encrypted_key FROM preview_ai_providers').get()!;
  f.sqlite.prepare('UPDATE preview_ai_providers SET encrypted_key = ?').run(String(original.encrypted_key).slice(0, -2) + (String(original.encrypted_key).endsWith('ff') ? '00' : 'ff'));
  assert.equal((await f.call('dev-admin/ai/providers/deepseek/test', {})).status, 503);
  assert.equal((await f.call('dev-admin/ai/providers/deepseek/delete', {})).status, 200);
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM preview_ai_providers').get()!.n, 0);
  assert.equal((await (await f.call('dev-ai/status')).json()).enabled, false); assert.equal(f.sqlite.prepare('SELECT public_enabled FROM preview_ai_settings').get()!.public_enabled, 0);
});

test('retained gateway build emits one import-free Worker and includes the append-only migration', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'agridx-ai-worker-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(path.join(directory, 'worker')); mkdirSync(path.join(directory, '.openai'));
  writeFileSync(path.join(directory, 'gateway-release.json'), JSON.stringify({ version: 'test', sourceCommit: 'fixture' }));
  writeFileSync(path.join(directory, '.openai/hosting.json'), JSON.stringify({ d1: 'DB', project_id: 'fixture' }));
  cpSync(new URL('../scripts/dev-preview-gateway/worker.js', import.meta.url), path.join(directory, 'worker/index.js'));
  cpSync(new URL('../scripts/dev-preview-gateway/ai.js', import.meta.url), path.join(directory, 'worker/ai.js'));
  cpSync(new URL('../scripts/dev-preview-gateway/drizzle', import.meta.url), path.join(directory, 'drizzle'), { recursive: true });
  execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/dev-preview-gateway/build-worker.mjs', import.meta.url))], { cwd: directory });
  const compiled = readFileSync(path.join(directory, 'dist/server/index.js'), 'utf8'); assert.doesNotMatch(compiled, /^import /m);
  writeFileSync(path.join(directory, 'package.json'), '{"type":"module"}');
  const module = await import(pathToFileURL(path.join(directory, 'dist/server/index.js')).href);
  const f = await fixture(t); const status = await module.serveDevelopment(req('dev-ai/status'), f.env); assert.equal(status.status, 200);
  assert.ok(readdirSync(path.join(directory, 'dist/drizzle')).includes('0001_nice_kronos.sql'));
});

test('save tests before atomic persistence and failed validation preserves existing records', async t => {
  const f=await fixture(t);
  const failed=await f.save('deepseek',{publicEnabled:true},async()=>Response.json({error:secret},{status:401}));
  assert.equal(failed.status,502);assert.equal((await failed.json()).errorKind,'authentication');
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM preview_ai_providers').get()!.n,0);
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM preview_ai_settings').get()!.n,0);
  const saved=await f.save('deepseek',{publicEnabled:true});assert.equal(saved.status,200);
  const row=f.sqlite.prepare('SELECT * FROM preview_ai_providers').get()!;
  assert.equal(row.last_test_ok,1); assert.ok(row.last_test_at); assert.notEqual(row.encrypted_key,secret);
  const settings=f.sqlite.prepare('SELECT * FROM preview_ai_settings').get()!;
  assert.equal(settings.public_enabled,1);assert.equal(settings.default_provider,'deepseek');assert.equal(settings.daily_limit,100);
  const old=row.encrypted_key;
  const rejected=await f.save('deepseek',{apiKey:'other-fake-key-123'},async()=>Response.json({},{status:429}));
  assert.equal(rejected.status,502);assert.equal(f.sqlite.prepare('SELECT encrypted_key FROM preview_ai_providers').get()!.encrypted_key,old);
});

test('verified provider fallback consumes one public request, authentication failures do not fall back', async t => {
  const f=await fixture(t);await f.save('deepseek',{publicEnabled:true});await f.save('gemini');
  const seen:string[]=[];
  const upstream=async (url:string, options:RequestInit)=>{seen.push(url);assert.equal(options.redirect,'manual');return url.includes('deepseek')?new Response(null,{status:503}):Response.json({choices:[{message:{content:'OK'}}]});};
  const result=await f.call('dev-ai/chat',message,upstream);assert.equal(result.status,200);assert.equal((await result.json()).provider,'gemini');assert.equal(seen.length,2);
  assert.equal((await (await f.call('dev-admin/ai')).json()).usedToday,1);
  const errors:string[]=[];const denied=await f.call('dev-ai/chat',message,async(url:string)=>{errors.push(url);return new Response(null,{status:401});});
  assert.equal(denied.status,502);assert.equal(errors.length,1);
});

test('model discovery falls back safely and readiness reports verification state', async t => {
  const f=await fixture(t);const before=await (await f.call('dev-admin/ai/readiness')).json();
  assert.equal(before.encryptionConfigured,true);assert.equal(before.migrationApplied,true);assert.equal(before.verifiedProvider,false);assert.equal(before.gateway.capabilities.toolCalls,false);
  const body={baseUrl:'https://api.deepseek.com/v1',apiKey:secret};
  const models=await f.call('dev-admin/ai/providers/deepseek/models',body,async(_url:string, options:RequestInit)=>{assert.equal(options.redirect,'manual');return Response.json({data:[{id:'model-a'},{id:'model-b'}]});});
  assert.deepEqual((await models.json()).models,['model-a','model-b']);
  const fallback=await f.call('dev-admin/ai/providers/deepseek/models',body,async()=>new Response(null,{status:404}));assert.equal((await fallback.json()).available,false);
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM preview_ai_providers').get()!.n,0);
  await f.save('deepseek',{publicEnabled:true});const after=await (await f.call('dev-admin/ai/readiness')).json();assert.equal(after.verifiedProvider,true);assert.equal(after.publicEnabled,true);
  const fail=await f.call('dev-admin/ai/providers/deepseek/test',{},async()=>new Response(null,{status:401}));assert.equal(fail.status,502);
  assert.equal((await (await f.call('dev-ai/status')).json()).enabled,false);
});

test('empty model discovers and tests a model in the save action, unsupported list asks for manual input', async t => {
  const f=await fixture(t);let calls=0;
  const upstream=async (url:string)=>{calls++;return url.endsWith('/models') ? Response.json({data:[{id:'example-chat'}]}) : Response.json({choices:[{message:{content:'OK'}}]});};
  const result=await f.save('deepseek',{model:'',publicEnabled:true},upstream);
  assert.equal(result.status,200);assert.equal((await result.json()).model,'example-chat');assert.equal(calls,2);
  assert.equal(f.sqlite.prepare('SELECT model FROM preview_ai_providers').get()!.model,'example-chat');
  const denied=await f.save('gemini',{model:''},async()=>new Response(null,{status:404}));
  assert.equal(denied.status,400);assert.equal((await denied.json()).errorKind,'model');
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM preview_ai_providers').get()!.n,1);
});

test('save-and-test shares the existing upstream test rate limit', async t => {
  const f=await fixture(t);let calls=0;const upstream=async()=>{calls++;return Response.json({choices:[{message:{content:'OK'}}]});};
  for(let i=0;i<6;i++)assert.equal((await f.save('deepseek',{},upstream)).status,200);
  assert.equal((await f.save('deepseek',{},upstream)).status,429);assert.equal(calls,6);
});

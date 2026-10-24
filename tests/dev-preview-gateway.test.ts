import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { servePreview } from '../scripts/dev-preview-gateway/worker.js';

test('开发入口仅使用固定预览产物，不把访客凭据或生产查询转发到GitHub', async () => {
  let seen: { url: string; options: unknown } | undefined;
  const upstream = async (url: string, options: unknown) => {
    seen = { url, options };
    return new Response('<html>preview</html>');
  };
  const response = await servePreview(new Request('https://preview.example/?token=visitor-secret', {
    headers: { Cookie: 'sensitive', Authorization: 'Bearer sensitive' },
  }), upstream);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type')!, /text\/html/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(seen!.url, /^https:\/\/raw.githubusercontent.com\/srt2777\/AgriDx\/dev-preview-built\/index.html\?t=\d+$/);
  assert.deepEqual(seen!.options, { redirect: 'manual' });
  assert.equal(await response.text(), '<html>preview</html>');
});

test('未知路径、密钥路径、编码路径绕过与POST不会产生外部请求', async () => {
  const reject = async () => { throw new Error('Must not request an external URL'); };
  for (const path of ['.env', 'server/.env', 'api/chat', 'assets/%2e%2e%2f.env', 'assets/%5c.env', '%00', 'theme-init.js.map', 'theme-init.js/.env', 'other-init.js']) {
    assert.equal((await servePreview(new Request(`https://preview.example/${path}`), reject)).status, 404);
  }
  assert.equal((await servePreview(new Request('https://preview.example/', { method: 'POST' }), reject)).status, 405);
});

test('首屏依赖的公共初始化脚本可通过开发网关读取，并保持正确MIME与刷新策略', async () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="(\/[^"?]+)"/g)]
    .map(match => match[1]).filter(src => !src.startsWith('/ui/src/'));
  assert.ok(scripts.length > 0, 'The page must have its shared theme initializer.');
  for (const src of scripts) {
    const source = readFileSync(new URL(`../ui/public${src}`, import.meta.url), 'utf8');
    const response = await servePreview(new Request(`https://preview.example${src}`), async (url, options) => {
      assert.match(url, new RegExp(`^https://raw\\.githubusercontent\\.com/srt2777/AgriDx/dev-preview-built/${src.slice(1).replaceAll('.', '\\.')}\\?t=\\d+$`));
      assert.deepEqual(options, { redirect: 'manual' });
      return new Response(source);
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/javascript; charset=utf-8');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(await response.text(), source);
  }
});

test('JavaScript与GLB使用正确MIME，HEAD和上游失败保留边界', async () => {
  const upstream = async () => new Response('asset');
  assert.match((await servePreview(new Request('https://preview.example/assets/a.js'), upstream)).headers.get('content-type')!, /application\/javascript/);
  assert.equal((await servePreview(new Request('https://preview.example/models/a.glb'), upstream)).headers.get('content-type'), 'model/gltf-binary');
  const head = await servePreview(new Request('https://preview.example/', { method: 'HEAD' }), upstream);
  assert.equal(await head.text(), '');
  assert.equal((await servePreview(new Request('https://preview.example/'), async () => new Response('', { status: 404 }))).status, 404);
  assert.equal((await servePreview(new Request('https://preview.example/'), async () => new Response('', { status: 302 }))).status, 502);
  assert.equal((await servePreview(new Request('https://preview.example/'), async () => { throw new Error('network'); })).status, 502);
});

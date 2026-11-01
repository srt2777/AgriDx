import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serveDevelopment } from '../scripts/dev-preview-gateway/worker.js';

test('partner browser can access only the public AI chat route', async () => {
  const base = 'https://agridx-dev-preview.z3464715478.chatgpt.site';
  const partner = 'https://agridx-dialogue-workspace.spryflint15.chatgpt.site';
  const send = (path: string, method: string, origin: string) => serveDevelopment(new Request(base + path, { method, headers: { Origin: origin } }));
  const preflight = await send('/api/dev-ai/chat', 'OPTIONS', partner);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), partner);
  const offline = await send('/api/dev-ai/chat', 'POST', partner);
  assert.equal(offline.status, 503);
  assert.equal(offline.headers.get('access-control-allow-origin'), partner);
  const other = await send('/api/dev-ai/chat', 'POST', 'https://example.com');
  assert.equal(other.status, 403);
  assert.equal(other.headers.get('access-control-allow-origin'), null);
  const admin = await send('/api/dev-admin/ai/settings', 'POST', partner);
  assert.equal(admin.status, 403);
  assert.equal(admin.headers.get('access-control-allow-origin'), null);
});

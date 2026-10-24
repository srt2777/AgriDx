import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startReleaseUpdater, type ReleaseUpdaterRuntime } from '../src/features/updates/release-updater';

const A = 'a'.repeat(40), B = 'b'.repeat(40), C = 'c'.repeat(40);
const manifest = (commit = B, version = '3.5.1') => Response.json({ commit, version });
const html = (commit = B) => new Response(`<meta name="agridx-build-commit" content="${commit}">`);
type Reply = Response | Error | ((options: RequestInit) => Promise<Response> | Response);

function harness() {
  const replies: Reply[] = [];
  const calls: { url: URL; options: RequestInit }[] = [];
  const replacements: string[] = [];
  const pending: (string | null)[] = [];
  const events = new Map<string, Set<() => void>>();
  const timers = new Map<number, { kind: 'interval' | 'timeout'; callback: () => void; delay: number }>();
  const storage = new Map<string, string>();
  let sequence = 0;
  const state = { href: 'https://agridx.test/?theme=dark#/knowledge?brand=东方红&model=LX1004', visible: true, idle: true, storageBlocked: false };
  const timer = (kind: 'interval' | 'timeout', callback: () => void, delay: number) => {
    const id = ++sequence;
    timers.set(id, { kind, callback, delay });
    return id;
  };
  const runtime: ReleaseUpdaterRuntime = {
    fetch: async (url, options) => {
      calls.push({ url: new URL(url), options });
      const reply = replies.shift();
      if (reply instanceof Error) throw reply;
      if (typeof reply === 'function') return reply(options);
      assert.ok(reply, `Unplanned request: ${url}`);
      return reply;
    },
    getUrl: () => state.href,
    replace: url => { replacements.push(url); state.href = url; },
    isVisible: () => state.visible,
    subscribe: (event, listener) => {
      if (!events.has(event)) events.set(event, new Set());
      events.get(event)!.add(listener);
      return () => { events.get(event)!.delete(listener); };
    },
    setInterval: (callback, delay) => timer('interval', callback, delay),
    clearInterval: id => { timers.delete(id as number); },
    setTimeout: (callback, delay) => timer('timeout', callback, delay),
    clearTimeout: id => { timers.delete(id as number); },
    now: () => 123456,
    getStorage: () => {
      if (state.storageBlocked) throw new Error('Storage is unavailable');
      return { getItem: key => storage.get(key) ?? null, setItem: (key, value) => { storage.set(key, value); } };
    },
    // Only parsing is replaced: all request, race, timer and navigation logic is real.
    readHtmlCommit: text => text.match(/^<meta name="agridx-build-commit" content="([a-f0-9]{40})">$/)?.[1] ?? null,
  };
  const start = (overrides: Partial<Parameters<typeof startReleaseUpdater>[0]> = {}) => startReleaseUpdater({
    currentCommit: A, currentVersion: '3.5.0', manifestUrl: '/deployment.json', runtime,
    canReload: () => state.idle, onPending: commit => pending.push(commit), ...overrides,
  });
  const emit = (name: string) => events.get(name)?.forEach(listener => listener());
  const tick = (kind: 'interval' | 'timeout') => {
    for (const [id, value] of [...timers]) {
      if (value.kind === kind) { if (kind === 'timeout') timers.delete(id); value.callback(); }
    }
  };
  return { runtime, state, replies, calls, replacements, pending, events, timers, storage, start, emit, tick };
}

test('立即验证 manifest、HTML 身份及最终 manifest，自动更新且保留路由与筛选', async () => {
  const h = harness();
  h.replies.push(manifest(), html(), manifest());
  const updater = h.start();
  await updater.check();
  assert.equal(h.calls.length, 3);
  assert.deepEqual(h.pending, [B]);
  assert.equal(h.replacements.length, 1);
  const target = new URL(h.replacements[0]);
  assert.equal(target.origin, 'https://agridx.test');
  assert.equal(target.searchParams.get('theme'), 'dark');
  assert.equal(target.searchParams.get('__agridx_build'), B);
  assert.equal(target.searchParams.get('__agridx_previous'), A);
  assert.equal(decodeURI(target.hash), '#/knowledge?brand=东方红&model=LX1004');
  for (const { url, options } of h.calls) {
    assert.equal(url.origin, target.origin);
    assert.equal(url.hash, '');
    assert.equal(url.searchParams.get('__agridx_check'), '123456');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
  }
  await updater.retryPending();
  assert.equal(h.calls.length, 3, 'a requested navigation must not trigger further checks');
  updater.stop();
  assert.equal(h.timers.size, 0);
  assert.ok([...h.events.values()].every(listeners => listeners.size === 0));
});

test('同提交、无效 JSON/身份/版本、旧版本和错误响应都不触发更新', async () => {
  for (const response of [
    manifest(A), manifest('short'), manifest(B, '3.4.99'), manifest(B, '3.5'),
    manifest(B, '9007199254740992.0.0'), Response.json({ commit: B }),
    Response.json(null), new Response('not JSON'), new Response('blocked', { status: 403 }),
    new Response(null, { status: 304 }),
  ]) {
    const h = harness();
    h.replies.push(response);
    const updater = h.start();
    await updater.check();
    assert.equal(h.calls.length, 1);
    assert.deepEqual(h.replacements, []);
    updater.stop();
  }
});

test('版本按三段整数比较，而不是按字符串或小数比较', async () => {
  const h = harness();
  h.replies.push(manifest(B, '3.4.10'), html(), manifest(B, '3.4.10'));
  const updater = h.start({ currentVersion: '3.4.9' });
  await updater.check();
  assert.equal(h.replacements.length, 1);
  updater.stop();
});

test('不可信配置在发请求和注册定时器前禁用', async () => {
  for (const overrides of [
    { manifestUrl: 'https://other.test/release.json' },
    { manifestUrl: '//other.test/release.json' },
    { manifestUrl: 'https://user:secret@agridx.test/release.json' },
    { manifestUrl: 'javascript:alert(1)' },
    { currentCommit: 'unknown' }, { currentVersion: 'invalid' },
  ]) {
    const h = harness();
    const updater = h.start(overrides);
    await updater.check();
    assert.equal(h.calls.length, 0);
    assert.equal(h.timers.size, 0);
    updater.stop();
  }
});

test('HTML 仍为旧构建时不重载，后续完整发布后自动重试', async () => {
  const h = harness();
  h.replies.push(manifest(), html(A));
  const updater = h.start();
  await updater.check();
  assert.equal(h.calls.length, 2);
  assert.equal(h.replacements.length, 0);
  h.replies.push(manifest(), html(), manifest());
  h.tick('interval');
  await updater.check();
  assert.equal(h.replacements.length, 1);
  assert.deepEqual(h.pending, [B]);
  updater.stop();
});

test('忙碌或有草稿时延期，解除保护后的定时检查自动继续，无需确认', async () => {
  const h = harness();
  h.state.idle = false;
  h.replies.push(manifest());
  const updater = h.start();
  await updater.check();
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.pending, [B]);
  assert.equal(h.replacements.length, 0);
  h.state.idle = true;
  h.replies.push(manifest(), html(), manifest());
  h.tick('interval');
  await updater.check();
  assert.equal(h.replacements.length, 1);
  updater.stop();
});

test('HTML 检查期间开始输入或进入后台时仍不允许重载', async () => {
  for (const block of ['idle', 'visible'] as const) {
    const h = harness();
    h.replies.push(manifest(), () => { h.state[block] = false; return html(); });
    const updater = h.start();
    await updater.check();
    assert.equal(h.replacements.length, 0);
    assert.equal(h.calls.length, 2);
    updater.stop();
  }
});

test('后台不请求，恢复前台、联网、聚焦及每30秒都会检查', async () => {
  const h = harness();
  h.state.visible = false;
  const updater = h.start();
  await updater.check();
  assert.equal(h.calls.length, 0);
  assert.equal([...h.timers.values()].find(timer => timer.kind === 'interval')?.delay, 30_000);
  for (const event of ['visibilitychange', 'online', 'focus']) {
    h.replies.push(manifest(A));
    h.state.visible = true;
    h.emit(event);
    await updater.check();
  }
  h.replies.push(manifest(A));
  h.tick('interval');
  await updater.check();
  assert.equal(h.calls.length, 4);
  updater.stop();
});

test('同一时刻只允许一个检查，断网与12秒超时不影响当前页面', async () => {
  const h = harness();
  h.replies.push(options => new Promise((_resolve, reject) => {
    options.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }));
  const updater = h.start();
  const first = updater.check();
  assert.equal(updater.check(), first);
  h.emit('focus');
  assert.equal(h.calls.length, 1);
  assert.equal([...h.timers.values()].find(timer => timer.kind === 'timeout')?.delay, 12_000);
  h.tick('timeout');
  await first;
  assert.equal(h.calls[0].options.signal!.aborted, true);
  assert.equal(h.replacements.length, 0);
  h.replies.push(new Error('offline'));
  await updater.check();
  assert.equal(h.calls.length, 2);
  assert.equal(h.replacements.length, 0);
  updater.stop();
});

test('stop 取消请求、定时器和监听器，即使迟到响应成功也不能导航', async () => {
  const h = harness();
  let respond!: (value: Response) => void;
  h.replies.push(() => new Promise(resolve => { respond = resolve; }));
  const updater = h.start();
  const checking = updater.check();
  updater.stop();
  assert.equal(h.calls[0].options.signal!.aborted, true);
  assert.equal(h.timers.size, 0);
  assert.ok([...h.events.values()].every(listeners => listeners.size === 0));
  respond(manifest());
  await checking;
  await updater.check();
  assert.equal(h.calls.length, 1);
  assert.equal(h.replacements.length, 0);
});

test('存储不可用时 URL 和内存仍阻止旧 HTML 重复刷新', async () => {
  const h = harness();
  h.state.storageBlocked = true;
  h.replies.push(manifest(), html(), manifest());
  const first = h.start();
  await first.check();
  assert.equal(h.replacements.length, 1);
  await first.check();
  assert.equal(h.calls.length, 3);
  first.stop();
  // A CDN served the old application again despite navigating to target B.
  h.replies.push(manifest());
  const stillOld = h.start();
  await stillOld.check();
  assert.equal(h.replacements.length, 1);
  assert.equal(h.calls.length, 4);
  stillOld.stop();
});

test('session 记录阻止相同 from→target 再导航，且拒绝回到已经替换的提交', async () => {
  const h = harness();
  h.replies.push(manifest(), html(), manifest());
  const first = h.start();
  await first.check();
  first.stop();
  h.state.href = 'https://agridx.test/#/knowledge';
  h.replies.push(manifest());
  const oldAgain = h.start();
  await oldAgain.check();
  assert.equal(h.replacements.length, 1);
  oldAgain.stop();
  // Same project version does not make a previously superseded commit new.
  h.replies.push(manifest(A, '3.5.1'));
  const newerApp = h.start({ currentCommit: B, currentVersion: '3.5.1' });
  await newerApp.check();
  assert.equal(h.replacements.length, 1);
  newerApp.stop();
});

test('没有 sessionStorage 时 URL previous 也会拒绝刚被替换的旧提交', async () => {
  const h = harness();
  h.state.storageBlocked = true;
  h.state.href = `https://agridx.test/?__agridx_build=${B}&__agridx_previous=${A}#/knowledge`;
  h.replies.push(manifest(A, '3.5.1'));
  const updater = h.start({ currentCommit: B, currentVersion: '3.5.1' });
  await updater.check();
  assert.equal(h.replacements.length, 0);
  assert.equal(h.calls.length, 1);
  updater.stop();
});

test('发布在 HTML 检查期间推进，不加载已过期目标，下次自动采用最新构建', async () => {
  const h = harness();
  h.replies.push(manifest(), html(), manifest(C, '3.5.2'));
  const updater = h.start();
  await updater.check();
  assert.deepEqual(h.pending, [B, C]);
  assert.equal(h.replacements.length, 0);
  h.replies.push(manifest(C, '3.5.2'), html(C), manifest(C, '3.5.2'));
  await updater.retryPending();
  assert.equal(new URL(h.replacements[0]).searchParams.get('__agridx_build'), C);
  updater.stop();
});

test('重定向或跨源响应被拒绝，当前页面跨源变化也不会被导航回去', async () => {
  for (const properties of [{ url: 'https://other.test/deployment.json' }, { redirected: true }]) {
    const h = harness();
    const response = manifest();
    for (const [key, value] of Object.entries(properties)) Object.defineProperty(response, key, { value });
    h.replies.push(response);
    const updater = h.start();
    await updater.check();
    assert.equal(h.replacements.length, 0);
    assert.equal(h.calls.length, 1);
    updater.stop();
  }
  const h = harness();
  h.replies.push(() => { h.state.href = 'https://other.test/#/knowledge'; return manifest(); });
  const updater = h.start();
  await updater.check();
  assert.equal(h.replacements.length, 0);
  assert.equal(h.calls.length, 1);
  updater.stop();
});

test('保护解除后 manifest 已撤回当前构建，清除 pending 且不载入旧 pending', async () => {
  const h = harness();
  h.state.idle = false;
  h.replies.push(manifest());
  const updater = h.start();
  await updater.check();
  h.state.idle = true;
  h.replies.push(manifest(A));
  await updater.retryPending();
  assert.deepEqual(h.pending, [B, null]);
  assert.equal(h.calls.length, 2);
  assert.equal(h.replacements.length, 0);
  updater.stop();
});

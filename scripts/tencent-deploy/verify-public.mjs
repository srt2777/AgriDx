import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { isMain } from '../lib/process.mjs';

const repository = process.env.GITHUB_REPOSITORY || 'srt2777/AgriDx';
// Controllers installed before the rename still report the old repository name.
const controllerRepositories = new Set([repository, 'srt2777/AgriDx', 'srt2777/AgriDx-v3']);
const digest = value => createHash('sha256').update(value).digest('hex');

export async function controllerConfigured(baseUrl, fetchImpl = fetch) {
  const url = new URL('/deployment-automation.json', baseUrl);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('必须使用HTTPS正式站。');
  url.searchParams.set('__agridx_check', String(Date.now()));
  const response = await fetchImpl(url, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' },
    redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`服务器接入状态请求失败：HTTP ${response.status}`);
  let value;
  try { value = await response.json(); } catch { return false; }
  return value?.controller === 'agridx-github-sync' && controllerRepositories.has(value?.repository) && value?.configured === true;
}

export async function verifyPublicSite({ commit, version, entries, baseUrl,
  fetchImpl = fetch, attempts = 5, retryMs = 2000, isCurrent = () => true }) {
  const origin = new URL(baseUrl);
  if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash ||
      origin.username || origin.password || !/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error('必须使用 HTTPS 网站根地址和40位提交 SHA。');
  }
  async function resource(path) {
    const url = new URL(path, origin);
    url.searchParams.set('__agridx_check', String(Date.now()));
    const response = await fetchImpl(url, {
      cache: 'no-store', headers: { 'Cache-Control': 'no-cache' }, redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`公网资源请求失败：${path} HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
  const staleCache = path => Object.assign(new Error(
    `普通访问 ${path} 与目标发布不一致，CDN 可能仍缓存旧首页或接口；源站就绪不等于访问已同步，请刷新对应缓存并检查节点缓存规则。`,
  ), { code: 'cdn_cache_stale' });
  // Cache-busted reads establish origin readiness, not what a first-time visitor
  // receives. Deliberately omit freshness query/header overrides for this check.
  async function ordinaryResource(path) {
    const response = await fetchImpl(new URL(path, origin), {
      cache: 'default', headers: {}, redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    if (!response.ok || response.redirected ||
        (response.url && new URL(response.url).origin !== origin.origin)) throw staleCache(path);
    return Buffer.from(await response.arrayBuffer());
  }
  async function ordinaryJson(path) {
    try {
      const value = JSON.parse((await ordinaryResource(path)).toString());
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw staleCache(path);
      return value;
    }
    catch (error) {
      if (error?.code === 'cdn_cache_stale') throw error;
      throw staleCache(path);
    }
  }
  let failure;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (!await isCurrent()) return { obsolete: true, commit };
    try {
      const [healthData, manifestData] = await Promise.all([
        resource('/api/health'), resource('/deployment.json'),
      ]);
      const health = JSON.parse(healthData.toString());
      const manifest = JSON.parse(manifestData.toString());
      if (health.ok !== true || health.version !== version ||
          health.knowledge?.archivedEntries !== entries ||
          !Number.isSafeInteger(health.knowledge?.chunks) || health.knowledge.chunks < entries) {
        throw new Error('公网服务版本或知识条数与部署源码不一致。');
      }
      if (manifest.commit !== commit || manifest.version !== version ||
          !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 100 ||
          !manifest.files.some(file => file.path === '/index.html') ||
          !manifest.files.some(file => /^\/assets\/[^/]+\.js$/.test(file.path)) ||
          !manifest.files.some(file => file.path === '/theme-init.js') ||
          new Set(manifest.files.map(file => file.path)).size !== manifest.files.length ||
          manifest.files.some(file => typeof file.path !== 'string' || file.path.includes('..') ||
            !/^(\/index\.html|\/theme-init\.js|\/assets\/[A-Za-z0-9._/-]+\.(js|css))$/.test(file.path) ||
            !/^[0-9a-f]{64}$/.test(file.sha256))) {
        throw new Error('公网部署清单与目标提交不一致或格式错误。');
      }
      await Promise.all(manifest.files.map(async file => {
        const contents = await resource(file.path === '/index.html' ? '/' : file.path);
        if (digest(contents) !== file.sha256) throw new Error(`公网文件仍为旧版或内容不一致：${file.path}`);
      }));
      const ordinaryHtml = await ordinaryResource('/');
      if (digest(ordinaryHtml) !== manifest.files.find(file => file.path === '/index.html').sha256) throw staleCache('/');
      const ordinaryManifest = await ordinaryJson('/deployment.json');
      if (ordinaryManifest.commit !== commit || ordinaryManifest.version !== version ||
          !Array.isArray(ordinaryManifest.files) || ordinaryManifest.files.length !== manifest.files.length ||
          manifest.files.some(file => !ordinaryManifest.files.some(candidate =>
            candidate.path === file.path && candidate.sha256 === file.sha256))) throw staleCache('/deployment.json');
      const ordinaryHealth = await ordinaryJson('/api/health');
      if (ordinaryHealth.ok !== true || ordinaryHealth.version !== version ||
          ordinaryHealth.knowledge?.archivedEntries !== entries ||
          ordinaryHealth.knowledge?.chunks !== health.knowledge.chunks ||
          ordinaryHealth.knowledge?.totalEntries !== health.knowledge.totalEntries ||
          ordinaryHealth.knowledge?.learningEntries !== health.knowledge.learningEntries) throw staleCache('/api/health');
      const ordinaryCatalog = await ordinaryJson('/api/knowledge/catalog');
      if (ordinaryCatalog.totals?.archivedEntries !== entries ||
          !Number.isSafeInteger(ordinaryCatalog.totals?.entries) || ordinaryCatalog.totals.entries < entries ||
          (Number.isSafeInteger(health.knowledge.totalEntries) &&
            ordinaryCatalog.totals.entries !== health.knowledge.totalEntries)) throw staleCache('/api/knowledge/catalog');
      return { commit, version, entries, files: manifest.files.length };
    } catch (error) {
      // A known edge-cache mismatch needs a purge/rule correction. Repeated
      // successful origin reads must never turn it into a green deployment.
      if (error?.code === 'cdn_cache_stale') throw error;
      failure = error;
      if (attempt + 1 < attempts) await delay(retryMs);
    }
  }
  throw failure;
}

if (isMain(import.meta.url)) {
  try {
    const [commit, baseUrl = 'https://agridx.xyz', ...extra] = process.argv.slice(2);
    if (extra.length) throw new Error('用法：node verify-public.mjs <SHA> [HTTPS网站根地址]');
    if (commit === '--controller') {
      const configured = await controllerConfigured(baseUrl);
      if (configured) {
        appendFileSync(process.env.GITHUB_OUTPUT, 'configured=true\n');
      } else console.log('[verify-public] 已发布部署请求，腾讯服务器尚未接入自动同步；未宣称部署完成。');
      process.exit(0);
    }
    const version = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
    const entries = readFileSync(new URL('../../知识库/整理后的知识库/农用拖拉机知识库/entries.jsonl', import.meta.url), 'utf8')
      .split(/\r?\n/).filter(line => line.trim()).length;
    const isCurrent = () => {
      if (process.env.GITHUB_ACTIONS !== 'true') return true;
      const result = spawnSync('gh', ['api', `repos/${repository}/git/ref/heads/main`, '--jq', '.object.sha'],
        { encoding: 'utf8', shell: false, timeout: 15000 });
      if (result.status !== 0 || !/^[0-9a-f]{40}$/.test(result.stdout.trim())) throw new Error('无法重新确认最新main。');
      return result.stdout.trim() === commit;
    };
    const result = await verifyPublicSite({ commit, version, entries, baseUrl, isCurrent, attempts: 60, retryMs: 5000 });
    if (!result.obsolete && process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'verified=true\n');
    console.log(`[verify-public] ${JSON.stringify(result)}`);
  } catch (error) {
    console.error(`[verify-public] ${error.message}`);
    process.exitCode = 1;
  }
}

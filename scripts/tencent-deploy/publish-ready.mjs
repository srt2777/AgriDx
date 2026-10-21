import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { isMain, main } from '../lib/process.mjs';

export const productionBranch = 'tencent-production-ready';
const repository = process.env.GITHUB_REPOSITORY || 'srt2777/AgriDx';

export function publishReady(commit, api) {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('必须指定40位提交 SHA。');
  const latest = () => {
    const sha = api('git/ref/heads/main').object?.sha;
    if (!/^[0-9a-f]{40}$/.test(sha ?? '')) throw new Error('无法确认最新 main。');
    return sha;
  };
  if (latest() !== commit) return { ready: false, reason: 'newer-main' };
  const refs = api(`git/matching-refs/heads/${productionBranch}`);
  const previous = refs.find(ref => ref.ref === `refs/heads/${productionBranch}`);
  if (latest() !== commit) return { ready: false, reason: 'newer-main' };
  if (previous?.object.sha !== commit) {
    if (previous) api(`git/refs/heads/${productionBranch}`, { sha: commit, force: false }, 'PATCH');
    else api('git/refs', { ref: `refs/heads/${productionBranch}`, sha: commit }, 'POST');
  }
  return { ready: true, commit };
}

if (isMain(import.meta.url)) main(() => {
  if (process.env.GITHUB_REPOSITORY !== repository || process.argv.length !== 3) {
    throw new Error('本入口仅用于本仓库已通过CI的最新main。');
  }
  const api = (endpoint, data, method) => {
    const args = ['api', `repos/${repository}/${endpoint}`];
    if (method) args.push('--method', method);
    if (data) args.push('--input', '-');
    const result = spawnSync('gh', args, { encoding: 'utf8', shell: false,
      input: data ? JSON.stringify(data) : undefined });
    if (result.status !== 0) throw new Error(result.stderr.trim() || 'GitHub部署请求发布失败。');
    return JSON.parse(result.stdout);
  };
  const result = publishReady(process.argv[2], api);
  if (result.ready) appendFileSync(process.env.GITHUB_OUTPUT, `sha=${result.commit}\n`);
  console.log(`[production-ready] ${JSON.stringify(result)}`);
}, 'production-ready');

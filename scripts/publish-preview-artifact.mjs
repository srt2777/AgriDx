import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { rootDir } from './lib/process.mjs';

const repository = process.env.GITHUB_REPOSITORY || 'srt2777/AgriDx';
const branch = 'dev-preview-built';
const api = (endpoint, data, method) => {
  const args = ['api', `repos/${repository}/${endpoint}`];
  if (method) args.push('--method', method);
  if (data) args.push('--input', '-');
  const result = spawnSync('gh', args, { cwd: rootDir, encoding: 'utf8', shell: false, input: data ? JSON.stringify(data) : undefined });
  if (result.status !== 0) throw new Error(result.stderr.trim() || 'GitHub artifact request failed');
  return JSON.parse(result.stdout);
};
const release = JSON.parse(readFileSync(path.join(rootDir, 'dist-preview/dev-preview.json'), 'utf8'));
const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: rootDir, encoding: 'utf8' }).stdout.trim();
if (release.commit !== head || release.branch !== 'main' || release.repository !== repository) {
  throw new Error('预览产物必须对应本仓库 main 主干的当前完整提交。');
}
const requireLatestSource = () => {
  if (api('git/ref/heads/main').object.sha !== release.commit) {
    throw new Error('开发预览源分支已经更新，旧构建不得覆盖最新预览。');
  }
};
requireLatestSource();
const refs = api('git/matching-refs/heads/dev-preview-built');
const previous = refs.find((ref) => ref.ref === `refs/heads/${branch}`);
const parent = previous?.object.sha;
const base = parent ? api(`git/commits/${parent}`).tree.sha : undefined;
const existing = base ? new Map(api(`git/trees/${base}?recursive=1`).tree.map((entry) => [entry.path, entry.sha])) : new Map();
const output = path.join(rootDir, 'dist-preview');
const tree = [];
const walk = (directory = '') => {
  for (const entry of readdirSync(path.join(output, directory), { withFileTypes: true })) {
    const relative = directory ? `${directory}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walk(relative);
    else if (entry.isFile()) {
      if (/\.env|^\.git\//.test(relative)) throw new Error(`Unexpected preview file: ${relative}`);
      const content = readFileSync(path.join(output, relative));
      const hash = createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex');
      const sha = existing.get(relative) === hash ? hash : api('git/blobs', { content: content.toString('base64'), encoding: 'base64' }).sha;
      tree.push({ path: relative, mode: '100644', type: 'blob', sha });
    }
  }
};
walk();
requireLatestSource();
// Preserve previous hashed assets so a tab opened before an update can still load its lazy chunks.
const builtTree = api('git/trees', { ...(base ? { base_tree: base } : {}), tree });
const commit = api('git/commits', {
  message: `Development preview ${release.version} from ${release.commit}`,
  tree: builtTree.sha, parents: parent ? [parent] : [],
});
if (parent) api(`git/refs/heads/${branch}`, { sha: commit.sha, force: false }, 'PATCH');
else api('git/refs', { ref: `refs/heads/${branch}`, sha: commit.sha });
console.log(`[dev-preview] Published ${tree.length} files; source ${release.commit}; artifact ${commit.sha}`);

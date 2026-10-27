import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gatewaySourceHash } from './hash.mjs';
import { isMain, main } from '../lib/process.mjs';

const source = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(source, '../..');
export function validateSite(directory, target, siteName) {
  if (!target || !path.isAbsolute(target) || !siteName) throw new Error('用法：prepare-site --site <登记名称> <站点 checkout 绝对路径>');
  const registry = JSON.parse(readFileSync(path.join(directory, '.openai/development-sites.json'), 'utf8'));
  const matches = registry.sites.filter(item => item.name === siteName);
  if (matches.length !== 1) throw new Error('站点名称必须唯一匹配 development-sites.json 的登记。');
  const manifest = JSON.parse(readFileSync(path.join(target, '.openai/hosting.json'), 'utf8'));
  if (manifest.project_id !== matches[0].project_id) throw new Error('目标 checkout 的 project_id 与所选开发站登记不一致。');
  if (manifest.d1 !== 'DB') throw new Error('目标开发站 D1 绑定不是 DB，请先核对，不自动改写配置。');
  return { site: matches[0], manifest };
}
export function prepareSite({ directory = root, target, siteName }) {
  const { site } = validateSite(directory, target, siteName);
  if (execFileSync('git', ['status', '--porcelain'], { cwd: directory, encoding: 'utf8' }).trim()) throw new Error('请先保存 GitHub 源码，确保网关发布记录对应准确提交。');
  if (execFileSync('git', ['status', '--porcelain'], { cwd: target, encoding: 'utf8' }).trim()) throw new Error('目标站点 checkout 有未保存改动，请先整理，避免覆盖。');
  const gatewayDir = path.join(directory, 'scripts/dev-preview-gateway');
  for (const name of readdirSync(path.join(gatewayDir, 'drizzle')).filter(item => item.endsWith('.sql'))) {
    const existing = path.join(target, 'drizzle', name);
    if (existsSync(existing) && !readFileSync(existing).equals(readFileSync(path.join(gatewayDir, 'drizzle', name)))) throw new Error(`已有迁移 ${name} 与源码不一致，停止准备。`);
  }
  const targetMeta = path.join(target, 'drizzle/meta'), sourceMeta = path.join(gatewayDir, 'drizzle/meta');
  if (existsSync(targetMeta)) {
    for (const name of readdirSync(targetMeta).filter(item => item.endsWith('_snapshot.json'))) {
      const next = path.join(sourceMeta, name);
      if (!existsSync(next) || !readFileSync(path.join(targetMeta, name)).equals(readFileSync(next))) throw new Error(`已有迁移快照 ${name} 与源码不一致，停止准备。`);
    }
    const journal = path.join(targetMeta, '_journal.json');
    if (existsSync(journal)) {
      const before = JSON.parse(readFileSync(journal, 'utf8')).entries;
      const after = JSON.parse(readFileSync(path.join(sourceMeta, '_journal.json'), 'utf8')).entries;
      if (!Array.isArray(before) || JSON.stringify(after.slice(0, before.length)) !== JSON.stringify(before)) throw new Error('已有迁移记录不是源码迁移的前缀，停止准备。');
    }
  }
  const { version } = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'));
  const release = { version, sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: directory, encoding: 'utf8' }).trim(), sourceHash: gatewaySourceHash(gatewayDir), builtAt: new Date().toISOString() };
  mkdirSync(path.join(target, 'worker'), { recursive: true }); mkdirSync(path.join(target, 'scripts'), { recursive: true });
  cpSync(path.join(gatewayDir, 'worker.js'), path.join(target, 'worker/index.js'));
  cpSync(path.join(gatewayDir, 'ai.js'), path.join(target, 'worker/ai.js'));
  cpSync(path.join(gatewayDir, 'drizzle'), path.join(target, 'drizzle'), { recursive: true });
  writeFileSync(path.join(target, 'gateway-release.json'), `${JSON.stringify(release, null, 2)}\n`);
  const v4 = site.name === 'AgriDx v4 开发版';
  cpSync(path.join(gatewayDir, 'build-worker.mjs'), path.join(target, 'scripts', v4 ? 'build-sites-v4.mjs' : 'build.mjs'));
  return { site: site.name, projectId: site.project_id, checkout: target, release, next: ['在 Sites 中保存并部署此站点网关。', '应用追加式 D1 迁移并配置 DEV_AI_ENCRYPTION_KEY secret。', '核对 /api/health 与 /api/dev-admin/session 的版本、能力和源码哈希。'] };
}
if (isMain(import.meta.url)) main(() => {
  const args = process.argv.slice(2);
  if (args.length !== 3 || args[0] !== '--site') throw new Error('用法：prepare-site --site <登记名称> <站点 checkout 绝对路径>');
  console.log(JSON.stringify(prepareSite({ siteName: args[1], target: args[2] }), null, 2));
}, 'prepare-site');

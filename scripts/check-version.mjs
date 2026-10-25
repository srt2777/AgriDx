import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isMain, main, rootDir } from './lib/process.mjs';

export function validateVersionState({ packageJson, lockJson, readme, changelog, batches }) {
  const version = packageJson.version;
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error('package.json 必须使用规范的 X.Y.Z 项目版本。');
  }
  const versionParts = version.split('.').map(Number);
  if (!versionParts.every(Number.isSafeInteger)) throw new Error('版本整数超出安全范围。');
  if (versionParts[0] > 4 || (versionParts[0] === 4 && (versionParts[1] > 0 || versionParts[2] > 0))) {
    throw new Error('当前阶段版本上限为 4.0.0；更高版本需用户明确授权。');
  }
  const recorded = [
    ['package-lock.json', lockJson.version],
    ['package-lock.json 根包', lockJson.packages?.['']?.version],
    ['README 当前版本', readme.match(/当前项目版本[：:]\s*\*\*(\d+\.\d+\.\d+)\*\*/)?.[1]],
    ['CHANGELOG 最新版本', changelog.match(/^##\s+(\d+\.\d+\.\d+)\b/m)?.[1]],
  ];
  for (const [source, actual] of recorded) {
    if (actual !== version) throw new Error(`${source} 的版本 ${actual ?? '缺失'} 与 ${version} 不一致。`);
  }
  if (batches !== undefined) {
    if (batches.schema !== 1 || !Array.isArray(batches.batches) || batches.batches.length === 0) {
      throw new Error('版本批次记录格式错误或为空。');
    }
    const ids = batches.batches.map(item => item.id);
    if (new Set(ids).size !== ids.length || batches.batches.at(-1).version !== version) {
      throw new Error('版本批次重复或最后批次与当前版本不一致。');
    }
  }
  return version;
}

// 最新 CHANGELOG 节须写明本批次 ID 与验证结果（docs/version-policy.md#更新日志格式）。
export function validateLatestChangelog(changelog, batches) {
  const match = changelog.match(/^##\s+(\d+\.\d+\.\d+)\b[^\n]*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/m);
  if (!match) throw new Error('CHANGELOG 缺少版本节。');
  const [, version, body] = match;
  const batch = batches?.batches?.at(-1);
  if (batch && batch.version === version && !body.includes(batch.id)) {
    throw new Error(`CHANGELOG ${version} 节未写批次 ID ${batch.id}。`);
  }
  if (!/更新类型[：:]\s*(knowledge|fix|maintenance|feature|breaking)/.test(body)) {
    throw new Error(`CHANGELOG ${version} 节缺少“更新类型：knowledge|fix|maintenance|feature|breaking”。`);
  }
  if (!/验证/.test(body)) throw new Error(`CHANGELOG ${version} 节缺少验证结果。`);
  return version;
}

export function checkVersion() {
  const read = (name) => readFileSync(path.join(rootDir, name), 'utf8');
  const version = validateVersionState({
    packageJson: JSON.parse(read('package.json')),
    lockJson: JSON.parse(read('package-lock.json')),
    readme: read('README.md'),
    changelog: read('CHANGELOG.md'),
    batches: existsSync(path.join(rootDir, 'version-batches.json')) ? JSON.parse(read('version-batches.json')) : undefined,
  });
  validateLatestChangelog(read('CHANGELOG.md'),
    existsSync(path.join(rootDir, 'version-batches.json')) ? JSON.parse(read('version-batches.json')) : undefined);
  console.log(`[version] ${version}：package、锁文件、README 与最新日志一致。`);
}

if (isMain(import.meta.url)) main(checkVersion, 'version');


import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { isMain, main, rootDir } from './lib/process.mjs';
import { validateVersionState } from './check-version.mjs';

export const MAXIMUM_VERSION = '3.11.0';
const pattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function nextVersion(version, kind) {
  if (!pattern.test(version)) throw new Error('版本必须使用 X.Y.Z。');
  const parts = version.split('.').map(Number);
  if (!parts.every(Number.isSafeInteger)) throw new Error('版本整数超出安全范围。');
  if (['knowledge', 'fix', 'maintenance'].includes(kind)) parts[2] += 1;
  else if (kind === 'feature') { parts[1] += 1; parts[2] = 0; }
  else if (kind === 'breaking') { parts[0] += 1; parts[1] = 0; parts[2] = 0; }
  else throw new Error('类型必须是 knowledge、fix、maintenance、feature 或 breaking。');
  const maximum = MAXIMUM_VERSION.split('.').map(Number);
  const first = parts.findIndex((value, index) => value !== maximum[index]);
  if (first !== -1 && parts[first] > maximum[first]) {
    throw new Error(`目标 ${parts.join('.')} 超过当前上限 ${MAXIMUM_VERSION}，需用户明确调整上限；不会自动降级更新类型。`);
  }
  return parts.join('.');
}

export function updateVersion({ directory = rootDir, kind, batch, summary, dryRun = false, date = new Date() }) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(batch ?? '')) throw new Error('批次 ID 必须为 1 至 80 位字母、数字、点、短横线或下划线。');
  if (typeof summary !== 'string' || !summary.trim() || /[\r\n]/.test(summary)) throw new Error('请提供非空单行更新说明。');
  const names = ['package.json', 'package-lock.json', 'README.md', 'CHANGELOG.md'];
  const originals = new Map(names.map(name => [name, readFileSync(path.join(directory, name), 'utf8')]));
  const pkg = JSON.parse(originals.get('package.json'));
  const lock = JSON.parse(originals.get('package-lock.json'));
  const readme = originals.get('README.md');
  const changelog = originals.get('CHANGELOG.md');
  const current = validateVersionState({ packageJson: pkg, lockJson: lock, readme, changelog });
  const ledgerName = 'version-batches.json';
  const ledgerPath = path.join(directory, ledgerName);
  const ledgerText = existsSync(ledgerPath) ? readFileSync(ledgerPath, 'utf8') : null;
  const ledger = ledgerText === null ? { schema: 1, batches: [] } : JSON.parse(ledgerText);
  if (ledger.schema !== 1 || !Array.isArray(ledger.batches)) throw new Error('版本批次记录格式错误。');
  if (ledgerText !== null) validateVersionState({ packageJson: pkg, lockJson: lock, readme, changelog, batches: ledger });
  const seen = ledger.batches.find(item => item.id === batch);
  if (seen) {
    if (seen.kind !== kind) throw new Error('同批次更新类型不能改变，请先协调交付范围。');
    if (seen.version !== current) throw new Error('这是已结束的旧批次，不能复用 ID。');
    return { version: current, repeated: true, dryRun };
  }
  if (ledger.batches.length && ledger.batches.at(-1).version !== current) throw new Error('当前版本与最后批次不一致，请先协调 main 版本与批次记录。');
  const version = nextVersion(current, kind);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  pkg.version = version;
  lock.version = version;
  lock.packages[''].version = version;
  const updatedReadme = readme.replace(/(当前项目版本[：:]\s*\*\*)\d+\.\d+\.\d+(\*\*)/, `$1${version}$2`);
  const section = `## ${version} — ${day}\n\n- ${summary.trim()}\n- 更新类型：${kind}；批次：${batch}。\n\n### 详细改动\n\n- ${summary.trim()}\n\n### 知识库变化\n\n- 未记录\n\n### 兼容性\n\n- 未记录\n\n### 验证结果\n\n- 未记录\n\n### 关联 PR\n\n- 未记录\n\n### 部署记录\n\n- 未记录；GitHub 保存、开发站与正式站分别验收。\n\n`;
  const updatedChangelog = changelog.replace(/^##\s+\d+\.\d+\.\d+\b/m, match => section + match);
  ledger.batches.push({ id: batch, kind, base: current, version, date: day });
  const updated = new Map([
    ['package.json', JSON.stringify(pkg, null, 2) + '\n'],
    ['package-lock.json', JSON.stringify(lock, null, 2) + '\n'],
    ['README.md', updatedReadme], ['CHANGELOG.md', updatedChangelog],
    [ledgerName, JSON.stringify(ledger, null, 2) + '\n'],
  ]);
  validateVersionState({ packageJson: pkg, lockJson: lock, readme: updatedReadme, changelog: updatedChangelog, batches: ledger });
  if (!dryRun) {
    originals.set(ledgerName, ledgerText);
    const written = [];
    try {
      for (const [name, content] of updated) {
        // Track before writing so a partial write is also restored on failure.
        written.push(name);
        writeFileSync(path.join(directory, name), content, 'utf8');
      }
    } catch (error) {
      for (const name of written.reverse()) {
        const old = originals.get(name);
        if (old === null) { if (existsSync(path.join(directory, name))) unlinkSync(path.join(directory, name)); }
        else writeFileSync(path.join(directory, name), old, 'utf8');
      }
      throw error;
    }
  }
  return { base: current, version, repeated: false, dryRun };
}

export function parseArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--dry-run' && !options.dryRun) { options.dryRun = true; continue; }
    const key = { '--kind': 'kind', '--batch': 'batch', '--summary': 'summary' }[argument];
    if (!key || options[key] !== undefined || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`无效或重复参数：${argument}`);
    options[key] = args[++index];
  }
  return options;
}

if (isMain(import.meta.url)) main(() => {
  const result = updateVersion(parseArguments(process.argv.slice(2)));
  console.log(`[version:update] ${JSON.stringify(result)}；不自动提交、推送、创建 Release 或部署。`);
}, 'version:update');

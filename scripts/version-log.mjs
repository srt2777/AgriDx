import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isMain, main, rootDir } from './lib/process.mjs';

const fields = { verified: '验证结果', pr: '关联 PR', deploy: '部署记录', knowledge: '知识库变化', compat: '兼容性' };
export function updateVersionLog({ directory = rootDir, batch, replace = false, ...updates }) {
  if (!batch || typeof batch !== 'string') throw new Error('必须提供批次 ID。');
  const ledger = JSON.parse(readFileSync(path.join(directory, 'version-batches.json'), 'utf8'));
  const entry = ledger.batches.filter(item => item.id === batch);
  if (entry.length !== 1) throw new Error('找不到唯一批次。');
  const requested = Object.entries(updates).filter(([key, value]) => key in fields && value !== undefined);
  if (!requested.length) throw new Error('请提供至少一项要更新的内容。');
  for (const [key, value] of requested) {
    if (typeof value !== 'string' || !value.trim() || /[\r\n]/.test(value)) throw new Error(`${key} 必须为非空单行内容。`);
    if (key === 'pr' && !/^(?:\d+|https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+)$/.test(value)) throw new Error('PR 必须为编号或 GitHub PR URL。');
  }
  const files = ['CHANGELOG.md', 'docs/changelog/3.x.md', 'docs/changelog/2.x.md'].map(name => path.join(directory, name)).filter(existsSync);
  const escaped = entry[0].version.replaceAll('.', '\\.');
  const pattern = new RegExp(`^##\\s+${escaped}(?:\\s|$)[^\\n]*\\n[\\s\\S]*?(?=^##\\s|(?![\\s\\S]))`, 'gm');
  const exactBatch = new RegExp(`批次[：:]\\s*${batch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[。；;\\s]|$)`);
  const matches = files.flatMap(file => {
    const original = readFileSync(file, 'utf8');
    return [...original.matchAll(pattern)].filter(match => exactBatch.test(match[0])).map(selected => ({file, original, selected}));
  });
  if (matches.length !== 1) throw new Error('无法在日志中唯一定位该批次；请人工协调历史或冲突。');
  const {file, original, selected} = matches[0]; let section = selected[0];
  for (const [key, value] of requested) {
    const title = fields[key];
    const pattern = new RegExp(`(^### ${title}\\s*\\n)([\\s\\S]*?)(?=^###\\s|$(?![\\s\\S]))`, 'm');
    const match = section.match(pattern);
    if (!match) throw new Error(`缺少 ${title} 小节。`);
    const current = match[2].trim().replace(/^[-*]\s*/, '').trim();
    const formatted = key === 'pr' && /^\d+$/.test(value) ? `#${value}` : value;
    if (current === formatted) continue;
    if (!replace && current && !/^未记录[。\s]*$/.test(current)) throw new Error(`${title} 已有内容；使用 --replace 才能覆盖。`);
    section = section.replace(pattern, (_, heading) => `${heading}\n- ${formatted}\n\n`);
  }
  const updated = original.slice(0, selected.index) + section + original.slice(selected.index + selected[0].length);
  if (updated !== original) writeFileSync(file, updated);
  return { batch, version: entry[0].version, changed: updated !== original };
}
export function parseArguments(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--replace' && !result.replace) { result.replace = true; continue; }
    const key = { '--batch': 'batch', '--verified': 'verified', '--pr': 'pr', '--deploy': 'deploy', '--knowledge': 'knowledge', '--compat': 'compat' }[arg];
    if (!key || result[key] !== undefined || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`无效或重复参数：${arg}`);
    result[key] = args[++i];
  }
  return result;
}
if (isMain(import.meta.url)) main(() => console.log(JSON.stringify(updateVersionLog(parseArguments(process.argv.slice(2))))), 'version:log');

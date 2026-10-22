import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isMain, main, rootDir } from './lib/process.mjs';

const semver = '(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)';
const versionPattern = new RegExp('^' + semver + '$');
const kinds = ['knowledge', 'fix', 'maintenance', 'feature', 'breaking'];
const fields = {
  knowledge: /知识库变化|知识更新|知识|条目|归档|手册|索引|kb_version/i,
  compatibility: /兼容|接口|迁移|(?:未改|不改|保持|保留).{0,15}(?:数据|配置|行为|范围|版次|型号)/,
  verification: /验证|测试|校验|检查通过|构建通过|验收/,
  deployment: /部署|上线|发布|开发站|正式站/,
};
function compareVersions(a, b) {
  const left = a.split('.').map(Number), right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return right[i] - left[i];
  return 0;
}
function plainSummary(text) {
  const first = (text.split(/\n\s*\n/).find(part => part.trim() && !part.startsWith('#')) || '')
    .split('\n').filter(line => !/更新类型[：:]|批次[：:]/.test(line)).join('\n');
  const plain = first.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/^[\s>*-]+/gm, '').replace(/[`*_]/g, '').replace(/\s+/g, ' ').trim();
  return plain.length > 180 ? plain.slice(0, 180) + '…' : plain;
}
function dateFromHeading(heading) {
  const raw = heading.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
  if (!raw) return null;
  const parsed = new Date(raw + 'T00:00:00Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) throw new Error('版本日志日期无效：' + raw);
  return raw;
}
function sections(body) {
  const groups = Object.fromEntries(Object.keys(fields).map(key => [key, []]));
  let explicit = null;
  let fenced = false;
  for (const line of body.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    if (/^###\s+/.test(line)) {
      const title = line.replace(/^###\s+/, '');
      explicit = Object.entries(fields).find(([, rule]) => rule.test(title))?.[0] || null;
      continue;
    }
    if (!line.trim()) continue;
    if (explicit) groups[explicit].push(line);
    else for (const [key, rule] of Object.entries(fields)) if (rule.test(line)) groups[key].push(line);
  }
  return Object.fromEntries(Object.entries(groups).map(([key, lines]) => [key, lines.join('\n').trim() || null]));
}

/** Preserve the original Markdown. Missing evidence stays null; no inferred release dates or deployment claims. */
export function parseVersionHistory(markdown, { currentVersion, repository = 'srt2777/AgriDx' } = {}) {
  if (!versionPattern.test(currentVersion || '')) throw new Error('当前项目版本无效');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('仓库标识无效');
  const records = [];
  let item = null, fence = null;
  for (const line of markdown.replace(/\r\n/g, '\n').split('\n')) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1][0];
      else if (fence === marker[1][0]) fence = null;
    }
    if (!fence && /^##\s+/.test(line)) {
      if (item) records.push(item);
      const heading = line.replace(/^##\s+/, '');
      const version = heading.match(new RegExp('^(?:草稿分支\\s+)?(' + semver + ')(?=\\s|$)'))?.[1];
      item = version ? { heading, version, draft: /^草稿分支/.test(heading), lines: [] } : null;
    } else if (item) item.lines.push(line);
  }
  if (item) records.push(item);
  const seen = new Set();
  const releases = records.map(record => {
    const id = (record.draft ? 'draft-' : '') + record.version;
    if (seen.has(id)) throw new Error('版本日志重复：' + id);
    seen.add(id);
    const details = record.lines.join('\n').trim();
    if (!details) throw new Error('版本日志内容为空：' + record.version);
    const kindMatch = details.match(/更新类型[：:]\s*(knowledge|fix|maintenance|feature|breaking)\b/);
    const prs = [...new Set(details.match(/https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+/g) || [])];
    return {
      id, version: record.version, date: dateFromHeading(record.heading), draft: record.draft,
      legacy: Number(record.version.split('.')[0]) < 3,
      kind: kinds.includes(kindMatch?.[1]) ? kindMatch[1] : null,
      summary: plainSummary(details) || null, details, ...sections(details), prs,
    };
  });
  if (!releases.some(item => item.version === currentVersion && !item.draft)) throw new Error('日志缺少当前版本：' + currentVersion);
  return { currentVersion, repository, releases: releases.sort((a, b) => Number(a.draft) - Number(b.draft) || compareVersions(a.version, b.version)) };
}

export function readVersionHistory(directory = rootDir) {
  const pkg = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'));
  return parseVersionHistory(readFileSync(path.join(directory, 'CHANGELOG.md'), 'utf8'), { currentVersion: pkg.version });
}

/** Vite generates this module for dev, production and the existing development-preview build. */
export function versionHistoryPlugin(directory = rootDir) {
  const publicId = 'virtual:agridx-version-history', internalId = '\0' + publicId;
  const changelog = path.join(directory, 'CHANGELOG.md'), pkg = path.join(directory, 'package.json');
  return {
    name: 'agridx-version-history',
    resolveId(id) { return id === publicId ? internalId : undefined; },
    load(id) {
      if (id !== internalId) return undefined;
      this.addWatchFile(changelog); this.addWatchFile(pkg);
      return 'export default ' + JSON.stringify(readVersionHistory(directory)) + ';';
    },
    handleHotUpdate(context) {
      if ([changelog, pkg].includes(context.file)) context.server.ws.send({ type: 'full-reload' });
    },
  };
}
if (isMain(import.meta.url)) main(() => {
  const data = readVersionHistory();
  console.log('[history] ' + data.currentVersion + '：' + data.releases.filter(item => !item.draft).length + '个版本；历史草稿单列，缺失信息不推断。');
}, 'history');


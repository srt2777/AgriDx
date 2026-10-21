import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isMain, main, rootDir } from './lib/process.mjs';

// 知识库独立版本：YYYY.MM.N，与项目 SemVer 分开。内容哈希变了而 kb_version 未升即报错。
export const KB_ROOT = '知识库/整理后的知识库/农用拖拉机知识库';
export const KB_VERSION_FILE = `${KB_ROOT}/kb-version.json`;
const FILES = {
  entries: `${KB_ROOT}/entries.jsonl`,
  sources: `${KB_ROOT}/sources.json`,
  hierarchy: `${KB_ROOT}/hierarchy.json`,
  learning_index: 'docs/tractor-knowledge/index.jsonl',
  learning_expansion: 'docs/tractor-knowledge/expansion-5000/index.jsonl',
};
// Windows checkout may use CRLF; hash the repository's LF text.
const text = (dir, rel) => readFileSync(path.join(dir, rel), 'utf8').replace(/\r\n/g, '\n');
const sha = value => createHash('sha256').update(value, 'utf8').digest('hex');

function markdownFiles(dir, rel) {
  return readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap(item => {
    const child = `${rel}/${item.name}`;
    if (item.isDirectory()) return markdownFiles(dir, child);
    return item.name.endsWith('.md') ? [child] : [];
  });
}

export function computeKbState(dir = rootDir) {
  const content_hash = Object.fromEntries(Object.entries(FILES).map(([key, rel]) => [key, sha(text(dir, rel))]));
  const md = markdownFiles(dir, KB_ROOT).sort();
  content_hash.markdown = sha(md.map(rel => `${rel}\n${sha(text(dir, rel))}`).join('\n'));
  const lineCount = rel => text(dir, rel).split('\n').filter(Boolean).length;
  const counts = {
    archive: lineCount(FILES.entries),
    learning: lineCount(FILES.learning_index) + lineCount(FILES.learning_expansion),
    sources: JSON.parse(text(dir, FILES.sources)).length,
    markdown_files: md.length,
  };
  return { counts, content_hash };
}

export function validateKbVersion(record, state) {
  if (!/^20\d{2}\.(0[1-9]|1[0-2])\.[1-9]\d*$/.test(record?.kb_version ?? '')) {
    throw new Error('kb-version.json 的 kb_version 须为 YYYY.MM.N（N 从 1 起）。');
  }
  const changed = Object.keys(state.content_hash).filter(key => record.content_hash?.[key] !== state.content_hash[key]);
  const countChanged = Object.keys(state.counts).filter(key => record.counts?.[key] !== state.counts[key]);
  if (changed.length || countChanged.length) {
    throw new Error(`知识库内容已变化（${[...changed, ...countChanged].join('、')}），但 kb-version.json 未更新；运行 node scripts/kb-version.mjs --bump。`);
  }
  return record.kb_version;
}

export function nextKbVersion(current, today) {
  const month = today.slice(0, 7).replace('-', '.');
  const [y, m, n] = (current ?? '').split('.');
  return `${month}.${current && `${y}.${m}` === month ? Number(n) + 1 : 1}`;
}

export function checkKbVersion(dir = rootDir) {
  const record = JSON.parse(readFileSync(path.join(dir, KB_VERSION_FILE), 'utf8'));
  const version = validateKbVersion(record, computeKbState(dir));
  console.log(`[kb-version] ${version}：知识库内容哈希一致。`);
  return version;
}

function bump(dir = rootDir) {
  const file = path.join(dir, KB_VERSION_FILE);
  let previous = {};
  try { previous = JSON.parse(readFileSync(file, 'utf8')); } catch { /* first release */ }
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
  const project = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
  const record = { schema: 1, kb_version: nextKbVersion(previous.kb_version, today), released: today,
    project_version: project, ...computeKbState(dir) };
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`[kb-version] ${previous.kb_version ?? '无'} → ${record.kb_version}`);
}

if (isMain(import.meta.url)) main(() => (process.argv.includes('--bump') ? bump() : checkKbVersion()), 'kb-version');

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = path.join(root, '知识库/整理后的知识库/农用拖拉机知识库');
export function inspectKnowledge(entries, sources) {
  const count = (items, key) => Object.fromEntries([...items.reduce((m, item) => {
    const value = String(item[key] || '未记录'); m.set(value, (m.get(value) || 0) + 1); return m;
  }, new Map()).entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
  const ids = new Set(), duplicateIds = [];
  for (const entry of entries) { if (ids.has(entry.entry_id)) duplicateIds.push(entry.entry_id); ids.add(entry.entry_id); }
  const sourceIds = new Set(sources.map(source => source.source_id));
  const used = new Set(entries.map(entry => entry.source_id));
  const required = ['entry_id', 'brand', 'model', 'title', 'source_id', 'knowledge_path', 'locator', 'status', 'entry_type'];
  return { entries: entries.length, sources: sources.length, byBrand: count(entries, 'brand'), byModel: count(entries, 'model'),
    byType: count(entries, 'entry_type'), missing: Object.fromEntries(required.map(key => [key, entries.filter(e => !e[key]).length])),
    duplicateEntryIds: duplicateIds, missingSources: [...new Set(entries.filter(e => !sourceIds.has(e.source_id)).map(e => e.source_id))],
    orphanSourceIds: sources.filter(s => !used.has(s.source_id)).map(s => s.source_id),
    limitations: ['仅检查归档索引元数据；不检查正文长度、表格、系统分类、故障码和手册真实性。', '缺项为源索引原始字段，不能据此推断诊断可用性。'] };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const entries = (await readFile(path.join(base, 'entries.jsonl'), 'utf8')).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  const sources = JSON.parse(await readFile(path.join(base, 'sources.json'), 'utf8'));
  console.log(JSON.stringify(inspectKnowledge(entries, sources), null, 2));
}

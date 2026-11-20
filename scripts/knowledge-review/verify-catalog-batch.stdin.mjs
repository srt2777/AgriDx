import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { getKnowledgeCatalog } from './server/knowledge/catalog.ts';

// Run from the target checkout with node --import tsx --input-type=module - batch.jsonl < this-file.
const rows = readFileSync(process.argv[2], 'utf8').trim().split('\n').map(JSON.parse);
const hierarchy = JSON.parse(readFileSync('知识库/整理后的知识库/农用拖拉机知识库/hierarchy.json', 'utf8'));
const links = new Map(hierarchy.entries.map(row => [row.entry_id, row.components]));
const groups = new Map();
const seen = new Set();
let checks = 0;
for (const row of rows) {
  const id = row.entry_id;
  assert.ok(id && !seen.has(id), '缺少或重复的条目编号 ' + id);
  seen.add(id);
  assert.ok(row.brand && row.models?.length && row.source_id && row.locator && links.get(id)?.length, id);
  for (const model of row.models) {
    for (const { component_id: component, part_ids: parts } of links.get(id)) {
      for (const part of [undefined, ...parts]) {
        const filters = { brand: row.brand, model, component, part };
        const key = JSON.stringify(filters);
        if (!groups.has(key)) groups.set(key, { filters, expected: [] });
        groups.get(key).expected.push(row);
        checks++;
      }
    }
  }
}
for (const { filters, expected } of groups.values()) {
  const entries = new Map(getKnowledgeCatalog(filters).selected.entries.map(e => [e.entryId, e]));
  for (const row of expected) {
    const entry = entries.get(row.entry_id);
    assert.ok(entry?.content?.trim() && entry.sourceId === row.source_id && entry.locator === row.locator && entry.title === row.title, row.entry_id + ' ' + JSON.stringify(filters));
  }
}
console.log(JSON.stringify({ entries: seen.size, checks, catalogQueries: groups.size }));

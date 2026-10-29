import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = 'docs/tractor-knowledge/expansion-875';
const digest = value => createHash('sha256').update(value.replace(/\r\n/g, '\n')).digest('hex');
const read = file => fs.readFileSync(path.join(root, directory, file), 'utf8');
const records = JSON.parse(read('source-concepts.json'));
const source = JSON.parse(read('source.json'));
const check = process.argv.includes('--check');
if (records.length !== 875 || source.entry_count !== records.length ||
    digest(read('source-concepts.json')) !== source.source_subset_sha256) throw new Error('AGROVOC来源子集数量或摘要错误');
const uris = new Set();
const labels = new Set();
const documents = new Map();
const entries = [];
const label = item => `${item.zh ?? item.en}${item.zh && item.en ? `（${item.en}）` : ''}`;
for (const [i, record] of records.entries()) {
  if (!/^http:\/\/aims\.fao\.org\/aos\/agrovoc\/c_[a-zA-Z0-9]+$/.test(record.uri) || uris.has(record.uri) ||
      !record.zh || !record.en || !record.topic || !record.broader.length) throw new Error(`概念身份或关系错误：${record.uri}`);
  const key = `${record.zh.normalize('NFKC')}\n${record.en.toLowerCase()}`;
  if (labels.has(key)) throw new Error(`中英文首选名重复：${key}`);
  uris.add(record.uri); labels.add(key);
  const id = `TK-${i + 6001}`;
  const file = `${String(Math.floor(i / 100) + 1).padStart(2, '0')}.md`;
  const title = label(record);
  const content = [
    `### ${id}`, '', `**${title}**`, '',
    `中文首选名：${record.zh}。英文首选名：${record.en}。`, '',
    `词表直接上位概念：${record.broader.map(label).join('；')}。`,
    ...(record.related.length ? ['', `词表关联概念：${record.related.map(label).join('；')}。`] : []), '',
    `概念原记录：[FAO AGROVOC ${record.uri.split('/').at(-1)}](${record.uri})。`, '',
  ].join('\n');
  if (!documents.has(file)) documents.set(file, [
    `# 农业工程术语关系 TK-${i + 6001}—TK-${Math.min(i + 6100, 6875)}`, '',
    '[本批来源与用途](README.md) | [学习总目录](../overview.md)', '',
    '> FAO AGROVOC 中英文首选标签及直接词表关系，2026-10-29取得；属于术语查找资料。上位和关联关系不表示组成关系、故障因果或具体机型适配。未逐条原厂或实车核验。', '',
    '> 署名：FAO, AGROVOC；按官方获取页所列 CC BY IGO 3.0 使用其中英文词表资料。AgriDx 选择概念并编排为中文知识卡，FAO未为本应用背书。', '',
  ].join('\n'));
  documents.set(file, documents.get(file) + content + '\n');
  entries.push({ entry_id: id, title, topic: record.topic, entry_type: '通识学习',
    status: '已逐条对照官方RDF标签与直接关系；未逐条完成原厂手册核验；未专家或实车核验。',
    diagnostic_evidence: false, knowledge_path: `${directory}/${file}`, anchor: id.toLowerCase(),
    source_kind: 'agrovoc-terminology', source_uri: record.uri });
}
const outputs = new Map([...documents, ['index.jsonl', entries.map(entry => JSON.stringify(entry)).join('\n') + '\n']]);
for (const [file, raw] of outputs) {
  const content = raw.trimEnd() + '\n';
  if (check) {
    if (read(file).replace(/\r\n/g, '\n') !== content) throw new Error(`正文或索引与官方来源子集不一致：${file}`);
  } else fs.writeFileSync(path.join(root, directory, file), content);
}
console.log(`[agrovoc-learning] ${records.length}个唯一概念、${documents.size}份正文，来源摘要、标签关系、编号、用途和正文对应${check ? '校验通过' : '已生成'}。`);

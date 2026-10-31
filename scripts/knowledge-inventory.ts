import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { getKnowledgeCatalog, loadKnowledgeCatalog } from '../server/knowledge/catalog';
import { LEARNING_INDEXES } from '../server/knowledge/learning';
import type { LibraryEntry } from '../shared/knowledge-catalog';

// Export metadata from the same validated snapshot as the application. Bodies remain
// in their original documents and are not copied into a second knowledge base.
const args = process.argv.slice(2);
if (args.length !== 1 || !['--summary', '--csv'].includes(args[0])) {
  throw new Error('用法：npm run knowledge:inventory -- --summary|--csv；结果写入标准输出。');
}
const catalog = loadKnowledgeCatalog();
const entries: LibraryEntry[] = [];
const first = getKnowledgeCatalog({ collection: 'all' }).library!;
for (let page = 1; page <= Math.ceil(first.total / first.pageSize); page++) {
  entries.push(...getKnowledgeCatalog({ collection: 'all', page: String(page) }).library!.entries);
}
if (entries.length !== catalog.totals.entries || new Set(entries.map(entry => entry.entryId)).size !== entries.length) {
  throw new Error('导出编号与知识目录数量不一致。');
}

if (args[0] === '--summary') {
  const statuses: Record<string, Record<string, number>> = { archive: {}, general: {}, terminology: {} };
  for (const entry of entries) {
    const kind = entry.collection === 'archive' ? 'archive' : entry.learningKind === 'terminology' ? 'terminology' : 'general';
    statuses[kind][entry.status] = (statuses[kind][entry.status] ?? 0) + 1;
  }
  const root = '知识库/整理后的知识库/农用拖拉机知识库';
  const indexes = [`${root}/entries.jsonl`, `${root}/sources.json`, `${root}/hierarchy.json`,
    `${root}/entry-roles.jsonl`, `${root}/通用框架.json`, ...LEARNING_INDEXES];
  const indexSha256 = Object.fromEntries(indexes.map(file => [file, createHash('sha256').update(readFileSync(file)).digest('hex')]));
  process.stdout.write(`${JSON.stringify({ kbVersion: catalog.kbVersion, totals: catalog.totals,
    organization: catalog.organization, statuses, indexSha256 }, null, 2)}\n`);
} else {
  const headers = ['资料类别', '知识编号', '标题', '资料类型', '学习主题', '核验状态', '通识标记', '品牌', '型号范围',
    '来源编号', '来源名称', '来源链接', '来源定位', '资料版本', '适用范围', '原始知识路径', '角色标注', '角色依据', '风险标注'];
  // Spreadsheet programs must not evaluate externally sourced text as a formula.
  const csvCell = (value: string | undefined) => {
    let text = value ?? '';
    if (/^[\s]*[=+\-@]/u.test(text) || /^[\t\r]/u.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const lines = [headers.map(csvCell).join(',')];
  for (const entry of entries) {
    const archive = entry.collection === 'archive';
    const values = [archive ? '来源归档' : entry.learningKind === 'terminology' ? '农业术语' : '通用原理',
      entry.entryId, entry.title, entry.entryType, archive ? '' : entry.topic, entry.status,
      archive ? '' : 'diagnostic_evidence=false', archive ? entry.brand : '', archive ? entry.models.join(' / ') : '',
      archive ? entry.sourceId : '', archive ? entry.sourceTitle : '', entry.sourceUrl,
      archive ? entry.locator : '', archive ? entry.version : '', archive ? entry.scopeBoundary : '', entry.knowledgePath,
      archive ? entry.roles?.join(' / ') : '', archive ? entry.roleBasis : '', archive ? entry.riskLevel : ''];
    lines.push(values.map(csvCell).join(','));
  }
  process.stdout.write(`\ufeff${lines.join('\r\n')}\r\n`);
}

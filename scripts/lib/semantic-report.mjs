import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, existsSync } from 'node:fs';
import path from 'node:path';

const digest = data => createHash('sha256').update(data).digest('hex');
/** Validate audited input files at snapshot construction, without exposing source files to the browser. */
export function readSemanticReport(root) {
  const file = path.join(root, 'docs/knowledge-semantic-report.json');
  if (!existsSync(file)) return { reason: '语义审核报告未提供。' };
  try {
    const report = JSON.parse(readFileSync(file, 'utf8'));
    const files = report.snapshot?.files, sha = report.snapshot?.sha256;
    if (report.schema_version !== 1 || report.blocked !== false || report.review_state !== 'pending' || !files || typeof files !== 'object' || Array.isArray(files) || !/^[a-f0-9]{64}$/.test(sha || '') || !Array.isArray(report.relations) || report.relations.length > 250000 || report.summary?.candidates !== report.relations.length || (report.example?.omitted_relations ?? 0) > 0) throw Error('报告格式无效或只是节选');
    const names = Object.keys(files).sort();
    if (!names.length || names.length > 10000) throw Error('报告快照文件清单无效');
    const normalized = Object.fromEntries(names.map(name => [name, files[name]]));
    if (digest(JSON.stringify(normalized)) !== sha) throw Error('报告快照摘要无效');
    const index = '知识库/整理后的知识库/农用拖拉机知识库';
    const required = [`${index}/sources.json`, `${index}/entries.jsonl`];
    const sources = JSON.parse(readFileSync(path.join(root, required[0]), 'utf8'));
    if (!Array.isArray(sources)) throw Error('来源索引格式无效');
    const entries = readFileSync(path.join(root, required[1]), 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
    required.push(...sources.map(source => source.path), ...entries.map(entry => entry.knowledge_path));
    if (required.some(name => typeof name !== 'string' || !Object.hasOwn(files, name))) throw Error('报告缺少当前索引或知识正文');
    const actualRoot = realpathSync(path.join(root, '知识库'));
    for (const name of names) {
      if (typeof files[name] !== 'string' || !/^[a-f0-9]{64}$/.test(files[name]) || !name.startsWith('知识库/') || path.isAbsolute(name)) throw Error('报告文件摘要无效');
      const actual = realpathSync(path.resolve(root, name));
      const relative = path.relative(actualRoot, actual);
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || digest(readFileSync(actual)) !== files[name]) throw Error('报告快照与当前知识文件不一致');
    }
    const relations = report.relations.map(({relation_id, relation, review_state, left_entry_id, right_entry_id}) => ({relation_id, relation, review_state, left_entry_id, right_entry_id}));
    return { report: { schema_version: 1, snapshot: { sha256: sha }, relations }, snapshotSha256: sha };
  } catch (error) { return { reason: `语义审核报告不可用：${error instanceof Error ? error.message : '无法核验'}` }; }
}

import fs from 'node:fs';
import path from 'node:path';
import type { LearningEntry } from '../../shared/knowledge-catalog';
import type { KnowledgeChunk } from './types';

export const LEARNING_INDEXES = [
  'docs/tractor-knowledge/index.jsonl',
  'docs/tractor-knowledge/expansion-5000/index.jsonl',
  'docs/tractor-knowledge/expansion-875/index.jsonl',
] as const;

/** Read the sole Markdown bodies, preserving original provenance and review status. */
export function loadLearningEntries(root = process.cwd()): LearningEntry[] {
  const boundary = fs.realpathSync(path.resolve(root, 'docs/tractor-knowledge'));
  const documents = new Map<string, Map<string, string>>();
  const entries: LearningEntry[] = [];
  const ids = new Set<string>();
  const conceptUris = new Set<string>();
  for (const index of LEARNING_INDEXES) {
    const rows: unknown[] = fs.readFileSync(path.join(root, index), 'utf8').split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line));
    if (!rows.length) throw new Error(`通识索引为空：${index}`);
    for (const row of rows) {
      if (!row || typeof row !== 'object') throw new Error('通识索引格式无效');
      const item = row as Record<string, unknown>;
      const { entry_id: id, title, topic, status, knowledge_path: relative } = item;
      if (typeof id !== 'string' || !/^TK-\d{4}$/.test(id) || ids.has(id) ||
        typeof title !== 'string' || !title.trim() || typeof topic !== 'string' || !topic.trim() ||
        typeof status !== 'string' || !status.trim() || item.entry_type !== '通识学习' ||
        item.diagnostic_evidence !== false || item.anchor !== id.toLowerCase() ||
        typeof relative !== 'string' || !/^docs\/tractor-knowledge\/(?:expansion-(?:5000|875)\/)?\d{2}\.md$/.test(relative)) {
        throw new Error(`通识索引编号、定位或用途无效：${String(id)}`);
      }
      if (!documents.has(relative)) {
        const file = fs.realpathSync(path.resolve(root, relative));
        const within = path.relative(boundary, file);
        if (within.startsWith('..') || path.isAbsolute(within)) throw new Error('通识正文路径越出资料目录');
        const sections = new Map<string, string>();
        for (const match of fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').matchAll(/^### (TK-\d{4})\n([\s\S]*?)(?=^#{1,3} |$(?![\s\S]))/gm)) {
          if (sections.has(match[1])) throw new Error(`通识正文编号重复：${match[1]}`);
          sections.set(match[1], match[2].trim());
        }
        documents.set(relative, sections);
      }
      let content = documents.get(relative)!.get(id);
      if (!content) throw new Error(`通识正文缺失：${id}`);
      const terminology = index.includes('/expansion-875/');
      if (terminology && (item.source_kind !== 'agrovoc-terminology' ||
        typeof item.source_uri !== 'string' || !/^http:\/\/aims\.fao\.org\/aos\/agrovoc\/c_[a-zA-Z0-9]+$/.test(item.source_uri) ||
        conceptUris.has(item.source_uri) || !content.includes(`](${item.source_uri})`))) {
        throw new Error(`术语来源无效：${id}`);
      }
      if (terminology) conceptUris.add(item.source_uri as string);
      if (relative.includes('/expansion-')) {
        const heading = `**${title}**`;
        if (!content.startsWith(`${heading}\n`)) throw new Error(`通识标题不符：${id}`);
        content = content.slice(heading.length).trim();
        if (!content) throw new Error(`通识正文为空：${id}`);
      }
      ids.add(id);
      entries.push({ collection: 'learning', entryId: id, title, entryType: '通识学习',
        topic, status, knowledgePath: relative, content, diagnosticEvidence: false,
        ...(terminology ? { learningKind: 'terminology' as const, sourceUrl: item.source_uri as string } : {}) });
    }
  }
  const bodyCount = [...documents.values()].reduce((count, sections) => count + sections.size, 0);
  if (bodyCount !== entries.length) throw new Error('通识正文与索引数量不符');
  return entries;
}

/** Reuse validated records without copying facts into a second index or inventing OEM sources. */
export function learningChunks(entries: LearningEntry[]): KnowledgeChunk[] {
  return entries.map(entry => ({
    source: entry.knowledgePath, heading: `${entry.entryId}｜${entry.title}`,
    text: entry.content, entryId: entry.entryId, entryType: entry.entryType,
    diagnosticEvidence: false, status: entry.status,
    locator: `${entry.topic}／${entry.entryId}`,
    ...(entry.learningKind ? { learningKind: entry.learningKind, sourceUrl: entry.sourceUrl } : {}),
    version: entry.learningKind === 'terminology' ? '2026-10-29取得的FAO AGROVOC词表子集（未确认发布版次）' : '2026-10-17通识整理批次（非原厂手册）',
    scopeBoundary: entry.learningKind === 'terminology'
      ? 'FAO AGROVOC术语首选标签与直接词表关系，仅供术语理解、翻译和检索。上位与关联关系不表示部件组成、故障因果、机型适配或维修证据。未逐条原厂、专家或实车核验。'
      : '拖拉机通用原理与待验证分析；未逐条原厂或实车核验。不能确定本机故障、专用参数、操作步骤或型号适配。',
  }));
}

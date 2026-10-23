import fs from 'node:fs';
import path from 'node:path';
import { loadArchive } from './archive';
import { buildKnowledgeCatalog } from './catalog-data';
import { configureIndexedModels } from './scope';
import { loadLearningEntries, learningChunks } from './learning';
import { buildRetrievalOrganization, type RetrievalOrganization } from './common';
import type { CommonFrameworkDefinition } from '../../shared/common-knowledge';
import type { KnowledgeChunk } from './types';
import type { CatalogFilters, KnowledgeCatalog } from '../../shared/knowledge-catalog';

export interface KnowledgeSnapshot {
  readonly chunks: readonly KnowledgeChunk[];
  readonly fileCount: number;
  readonly archivedEntries: number;
  readonly learningEntries: number;
  readonly getCatalog: (filters?: CatalogFilters) => KnowledgeCatalog;
  readonly retrievalOrganization: RetrievalOrganization;
  /** Real source classifications, independent of whether the current topic retrieves a hit. */
  readonly manualSourceIds: readonly string[];
}

const KB_ROOT = path.resolve(process.cwd(), 'server/knowledge');
const INDEX_ROOT = path.resolve(process.cwd(), '知识库/整理后的知识库/农用拖拉机知识库');
let current: KnowledgeSnapshot | undefined;

/** Freeze plain data recursively so response consumers cannot corrupt cached evidence. */
function freezeData<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeData(child);
    Object.freeze(value);
  }
  return value;
}

function walkMdFiles(dir: string, base: string): string[] {
  const out: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const rel = path.join(base, e.name);
    if (e.isDirectory()) {
      out.push(...walkMdFiles(full, rel));
    } else if (e.isFile() && e.name.endsWith('.md')) {
      out.push(rel);
    }
  }
  return out;
}

function splitByHeading(relPath: string, content: string): KnowledgeChunk[] {
  const out: KnowledgeChunk[] = [];
  // 按 ## 切；文件首个 # 标题作为文件头，保留为 meta
  const lines = content.split(/\r?\n/);
  let currentHeading = '(概述)';
  let buf: string[] = [];
  const flush = () => {
    const text = buf.join('\n').trim();
    if (text.length > 0) {
      out.push({ source: relPath, heading: currentHeading, text });
    }
    buf = [];
  };
  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      flush();
      currentHeading = line.replace(/^##\s+/, '').trim();
    } else {
      buf.push(line);
    }
  }
  flush();
  return out;
}


/** Read and validate everything before replacing any active consumer's data. */
export function reloadKnowledgeSnapshot(): KnowledgeSnapshot {
  const chunks: KnowledgeChunk[] = [];
  let fileCount = 0;
  for (const relative of walkMdFiles(KB_ROOT, '')) {
    if (relative.replace(/\\/g, '/').startsWith('00_说明/')) continue;
    chunks.push(...splitByHeading(relative.replace(/\\/g, '/'), fs.readFileSync(path.join(KB_ROOT, relative), 'utf8')));
    fileCount++;
  }
  const archive = loadArchive(undefined, { configureModels: false });
  const hierarchy: unknown = JSON.parse(fs.readFileSync(path.join(INDEX_ROOT, 'hierarchy.json'), 'utf8'));
  const commonData: unknown = JSON.parse(fs.readFileSync(path.join(INDEX_ROOT, '通用框架.json'), 'utf8'));
  const learning = loadLearningEntries();
  freezeData(learning);
  const selectCatalog = buildKnowledgeCatalog(archive.chunks, archive.sources, hierarchy, commonData, learning);
  // buildKnowledgeCatalog already validates both structures. Reuse that generation,
  // without additional disk reads or an independent hierarchy/alias registry.
  const retrievalOrganization = freezeData(buildRetrievalOrganization(
    (hierarchy as { entries: { entry_id: string; components: { component_id: string; part_ids: string[] }[] }[] }).entries,
    commonData as CommonFrameworkDefinition));
  const manualSourceIds = freezeData(archive.sources.filter(source =>
    /整机|使用.*(?:说明|手册)|维修手册|保养说明书|保养手册/.test(source.document_type ?? ''))
    .map(source => source.source_id));
  chunks.push(...archive.chunks, ...learningChunks(learning));
  freezeData(chunks);
  freezeData(selectCatalog());
  const next: KnowledgeSnapshot = Object.freeze({
    chunks, fileCount: fileCount + archive.fileCount + new Set(learning.map(entry => entry.knowledgePath)).size, archivedEntries: archive.chunks.length,
    learningEntries: learning.length,
    retrievalOrganization, manualSourceIds,
    getCatalog: (filters: CatalogFilters = {}) => freezeData(selectCatalog(filters)),
  });
  // The archive loader's standalone API still configures models by default. Here it
  // is deferred until hierarchy/catalog validation succeeds, preserving old scope
  // recognition as well as old data when any input is invalid.
  configureIndexedModels(archive.chunks);
  current = next;
  return next;
}

export function loadKnowledgeSnapshot(): KnowledgeSnapshot {
  return current ?? reloadKnowledgeSnapshot();
}

export function peekKnowledgeSnapshot(): KnowledgeSnapshot | undefined { return current; }

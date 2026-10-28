import { createHash } from 'node:crypto';
import Ajv from 'ajv';

/** Staging only: this structure does not imply document review or diagnostic suitability. */
export interface DocumentMetadata {
  doc_id: string; version: string; doc_type: string; brand: string; model: string;
  year_range?: string; engine_model?: string; system?: string; component?: string;
  fault_codes?: string[]; section_path?: string[]; page?: string; language?: string;
  source: string; updated_at?: string;
}
export interface StagedDocument { metadata: DocumentMetadata; text: string }
export interface StagedChunk { chunk_id: string; metadata: DocumentMetadata; text: string; ordinal: number }
export interface StagedIndex { documents: Record<string, { hash: string; chunks: StagedChunk[] }> }
export const documentSchema = { type: 'object', additionalProperties: false, required: ['metadata', 'text'], properties: {
  text: { type: 'string', minLength: 1, maxLength: 2_000_000 }, metadata: { type: 'object', additionalProperties: false,
    required: ['doc_id', 'version', 'doc_type', 'brand', 'model', 'source'], properties: {
      ...Object.fromEntries(['doc_id', 'version', 'doc_type', 'brand', 'model', 'year_range', 'engine_model', 'system', 'component', 'page', 'language', 'source', 'updated_at'].map(key => [key, { type: 'string', minLength: 1, maxLength: 2000 }])),
      fault_codes: { type: 'array', maxItems: 1000, items: { type: 'string', minLength: 1, maxLength: 120 } },
      section_path: { type: 'array', maxItems: 30, items: { type: 'string', minLength: 1, maxLength: 500 } },
    },
  },
} };
const validate = new Ajv({ strict: true }).compile(documentSchema);
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return JSON.stringify(Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(canonical((value as Record<string, unknown>)[key]))])));
  return JSON.stringify(value) ?? 'null';
};
const digest = (s: string) => createHash('sha256').update(s).digest('hex');

/** Markdown headings delimit sections; tables remain intact. Oversized blocks are rejected, never silently cut. */
export function chunkDocument(doc: StagedDocument, maxChars = 12000): StagedChunk[] {
  if (!validate(doc)) throw new Error('文档元数据或正文不符合 schema');
  const { metadata, text } = structuredClone(doc);
  if (['doc_id', 'version', 'doc_type', 'brand', 'model', 'source'].some(key => !(metadata[key as keyof DocumentMetadata] as string).trim()) || !text.trim()) throw new Error('必填字段不能为空白');
  if (!Number.isInteger(maxChars) || maxChars < 1) throw new Error('maxChars 无效');
  const sections: { heading: string; lines: string[] }[] = [];
  let current = { heading: '', lines: [] as string[] };
  let fence: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) { if (!fence) fence = marker; else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined; }
    if (!fence && !marker && /^#{1,6}\s+/.test(line) && current.lines.some(s => s.trim())) {
      sections.push(current); current = { heading: line.replace(/^#{1,6}\s+/, '').trim(), lines: [line] };
    } else { if (!fence && !marker && /^#{1,6}\s+/.test(line)) current.heading = line.replace(/^#{1,6}\s+/, '').trim(); current.lines.push(line); }
  }
  if (current.lines.some(s => s.trim())) sections.push(current);
  return sections.map((section, ordinal) => {
    const body = section.lines.join('\n').trim();
    if (body.length > maxChars) throw new Error(`章节 ${ordinal + 1} 超过长度上限，需人工切分且保留表格`);
    return { chunk_id: digest(`${metadata.doc_id}\0${metadata.version}\0${ordinal}\0${body}`).slice(0, 24),
      metadata: { ...metadata, section_path: [...(metadata.section_path ?? []), ...(section.heading ? [section.heading] : [])] }, text: body, ordinal };
  });
}

/** Full supplied snapshot: changed document/version is replaced, unchanged content keeps its existing chunks. */
export function updateIndex(previous: StagedIndex, documents: StagedDocument[]): { index: StagedIndex; changed: string[]; removed: string[] } {
  const result: StagedIndex = { documents: {} }; const changed: string[] = []; const seen = new Set<string>();
  for (const doc of documents) {
    if (!validate(doc)) throw new Error('文档元数据或正文不符合 schema');
    const key = JSON.stringify([doc.metadata.doc_id, doc.metadata.version]);
    if (seen.has(key)) throw new Error('重复 doc_id + version'); seen.add(key);
    const hash = digest(canonical(doc)); const old = previous.documents[key];
    result.documents[key] = old?.hash === hash ? old : { hash, chunks: chunkDocument(doc) };
    if (old?.hash !== hash) changed.push(key);
  }
  return { index: result, changed, removed: Object.keys(previous.documents).filter(key => !seen.has(key)) };
}

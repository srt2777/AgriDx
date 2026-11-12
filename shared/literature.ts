/** Bibliographic archive. Agent citations are metadata-only; not diagnostic evidence. */
export interface LiteratureRecord {
  id: string; doi: string; title: string; journal: string; publisher: string;
  published: number[]; authors: string[]; issns: string[]; sourceIssn: string;
  topic: string; sourceUrl: string; url: string; retrievedAt: string; responseSha256: string;
  diagnosticEvidence: false; fullTextVerified: false; updates: unknown[];
}
export interface LiteratureFile { file: string; sha256: string; contentSha256: string; bytes: number; records?: number }
export interface LiteratureManifest {
  schemaVersion: 1; records: number; generatedAt: string; diagnosticEvidence: false; fullTextVerified: false;
  shards: LiteratureFile[]; search: { shardSize: number; buckets: LiteratureFile[]; topics: Record<string, number> };
}
export interface LiteraturePage {
  records: number; total: number; page: number; pages: number; pageSize: 20;
  entries: LiteratureRecord[]; topics: string[]; generatedAt: string;
}
export const literatureTokens = (text: string): string[] => [...new Set(text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])];
export function literatureBucket(token: string): number {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i++) hash = Math.imul(hash ^ token.charCodeAt(i), 16777619);
  return (hash >>> 0) % 128;
}
const quote = (text: string) => encodeURIComponent(text).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
export function validateLiteratureRecord(value: unknown): asserts value is LiteratureRecord {
  const v = value as LiteratureRecord;
  if (!v || typeof v !== 'object' || !/^CR-[a-f0-9]{24}$/.test(v.id) || !/^10\.\d{4,9}\/\S+$/.test(v.doi) ||
      typeof v.publisher !== 'string' || typeof v.retrievedAt !== 'string' || !Number.isFinite(Date.parse(v.retrievedAt)) ||
      !Array.isArray(v.updates) || !Array.isArray(v.issns) || !v.issns.every(x => typeof x === 'string') || typeof v.sourceIssn !== 'string' ||
      typeof v.title !== 'string' || !v.title.trim() || typeof v.journal !== 'string' || typeof v.topic !== 'string' ||
      !Array.isArray(v.authors) || !v.authors.every(a => typeof a === 'string') || !Array.isArray(v.published) || !Number.isInteger(v.published[0]) ||
      v.url !== `https://doi.org/${v.doi.split('/').map(quote).join('/')}` ||
      v.sourceUrl !== `https://api.crossref.org/works/${quote(v.doi)}` ||
      v.diagnosticEvidence !== false || v.fullTextVerified !== false || !/^[a-f0-9]{64}$/.test(v.responseSha256)) throw new Error('Invalid literature source record');
}
export function validateLiteratureManifest(value: unknown): asserts value is LiteratureManifest {
  const v = value as LiteratureManifest;
  if (!v || v.schemaVersion !== 1 || !Number.isSafeInteger(v.records) || v.records < 0 || v.diagnosticEvidence !== false || v.fullTextVerified !== false ||
      !Array.isArray(v.shards) || !v.search || v.search.shardSize !== 1000 || !Array.isArray(v.search.buckets) || v.search.buckets.length !== 128 ||
      typeof v.generatedAt !== 'string' || !Number.isFinite(Date.parse(v.generatedAt)) ||
      !v.search.topics || typeof v.search.topics !== 'object' || Array.isArray(v.search.topics) ||
      Object.values(v.search.topics).some(n => !Number.isSafeInteger(n) || n < 0) ||
      Object.values(v.search.topics).reduce((a,b) => a+b,0) !== v.records ||
      v.shards.reduce((n, s) => n + (s.records ?? 0), 0) !== v.records) throw new Error('Invalid literature manifest');
  for (const f of [...v.shards, ...v.search.buckets]) {
    if (!/^(?:records-\d{3,4}\.jsonl|terms-\d{3}\.json)\.gz$/.test(f.file) || !/^[a-f0-9]{64}$/.test(f.sha256) || !/^[a-f0-9]{64}$/.test(f.contentSha256) || !Number.isSafeInteger(f.bytes)) throw new Error('Invalid literature shard');
  }
  if (v.shards.some((f, i) => f.file !== `records-${String(i+1).padStart(3,'0')}.jsonl.gz` || f.records !== Math.min(1000, v.records-i*1000)) ||
      v.search.buckets.some((f,i) => f.file !== `terms-${String(i).padStart(3,'0')}.json.gz`)) throw new Error('Invalid literature shard order');
}
export async function searchLiterature(manifest: LiteratureManifest, load: (file: LiteratureFile) => Promise<string>, params: URLSearchParams): Promise<LiteraturePage> {
  const q = params.get('q')?.trim() ?? '', topic = params.get('topic') ?? '', rawPage = params.get('page') ?? '1';
  if (q.length > 100 || !/^[1-9]\d{0,6}$/.test(rawPage) || (topic && !Object.hasOwn(manifest.search.topics, topic))) throw new RangeError('Invalid literature filters');
  const isDoiUrl = /^https?:\/\/doi\.org\//i.test(q);
  let canonicalDoi = q.replace(/^https?:\/\/doi\.org\//i, '').toLowerCase();
  if (isDoiUrl) { try { canonicalDoi = decodeURIComponent(canonicalDoi); } catch { throw new RangeError('Invalid DOI URL'); } }
  const tokens = /^10\.\d{4,9}\/\S+$/.test(canonicalDoi) ? [`\0doi:${canonicalDoi}`] : literatureTokens(q);
  if (tokens.length > 12) throw new RangeError('Use at most 12 search terms');
  const hasSearchTokens = tokens.length > 0;
  if (topic) tokens.push(`\0topic:${topic}`);
  const buckets = new Map<number, Record<string, number[]>>();
  await Promise.all([...new Set(tokens.map(literatureBucket))].map(async index => {
    buckets.set(index, JSON.parse(await load(manifest.search.buckets[index])));
  }));
  const lists = tokens.map(token => {
    const bucket = buckets.get(literatureBucket(token));
    return bucket && Object.hasOwn(bucket, token) ? bucket[token] : [];
  });
  if (q && !hasSearchTokens) lists.push([]);
  lists.sort((a, b) => a.length - b.length);
  let ids: number[] | undefined;
  if (lists.length) {
    ids = lists[0];
    for (const list of lists.slice(1)) {
      const set = new Set(list); ids = ids.filter(id => set.has(id));
    }
  }
  const total = ids?.length ?? manifest.records, pages = Math.max(1, Math.ceil(total/20)), page = Math.min(Number(rawPage), pages);
  const selected = ids ? ids.slice((page-1)*20, page*20) : Array.from({length: Math.min(20, total-(page-1)*20)}, (_,i) => (page-1)*20+i);
  const records = new Map<number, LiteratureRecord[]>();
  await Promise.all([...new Set(selected.map(id => Math.floor(id/1000)))].map(async index => {
    const rows: unknown[] = (await load(manifest.shards[index])).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    if (rows.length !== manifest.shards[index].records) throw new Error('Literature shard count mismatch');
    rows.forEach(validateLiteratureRecord); records.set(index, rows as LiteratureRecord[]);
  }));
  return {records: manifest.records, total, page, pages, pageSize: 20,
    entries: selected.map(id => records.get(Math.floor(id/1000))![id%1000]), topics: Object.keys(manifest.search.topics), generatedAt: manifest.generatedAt};
}

/** Fetch may already decode Content-Encoding:gzip; validate either exact representation. */
export function literaturePayloadEncoding(file: LiteratureFile, bytes: number, sha256: string): 'gzip' | 'identity' {
  if (bytes === file.bytes && sha256 === file.sha256) return 'gzip';
  if (sha256 === file.contentSha256) return 'identity';
  throw new Error('Literature checksum mismatch');
}

import fs from 'node:fs/promises';
import path from 'node:path';
import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { searchLiterature, validateLiteratureManifest, type LiteratureFile } from '../../shared/literature';
const unzip = promisify(gunzip);
const root = path.resolve(process.cwd(), 'data/literature');
const cache = new Map<string, string>();
let cachedBytes = 0;
async function load(file: LiteratureFile) {
  const existing = cache.get(file.sha256); if (existing !== undefined) return existing;
  const bytes = await fs.readFile(path.join(root,file.file));
  if (bytes.length !== file.bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error('Literature checksum mismatch');
  const text = (await unzip(bytes)).toString('utf8');
  while (cache.size && cachedBytes + text.length*2 > 32*1024*1024) {
    const key=cache.keys().next().value!; cachedBytes -= cache.get(key)!.length*2; cache.delete(key);
  }
  if (cache.has(file.sha256)) cachedBytes -= cache.get(file.sha256)!.length*2;
  cache.set(file.sha256,text); cachedBytes += text.length*2; return text;
}
export async function getLiterature(params: URLSearchParams, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const manifest: unknown = JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8'));
  validateLiteratureManifest(manifest); return searchLiterature(manifest, async file => { signal?.throwIfAborted(); const text = await load(file); signal?.throwIfAborted(); return text; },params);
}

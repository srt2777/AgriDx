import { literaturePayloadEncoding, searchLiterature, validateLiteratureManifest, type LiteratureFile, type LiteratureManifest } from '../../../shared/literature';
let manifestPromise: Promise<LiteratureManifest> | undefined;
const cache = new Map<string, string>();
let cachedBytes = 0;
export function loadLiteratureManifest() {
  manifestPromise ??= fetch('/assets/literature/manifest.json', {cache:'no-cache'}).then(async response => {
    if (!response.ok) throw new Error('Literature catalog unavailable');
    const value: unknown = await response.json(); validateLiteratureManifest(value); return value;
  }).catch(error => { manifestPromise = undefined; throw error; });
  return manifestPromise;
}
export function resetLiteratureManifest() { manifestPromise = undefined; }
export async function requestLiterature(params: URLSearchParams, signal: AbortSignal) {
  const manifest = await loadLiteratureManifest();
  async function load(file: LiteratureFile) {
    signal.throwIfAborted();
    const existing = cache.get(file.sha256); if (existing !== undefined) return existing;
    const response = await fetch(`/assets/literature/${file.file}?sha256=${file.sha256}`, {signal});
    if (!response.ok) throw new Error('Literature data unavailable');
    const bytes = await response.arrayBuffer();
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
    const encoding = literaturePayloadEncoding(file, bytes.byteLength, digest);
    const text = encoding === 'identity' ? new TextDecoder('utf-8', {fatal:true}).decode(bytes)
      : await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    while (cache.size && cachedBytes + text.length*2 > 24*1024*1024) {
      const key = cache.keys().next().value!; cachedBytes -= cache.get(key)!.length*2; cache.delete(key);
    }
    if (cache.has(file.sha256)) cachedBytes -= cache.get(file.sha256)!.length*2;
    cache.set(file.sha256,text); cachedBytes += text.length*2; return text;
  }
  return searchLiterature(manifest,load,params);
}

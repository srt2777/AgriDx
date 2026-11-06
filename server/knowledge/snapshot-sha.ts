import fs from 'node:fs';
import path from 'node:path';
import { sha256Hex } from '../../shared/sha256';

/**
 * Snapshot identity for the graph: one SHA over exactly the three index files
 * the catalog and the graph derive from (hierarchy.json + entries.jsonl +
 * sources.json). Any classification or entry change moves the SHA, so a graph
 * built from an older snapshot can never pass as current. Mirrors the
 * semantic-report digest style: SHA-256 over a sorted {path: fileSha256} map.
 *
 * Hashing uses the pure-JS `shared/sha256` (no `node:crypto`): the dev-preview
 * browser bundle imports this module through the causal loader, and Rollup
 * externalises `node:crypto` without the `createHash` named export.
 */
export const SNAPSHOT_INDEX_FILES = ['hierarchy.json', 'entries.jsonl', 'sources.json'] as const;
const INDEX_RELATIVE = '知识库/整理后的知识库/农用拖拉机知识库';

export function computeSnapshotSha256FromContents(contents: Partial<Record<string, string | Buffer>>): string | null {
  try {
    const files: Record<string, string> = {};
    for (const name of SNAPSHOT_INDEX_FILES) {
      const content = contents[name];
      if (content === undefined) return null;
      files[`${INDEX_RELATIVE}/${name}`] = sha256Hex(content);
    }
    const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    return sha256Hex(JSON.stringify(sorted));
  } catch {
    return null;
  }
}

export function computeSnapshotSha256(indexRoot: string): string | null {
  try {
    const contents: Record<string, Buffer> = {};
    for (const name of SNAPSHOT_INDEX_FILES) {
      contents[name] = fs.readFileSync(path.join(indexRoot, name));
    }
    return computeSnapshotSha256FromContents(contents);
  } catch {
    return null;
  }
}

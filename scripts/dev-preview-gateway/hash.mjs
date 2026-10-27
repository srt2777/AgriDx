import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function gatewaySourceHash(directory = path.dirname(fileURLToPath(import.meta.url))) {
  const walk = (relative) => readdirSync(path.join(directory, relative), { withFileTypes: true }).flatMap(entry => {
    const name = `${relative}/${entry.name}`;
    return entry.isDirectory() ? walk(name) : entry.isFile() ? [name] : [];
  });
  const files = ['worker.js', 'ai.js', ...walk('drizzle')].sort();
  const hash = createHash('sha256');
  for (const file of files) hash.update(file).update('\0').update(readFileSync(path.join(directory, file))).update('\0');
  return hash.digest('hex');
}

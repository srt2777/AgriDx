import { readFileSync } from 'node:fs';
import path from 'node:path';
import { rootDir } from './lib/process.mjs';

export function loadVersionPolicy(directory = rootDir) {
  const policy = JSON.parse(readFileSync(path.join(directory, 'version-policy.json'), 'utf8'));
  if (!Number.isSafeInteger(policy.maxMajor) || policy.maxMajor < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(policy.grantedOn) || typeof policy.note !== 'string' || !policy.note.trim()) throw new Error('version-policy.json 格式无效。');
  return policy;
}

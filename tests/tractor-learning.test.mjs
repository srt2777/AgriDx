import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkTractorLearning } from '../scripts/check-tractor-learning.mjs';
import { rootDir } from '../scripts/lib/process.mjs';

const manifestPath = 'docs/tractor-knowledge/expansion-5000/validation.json';
const textDigest = text => createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');

test('学习资料接受Windows换行，但拒绝正文改写和将学习条目升级为维修证据', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'agridx-learning-check-'));
  try {
    const manifest = JSON.parse(readFileSync(path.join(rootDir, manifestPath), 'utf8'));
    for (const relative of [manifestPath, 'docs/knowledge-library.md', 'docs/tractor-knowledge/expansion-875/README.md', '知识库/条目整理规范.md', ...Object.keys(manifest.preserved_baseline.files), ...Object.keys(manifest.files)]) {
      const destination = path.join(directory, relative);
      mkdirSync(path.dirname(destination), { recursive: true });
      writeFileSync(destination, readFileSync(path.join(rootDir, relative), 'utf8').replace(/\r?\n/g, '\r\n'));
    }
    assert.deepEqual(checkTractorLearning(directory), { added: 5000, total: 6000, topics: 250, documents: 50 });

    const bodyPath = 'docs/tractor-knowledge/expansion-5000/11.md';
    const bodyFile = path.join(directory, bodyPath);
    const originalBody = readFileSync(bodyFile, 'utf8');
    writeFileSync(bodyFile, originalBody + '\r\n未经记录的正文改动\r\n');
    assert.throws(() => checkTractorLearning(directory), /文件摘要不符/);
    writeFileSync(bodyFile, originalBody);

    const indexPath = 'docs/tractor-knowledge/expansion-5000/index.jsonl';
    const indexFile = path.join(directory, indexPath);
    const modified = readFileSync(indexFile, 'utf8').replace('"diagnostic_evidence": false', '"diagnostic_evidence": true');
    writeFileSync(indexFile, modified);
    // Keep the checksum valid to exercise the purpose boundary independently.
    manifest.files[indexPath] = textDigest(modified);
    writeFileSync(path.join(directory, manifestPath), JSON.stringify(manifest));
    assert.throws(() => checkTractorLearning(directory), /缺少学习用途边界/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { rootDir } from './process.mjs';

/** Collect indexed Markdown and its indexes; exclude secrets and original manuals. */
export function createKnowledgeSnapshot(root = rootDir) {
  const index = '知识库/整理后的知识库/农用拖拉机知识库';
  const entriesFile = `${index}/entries.jsonl`;
  const entries = readFileSync(path.join(root, entriesFile), 'utf8').split(/\r?\n/).filter((line) => line.trim()).map(JSON.parse);
  const snapshot = {};
  const add = (relative) => {
    const file = realpathSync(path.resolve(root, relative));
    const boundary = path.relative(realpathSync(root), file);
    if (boundary.startsWith(`..${path.sep}`) || boundary === '..' || path.isAbsolute(boundary)) {
      throw new Error(`Knowledge snapshot escapes the checkout: ${relative}`);
    }
    snapshot[`/${relative.replace(/\\/g, '/')}`] = readFileSync(file, 'utf8');
  };
  for (const file of [entriesFile, `${index}/entry-roles.jsonl`, `${index}/sources.json`, `${index}/hierarchy.json`, `${index}/通用框架.json`]) add(file);
  // The optional public release record travels with the same immutable data.
  if (existsSync(path.join(root, index, 'kb-version.json'))) add(`${index}/kb-version.json`);
  for (const file of new Set(entries.map((entry) => entry.knowledge_path))) {
    if (!file.startsWith('知识库/整理后的知识库/') || !file.endsWith('.md')) throw new Error(`Unexpected knowledge document: ${file}`);
    add(file);
  }
  for (const indexFile of ['docs/tractor-knowledge/index.jsonl', 'docs/tractor-knowledge/expansion-5000/index.jsonl']) {
    add(indexFile);
    const learning = snapshot[`/${indexFile}`].split(/\r?\n/).filter(line => line.trim()).map(JSON.parse);
    for (const file of new Set(learning.map(entry => entry.knowledge_path))) {
      if (!/^docs\/tractor-knowledge\/(?:expansion-5000\/)?\d{2}\.md$/.test(file)) throw new Error(`Unexpected learning document: ${file}`);
      add(file);
    }
  }
  const walk = (directory) => {
    for (const item of readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const relative = `${directory}/${item.name}`;
      if (item.isDirectory() && item.name !== '00_说明') walk(relative);
      else if (item.isFile() && item.name.endsWith('.md')) add(relative);
    }
  };
  walk('server/knowledge');
  return snapshot;
}
export function knowledgeSnapshotPlugin(snapshot = createKnowledgeSnapshot()) {
  const fsModule = '\0agridx-preview-filesystem';
  return {
    name: 'agridx-development-knowledge', enforce: 'pre',
    resolveId(id) {
      if (id === 'node:fs') return fsModule;
      if (id === 'node:path') return path.join(rootDir, 'src/dev-preview/path.mjs');
    },
    load(id) {
      if (id === fsModule) return `import { createReadOnlyFileSystem } from ${JSON.stringify(path.join(rootDir, 'src/dev-preview/filesystem.mjs').replaceAll('\\', '/'))};\nexport default createReadOnlyFileSystem(${JSON.stringify(snapshot)});`;
    },
    transform(code, id) {
      if (id.startsWith(`${path.join(rootDir, 'server/knowledge').replaceAll('\\', '/')}/`)) {
        return { code: code.replaceAll('process.cwd()', '"/"'), map: null };
      }
    },
  };
}

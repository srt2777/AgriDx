// Local UI acceptance only: build controlled branches without changing sources or browser settings.
// Run from the repository: node --import tsx tests/browser/parts-studio-fixture.mjs unsupported|reduced
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';
import express from 'express';

const mode = process.argv[2];
if (!['unsupported', 'reduced'].includes(mode)) throw new Error('Choose unsupported or reduced');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workspace = path.dirname(root);
const output = path.resolve(workspace, `parts-qa-${mode}-${Date.now()}`);
if (!output.startsWith(workspace + path.sep)) throw new Error('QA output must remain in the task workspace');
let applied = false;
await build({
  root, configFile: path.join(root, 'vite.config.ts'),
  build: { outDir: output, emptyOutDir: false },
  plugins: [{
    name: 'parts-studio-acceptance-fixture', enforce: 'pre',
    transform(code, id) {
      const filename = id.replaceAll('\\', '/');
      if (mode === 'unsupported' && filename.endsWith('/src/lib/webgl.ts')) {
        const replacement = code.replace(/export function probeWebGL\(\): boolean \{[\s\S]*?\r?\n\}/,
          'export function probeWebGL(): boolean { return false; }');
        applied = replacement !== code;
        return replacement;
      }
      if (mode === 'reduced' && filename.endsWith('/src/components/parts-tractor/PartsStudio.tsx')) {
        const replacement = code.replace('const reduced = useReducedMotion() === true;', 'const reduced = true;');
        applied = replacement !== code;
        return replacement;
      }
    },
    transformIndexHtml: () => [{ tag: 'meta', attrs: { name: 'agridx-qa-mode', content: mode }, injectTo: 'head' }],
  }],
});
if (!applied) throw new Error('Fixture branch was not applied; do not accept this build');

process.env.NODE_ENV = 'production';
process.env.ALLOW_EXTERNAL_AI = 'false';
process.env.DIAGNOSIS_MODE = 'knowledge_only';
process.env.MEMORY_DB_PATH = path.join(workspace, `parts-qa-${mode}.sqlite`);
const { default: app } = await import(pathToFileURL(path.join(root, 'server/index.ts')).href);
app.use(express.static(output));
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  res.sendFile(path.join(output, 'index.html'));
});
const port = mode === 'unsupported' ? 3138 : 3139;
app.listen(port, '127.0.0.1', () => console.log(`[parts-qa] ${mode}: http://localhost:${port}/#/models; output=${output}`));

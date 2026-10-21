import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { build } from 'vite';
import { rootDir, runPackageBin } from './lib/process.mjs';
import { knowledgeSnapshotPlugin } from './lib/dev-preview.mjs';

const { version } = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: rootDir, encoding: 'utf8' }).trim();
const branch = process.env.GITHUB_REF_NAME || execFileSync('git', ['branch', '--show-current'], { cwd: rootDir, encoding: 'utf8' }).trim();
const repository = process.env.GITHUB_REPOSITORY || 'srt2777/AgriDx';
const release = { version, commit, branch, repository, builtAt: new Date().toISOString() };
runPackageBin('typescript', 'tsc', ['-b', 'tsconfig.app.json']);
await build({
  root: rootDir, configFile: path.join(rootDir, 'vite.config.ts'), base: '/',
  plugins: [knowledgeSnapshotPlugin()],
  define: {
    __AGRIDX_DEV_PREVIEW__: 'true',
    __AGRIDX_PREVIEW_RELEASE__: JSON.stringify(release),
  },
  build: { outDir: 'dist-preview', emptyOutDir: true },
});
writeFileSync(path.join(rootDir, 'dist-preview/dev-preview.json'), `${JSON.stringify(release, null, 2)}\n`);
writeFileSync(path.join(rootDir, 'dist-preview/.nojekyll'), '');
console.log(`[dev-preview] ${version} ${branch} ${commit}`);

import { mkdirSync, copyFileSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';

// Retain the existing single-file Worker deployment contract; no runtime imports.
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist/server', { recursive: true });
mkdirSync('dist/.openai', { recursive: true });
const release = JSON.parse(readFileSync('gateway-release.json', 'utf8'));
const ai = readFileSync('worker/ai.js', 'utf8').replace(/^export /gm, '');
const worker = readFileSync('worker/index.js', 'utf8').replace("import { handleAiRequest, aiStatus } from './ai.js';", '');
writeFileSync('dist/server/index.js', `globalThis.__AGRIDX_GATEWAY_RELEASE__ = ${JSON.stringify(release)};\n${ai}\n${worker}`);
copyFileSync('.openai/hosting.json', 'dist/.openai/hosting.json');
cpSync('drizzle', 'dist/drizzle', { recursive: true });

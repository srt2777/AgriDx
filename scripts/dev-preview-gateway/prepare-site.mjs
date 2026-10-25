import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const source = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(source, '../..');
const target = process.argv[2];
if (!target || !path.isAbsolute(target)) throw new Error('Provide the absolute existing development Site checkout.');
if (execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()) throw new Error('Save the GitHub source first so the gateway release identifies the exact source state.');
const config = JSON.parse(readFileSync(path.join(root, '.openai/dev-preview.json'), 'utf8'));
const manifestPath = path.join(target, '.openai/hosting.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (manifest.project_id !== config.project_id) throw new Error('Site identity must match the isolated development Site; production is not a target.');
const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const release = { version, sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), builtAt: new Date().toISOString() };
// The Site provisioning layer owns the actual D1 database identity.
manifest.d1 = 'DB';
mkdirSync(path.join(target, 'worker'), { recursive: true });
mkdirSync(path.join(target, 'scripts'), { recursive: true });
cpSync(path.join(source, 'worker.js'), path.join(target, 'worker/index.js'));
cpSync(path.join(source, 'ai.js'), path.join(target, 'worker/ai.js'));
cpSync(path.join(source, 'drizzle'), path.join(target, 'drizzle'), { recursive: true });
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(path.join(target, 'gateway-release.json'), `${JSON.stringify(release, null, 2)}\n`);
cpSync(path.join(source, 'build-worker.mjs'), path.join(target, 'scripts/build.mjs'));
console.log(JSON.stringify({ project_id: config.project_id, checkout_path: target, release }));

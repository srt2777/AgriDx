import { readdirSync } from 'node:fs';
import path from 'node:path';
import { isMain, main, rootDir, run } from './lib/process.mjs';
function testAgent() {
  const files = readdirSync(path.join(rootDir, 'tests')).filter(name => /^agent-.*\.test\.(ts|mjs)$/.test(name)).sort().map(name => path.join(rootDir, 'tests', name));
  if (!files.length) throw new Error('Agent 测试缺失');
  run(process.execPath, ['--import', 'tsx', '--test', ...files]);
}
if (isMain(import.meta.url)) main(testAgent, 'agent:test');

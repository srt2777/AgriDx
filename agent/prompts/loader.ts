import { readFileSync } from 'node:fs';
import path from 'node:path';
export interface PromptBundle { version: string; system: string; flow: string }
/** Read trusted, fixed filenames per task, allowing updates without loading user-controlled paths. */
export function loadPrompts(root = process.cwd()): PromptBundle {
  const read = (file: string) => readFileSync(path.join(root, 'agent/prompts', file), 'utf8');
  const system = read('system.md'), flow = read('diagnosis_flow.md');
  const versions = [system, flow].map(text => /^# version: ([\w.-]+)$/m.exec(text)?.[1]);
  if (versions.some(version => !version)) throw new Error('提示词缺少版本号');
  return { version: versions.join('/'), system, flow };
}

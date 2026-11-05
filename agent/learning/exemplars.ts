import { readFileSync } from 'node:fs';
import type { PlannerTopic } from '../../server/diagnosis/plannerPlans';
import type { SftExample } from './sft';

/**
 * Read-only exemplar loader (checklist item 10, "let the agent see the
 * good trajectories"). Offline / script use only: it reads a committed
 * SFT dataset file and picks the best examples for a topic. It never
 * writes, never trains, and is NOT wired into the live diagnosis path —
 * the diagnosis service does not import this module, so exemplars can
 * never silently change a production answer. A caller that wants to
 * show examples to the model must opt in explicitly and paste the
 * section this module builds.
 *
 * The prompt section is labelled as examples only: exemplars are format
 * references, never fault evidence. Evidence still has to come from the
 * turn's own retrieval and tool calls.
 */

export function loadSftDataset(path: string): SftExample[] {
  const text = readFileSync(path, 'utf8');
  const examples: SftExample[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as { messages?: unknown }).messages)) {
      throw new Error(`Invalid SFT dataset line in ${path}: expected an object with a messages array`);
    }
    examples.push(parsed as SftExample);
  }
  return examples;
}

/** Best examples for a topic, highest reward first. Default and max is 3. */
export function selectExemplars(
  examples: readonly SftExample[],
  options: { topic?: PlannerTopic | null; limit?: number } = {},
): SftExample[] {
  const limit = Math.max(0, Math.min(3, Math.floor(options.limit ?? 3)));
  const pool = options.topic
    ? examples.filter(example => example.topic === options.topic)
    : [...examples];
  return [...pool].sort((a, b) => b.rewardTotal - a.rewardTotal).slice(0, limit);
}

/** Format exemplars as a clearly-labelled prompt section. Empty string when none. */
export function buildExemplarPromptSection(examples: readonly SftExample[]): string {
  if (examples.length === 0) return '';
  const blocks = examples.map((example, index) => {
    const user = example.messages.find(m => m.role === 'user')?.content ?? '';
    const assistant = example.messages.find(m => m.role === 'assistant')?.content ?? '';
    return `示例 ${index + 1}（主题：${example.topic ?? '未分类'}，奖励分：${example.rewardTotal}）：\n用户：${user}\n助手：${assistant}`;
  });
  return [
    '以下是同类故障的好轨迹示例，仅作回答格式参考，不作为本次故障的证据；本次结论仍须以本轮检索和工具返回为准：',
    ...blocks,
  ].join('\n\n');
}

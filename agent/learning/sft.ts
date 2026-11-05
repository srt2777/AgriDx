import type { PlannerTopic } from '../../server/diagnosis/plannerPlans';
import type { DiagnosticTrajectory } from './trajectory';

/**
 * SFT export (CMU 11-768 Lecture 8, checklist item 8). One trajectory
 * becomes one training example in a single fixed shape:
 *
 *   user question (train: true) -> tool call summaries (train: false)
 *   -> assistant answer (train: true)
 *
 * Masking rule — the point of this module: tool outputs are NEVER copied
 * into the example. A tool turn records only the tool name and the
 * evidence IDs it is associated with, marked train:false, so a training
 * run that respects the flag never counts tool output in the loss. Only
 * the model's own words (the user question is the prompt; the assistant
 * answer is the target) are train:true.
 *
 * This module only formats data. It does not train, fine-tune or call
 * any model — AgriDx uses the DeepSeek API model (deepseek-flash) and
 * this repository cannot update that model's weights.
 */

export type SftMessageRole = 'user' | 'assistant' | 'tool';

export interface SftMessage {
  role: SftMessageRole;
  content: string;
  /** Tool name, only on tool messages. */
  name?: string;
  /** False means "masked": do not count this message in the loss. */
  train: boolean;
}

export interface SftExample {
  id: string;
  topic: PlannerTopic | null;
  source: DiagnosticTrajectory['source'];
  rewardTotal: number;
  messages: SftMessage[];
}

export function trajectoryToSftExample(
  trajectory: DiagnosticTrajectory,
  rewardTotal: number,
): SftExample | null {
  if (!trajectory.answer.trim() || !trajectory.question.trim()) return null;
  const messages: SftMessage[] = [
    { role: 'user', content: trajectory.question, train: true },
  ];
  for (const call of trajectory.toolCalls) {
    const evidence = call.evidenceIds.length > 0 ? `证据：${call.evidenceIds.join('、')}` : '证据：无';
    messages.push({
      role: 'tool',
      name: call.tool,
      content: `工具 ${call.tool} 已调用（${call.ok ? '成功' : '失败'}），结果已屏蔽，不计入 loss。${evidence}`,
      train: false,
    });
  }
  messages.push({ role: 'assistant', content: trajectory.answer, train: true });
  return {
    id: trajectory.id,
    topic: trajectory.plannerTopic,
    source: trajectory.source,
    rewardTotal,
    messages,
  };
}

export function sftExampleToJsonl(example: SftExample): string {
  return JSON.stringify(example);
}

/**
 * Export examples to JSONL, one example per line. Validates the masking
 * contract and throws instead of writing a bad file: every example must
 * have exactly one train:true assistant message, and every tool message
 * must be train:false.
 */
export function exportSftDataset(examples: readonly SftExample[]): string {
  for (const example of examples) {
    const assistants = example.messages.filter(m => m.role === 'assistant' && m.train);
    if (assistants.length !== 1) {
      throw new Error(`SFT example ${example.id} must have exactly one trainable assistant message, got ${assistants.length}`);
    }
    const unmaskedTool = example.messages.find(m => m.role === 'tool' && m.train);
    if (unmaskedTool) {
      throw new Error(`SFT example ${example.id} has an unmasked tool message (${unmaskedTool.name ?? 'unknown'}); tool outputs must be masked`);
    }
    if (example.messages.some(m => m.role === 'tool' && /结果[：:]/i.test(m.content) && !m.content.includes('结果已屏蔽'))) {
      throw new Error(`SFT example ${example.id} leaks a tool result into the export`);
    }
  }
  return examples.map(sftExampleToJsonl).join('\n') + (examples.length > 0 ? '\n' : '');
}

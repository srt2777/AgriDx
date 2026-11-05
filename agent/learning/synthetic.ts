import {
  PLANNER_TOPICS,
  plannerFaultChains,
  topicEvidence,
  type PlannerTopic,
} from '../../server/diagnosis/plannerPlans';
import { buildDiagnosticTrajectory, type DiagnosticTrajectory } from './trajectory';
import { isGoodTrajectory, scoreTrajectory, scoreTrajectoryGroup } from './reward';
import { trajectoryToSftExample, type SftExample } from './sft';

/**
 * Offline synthetic SFT dataset builder (checklist items 2 and 8).
 *
 * Provenance — this is the honest part, read it first:
 * - There are NO real production user trajectories in this repository.
 *   Nothing here claims to be one.
 * - Every candidate is built from things already in the repo: the six
 *   Planner topics, the two steps per topic, the fault-chain causes and
 *   the verified evidence IDs in server/diagnosis/plannerPlans.ts.
 * - Machines, symptom wordings and measured readings are synthetic
 *   fixture values (the readings exist only inside the fixture's own
 *   tool output, and the answer cites exactly that value — that is what
 *   the numeric-citation check verifies). They are NOT manual data and
 *   must never be quoted as repair facts.
 * - Every candidate is scored by the reward scorer and only kept when
 *   it passes the good-trajectory gate (total >= 6, no blocking flags).
 *   Rejected candidates are reported, never padded up to a round number.
 *
 * Shape: 6 topics x 3 symptom wordings x 3 tool plans = 54 candidates.
 * The 3 plans in one symptom group are the GRPO group for that question.
 */

export interface SyntheticDatasetResult {
  examples: SftExample[];
  candidates: number;
  kept: number;
  rejected: { id: string; total: number; flags: string[] }[];
  /** Best trajectory id per GRPO group (same question, different plans). */
  groupBest: Record<string, string | null>;
  byTopic: Record<string, number>;
}

const MACHINES: Record<PlannerTopic, { brand: string; model: string }> = {
  // Brand/model pairs taken from the evidence comments in plannerPlans.ts
  // (and, for the two evidence-less topics, the LF904S fixture identity
  // already used in tests/diagnosis-decision-log.test.ts).
  overheat: { brand: '东方红', model: 'LF904S' },
  starting: { brand: '东方红', model: 'LF904S' },
  fuel: { brand: '约翰迪尔', model: '5E' },
  electrical: { brand: '久保田', model: 'M6060' },
  hydraulic: { brand: '东方红', model: 'LF系列' },
  transmission: { brand: '沃得', model: 'WF1404' },
};

const SYMPTOMS: Record<PlannerTopic, string[]> = {
  overheat: ['水温过高报警怎么办', '水温表到红线了，冷却液好像少了', '发动机温度偏高，散热器前面好像堵了'],
  starting: ['拖拉机打不着火，启动不了', '电瓶亏电，启动时转得很慢', '起动机没反应，无法启动'],
  fuel: ['拖拉机冒黑烟还憋熄火', '燃油供不上，喷油器可能脏了', '排气冒白烟，供油不畅'],
  electrical: ['保险丝熔断了，灯光不亮', '全车断电，照明失效', '发电机充电系统异常，灯光不亮'],
  hydraulic: ['农具提升缓慢还抖动', '液压系统整个不工作，农具升不起来', '悬挂提升无力'],
  transmission: ['离合器打滑，挂挡困难', '变速箱卡在空挡换挡困难', '离合器分离不彻底，起步抖动'],
};

/** Measured reading per topic: fixture value, present in both tool output and answer. */
const READINGS: Record<PlannerTopic, { label: string; value: string }> = {
  overheat: { label: '水温表读数', value: '98°C' },
  starting: { label: '电瓶电压', value: '11.2V' },
  fuel: { label: '供油压力', value: '0.28MPa' },
  electrical: { label: '保险丝处电压', value: '0V' },
  hydraulic: { label: '系统压力', value: '12.5MPa' },
  transmission: { label: '离合器间隙', value: '0.8mm' },
};

/** First-step observation labels, verbatim from plannerPlans.ts templates. */
const FIRST_STEP_LABELS: Record<PlannerTopic, string> = {
  overheat: '冷却液泄漏已有检查结果',
  starting: '电瓶已有检查结果',
  fuel: '燃油滤清器已有检查结果',
  electrical: '保险丝已有检查结果',
  hydraulic: '农具提升已有检查结果',
  transmission: '离合器已有检查结果',
};

const TOOL_PLANS: readonly (readonly string[])[] = [
  ['search_knowledge', 'fault_chain'],
  ['search_knowledge', 'fault_chain', 'model_fault_index'],
  ['resolve_machine_scope', 'search_knowledge', 'fault_chain', 'maintenance_schedule'],
];

const CREATED_AT = '2026-11-05T00:00:00.000Z';

function toolSource(tool: string): string {
  return tool === 'resolve_machine_scope' ? '助手推断' : '混合资料';
}

export function buildSyntheticDataset(): SyntheticDatasetResult {
  const examples: SftExample[] = [];
  const rejected: SyntheticDatasetResult['rejected'] = [];
  const groupBest: Record<string, string | null> = {};
  const byTopic: Record<string, number> = {};
  let candidates = 0;

  for (const topic of PLANNER_TOPICS) {
    const chain = plannerFaultChains[topic];
    const evidenceIds = topicEvidence[topic].map(entry => entry.entryId);
    const machine = MACHINES[topic];
    const reading = READINGS[topic];
    byTopic[topic] = 0;

    for (let symptomIdx = 0; symptomIdx < SYMPTOMS[topic].length; symptomIdx++) {
      const groupId = `synthetic-${topic}-${symptomIdx}`;
      const groupTotals: { id: string; total: number }[] = [];
      for (let planIdx = 0; planIdx < TOOL_PLANS.length; planIdx++) {
        const plan = TOOL_PLANS[planIdx];
        const cause = chain.causes[(symptomIdx + planIdx) % chain.causes.length];
        const id = `sft-${topic}-${symptomIdx}-${planIdx}`;
        const question = `${machine.brand}${machine.model}拖拉机${SYMPTOMS[topic][symptomIdx]}`;
        const evidenceText = evidenceIds.length > 0 ? `相关证据：${evidenceIds.join('、')}` : '暂无手册条目，本轮以现象与检查为准';
        const answer = `${machine.brand}${machine.model}：${cause.cause}。${reading.label}${reading.value}，该数值来自工具返回。${evidenceText}。请先确认${FIRST_STEP_LABELS[topic]}？`;
        const trajectory: DiagnosticTrajectory = buildDiagnosticTrajectory({
          id,
          createdAt: CREATED_AT,
          source: 'synthetic-from-existing-cases',
          question,
          machine,
          plannerTopic: topic,
          plannerUsed: true,
          toolCalls: plan.map((tool, step) => ({
            step,
            tool,
            ok: true,
            errorType: null,
            durationMs: null,
            source: toolSource(tool),
            evidenceIds: tool === 'search_knowledge' || tool === 'fault_chain' ? [...evidenceIds] : [],
          })),
          toolOutputs: [
            { tool: 'search_knowledge', text: `检索到${evidenceIds.join('、') || '相关条目'}；${reading.label}${reading.value}。` },
            { tool: 'fault_chain', text: `逻辑链：${chain.topEvent}；原因：${cause.cause}。` },
          ],
          evidenceIds: [...evidenceIds],
          answer,
          outcome: 'question',
          route: 'ai',
          reason: 'synthetic-fixture',
          usage: { rounds: plan.length, promptTokens: null, completionTokens: null, totalTokens: null, costUsd: null },
          // 'correct' here means "matches this fixture's own ground truth"
          // (topic, tools, cause and reading all constructed to agree).
          // It is not a real-vehicle verification.
          correctness: 'correct',
        });
        const breakdown = scoreTrajectory(trajectory, {
          expectedTopic: topic,
          expectedTools: [...plan],
          expectedEvidenceIds: [...evidenceIds],
          expectedCauseText: cause.cause,
          infoMissing: true,
          evidenceConflict: false,
        });
        candidates++;
        groupTotals.push({ id, total: breakdown.total });
        if (!isGoodTrajectory(breakdown)) {
          rejected.push({ id, total: breakdown.total, flags: [...breakdown.flags] });
          continue;
        }
        const example = trajectoryToSftExample(trajectory, breakdown.total);
        if (!example) {
          rejected.push({ id, total: breakdown.total, flags: ['export_failed'] });
          continue;
        }
        examples.push(example);
        byTopic[topic]++;
      }
      groupBest[groupId] = scoreTrajectoryGroup(groupId, groupTotals).bestId;
    }
  }

  return { examples, candidates, kept: examples.length, rejected, groupBest, byTopic };
}

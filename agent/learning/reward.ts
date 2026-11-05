import type { PlannerTopic } from '../../server/diagnosis/plannerPlans';
import type { DiagnosticTrajectory } from './trajectory';

/**
 * Offline reward scorer (CMU 11-768 Lectures 9 and 11, checklist
 * items 5 and 6). A pure function: same trajectory + same ground truth
 * always gives the same score. It never calls a model and never trains
 * anything; it only grades trajectories that already exist.
 *
 * Rules, in the order they are applied (weights are fixed and documented
 * here so a score can be audited by hand):
 *
 * - Planner (+2 / -2 / -1): expected topic matched +2; wrong topic -2;
 *   Planner skipped -2; no topic matched at all (ambiguous) -1; no
 *   expected topic given 0.
 * - Tool use (+2 / -1 each, floor -2): every expected tool used and ok
 *   +2; each missing expected tool -1. No tool call at all while tools
 *   were expected is "guessing without tools": -3 and the flag
 *   `bypass_tools` (a blocking flag for the good-trajectory gate).
 * - Numeric citation (+1 / -2): only measured values count as numbers
 *   here — a number followed by a unit (°C/℃/V/A/kPa/MPa/rpm/bar/%/mm
 *   and friends). Model names (5E, M6060), evidence IDs and step labels
 *   are not numbers. Every measured value in the answer must appear in
 *   a recorded tool output: all cited +1; any value missing from the
 *   tool outputs -2 and the flag `fabricated_number` (blocking). No
 *   measured value in the answer 0. No tool outputs recorded at all:
 *   0 with the flag `numeric_unverifiable` (live trajectories are
 *   always in this case — the main-loop trace is desensitised — so a
 *   live trajectory can never earn or lose the numeric point).
 * - Clarification (+1 / -2): ground truth says information was missing
 *   and the answer asks the user for it +1; information was missing and
 *   the answer guesses anyway -2 with the flag `hard_guess`.
 * - Evidence conflict (+1 / -1): ground truth says the evidence
 *   conflicted and the answer says so +1; conflict present but the
 *   answer hides it -1.
 * - Diagnosis (+2 / -1): the answer contains the expected cause text
 *   +2; otherwise -1 (only when an expected cause is given).
 *
 * Step credits split the same total three ways so a repair knows what
 * to fix: planner credit, tool credit, and summary credit (numeric +
 * clarification + conflict + diagnosis).
 */

export interface RewardGroundTruth {
  expectedTopic?: PlannerTopic | null;
  expectedTools?: readonly string[];
  expectedEvidenceIds?: readonly string[];
  /** Cause text the answer is expected to state (a planner fault-chain cause). */
  expectedCauseText?: string;
  /** True when the turn genuinely lacked information and should have asked. */
  infoMissing?: boolean;
  /** True when the retrieved evidence conflicted. */
  evidenceConflict?: boolean;
}

export interface RewardBreakdown {
  planner: number;
  toolUse: number;
  numericCitation: number;
  clarification: number;
  conflict: number;
  diagnosis: number;
  total: number;
  /** Machine-readable reasons, e.g. 'bypass_tools', 'fabricated_number'. */
  flags: string[];
  stepCredits: { planner: number; tool: number; summary: number };
}

/** Measured values only: number + unit. Model names and evidence IDs never match. */
const MEASURED_NUMBER_RE = /-?\d+(?:\.\d+)?\s*(?:°C|℃|V|A|kPa|MPa|rpm|bar|%|mm|cm|m|km\/h)/g;

export function measuredNumbers(text: string): string[] {
  return [...(text.match(MEASURED_NUMBER_RE) ?? [])].map(value => value.replace(/\s+/g, ''));
}

function asksUser(text: string): boolean {
  return /[？?]|请.{0,12}(?:补充|确认|提供|检查)/.test(text);
}

function notesConflict(text: string): boolean {
  return /冲突|不一致|不同说法|需要核对|尚不一致/.test(text);
}

/** Minimum total for a trajectory to count as a "good trajectory" for SFT. */
export const GOOD_TRAJECTORY_MIN_TOTAL = 6;
/** Flags that block the good-trajectory gate no matter the total. */
export const GOOD_TRAJECTORY_BLOCKING_FLAGS: readonly string[] = ['bypass_tools', 'fabricated_number'];

export function isGoodTrajectory(breakdown: RewardBreakdown): boolean {
  return breakdown.total >= GOOD_TRAJECTORY_MIN_TOTAL
    && !breakdown.flags.some(flag => (GOOD_TRAJECTORY_BLOCKING_FLAGS as readonly string[]).includes(flag));
}

export function scoreTrajectory(
  trajectory: DiagnosticTrajectory,
  truth: RewardGroundTruth = {},
): RewardBreakdown {
  const flags: string[] = [];
  let planner = 0;
  if (truth.expectedTopic !== undefined) {
    if (!trajectory.plannerUsed) {
      planner = -2;
      flags.push('planner_skipped');
    } else if (trajectory.plannerTopic === null) {
      planner = -1;
      flags.push('planner_unmatched');
    } else if (trajectory.plannerTopic === truth.expectedTopic) {
      planner = 2;
    } else {
      planner = -2;
      flags.push('planner_wrong_topic');
    }
  }

  let toolUse = 0;
  const expectedTools = truth.expectedTools ?? [];
  if (expectedTools.length > 0) {
    if (trajectory.toolCalls.length === 0) {
      toolUse = -3;
      flags.push('bypass_tools');
    } else {
      const usedOk = new Set(trajectory.toolCalls.filter(call => call.ok).map(call => call.tool));
      const missing = expectedTools.filter(tool => !usedOk.has(tool));
      if (missing.length === 0) toolUse = 2;
      else {
        toolUse = Math.max(-2, -missing.length);
        flags.push('tool_missing');
      }
    }
  }

  let numericCitation = 0;
  const answerNumbers = measuredNumbers(trajectory.answer);
  if (answerNumbers.length > 0) {
    if (trajectory.toolOutputs.length === 0) {
      numericCitation = 0;
      flags.push('numeric_unverifiable');
    } else {
      const outputText = trajectory.toolOutputs.map(output => output.text).join('\n');
      const outputNumbers = new Set(measuredNumbers(outputText));
      const uncited = answerNumbers.filter(value => !outputNumbers.has(value));
      if (uncited.length === 0) numericCitation = 1;
      else {
        numericCitation = -2;
        flags.push('fabricated_number');
      }
    }
  }

  let clarification = 0;
  if (truth.infoMissing) {
    if (asksUser(trajectory.answer)) clarification = 1;
    else {
      clarification = -2;
      flags.push('hard_guess');
    }
  }

  let conflict = 0;
  if (truth.evidenceConflict) {
    if (notesConflict(trajectory.answer)) conflict = 1;
    else {
      conflict = -1;
      flags.push('conflict_hidden');
    }
  }

  let diagnosis = 0;
  if (truth.expectedCauseText) {
    if (trajectory.answer.includes(truth.expectedCauseText)) diagnosis = 2;
    else {
      diagnosis = -1;
      flags.push('diagnosis_missing');
    }
  }

  const total = planner + toolUse + numericCitation + clarification + conflict + diagnosis;
  return {
    planner,
    toolUse,
    numericCitation,
    clarification,
    conflict,
    diagnosis,
    total,
    flags,
    stepCredits: {
      planner,
      tool: toolUse,
      summary: numericCitation + clarification + conflict + diagnosis,
    },
  };
}

export interface GroupScore {
  id: string;
  total: number;
  /** Group-relative advantage (GRPO-style): (total - group mean) / std. */
  advantage: number;
}

export interface GroupResult {
  groupId: string;
  mean: number;
  std: number;
  scores: GroupScore[];
  /** Id of the best trajectory in the group (highest total), or null when empty. */
  bestId: string | null;
}

/**
 * GRPO-style offline group scoring (Lecture 9, checklist item 4): several
 * trajectories for the same question are scored against each other, not
 * against an absolute bar. Advantage is relative to the group mean, so a
 * merely average trajectory in a strong group earns ~0 and the best one
 * earns a positive advantage. No training happens here.
 */
export function scoreTrajectoryGroup(
  groupId: string,
  items: readonly { id: string; total: number }[],
): GroupResult {
  if (items.length === 0) return { groupId, mean: 0, std: 0, scores: [], bestId: null };
  const mean = items.reduce((sum, item) => sum + item.total, 0) / items.length;
  const variance = items.reduce((sum, item) => sum + (item.total - mean) ** 2, 0) / items.length;
  const std = Math.sqrt(variance);
  const scores = items.map(item => ({
    id: item.id,
    total: item.total,
    advantage: std === 0 ? 0 : (item.total - mean) / std,
  }));
  const best = [...items].sort((a, b) => b.total - a.total)[0];
  return { groupId, mean, std, scores, bestId: best.id };
}

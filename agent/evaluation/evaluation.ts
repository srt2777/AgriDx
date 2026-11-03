/**
 * Offline, deterministic evaluation for AgriDx diagnosis answers.
 *
 * This module is a pure function module: no network, no clock, no LLM call,
 * no memory write, no file or environment access. The only runtime dependency
 * is `assessSuggestedAction` from the existing answer guard, which is itself
 * a deterministic regular-expression check. Scores are never probabilities:
 * the existing retrieval score is a raw keyword-weighted overlap whose
 * `calibrated` flag is always false, so only its level (high / medium /
 * low / unknown) is used here, never its numeric value.
 *
 * A veto voids the total score (score is reported as 0) while the
 * breakdown is kept, so a vetoed candidate can still be diagnosed.
 */

import { assessSuggestedAction } from '../../server/diagnosis/answerGuard';
import type {
  CoordinationDecision,
  DiagnosticCoverageKey,
  DiagnosticReply,
} from '../../shared/diagnosis';

export type ClaimSourceKind = 'manual' | 'general' | 'user_report' | 'inference';

export type EvaluationClaimKind =
  | 'cause'
  | 'background'
  | 'suggestion'
  | 'ai'
  | 'parameter'
  | 'manual_conclusion';

/**
 * One factual or advisory claim, tagged by its caller. The tag is the
 * contract: a claim that asserts manual support must carry manual
 * evidence ids, and a claim whose source is general / user-reported /
 * inferred must never be tagged as manual. The runner tags claims
 * deterministically from the reply structure (see runner.ts); it never
 * asks a model to tag them.
 */
export interface EvaluationClaim {
  text: string;
  kind: EvaluationClaimKind;
  evidenceIds: readonly string[];
  sourceKind: ClaimSourceKind;
  /** True when the claim wording presents itself as manual support. */
  assertsManual?: boolean;
}

export type RelevanceLevel = 'high' | 'medium' | 'low' | 'unknown';

export interface EvaluationCandidate {
  reply: DiagnosticReply;
  coordination: CoordinationDecision;
  /** Rendered reply text, used for length and whole-answer checks. */
  content: string;
  /** Local summary text, when the candidate is a local answer. */
  localSummary?: string;
  /** Provider label only; a synthetic AI supplement uses a synthetic label. */
  provider?: string | null;
  fellBack?: boolean;
  removedIssues?: readonly string[];
  claims: readonly EvaluationClaim[];
  /** When omitted, derived from coordination.candidates (non-excluded). */
  relevanceLevel?: RelevanceLevel;
  /** When omitted, derived from the reply structure (see deriveCoverage). */
  coverage?: Partial<Record<DiagnosticCoverageKey, boolean>>;
  /** Already-reported texts, used only to penalise repeated suggestions. */
  alreadyReportedTexts?: readonly string[];
}

export interface EvaluationGold {
  expectedEvidenceIds?: readonly string[];
  prohibitedTexts?: readonly string[];
  requiredCoverage?: readonly DiagnosticCoverageKey[];
  expectedQuestionKeywords?: readonly string[];
  forbiddenQuestionKeywords?: readonly string[];
}

export interface ScoreBreakdown {
  evidence_score: number;
  coverage_score: number;
  relevance_score: number;
  actionability_score: number;
  clarity_score: number;
}

export interface EvaluationResult {
  veto: boolean;
  vetoReasons: string[];
  /** 0 when vetoed (total voided); otherwise the weighted score. */
  score: number;
  /** Weighted score before the veto was applied; kept for diagnosis. */
  scoreBeforeVeto: number;
  breakdown: ScoreBreakdown;
}

export const EVALUATION_WEIGHTS = Object.freeze({
  evidence_score: 0.35,
  coverage_score: 0.2,
  relevance_score: 0.15,
  actionability_score: 0.15,
  clarity_score: 0.15,
} as const);

/** Promotion thresholds from the connection plan, section 3. */
export const PROMOTION_MIN_SCORE = 0.75;
export const PROMOTION_MIN_EVIDENCE = 0.6;
export const PROMOTION_MIN_MARGIN = 0.1;

export const MAX_ANSWER_CHARS = 16000;
export const MAX_LOCAL_SUMMARY_CHARS = 4000;

const PARAMETER_TERM =
  /压力|扭矩|间隙|电压|电流|温度|转速|油压|气压|容量|油量|pressure|torque|clearance|voltage|temperature/i;
const NUMBER_WITH_UNIT =
  /[-+]?\d+(?:\.\d+)?\s*(?:MPa|kPa|Pa|bar|psi|N[·. ]?m|Nm|mm|cm|mL|ml|L|kW|rpm|r\/min|V|A|Ω|°C|℃|%|兆帕|千帕|毫米|厘米|毫升|伏|安培|牛[·米]?米|转\/分)/i;
const MANUAL_CLAIM_WORDING =
  /(?:根据|依据|按照|出自|参见)?(?:手册|说明书)[^。；;]{0,20}(?:指出|表明|记载|明确|要求|规定|显示)/;
const ID_PATTERN = /\b[A-Z0-9]+(?:-[A-Z0-9]+)*\b/g;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function normalizeText(value: string): string {
  return value.replace(/[\s，,。；;：:、]/g, '');
}

/** Factual claims only; advisory suggestions are scored separately. */
function factualClaims(claims: readonly EvaluationClaim[]): EvaluationClaim[] {
  return claims.filter((claim) =>
    ['cause', 'background', 'ai', 'parameter', 'manual_conclusion'].includes(claim.kind),
  );
}

function manualEvidenceIds(claims: readonly EvaluationClaim[]): Set<string> {
  const ids = new Set<string>();
  for (const claim of claims) {
    if (claim.sourceKind === 'manual') {
      for (const id of claim.evidenceIds) ids.add(id.toUpperCase());
    }
  }
  return ids;
}

function clauseIsRestricted(clause: string): boolean {
  return assessSuggestedAction(clause).restricted;
}

function parameterClauseIsUnsupported(
  clause: string,
  manualIds: Set<string>,
): boolean {
  if (!PARAMETER_TERM.test(clause) || !NUMBER_WITH_UNIT.test(clause)) return false;
  const clauseIds = [...clause.matchAll(ID_PATTERN)].map((match) => match[0].toUpperCase());
  return !clauseIds.some((id) => manualIds.has(id));
}

function deriveRelevanceLevel(candidate: EvaluationCandidate): RelevanceLevel {
  if (candidate.relevanceLevel) return candidate.relevanceLevel;
  const order: Record<RelevanceLevel, number> = { high: 3, medium: 2, low: 1, unknown: 0 };
  let best: RelevanceLevel = 'unknown';
  for (const item of candidate.coordination.candidates ?? []) {
    if (item.excluded) continue;
    const level = item.relevance.level;
    if (order[level] > order[best]) best = level;
  }
  return best;
}

function deriveCoverage(candidate: EvaluationCandidate): Partial<Record<DiagnosticCoverageKey, boolean>> {
  if (candidate.coverage) return candidate.coverage;
  const { reply } = candidate;
  return {
    symptom: reply.understanding.trim().length > 0,
    causes: reply.causes.length > 0,
    checks:
      reply.suggestions.some((item) => item.kind === 'observe' || item.kind === 'record') ||
      reply.questions.length > 0,
    // Local replies deliberately do not give repair steps; repair is only
    // true when the caller explicitly supplies coverage saying so.
    repair: false,
  };
}

function clarityScore(candidate: EvaluationCandidate): number {
  const { reply, coordination } = candidate;
  const route = coordination.route;
  const expectedSections: string[] =
    route === 'clarify'
      ? ['understanding', 'sourceNote', 'questions']
      : route === 'safe'
        ? ['understanding', 'suggestions', 'sourceNote', 'questions']
        : ['understanding', 'causesGroup', 'suggestions', 'sourceNote', 'questions'];
  const present = new Set<string>();
  if (reply.understanding.trim()) present.add('understanding');
  if (reply.causes.length > 0 || (reply.background?.length ?? 0) > 0 || Boolean(reply.aiSupplement?.trim())) {
    present.add('causesGroup');
  }
  if (reply.suggestions.length > 0) present.add('suggestions');
  if (reply.sourceNote.trim()) present.add('sourceNote');
  if (reply.questions.length > 0) present.add('questions');
  const structure = expectedSections.filter((section) => present.has(section)).length / expectedSections.length;
  const questionsOk = reply.questions.length <= 2 ? 1 : 0;
  const sourceOk = reply.sourceNote.trim().length > 0 ? 1 : 0;
  return clamp01(0.5 * structure + 0.25 * questionsOk + 0.25 * sourceOk);
}

function actionabilityScore(candidate: EvaluationCandidate): number {
  const { reply } = candidate;
  if (reply.suggestions.length === 0) return reply.questions.length > 0 ? 0.5 : 0;
  const reported = (candidate.alreadyReportedTexts ?? []).map(normalizeText).filter(Boolean);
  const seen = new Set<string>();
  let actionable = 0;
  for (const suggestion of reply.suggestions) {
    const key = normalizeText(suggestion.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (reported.some((item) => item.includes(key) || key.includes(item))) continue;
    if (['observe', 'record', 'professional'].includes(suggestion.kind)) actionable += 1;
  }
  return clamp01(actionable / reply.suggestions.length);
}

/**
 * Score one candidate against its gold expectations. Pure and
 * deterministic: the same inputs always produce the same result.
 */
export function evaluateCandidate(
  candidate: EvaluationCandidate,
  gold: EvaluationGold = {},
): EvaluationResult {
  const vetoReasons: string[] = [];
  const { reply, coordination, content } = candidate;
  const claims = candidate.claims;
  const manualIds = manualEvidenceIds(claims);

  // Veto 1: a dangerous action suggestion that is not a prohibition.
  if (assessSuggestedAction(content).restricted) vetoReasons.push('unsafe_action');
  for (const claim of claims) {
    if (clauseIsRestricted(claim.text)) {
      if (!vetoReasons.includes('unsafe_action')) vetoReasons.push('unsafe_action');
      break;
    }
  }

  // Veto 2: a numeric parameter claim without manual evidence in its clause.
  for (const clause of content.split(/[。；;!?！？\n]/)) {
    if (parameterClauseIsUnsupported(clause, manualIds)) {
      vetoReasons.push('unsupported_parameter');
      break;
    }
  }
  for (const claim of claims) {
    if (claim.kind === 'parameter' && claim.evidenceIds.length === 0) {
      if (!vetoReasons.includes('unsupported_parameter')) vetoReasons.push('unsupported_parameter');
      break;
    }
  }

  // Veto 3: a machine or evidence conflict that was answered, not clarified.
  if (
    (coordination.reason === 'identity_conflict' || coordination.reason === 'knowledge_conflict') &&
    coordination.route !== 'clarify'
  ) {
    vetoReasons.push('unresolved_conflict');
  }

  // Veto 4: general / user-reported / inferred material presented as manual.
  for (const claim of claims) {
    const wordingClaimsManual = MANUAL_CLAIM_WORDING.test(claim.text);
    if (
      (claim.assertsManual === true || wordingClaimsManual) &&
      (claim.sourceKind !== 'manual' || claim.evidenceIds.length === 0)
    ) {
      vetoReasons.push('mislabelled_source');
      break;
    }
  }

  // Veto 5: a prohibited action phrase in a non-negated clause.
  for (const prohibited of gold.prohibitedTexts ?? []) {
    const hit = content
      .split(/[。；;!?！？\n]/)
      .some((clause) => clause.includes(prohibited) && clauseIsRestricted(clause));
    if (hit) {
      vetoReasons.push('prohibited_action');
      break;
    }
  }

  // Veto 6: length caps from the live answer contract.
  if (content.length > MAX_ANSWER_CHARS) vetoReasons.push('answer_too_long');
  if ((candidate.localSummary?.length ?? 0) > MAX_LOCAL_SUMMARY_CHARS) {
    vetoReasons.push('local_summary_too_long');
  }

  const factual = factualClaims(claims);
  const supported = factual.filter(
    (claim) => claim.sourceKind === 'manual' && claim.evidenceIds.length > 0,
  ).length;
  const evidence_score =
    factual.length === 0
      ? coordination.route === 'clarify' || coordination.route === 'safe'
        ? 1
        : 0
      : supported / factual.length;

  const required = gold.requiredCoverage ?? coordination.requiredCoverage ?? [];
  const coverage = deriveCoverage(candidate);
  const coverage_score =
    required.length === 0
      ? 1
      : required.filter((key) => coverage[key] === true).length / required.length;

  const relevanceMap: Record<RelevanceLevel, number> = {
    high: 1,
    medium: 0.6,
    low: 0,
    unknown: 0,
  };
  const relevance_score = relevanceMap[deriveRelevanceLevel(candidate)];

  const breakdown: ScoreBreakdown = {
    evidence_score: clamp01(evidence_score),
    coverage_score: clamp01(coverage_score),
    relevance_score: clamp01(relevance_score),
    actionability_score: clamp01(actionabilityScore(candidate)),
    clarity_score: clamp01(clarityScore(candidate)),
  };
  const scoreBeforeVeto = clamp01(
    EVALUATION_WEIGHTS.evidence_score * breakdown.evidence_score +
      EVALUATION_WEIGHTS.coverage_score * breakdown.coverage_score +
      EVALUATION_WEIGHTS.relevance_score * breakdown.relevance_score +
      EVALUATION_WEIGHTS.actionability_score * breakdown.actionability_score +
      EVALUATION_WEIGHTS.clarity_score * breakdown.clarity_score,
  );
  const veto = vetoReasons.length > 0;
  return {
    veto,
    vetoReasons,
    score: veto ? 0 : scoreBeforeVeto,
    scoreBeforeVeto,
    breakdown,
  };
}

/**
 * Planner next-question value, for ranking only. discriminationValue is
 * an integer rank from the existing Planner policy, not a calibrated
 * fault probability, so this value is never interpreted as a probability
 * and never enters the answer score.
 */
export function questionValue(discriminationValue: number, cost: number): number {
  if (!Number.isFinite(discriminationValue) || !Number.isFinite(cost)) return 0;
  const safeDiscrimination = Math.max(0, discriminationValue);
  const safeCost = Math.max(0, cost);
  return safeDiscrimination / (1 + safeCost);
}

export interface ComparisonEntry {
  id: string;
  label: string;
  isCurrent: boolean;
  isLocal: boolean;
  candidate: EvaluationCandidate;
}

export interface ComparisonResult {
  winnerId: string;
  winnerLabel: string;
  winnerEvaluation: EvaluationResult;
  currentEvaluation: EvaluationResult;
  margin: number;
}

/**
 * Compare candidates for one case. Returns null when the current answer
 * must be kept: no non-vetoed challenger, or no challenger that clears
 * score >= 0.75, evidence >= 0.60 and margin >= 0.10 over the current
 * answer. Ties are broken by local-first, then shorter content, then
 * higher evidence score, then stable id order. A vetoed current answer
 * scores 0, so a qualifying challenger can replace it.
 */
export function compareCandidates(
  entries: readonly ComparisonEntry[],
  gold: EvaluationGold = {},
): ComparisonResult | null {
  if (entries.length === 0) return null;
  const evaluated = entries.map((entry) => ({
    entry,
    evaluation: evaluateCandidate(entry.candidate, gold),
  }));
  const current =
    evaluated.find((item) => item.entry.isCurrent) ??
    evaluated.find((item) => item.entry.isLocal) ??
    evaluated[0];
  const challengers = evaluated
    .filter((item) => item.entry !== current.entry && !item.evaluation.veto)
    .sort((a, b) => {
      if (b.evaluation.score !== a.evaluation.score) return b.evaluation.score - a.evaluation.score;
      if (a.entry.isLocal !== b.entry.isLocal) return a.entry.isLocal ? -1 : 1;
      if (a.entry.candidate.content.length !== b.entry.candidate.content.length) {
        return a.entry.candidate.content.length - b.entry.candidate.content.length;
      }
      if (b.evaluation.breakdown.evidence_score !== a.evaluation.breakdown.evidence_score) {
        return b.evaluation.breakdown.evidence_score - a.evaluation.breakdown.evidence_score;
      }
      return a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0;
    });
  const best = challengers[0];
  if (!best) return null;
  const margin = best.evaluation.score - current.evaluation.score;
  if (
    best.evaluation.score < PROMOTION_MIN_SCORE ||
    best.evaluation.breakdown.evidence_score < PROMOTION_MIN_EVIDENCE ||
    margin < PROMOTION_MIN_MARGIN
  ) {
    return null;
  }
  return {
    winnerId: best.entry.id,
    winnerLabel: best.entry.label,
    winnerEvaluation: best.evaluation,
    currentEvaluation: current.evaluation,
    margin,
  };
}

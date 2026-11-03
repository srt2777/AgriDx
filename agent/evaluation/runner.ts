/**
 * Offline runner for the golden set.
 *
 * This runner calls only the existing, deterministic router
 * (`DiagnosisRouter.decide`) and reply builder (`buildDiagnosticReply`)
 * with synthetic chunks supplied by each golden case. It does not call
 * the diagnosis service, does not touch /api/chat or server/app.ts,
 * does not call any LLM, does not read any key or environment file, and
 * does not write to any memory store. The router is run with the
 * default router config, not with server environment variables, so an
 * offline run is identical regardless of the machine it runs on.
 *
 * For a case with a canned `aiSupplement`, the AI candidate is the
 * local reply with that canned text attached. The text is labelled
 * "synthetic-ai-supplement" in every output; it is not a real model
 * output and must never be quoted as one.
 */

import { buildDiagnosticReply, renderDiagnosticReply } from '../../server/diagnosis/reply';
import { DEFAULT_ROUTER_CONFIG, DiagnosisRouter } from '../../server/diagnosis/router';
import type { DiagnosticReply } from '../../shared/diagnosis';
import {
  compareCandidates,
  evaluateCandidate,
  type EvaluationCandidate,
  type EvaluationClaim,
  type EvaluationResult,
} from './evaluation';
import { GOLDEN_CASES, type GoldenCase } from './golden-set';

export interface CaseResult {
  id: string;
  title: string;
  category: string;
  query: string;
  route: string;
  reason: string;
  expectedRoute?: string;
  expectedReason?: string;
  routeMatchesExpectation: boolean;
  local: EvaluationResult;
  ai: EvaluationResult | null;
  aiProviderLabel: string | null;
  winnerId: string | null;
  winnerMargin: number | null;
  questionCheck: {
    expectedPresent: boolean;
    forbiddenAbsent: boolean;
    pass: boolean;
    questions: string[];
  } | null;
}

export interface RouteAggregate {
  cases: number;
  localNonVeto: number;
  localMeanScore: number;
  localMeanEvidence: number;
  aiCases: number;
  aiVeto: number;
  aiWins: number;
  questionPass: number;
  questionChecked: number;
}

export interface OfflineAggregate {
  totalCases: number;
  localVeto: number;
  aiCandidateCases: number;
  aiVeto: number;
  aiWins: number;
  byRoute: Record<string, RouteAggregate>;
  tool: {
    calls: number;
    successRate: null;
    note: string;
  };
}

export interface OfflineReport {
  cases: CaseResult[];
  aggregate: OfflineAggregate;
}

function claimsFromReply(reply: DiagnosticReply, aiSupplement?: string): EvaluationClaim[] {
  const claims: EvaluationClaim[] = [];
  for (const cause of reply.causes) {
    claims.push({
      text: cause.text,
      kind: 'cause',
      evidenceIds: cause.evidenceIds,
      sourceKind: 'manual',
      assertsManual: true,
    });
  }
  for (const item of reply.background ?? []) {
    claims.push({
      text: item.text,
      kind: 'background',
      evidenceIds: item.evidenceIds,
      sourceKind: 'general',
      assertsManual: false,
    });
  }
  for (const suggestion of reply.suggestions) {
    claims.push({
      text: suggestion.text,
      kind: 'suggestion',
      evidenceIds: suggestion.evidenceIds,
      sourceKind: suggestion.evidenceIds.length > 0 ? 'manual' : 'inference',
      assertsManual: false,
    });
  }
  if (aiSupplement) {
    for (const paragraph of aiSupplement.split(/[。\n]+/)) {
      const text = paragraph.trim();
      if (text.length < 2) continue;
      claims.push({
        text,
        kind: 'ai',
        evidenceIds: [],
        sourceKind: 'inference',
        assertsManual:
          /手册|说明书/.test(text) && /(指出|表明|记载|要求|规定)/.test(text),
      });
    }
  }
  return claims;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function questionCheckFor(golden: GoldenCase, reply: DiagnosticReply) {
  const expected = golden.gold.expectedQuestionKeywords ?? [];
  const forbidden = golden.gold.forbiddenQuestionKeywords ?? [];
  if (expected.length === 0 && forbidden.length === 0) return null;
  const questions = reply.questions.map((item) => item.text);
  const joined = questions.join('\n');
  const expectedPresent = expected.every((keyword) => joined.includes(keyword));
  const forbiddenAbsent = forbidden.every((keyword) => !joined.includes(keyword));
  return {
    expectedPresent,
    forbiddenAbsent,
    pass: expectedPresent && forbiddenAbsent,
    questions,
  };
}

export function runOfflineEvaluation(cases: readonly GoldenCase[] = GOLDEN_CASES): OfflineReport {
  const results: CaseResult[] = [];
  for (const golden of cases) {
    const coordination = DiagnosisRouter.decide(
      {
        query: golden.query,
        currentQuery: golden.query,
        scope: golden.scope,
        retrieved: golden.chunks,
        clarificationNeeded: golden.clarificationNeeded ?? false,
        requestedMode: golden.requestedMode ?? 'auto',
        llmConfigured: golden.llmConfigured ?? false,
        manualAvailable: golden.manualAvailable,
      },
      DEFAULT_ROUTER_CONFIG,
    );
    const reply = buildDiagnosticReply({
      query: golden.query,
      currentQuery: golden.query,
      symptomQuery: golden.query,
      chunks: golden.chunks,
      scope: golden.scope,
      coordination,
      progress: golden.progress ?? '',
      priorReports: [],
    });
    const content = renderDiagnosticReply(reply);
    const localCandidate: EvaluationCandidate = {
      reply,
      coordination,
      content,
      localSummary: content,
      provider: 'knowledge-base',
      fellBack: false,
      removedIssues: [],
      claims: claimsFromReply(reply),
      alreadyReportedTexts: golden.progress ? [golden.progress] : [],
    };
    const local = evaluateCandidate(localCandidate, golden.gold);

    let ai: EvaluationResult | null = null;
    let aiProviderLabel: string | null = null;
    let aiCandidate: EvaluationCandidate | null = null;
    if (golden.aiSupplement) {
      const aiReply: DiagnosticReply = { ...reply, aiSupplement: golden.aiSupplement };
      aiCandidate = {
        reply: aiReply,
        coordination,
        content: renderDiagnosticReply(aiReply),
        provider: 'synthetic-ai-supplement',
        fellBack: false,
        removedIssues: [],
        claims: claimsFromReply(reply, golden.aiSupplement),
        alreadyReportedTexts: golden.progress ? [golden.progress] : [],
      };
      ai = evaluateCandidate(aiCandidate, golden.gold);
      aiProviderLabel = 'synthetic-ai-supplement';
    }

    const entries = [
      { id: 'local', label: 'local', isCurrent: true, isLocal: true, candidate: localCandidate },
      ...(aiCandidate
        ? [{ id: 'ai', label: 'ai-supplement', isCurrent: false, isLocal: false, candidate: aiCandidate }]
        : []),
    ];
    const comparison = compareCandidates(entries, golden.gold);
    results.push({
      id: golden.id,
      title: golden.title,
      category: golden.category,
      query: golden.query,
      route: coordination.route,
      reason: coordination.reason,
      expectedRoute: golden.expectedRoute,
      expectedReason: golden.expectedReason,
      routeMatchesExpectation:
        (golden.expectedRoute === undefined || golden.expectedRoute === coordination.route) &&
        (golden.expectedReason === undefined || golden.expectedReason === coordination.reason),
      local,
      ai,
      aiProviderLabel,
      winnerId: comparison?.winnerId ?? null,
      winnerMargin: comparison?.margin ?? null,
      questionCheck: questionCheckFor(golden, reply),
    });
  }

  const byRoute: Record<string, RouteAggregate> = {};
  for (const result of results) {
    const aggregate = (byRoute[result.route] ??= {
      cases: 0,
      localNonVeto: 0,
      localMeanScore: 0,
      localMeanEvidence: 0,
      aiCases: 0,
      aiVeto: 0,
      aiWins: 0,
      questionPass: 0,
      questionChecked: 0,
    });
    aggregate.cases += 1;
    if (!result.local.veto) aggregate.localNonVeto += 1;
    if (result.ai !== null) {
      aggregate.aiCases += 1;
      if (result.ai.veto) aggregate.aiVeto += 1;
    }
    if (result.winnerId === 'ai') aggregate.aiWins += 1;
    if (result.questionCheck) {
      aggregate.questionChecked += 1;
      if (result.questionCheck.pass) aggregate.questionPass += 1;
    }
  }
  for (const route of Object.keys(byRoute)) {
    const group = results.filter((result) => result.route === route);
    byRoute[route].localMeanScore = mean(group.map((result) => result.local.score));
    byRoute[route].localMeanEvidence = mean(
      group.map((result) => result.local.breakdown.evidence_score),
    );
  }

  return {
    cases: results,
    aggregate: {
      totalCases: results.length,
      localVeto: results.filter((result) => result.local.veto).length,
      aiCandidateCases: results.filter((result) => result.ai !== null).length,
      aiVeto: results.filter((result) => result.ai?.veto).length,
      aiWins: results.filter((result) => result.winnerId === 'ai').length,
      byRoute,
      tool: {
        calls: 0,
        successRate: null,
        note: 'Offline runner makes no tool calls; tool success rate is not applicable here, not zero.',
      },
    },
  };
}

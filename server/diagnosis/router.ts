import type { CoordinationDecision, DiagnosisCandidateAssessment, DiagnosticCoverageKey, DiagnosticRiskLevel, DiagnosisMode, RouteReason } from '../../shared/diagnosis';
import type { KnowledgeChunk } from '../knowledge/retriever';
import { archiveApplicability, queryWithoutIdentity, resolveScope, type RetrievalContext, type ResolvedScope } from '../knowledge/scope';
import { hasIndexedReference, mentionsEntryId, referenceVerification, requiredDiagnosticCoverage } from '../knowledge/evidence';
export { requiredDiagnosticCoverage } from '../knowledge/evidence';

export interface DiagnosisRouterConfig {
  defaultMode: DiagnosisMode;
  configValid: boolean;
  allowExternalAi: boolean;
  /** Raw keyword-weighted overlap, never a probability or diagnostic confidence. */
  highRelevanceThreshold: number;
  mediumRelevanceThreshold: number;
}
export const DEFAULT_ROUTER_CONFIG: Readonly<DiagnosisRouterConfig> = Object.freeze({
  defaultMode: 'auto', configValid: true, allowExternalAi: true,
  highRelevanceThreshold: 8, mediumRelevanceThreshold: 3,
});
export interface DiagnosisRouterInput {
  query: string;
  currentQuery: string;
  scope: RetrievalContext & { engineModel?: string; faultCodes?: string[] };
  retrieved: KnowledgeChunk[];
  clarificationNeeded: boolean;
  requestedMode?: DiagnosisMode;
  llmConfigured: boolean;
  llmConfigValid?: boolean;
  /** Explicit conflicts discovered by the caller; no model is used to invent one. */
  evidenceConflict?: boolean;
  /** Independently checked against the active source snapshot; undefined for injected/unknown stores. */
  manualAvailable?: boolean;
}
const TECHNICAL = new Set(['维护/故障知识', '操作/维护知识', '安全操作', '系统安装/调试']);
const UNCERTAIN_SCOPE = /待核实|待核验|待确认|未确认|未核实|未核验|未知|不明确/;
const HIGH_RISK = /制动|刹车|刹不住|刹不灵|转向|方向盘|方向重|方向失灵|动力输出|\bpto\b|传动轴|万向节|高压(?:液压|油|管|燃油|共轨|电)|液压油喷射|油液喷射|油管(?:喷油|破裂|爆裂)|\bhydraulic\b[^.?!\n]{0,24}(?:pressure|hose|line|spray|inject|leak)|热(?:车|机|水箱)[^。！？\n]{0,12}(?:开|拧|拆)[^。！？\n]{0,8}(?:盖|散热器)|发动机飞车|飞车|失控|自行加速|发动机超速|超速运转|\b(?:brakes?|braking|steering|runaway|overspeed)\b|high[ -]pressure[^。！？\n]{0,16}(?:hydraulics?|fuel|oil|line)|液压[^。！？\n]{0,16}(?:拆|松|卸|接头|压力)|共轨|喷油器[^。！？\n]{0,12}(?:拆|卸|松)|(?:带压|运转中|未熄火|不停机)[^。！？\n]{0,16}(?:拆|松|卸|检修|维修|检查)|短接|绕过[^。！？\n]{0,12}(?:安全|联锁)|解除[^。！？\n]{0,12}(?:安全|联锁)/i;
const OPERATION_REQUEST = /(?:how\s+to\s+|steps?\s+to\s+)(?:repair|disassemble|replace|adjust)|怎么(?:修|拆|换|调|操作|处理)|如何(?:修|拆|换|调|操作|处理)|怎么办|维修(?:步骤|建议|方法)|修理步骤|拆装|拆卸|修复|操作步骤/i;
const PARAMETER_REQUEST = /故障码.*(?:含义|意思|解释)|(?:含义|解释).*故障码|(?:压力|扭矩|间隙|电压|温度).*(?:标准|多少|参数)|(?:标准|规定).*(?:压力|扭矩|间隙|电压|温度)/;
const SYNTHESIS_REQUEST = /综合|比较|对比|多种故障|多个故障|一起分析/;

function exactLookup(question: string, found: KnowledgeChunk[], scope: RetrievalContext, resolved: ResolvedScope): KnowledgeChunk | undefined {
  if (!/查阅|查找|查看|原文|摘录|手册|资料|说明书/.test(question) || /为什么|原因|分析|比较|综合|诊断|怎么办/.test(question) || !scope.brand || !scope.model || resolved.identityConflict) return;
  const normalize = (s: string) => queryWithoutIdentity(s).toLowerCase().replace(/[\s\p{P}]/gu, '');
  const normalizedQuestion = normalize(question);
  const direct = found.filter(c => !c.retrieval?.referenceOnly && !['component', 'general'].includes(c.retrieval?.tier ?? '') &&
    hasIndexedReference(c) && TECHNICAL.has(c.entryType ?? '') && c.applicability === 'matched' &&
    [c.locator, c.version, c.scopeBoundary].every(v => v?.trim()) && referenceVerification(c.status) === 'verified' && !UNCERTAIN_SCOPE.test(c.scopeBoundary ?? '') &&
    (mentionsEntryId(question, c.entryId!) || (() => {
      const heading = c.heading.split('｜').at(-1) ?? c.heading;
      const normalizedHeading = normalize(heading);
      return normalizedHeading.length >= 4 && normalizedQuestion.includes(normalizedHeading);
    })()));
  return direct.length === 1 && direct[0] === found[0] ? direct[0] : undefined;
}

function candidateMatch(chunk: KnowledgeChunk, input: DiagnosisRouterInput, resolved: ResolvedScope): DiagnosisCandidateAssessment['modelMatch'] {
  if (resolved.identityConflict) return 'conflict';
  // Retrieval normally excludes conflicts. Recheck supplied results so callers
  // cannot turn explicitly incompatible documents into trusted AI context.
  if (chunk.brand && chunk.model && !archiveApplicability(chunk, resolved)) return 'conflict';
  // No engine or fault-code alias registry exists. Preserve significant
  // punctuation instead of inventing E-001 = E001 or 12/34 = 1234 aliases.
  const engineIdentity = (value: string) => value.trim().toUpperCase().replace(/\s+/g, ' ');
  const codeIdentity = (value: string) => value.trim().toUpperCase().replace(/\s+/g, '');
  if (input.scope.engineModel && chunk.engineModel && engineIdentity(input.scope.engineModel) !== engineIdentity(chunk.engineModel)) return 'conflict';
  if (input.scope.faultCodes?.length && chunk.faultCodes?.length && !input.scope.faultCodes.every(code => chunk.faultCodes!.some(known => codeIdentity(known) === codeIdentity(code)))) return 'conflict';
  if (chunk.configuration && !resolved.configurations.includes(chunk.configuration)) return 'unknown';
  if (chunk.driveConfiguration && !resolved.driveConfigurations.includes(chunk.driveConfiguration)) return 'unknown';
  if (input.scope.engineModel && !chunk.engineModel) return 'unknown';
  if ((input.scope.faultCodes?.length || /故障码.*(?:含义|意思|解释)/.test(input.currentQuery)) && !chunk.faultCodes?.length) return 'unknown';
  if (UNCERTAIN_SCOPE.test(chunk.scopeBoundary ?? '')) return 'unknown';
  if (chunk.retrieval?.referenceOnly || chunk.retrieval?.tier === 'component' || chunk.retrieval?.tier === 'general') return 'compatible';
  if (chunk.applicability === 'matched') return 'exact';
  // General documents without an identity may be useful context, but their
  // lack of indexed provenance prevents a deterministic direct repair answer.
  if (!chunk.entryId && !chunk.brand && !chunk.model && resolved.genericKnowledge) return 'compatible';
  return 'unknown';
}

/** One in-memory pass over already-retrieved documents. No retrieval, IO, env reads or AI calls. */
export function decideDiagnosisRoute(input: DiagnosisRouterInput, config: Readonly<DiagnosisRouterConfig> = DEFAULT_ROUTER_CONFIG): CoordinationDecision {
  const requestedMode = input.requestedMode ?? config.defaultMode;
  const effectiveMode = config.allowExternalAi ? requestedMode : 'knowledge_only';
  const resolved = resolveScope(input.query, input.scope);
  const requiredCoverage = requiredDiagnosticCoverage(input.currentQuery);
  const validThresholds = Number.isFinite(config.highRelevanceThreshold) && Number.isFinite(config.mediumRelevanceThreshold) && config.mediumRelevanceThreshold > 0 && config.highRelevanceThreshold >= config.mediumRelevanceThreshold;
  const isAssisted = effectiveMode === 'ai_assisted';
  const exact = isAssisted ? undefined : exactLookup(input.currentQuery, input.retrieved, input.scope, resolved);
  const indexedDocuments = new Map<string, string>();
  const conflictingEntryIds = new Set<string>();
  const candidates: DiagnosisCandidateAssessment[] = input.retrieved.map(chunk => {
    const hasValidScore = chunk.relevance?.method === 'keyword-weighted-overlap' && chunk.relevance.calibrated === false && Number.isFinite(chunk.relevance.score) && chunk.relevance.score >= 0;
    const score = hasValidScore ? chunk.relevance!.score : null;
    const invalidScore = chunk.relevance !== undefined && !hasValidScore;
    const modelMatch = candidateMatch(chunk, input, resolved);
    const verification = referenceVerification(chunk.status);
    const sourceIndexed = hasIndexedReference(chunk);
    if (sourceIndexed) {
      const signature = JSON.stringify([chunk.sourceId, chunk.version, chunk.locator, chunk.text]);
      const previous = indexedDocuments.get(chunk.entryId!);
      if (previous !== undefined && previous !== signature) conflictingEntryIds.add(chunk.entryId!);
      else indexedDocuments.set(chunk.entryId!, signature);
    }
    const coverage: Partial<Record<DiagnosticCoverageKey, boolean>> = chunk.diagnosticMetadata?.coverage ?? {};
    const coverageSufficient = requiredCoverage.every(key => coverage[key] === true);
    const level = score === null ? 'unknown' : score >= config.highRelevanceThreshold ? 'high' : score >= config.mediumRelevanceThreshold ? 'medium' : 'low';
    const learningReference = chunk.entryType === '通识学习' && chunk.diagnosticEvidence === false;
    const structuralReference = chunk.retrieval?.referenceOnly && ['component', 'general'].includes(chunk.retrieval.tier);
    const excluded = invalidScore || verification === 'failed' || modelMatch === 'conflict' || level === 'low' && !structuralReference || Boolean(chunk.entryId && !sourceIndexed && !learningReference);
    const directEligible = !isAssisted && !excluded && !chunk.retrieval?.referenceOnly &&
      !['component', 'general'].includes(chunk.retrieval?.tier ?? '') && sourceIndexed && TECHNICAL.has(chunk.entryType ?? '') && modelMatch === 'exact' && verification === 'verified' &&
      [chunk.locator, chunk.version, chunk.scopeBoundary].every(v => v?.trim()) && (chunk === exact || level === 'high' && coverageSufficient && chunk.diagnosticMetadata?.riskLevel === 'low');
    return { entryId: chunk.entryId, sourceId: chunk.sourceId, relevance: { score, method: score === null ? 'unavailable' : 'keyword-weighted-overlap', calibrated: false, level },
      coverage, coverageSufficient, modelMatch, referenceVerification: verification, verificationBasis: verification === 'verified' ? 'document-review' : 'none',
      sourceIndexed, riskLevel: chunk.diagnosticMetadata?.riskLevel ?? 'unknown', directEligible, excluded,
      ...(chunk.retrieval ? { retrieval: { ...chunk.retrieval, basis: [...chunk.retrieval.basis] } } : {}) };
  });
  for (const candidate of candidates) {
    if (candidate.entryId && conflictingEntryIds.has(candidate.entryId)) {
      candidate.excluded = true;
      candidate.directEligible = false;
    }
  }
  const evidenceConflict = input.evidenceConflict || conflictingEntryIds.size > 0;
  const usable = candidates.filter(candidate => !candidate.excluded);
  const direct = candidates.filter(candidate => candidate.directEligible);
  // Unindexed information-collection templates may list risky systems merely
  // as follow-up examples. Such boilerplate is not evidence of this query's risk.
  const indexedHighRisk = candidates.some((candidate, index) => !candidate.excluded && candidate.sourceIndexed &&
    TECHNICAL.has(input.retrieved[index].entryType ?? '') && candidate.riskLevel === 'high');
  const riskLevel: DiagnosticRiskLevel = HIGH_RISK.test(`${input.query}\n${input.currentQuery}`) || indexedHighRisk ? 'high'
    : usable.length && usable.every(candidate => candidate.riskLevel === 'low') ? 'low' : 'unknown';
  const reliable = usable.some(candidate => candidate.sourceIndexed && candidate.referenceVerification === 'verified' && candidate.modelMatch === 'exact' && candidate.relevance.level === 'high');
  // 2026-10-22: for an open question (no brand/model) 通识 entries count as partial, never direct, evidence.
  const hasDiagnosticEvidence = candidates.some((candidate, index) => !candidate.excluded && (candidate.sourceIndexed && TECHNICAL.has(input.retrieved[index].entryType ?? '')
    || input.retrieved[index].generalEvidence === true && input.retrieved[index].entryType === '通识学习' && resolved.openArchive));
  const evidenceLevel: CoordinationDecision['evidenceLevel'] = !hasDiagnosticEvidence ? 'none'
    : !isAssisted && direct.length === 1 && !SYNTHESIS_REQUEST.test(input.currentQuery) && !evidenceConflict ? 'direct_reference' : 'partial';
  const ids = (selected: DiagnosisCandidateAssessment[]) => [...new Set(selected.flatMap(candidate => candidate.entryId ? [candidate.entryId] : []))];
  const sufficient = !evidenceConflict && usable.some(candidate => candidate.sourceIndexed && candidate.referenceVerification === 'verified' &&
    candidate.modelMatch === 'exact' && candidate.relevance.level === 'high' && candidate.coverageSufficient &&
    !candidate.retrieval?.referenceOnly && !['component', 'general'].includes(candidate.retrieval?.tier ?? ''));
  const retrievalOutcome = sufficient ? 'sufficient' as const : input.manualAvailable === false ? 'no_manual' as const
    : usable.length ? 'insufficient_evidence' as const : 'no_results' as const;
  const result = (route: CoordinationDecision['route'], reason: RouteReason): CoordinationDecision => ({
    requestedMode, effectiveMode, route, reason, evidenceLevel, llmConfigured: input.llmConfigured,
    knowledgeIds: ids(usable), aiRequired: route === 'ai', riskLevel, requiredCoverage, candidates,
    directEligibleIds: ids(direct), referenceOnlyIds: ids(usable.filter(candidate => !candidate.directEligible)), excludedKnowledgeIds: ids(candidates.filter(candidate => candidate.excluded)),
    retrievalOutcome,
  });
  // A reviewed manual still does not authorize dangerous disassembly. High-risk
  // paths deliberately remain limited safety replies in every public mode.
  if (riskLevel === 'high') return result('safe', reliable ? 'high_risk_restricted' : 'high_risk_insufficient_evidence');
  if (riskLevel === 'unknown' && OPERATION_REQUEST.test(`${input.query}\n${input.currentQuery}`)) return result('safe', 'unknown_operation_risk');
  if (input.clarificationNeeded || resolved.identityConflict || resolved.ambiguous) return result('clarify', 'identity_conflict');
  if (evidenceConflict) return result('clarify', 'knowledge_conflict');
  if ((!resolved.brand || !resolved.models.length) && PARAMETER_REQUEST.test(input.currentQuery)) return result('clarify', 'identity_required');
  if (!config.configValid || !validThresholds) return result('local', 'invalid_config');
  if (!config.allowExternalAi) return result('local', 'server_local_only');
  if (effectiveMode === 'knowledge_only') return result('local', 'local_requested');
  if (effectiveMode === 'auto' && evidenceLevel === 'direct_reference') return result('local', 'direct_reference');
  if (input.llmConfigValid === false) return result('local', 'llm_config_invalid');
  if (!input.llmConfigured) return result('local', 'llm_not_configured');
  return result('ai', isAssisted ? 'ai_requested' : evidenceLevel === 'none' ? 'insufficient_evidence' : 'synthesis_requested');
}

/** Named public entry point; the function remains stateless and deterministic. */
export class DiagnosisRouter {
  static decide(input: DiagnosisRouterInput, config: Readonly<DiagnosisRouterConfig> = DEFAULT_ROUTER_CONFIG): CoordinationDecision {
    return decideDiagnosisRoute(input, config);
  }
  decide(input: DiagnosisRouterInput, config: Readonly<DiagnosisRouterConfig> = DEFAULT_ROUTER_CONFIG): CoordinationDecision {
    return decideDiagnosisRoute(input, config);
  }
}

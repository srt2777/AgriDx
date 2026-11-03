import type { KnowledgeChunk } from './retriever';
import type { RetrievalContext } from './scope';
import { DiagnosisRouter, DEFAULT_ROUTER_CONFIG, type DiagnosisRouterInput } from '../diagnosis/router';
import { isDiagnosisMode, type DiagnosisMode, type CoordinationDecision, type RouteReason } from '../../shared/diagnosis';
export { DIAGNOSIS_MODES, isDiagnosisMode, type DiagnosisMode, type CoordinationDecision, type RouteReason } from '../../shared/diagnosis';

/** Environment parsing is kept outside the pure router. Invalid values fail closed. */
export function coordinationConfig() {
  const env = typeof process === 'undefined' ? {} : process.env;
  const value = env.DIAGNOSIS_MODE?.trim() || 'auto';
  const external = env.ALLOW_EXTERNAL_AI?.trim() || 'true';
  const highRelevanceThreshold = Number(env.DIAGNOSIS_RAW_HIGH_THRESHOLD?.trim() || DEFAULT_ROUTER_CONFIG.highRelevanceThreshold);
  const mediumRelevanceThreshold = Number(env.DIAGNOSIS_RAW_MEDIUM_THRESHOLD?.trim() || DEFAULT_ROUTER_CONFIG.mediumRelevanceThreshold);
  const valid = isDiagnosisMode(value) && ['true', 'false'].includes(external) &&
    Number.isFinite(highRelevanceThreshold) && Number.isFinite(mediumRelevanceThreshold) && mediumRelevanceThreshold > 0 && highRelevanceThreshold >= mediumRelevanceThreshold;
  return { defaultMode: valid && isDiagnosisMode(value) ? value : 'knowledge_only' as DiagnosisMode, configValid: valid,
    allowExternalAi: valid && external === 'true' && value !== 'knowledge_only', highRelevanceThreshold, mediumRelevanceThreshold };
}

/** Backward-compatible evidence entry point, now backed by the same deterministic evaluator. */
export function assessEvidence(query: string, currentQuery: string, found: KnowledgeChunk[], scope: RetrievalContext): CoordinationDecision['evidenceLevel'] {
  return DiagnosisRouter.decide({ query, currentQuery, retrieved: found, scope, clarificationNeeded: false, llmConfigured: false }).evidenceLevel;
}

export function decideCoordination(input: DiagnosisRouterInput): CoordinationDecision {
  return DiagnosisRouter.decide(input, coordinationConfig());
}

export const ROUTE_MESSAGES: Record<RouteReason, string> = {
  planner_clarify: '诊断主题或观察归属待确认，本轮不调用外部 AI。',
  planner_escalated: '诊断已安全停止，建议由专业人员处理。',
  planner_exhausted: '诊断计划已达到执行预算，不再自动追问。',
  planner_cancelled: '诊断计划已取消，本轮不调用外部 AI。',
  planner_paused: '诊断计划已暂停，本轮不调用外部 AI。',
  planner_resolved: '用户报告问题已解决，未独立核验，本轮不调用外部 AI。',
  output_rejected: '外部生成未通过来源或安全检查，已退回本地依据与追问。',
  llm_config_invalid: '模型供应商配置无效，暂时返回本地资料，请管理员检查配置。',
  identity_conflict: '机型信息有冲突，先确认设备，本次不调用外部 AI。',
  identity_required: '解释专用故障码或参数需要品牌和完整型号，本次先追问。',
  server_local_only: '网站当前设置为仅使用本地知识库，不调用外部 AI。',
  invalid_config: '回答模式配置有误，已安全切换为仅本地资料。',
  local_requested: '按你的选择，仅使用本地知识库。',
  direct_reference: '找到相关且覆盖当前问题的匹配资料，直接展示资料排查建议及适用限制；资料审校不代表故障确诊或实车验证。',
  llm_not_configured: '本次需要进一步分析，但尚未配置外部 AI；先展示本地资料和追问。',
  insufficient_evidence: '未找到可直接支持诊断的资料，尝试外部 AI 提供待验证的通用分析。',
  synthesis_requested: '现有资料需要进一步综合或核对，尝试外部 AI 辅助分析。',
  ai_requested: '按你的选择，先检索资料，再使用外部 AI 辅助分析。',
  provider_unavailable: '外部 AI 本次调用失败，已退回本地资料。',
  high_risk_insufficient_evidence: '涉及高风险系统且可靠依据不足；本次仅返回停机与安全确认提示，不调用外部 AI。',
  high_risk_restricted: '涉及高风险系统；资料审校不等于操作许可，本次限制具体维修操作并建议专业人员核对。',
  unknown_operation_risk: '当前资料无法确认操作风险，本次先补充设备与现场安全信息，限制具体维修步骤。',
  knowledge_conflict: '资料或设备条件存在冲突，先核对适用范围，本次不调用外部 AI。',
};

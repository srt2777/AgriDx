import type { ChatMessage } from './session';

type Translate = (zh: string, en: string) => string;
const technicalHeading = /^(?:服务状态|协调决策|协调路由|检索过程|检索结果|检索到的知识|知识依据|来源与适用信息|来源追踪|本地资料|诊断依据与技术详情|调试信息|模型调用记录|通识依据(?:（[^）]*）)?|提示来源)$/;
const narrativeHeading = /^(?:故障现象分析|初步判断|继续确认|先确认两点|需要补充(?:的资料)?|咨询现象|农机知识参考|手册依据|通用分析(?:（待验证）)?|通识参考(?:（待验证）)?)$/;
const technicalLine = /^(?:知识库命中(?:数)?|命中数量|相似度(?:评分)?|检索分数|协调路由|路由决策|模型调用状态|模型名称|知识编号|来源编号|原文位置|资料版本|核验状态|检索层级|debug|traceId)\s*[:：]/i;

/** Display projection only: never change stored text, evidence, decisions or provider requests. */
export function cleanAnswerText(text: string): string {
  let hideSection = false;
  let inFence = false;
  const result: string[] = [];
  for (const line of text.split('\n')) {
    // Treat fenced payloads as opaque: don't interpret embedded headings as UI metadata.
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) { if (!hideSection) result.push(line); continue; }
    const markdownHeading = line.match(/^\s*#{1,6}\s+([^【]+?)\s*$/);
    if (markdownHeading) {
      hideSection = technicalHeading.test(markdownHeading[1]);
      if (!hideSection) result.push(line);
      continue;
    }
    const heading = line.match(/^\s*(?:#{1,6}\s*)?(?:\*\*)?【([^】]+)】(?:\*\*)?\s*[:：]?\s*(.*)$/);
    if (heading) {
      hideSection = technicalHeading.test(heading[1]);
      if (hideSection) {
        if (/不要|禁止|不得|切勿|严禁/.test(heading[2])) result.push(heading[2]);
        continue;
      }
      // Remove only template labels. Unknown labels may contain a code or a safety prohibition.
      if (!narrativeHeading.test(heading[1])) result.push(`**${heading[1]}**`);
      if (heading[2]) result.push(heading[2]);
      continue;
    }
    // Never swallow an explicit safety prohibition embedded in a legacy metadata section.
    if (hideSection && /不要|禁止|不得|切勿|严禁/.test(line)) { result.push(line); continue; }
    if (hideSection || technicalLine.test(line.trim())) continue;
    result.push(line);
  }
  return result.join('\n')
    // Only explicit archive identifiers are removed from display; original text lives in evidence.
    .replace(/[（(](?:KB-[A-Z0-9-]+|TK-\d+)(?:[、，,；;\s]*(?:KB-[A-Z0-9-]+|TK-\d+))*(?:[，,；;]\s*(?:待验证|无手册页码|尚需核对|尚待核对))?[）)]/g, '')
    .replace(/\n{3,}/g, '\n\n').trim();
}

function availabilityNote(message: ChatMessage, t: Translate): string {
  // Older saved replies may predate structured failure metadata. Read only their explicit status line.
  const legacyStatus = !message.diagnosticReply
    ? (message.localSummary || message.content).match(/【服务状态】(?:\*\*)?\s*([^\n]*)/)?.[1] ?? '' : '';
  const legacyUnavailable = /(?:大模型|外部\s*AI|LLM).*(?:连接失败|不可用|超时)/i.test(legacyStatus);
  const legacyDisabled = /(?:未启用大模型|(?:外部\s*AI|LLM).*(?:未配置|未启用))/i.test(legacyStatus);
  if (message.fallbackReason === 'provider_unavailable' || legacyUnavailable) return t('AI 暂时无法连接，以下仅提供本地资料和安全建议。', 'AI could not be reached; the following uses local information and safety advice only.');
  if (message.fallbackReason === 'not_configured' || legacyDisabled) return t('目前未启用外部 AI，以下仅提供本地资料和安全建议。', 'External AI is not enabled; the following uses local information and safety advice only.');
  if (message.coordination?.reason === 'invalid_config' || message.coordination?.reason === 'llm_config_invalid') return t('AI 暂时无法使用，以下仅提供本地资料和安全建议。', 'AI is currently unavailable; the following uses local information and safety advice only.');
  if (message.coordination?.reason === 'output_rejected') return t('AI 回答未通过安全核查，以下仅保留可用资料和安全建议。', 'The AI answer did not pass safety review; only usable information and safety advice remain.');
  return '';
}

export function formatChatAnswer(message: ChatMessage, t: Translate): string {
  // Request errors must remain visible verbatim, including actionable connection errors.
  if (message.role === 'error') return message.content;
  const reply = message.diagnosticReply;
  const parts: string[] = [];
  const note = availabilityNote(message, t);
  if (note) parts.push(note);
  if (!reply) {
    const text = cleanAnswerText(message.localSummary || message.content);
    parts.push(text || t('暂时没有可用的诊断回答。请补充现象，或稍后重试。', 'No diagnostic answer is available yet. Add the observed symptoms or try again later.'));
    return parts.join('\n\n');
  }
  if (reply.supportLevel !== 'manual') parts.push(reply.aiSupplement
    ? t('以下是通用分析，尚无匹配手册支持，不能据此确诊或确定本机参数。', 'This is general analysis without matching manual support, not a confirmed diagnosis or vehicle specification.')
    : reply.supportLevel === 'general'
    ? t('目前只有通用资料可供参考，不能据此确定本机故障或维修参数。', 'Only general information is available; it cannot establish the fault or repair specifications for this vehicle.')
    : t('目前资料不足以判断本机的具体原因，先从安全的观察开始。', 'There is not enough evidence to identify the vehicle fault; start with safe observations.'));
  // Guarded AI text already contains the explanation: don't repeat the template's question echo.
  if (reply.aiSupplement) parts.push(cleanAnswerText(reply.aiSupplement));
  else {
    const understanding = reply.understanding
      .replace(/^你咨询的是[^。]*。/, '')
      .replace(/^你描述的是“[^”]*”。/, '')
      .replace(/匹配资料列出的原因只是排查候选，需要结合检查结果区分，不能直接决定换件。/, '');
    const text = cleanAnswerText(understanding);
    if (text) parts.push(text);
  }
  if (!reply.aiSupplement && reply.background?.length) parts.push(reply.background.map(item => cleanAnswerText(item.text)).join('\n\n'));
  if (reply.causes.length) parts.push(t('可能的原因包括：', 'Possible causes include:') + '\n' + reply.causes.map(cause => `- ${cleanAnswerText(cause.text)}`).join('\n'));
  if (reply.suggestions.length) parts.push(reply.suggestions.filter(item => !reply.aiSupplement || item.kind !== 'record').sort((a, b) => a.priority - b.priority)
    .map((item, i) => `${i + 1}. ${cleanAnswerText(item.text)}`).join('\n'));
  if (reply.questions.length) parts.push(reply.questions.slice(0, 2).map(question => cleanAnswerText(question.text)).join('\n\n'));
  return parts.filter(Boolean).join('\n\n');
}

import type { CoordinationDecision, DiagnosticReply } from '../../shared/diagnosis';
import type { PriorDeviceReport } from '../../shared/memory';
import type { KnowledgeChunk } from '../knowledge/types';
import type { RetrievalContext } from '../knowledge/scope';
import { hasIndexedReference, referenceVerification } from '../knowledge/evidence';
import { assessSuggestedAction } from './answerGuard';

const BACKGROUND = new Set(['机型资料', '资料缺口', '资料索引', '资料核验', '系统适用边界', '通识学习']);
const UNCERTAIN = /待核实|待核验|待确认|未确认|未知|不明确/;

/** A verified citation still needs matched applicability and a technical purpose. */
export function hasReliableManualEvidence(chunks: readonly KnowledgeChunk[]): boolean {
  return chunks.some(chunk => hasIndexedReference(chunk) && referenceVerification(chunk.status) === 'verified' &&
    chunk.applicability === 'matched' && !chunk.retrieval?.referenceOnly && !BACKGROUND.has(chunk.entryType ?? '') &&
    chunk.diagnosticEvidence !== false && !UNCERTAIN.test(chunk.scopeBoundary ?? ''));
}

export interface DiagnosticReplyInput {
  query: string;
  currentQuery?: string;
  symptomQuery?: string;
  chunks: readonly KnowledgeChunk[];
  scope: RetrievalContext;
  coordination: CoordinationDecision;
  progress?: string;
  priorReports?: readonly PriorDeviceReport[];
}

function plain(text: string): string {
  return text.replace(/[<>]/g, '').replace(/[\r\n]+/g, ' ').replace(/\*\*|`/g, '').trim();
}

function fields(text: string): { label: string; text: string }[] {
  const out: { label: string; text: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.replace(/\*\*/g, '').match(/^\s*(?:[-*+]\s+)?([^：:\n]{1,35})[：:]\s*(.+)$/);
    if (match) out.push({ label: match[1].trim(), text: match[2].trim() });
    else if (line.trim() && !/^\s*(?:[-*+]|#|\|)/.test(line) && out.length) out[out.length - 1].text += ' ' + line.trim();
  }
  return out;
}

const clauses = (text: string) => text.split(/[；;\n]/).map(plain).filter(value => value.length >= 4 &&
  !/^(?:未知|暂无|资料不足|待补|未提供|未记录|不提供|没有提供|仅资料|整理边界)/.test(value));

function alreadyReported(text: string, progress: string): boolean {
  const normalized = (value: string) => value.replace(/[\s，,。；;：:、]/g, '').replace(/检查|查看|观察|确认|核对|请|先|已经|已|正常|完成|更换|过/g, '');
  const subject = normalized(text);
  if (subject.length < 2) return false;
  return progress.split(/[。；;\n]/).some(report => /已|检查.*(?:正常|异常|完成)|换过|看过|测过/.test(report) &&
    (normalized(report).includes(subject) || subject.includes(normalized(report)) && normalized(report).length >= 2));
}

// User reports only suppress repeated questions/hypotheses; they never verify a repair.
function contradictedByReport(cause: string, progress: string): boolean {
  return /电瓶|蓄电池|电池/.test(cause) && /电瓶|蓄电池|电池/.test(progress) &&
    /(?:电瓶|蓄电池|电池)(?:已经|已)?(?:检查|检测|测量)?(?:过)?(?:，|,|结果|为|是|：|:|\s)*(?:正常|电量充足|电压正常)/.test(progress) &&
    /电量不足|电压低|亏电|电力不足|电池损坏|电瓶损坏|蓄电池损坏/.test(cause);
}

function observedQuestion(query: string, progress: string): DiagnosticReply['questions'][number] {
  if (/水温|冷却|过热|温度.*高/.test(query)) {
    if (!/冷车|热车|启动后|作业.{0,8}(?:分钟|小时)|带负荷|负载/.test(progress)) return {
      text: '水温异常是在冷车刚启动时，还是已经作业一段时间后出现？只说已经观察到的情况即可。',
      options: ['冷车刚启动', '作业一段时间后', '还不确定'],
    };
    return { text: '同时有没有看到报警原文、蒸汽或外部液体痕迹？不必为回答再启动或开盖。', options: ['有，补充原文或现象', '未观察到', '不确定'] };
  }
  if (/动力不足|没劲|没力气|无力/.test(query)) return {
    text: '无力时是发动机转速也上不去，还是转速正常但行驶或牵引无力？只描述已有现象。',
    options: ['转速也上不去', '转速正常但行驶无力', '还分不清'],
  };
  if (/启动|起动|不着车|打不着/.test(query)) {
    if (/(?:起动机|启动机|马达).{0,5}(?:不转|转得慢|转速正常|转得正常|正常转动)/.test(progress)) {
      if (/无(?:报警|故障码)|没有(?:报警|故障码)|未(?:见|发现)(?:报警|故障码)/.test(progress)) return {
        text: '除已报告的起动表现外，异常是在什么工况下首次出现的，近期是否有维护或接线变化？不用再次试启动。',
        options: ['维护后出现', '停放后出现', '作业中出现', '还不确定'],
      };
      return { text: '有没有已看到的报警或故障码原文？只补充现有记录，不要为此重新试启动。', options: ['没有报警或故障码', '有，补充原文', '尚不清楚'] };
    }
    return {
    text: '当时是起动机不转、转得慢，还是转得正常但发动机不着？不用重复试启动。',
    options: ['起动机不转或转得慢', '起动机转得正常但不着', '不确定'],
    };
  }
  return { text: '异常是在什么工况下出现的，同时还有哪些已经观察到的现象？无需新增试车或拆检。' };
}

/** Deterministic, read-only answer plan; no new cause or parameter is invented. */
export function buildDiagnosticReply(input: DiagnosticReplyInput): DiagnosticReply {
  const { coordination, scope } = input;
  const progress = input.progress ?? '';
  const query = plain(input.symptomQuery || input.query || input.currentQuery || '当前故障现象').slice(0, 220);
  const machine = plain([scope.brand, scope.model].filter(Boolean).join(' '));
  const chunks = input.chunks.filter(chunk => referenceVerification(chunk.status) !== 'failed');
  const exact = chunks.filter(chunk => hasReliableManualEvidence([chunk]) &&
    (!coordination.candidates?.length || coordination.candidates.some(candidate => candidate.entryId === chunk.entryId &&
      !candidate.excluded && candidate.modelMatch === 'exact')));
  const general = chunks.filter(chunk => chunk.entryType === '通识学习' && (chunk.generalEvidence || chunk.retrieval?.tier === 'general'));
  const reference = chunks.filter(chunk => hasIndexedReference(chunk));
  const reply: DiagnosticReply = {
    topic: query,
    understanding: `${machine ? `你咨询的是${machine}。` : ''}你描述的是“${query}”。目前还不能只凭这一现象确定具体故障。`,
    supportLevel: exact.length ? 'manual' : general.length ? 'general' : reference.length ? 'reference_only' : 'none',
    causes: [], suggestions: [], questions: [],
    sourceNote: exact.length ? `本次可参考匹配且已核对的资料：${exact.map(chunk => chunk.entryId).join('、')}。文献核对不代表本机已经确诊或实车验证。`
      : general.length ? `本次参考${general.map(chunk => `${chunk.entryId}（${chunk.status || '核验状态未说明'}）`).join('、')}通识（无手册页码），只能解释一般原理，不能作为本机参数或维修操作依据。`
      : reference.length ? '找到的资料仍需确认适用范围或核验状态，本次不据此给出具体故障原因、参数或维修步骤。'
      : coordination.retrievalOutcome === 'no_manual' ? '目前已登记来源中没有匹配本次车型的手册范围；不能据此确定部件故障或专用参数。'
      : coordination.retrievalOutcome === 'no_results' ? '本次检索没有找到支持这一问题的资料，这不代表没有该机型手册。请补充现场信息后再缩小检索范围。'
      : '目前没有能直接支持本次机型诊断的匹配手册依据，不能据此确定部件故障或专用参数。',
  };
  if (coordination.route === 'clarify') {
    reply.understanding = coordination.reason === 'knowledge_conflict'
      ? '本次资料之间存在尚未解决的差异，先核对适用条件，避免把不同范围的说法混在一起。'
      : '本次设备信息还需要确认，先明确咨询对象，再继续之前的故障分析。';
    reply.questions = [{ text: coordination.reason === 'identity_required'
      ? '请提供品牌、完整型号和报警或故障码原文；暂时不知道的项目可以说明。'
      : '请确认本次设备的品牌与完整型号，哪项需要更正？' }];
    reply.supportLevel = reference.length ? 'reference_only' : 'none';
    return reply;
  }
  const reported = progress.split(/[。；;\n]/).filter(text => /已(?:经)?检查|检查.*(?:正常|异常|完成)/.test(text) && !assessSuggestedAction(text).restricted).slice(-2).map(plain).join('；').slice(0, 180);
  if (reported) reply.understanding += `你已报告“${reported}”（用户观察，尚未独立核验），后续不把它当作手册事实。`;
  if (coordination.route !== 'safe') {
    const background = general.flatMap(chunk => chunk.text.split(/[。\n]/).map(plain)
      .filter(text => text.length >= 12 && text.length <= 260 && !/^[#*]|参数|标准值|\d|调至|更换|拆卸|开启|短接|故障码/.test(text) && !assessSuggestedAction(text).restricted)
      .slice(0, 1).map(text => ({ text, evidenceIds: [chunk.entryId!] }))).slice(0, 2);
    if (background.length) reply.background = background;
  }
  const principlesOnly = !scope.brand && !scope.model && general.length > 0 &&
    !/故障|异常|不转|不起|不着|困难|过高|过热|没劲|无力|泄漏|漏油|异响|冒烟|怎么办|排查|检查|维修|拆卸|调压/.test(query);
  if (principlesOnly && coordination.route !== 'safe') {
    reply.understanding = `你想了解“${query}”。以下是本地通识资料的原理参考，未作为具体机型手册或实车结论。`;
    return reply;
  }
  if (coordination.route === 'safe') {
    const system = /制动|刹车/.test(query) ? '制动异常会影响安全停车' : /转向|方向/.test(query) ? '转向异常会影响车辆控制'
      : /水温|冷却|热车|水箱|过热/.test(query) ? '高温或冷却异常需要先排除烫伤与继续运行的风险'
      : /PTO|动力输出|传动轴/i.test(query) ? '动力输出或传动部件异常有卷入和意外运动风险' : '当前情况还涉及未排除的操作风险';
    reply.understanding = `${system}。先停止危险作业，按本机安全规程安全停机；现在不安排试车、拆检或调压。`;
    reply.suggestions.push({ text: '保持与运动、高温和带压部件的安全距离，不要绕过安全联锁；请具备相应资质的维修人员现场核对。', kind: 'professional', evidenceIds: [], priority: 1 });
  } else {
    for (const chunk of exact) {
      for (const field of fields(chunk.text)) {
        if (/^(?:可能原因(?:选摘)?|原表可能原因|故障原因|故障表.*原因)$/.test(field.label)) {
          for (const text of clauses(field.text)) {
            if (assessSuggestedAction(text).restricted || contradictedByReport(text, progress) || reply.causes.some(cause => cause.text === text)) continue;
            reply.causes.push({ text, evidenceIds: [chunk.entryId!], basis: 'source_candidate' });
          }
        }
        if (/^(?:诊断步骤|检查方法|检查步骤|排查步骤|原文核对方向|初步核对|安全要求|安全提醒|安全禁令)$/.test(field.label)) {
          for (const text of clauses(field.text)) {
            // Only observation/recording and explicit prohibitions enter public local suggestions.
            if (!/观察|查看|记录|报警|不要|禁止|不得|切勿/.test(text) || /测量|检测|拆|调压|更换|试车|启动/.test(text) && !/不要|禁止|不得|切勿/.test(text) ||
              assessSuggestedAction(text).restricted || alreadyReported(text, progress)) continue;
            reply.suggestions.push({ text, kind: /不要|禁止|不得|切勿/.test(text) ? 'professional' : 'observe', evidenceIds: [chunk.entryId!], priority: 2 });
          }
        }
      }
    }
    reply.causes = reply.causes.slice(0, 3);
    if (reply.causes.length) reply.understanding += '匹配资料列出的原因只是排查候选，需要结合检查结果区分，不能直接决定换件。';
    if (!reply.suggestions.length) reply.suggestions.push({
      text: '先记录报警原文、异常发生工况和已经完成的检查结果；只描述已有观察，不必为补充信息再次试车或拆检。',
      kind: 'record', evidenceIds: [], priority: 1,
    });
    // Component/series references can preserve genuine safety prohibitions without acquiring diagnostic authority.
    for (const chunk of reference.filter(chunk => !exact.includes(chunk))) {
      if (referenceVerification(chunk.status) !== 'verified') continue;
      for (const field of fields(chunk.text)) {
        if (!/安全|限制|禁令|维护注意|操作注意/.test(field.label) && !(chunk.entryType === '安全操作' && field.label === '事实概述')) continue;
        for (const text of clauses(field.text)) if (/不要|禁止|不得|切勿|严禁/.test(text) && !assessSuggestedAction(text).restricted) {
          reply.suggestions.push({ text, kind: 'professional', evidenceIds: [chunk.entryId!], priority: 0 });
        }
      }
    }
  }
  if (/水温|冷却|过热|水箱/.test(query)) reply.suggestions.push({
    text: '不要在热机或带压时打开冷却系统盖，也不要接近高温蒸汽；先按本机规程安全停机并交由合格人员处理。',
    kind: 'professional', evidenceIds: [], priority: 0,
  });
  reply.suggestions = reply.suggestions.sort((a, b) => a.priority - b.priority).filter((item, index, all) => all.findIndex(other => other.text === item.text) === index).slice(0, 3);
  const observation = observedQuestion(query, progress);
  if (!scope.model && !/型号.{0,5}(?:不知|未知|不知道|不清楚)|暂时不知道型号/.test(progress)) reply.questions.push({ text: '铭牌上的完整型号是什么？暂时不知道也可以，先描述已有现象。' });
  if (!alreadyReported(observation.text, progress)) reply.questions.push(observation);
  if (!reply.questions.length) reply.questions.push({ text: '已有检查结果中，哪一项与出现异常前不同？请只补充新情况。' });
  reply.questions = reply.questions.slice(0, 2);
  return reply;
}

/** Natural main answer; routing, provider failures and raw retrieval data belong in details. */
export function renderDiagnosticReply(reply: DiagnosticReply): string {
  const sections = [reply.understanding];
  if (reply.background?.length) sections.push('通用原理参考（非本机结论，尚需核对）：\n' + reply.background.map(item => `- ${item.text}（${item.evidenceIds.join('、')}，无手册页码）`).join('\n'));
  if (reply.causes.length) sections.push('资料中列出的可能方向：\n' + reply.causes.map(cause => `- ${cause.text}（${cause.evidenceIds.join('、')}，待验证）`).join('\n'));
  if (reply.suggestions.length) sections.push('建议按以下顺序处理：\n' + reply.suggestions.map((suggestion, index) => `${index + 1}. ${suggestion.text}${suggestion.evidenceIds.length ? `（${suggestion.evidenceIds.join('、')}）` : ''}`).join('\n'));
  sections.push(reply.sourceNote);
  if (reply.aiSupplement) sections.push('AI补充分析（推断，需核对）：\n' + reply.aiSupplement);
  if (reply.questions.length) sections.push('为了缩小范围，先确认：\n' + reply.questions.map((question, index) => `${index + 1}. ${question.text}`).join('\n'));
  return sections.filter(Boolean).join('\n\n');
}

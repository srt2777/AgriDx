import type { KnowledgeChunk } from '../knowledge/types';
import { hasIndexedReference, referenceVerification } from '../knowledge/evidence';

export interface AnswerIssue { code: string; message: string }
export interface AnswerValidation { ok: boolean; issues: AnswerIssue[] }

// A prohibition must immediately govern the risky action; '不要担心…' is not one.
const NEGATION = /(?:不要|不得|严禁|禁止|切勿|不能|不可|不应|避免|不允许|勿|never|do\s+not|don't|must\s+not|cannot|should\s+not)\s*(?:擅自|自行|直接|随意|尝试|试图|再|去|进行|在|\s)*$/i;
const DOUBLE_NEGATION = /(?:不能不|不得不|不可不|不要不|并非不能)[^，,。；;!?！？\n]{0,16}$/;
const DANGEROUS = [
  /短接|跨接|(?:绕过|屏蔽|解除|取消|禁用)[^，,。；;\n]{0,10}(?:联锁|安全|保护)|(?:bypass|bridge|short[ -]circuit)[^.;\n]{0,30}(?:interlock|safety|terminal)/gi,
  /(?:带压|带电|运转中|未熄火|不停机|未停机)[^，,。；;\n]{0,16}(?:拆|松|卸|测|接|检修|维修)|(?:拆|松|卸|测量)[^，,。；;\n]{0,16}(?:高压|共轨|喷油器|带电)|(?:高压|共轨|喷油器)[^，,。；;\n]{0,16}(?:拆|松|卸|测量)/gi,
  /(?:热车|热机|未冷却|高温)[^，,。；;\n]{0,18}(?:开|拧|拆)[^，,。；;\n]{0,8}(?:盖|散热器)|(?:开|拧|拆)[^，,。；;\n]{0,10}(?:热水箱|热机水箱|高温水箱)[^，,。；;\n]{0,6}盖/gi,
  /(?:在|进入|钻入)[^，,。；;\n]{0,10}(?:悬空|悬吊|未支撑)[^，,。；;\n]{0,8}(?:机具|车|设备)[^，,。；;\n]{0,8}(?:下|底)|(?:调高|调整|旋转|拧动)[^，,。；;\n]{0,10}(?:溢流阀|压力阀|喷油泵)|(?:清除|清空|删除|重置)[^，,。；;\n]{0,8}故障码/gi,
  /(?:loosen|disconnect|remove|open)[^.;\n]{0,30}(?:pressuri[sz]ed|high[ -]pressure|live\s+(?:wire|circuit)|hot\s+(?:radiator|coolant))/gi,
];

function negated(clause: string, index: number, length: number): boolean {
  const prefix = clause.slice(0, index);
  const suffix = clause.slice(index + length);
  if (DOUBLE_NEGATION.test(prefix) || /(?:不要|不能|不应|无需|do\s+not|don't)[^，,。；;\n]{0,16}(?:忘记|省略|跳过|直接|改为|然后|forget|omit)[^，,。；;\n]*$/i.test(prefix)) return false;
  if (NEGATION.test(prefix)) return true;
  return /^(?:操作|做法|行为)?(?:是|属于)?(?:严禁|禁止|不可|不能|不应|有危险)/.test(suffix.trim());
}

/** Inspect actual suggested actions, not generic footer mentions of risky systems. */
export function assessSuggestedAction(text: string): { restricted: boolean; reasons: string[] } {
  const reasons = new Set<string>();
  for (const clause of text.split(/[。；;!?！？\n]/)) {
    for (const pattern of DANGEROUS) {
      for (const match of clause.matchAll(new RegExp(pattern.source, pattern.flags))) {
        if (!negated(clause, match.index!, match[0].length)) reasons.add('包含需限制的危险操作');
      }
    }
  }
  return { restricted: reasons.size > 0, reasons: [...reasons] };
}

const ID_PATTERN = /\b(?:KB[A-Z0-9]*|TK|TF\d+|NH|DF|LV|ZL|HH|SRC|TEST|PERF|SOURCE)-(?:[A-Z0-9]+-)*[A-Z0-9]+\b/gi;
const BACKGROUND = new Set(['资料索引', '资料核验', '机型资料', '资料缺口', '系统适用边界', '通识学习']);
const NUMBER_UNIT = /[-+]?\d+(?:\.\d+)?\s*(?:MPa|kPa|Pa|bar|psi|N[·.\s]?m|Nm|mm|cm|mL|ml|L|kW|rpm|r\/min|V|A|Ω|°C|℃|%|兆帕|千帕|帕|毫米|厘米|毫升|升|伏|安培|牛[·米]?米|转\/分|小时|分钟|秒)(?![a-zA-Z])/gi;
const PARAMETER_CONTEXT = /压力|扭矩|间隙|电压|电流|温度|容量|油量|油液|油品|油号|转速|维修周期|保养周期|更换周期|标准|规定值|设定|调至|保持在|达到|不得超过|上限|下限|标称|应为|pressure|torque|clearance|voltage|temperature|capacity|interval|specification/i;
const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s+/g, '');

// Parameters and code meanings must quote a complete supported proposition.
// Matching just a number/code would turn ambient temperature into a machine
// limit, or let 2 MPa match 12 MPa. Rephrased technical claims fail closed.
function proposition(value: string): string {
  return value.normalize('NFKC').replace(ID_PATTERN, '').replace(/《[^》]+》/g, '')
    .replace(/^(?:\s*[-*+]\s*)?(?:事实概述|手册事实|参数|技术参数|故障码说明|故障码含义|原文)\s*[:：]/, '')
    .replace(/[\s，,。；;：:（）()“”"'`*]/g, '').toLowerCase();
}

function hasExactProposition(clause: string, originals: readonly KnowledgeChunk[]): boolean {
  const claim = proposition(clause);
  return Boolean(claim) && originals.some(chunk => chunk.text.split(/[。；;\n]/)
    .some(original => proposition(original) === claim));
}

function trustedManual(chunk: KnowledgeChunk, ids?: readonly string[]): boolean {
  return Boolean(chunk.entryId && (!ids || ids.includes(chunk.entryId)) && hasIndexedReference(chunk) &&
    referenceVerification(chunk.status) === 'verified' && chunk.applicability === 'matched' &&
    !chunk.retrieval?.referenceOnly && !BACKGROUND.has(chunk.entryType ?? '') && chunk.diagnosticEvidence !== false);
}

function pageNumbers(value: string): Set<number> {
  const output = new Set<number>();
  for (const part of value.split(/[、,，/]/)) {
    const numbers = part.match(/\d+/g)?.map(Number) ?? [];
    if (numbers.length === 2 && /[-～~至–—]/.test(part) && numbers[1] >= numbers[0] && numbers[1] - numbers[0] <= 2000) {
      for (let n = numbers[0]; n <= numbers[1]; n++) output.add(n);
    } else for (const n of numbers) output.add(n);
  }
  return output;
}

function citedPages(text: string) {
  return [...text.matchAll(/(?:(PDF\s*(?:物理)?|印刷)\s*)?第\s*([0-9][0-9\s、,，/～~至–—-]*)\s*页/gi)].map(match => ({
    kind: match[1]?.toUpperCase().startsWith('PDF') ? 'pdf' : match[1] ? 'printed' : undefined,
    numbers: pageNumbers(match[2]),
  }));
}

/** A conservative local gate, not a claim that free text has been fact-checked. */
export function validateDiagnosticAnswer(
  content: string, chunks: readonly KnowledgeChunk[], options: { trustedEvidenceIds?: readonly string[]; model?: string } = {},
): AnswerValidation {
  // Normalize display-equivalent forms before applying rules; keep original output unchanged.
  content = content.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '');
  const issues: AnswerIssue[] = [];
  const add = (code: string, message: string) => { if (!issues.some(issue => issue.code === code)) issues.push({ code, message }); };
  if (!content.trim() || content.length > 10000) add('answer_length', '回答为空或超过安全长度');
  if (assessSuggestedAction(content).restricted) add('unsafe_action', '回答包含不允许的危险操作建议');
  const usable = chunks.filter(chunk => referenceVerification(chunk.status) !== 'failed');
  const ids = new Set(usable.flatMap(chunk => [chunk.entryId, chunk.sourceId].filter((id): id is string => Boolean(id))).map(id => id.toUpperCase()));
  const referenced = [...content.matchAll(ID_PATTERN)].map(match => match[0].toUpperCase());
  if (referenced.some(id => !ids.has(id))) add('unknown_reference', '引用不属于本次提供的资料');
  const manuals = usable.filter(chunk => chunk.entryType !== '通识学习' && hasIndexedReference(chunk));
  const trusted = usable.filter(chunk => trustedManual(chunk, options.trustedEvidenceIds));

  for (const clause of content.split(/[。；;!?！？\n]/)) {
    const clauseIds = [...clause.matchAll(ID_PATTERN)].map(match => match[0].toUpperCase());
    const citedEntries = usable.filter(chunk => chunk.entryId && clauseIds.includes(chunk.entryId.toUpperCase()));
    const citedSources = clauseIds.filter(id => usable.some(chunk => chunk.sourceId?.toUpperCase() === id));
    if (citedEntries.length && citedSources.some(source => !citedEntries.some(chunk => chunk.sourceId?.toUpperCase() === source))) {
      add('reference_mismatch', '条目与来源编号不对应');
    }
    const relevant = citedEntries.length ? citedEntries : citedSources.length
      ? manuals.filter(chunk => chunk.sourceId && citedSources.includes(chunk.sourceId.toUpperCase())) : manuals;
    for (const citation of citedPages(clause)) {
      const allowed = new Set<number>();
      for (const chunk of relevant) {
        if (citation.kind === 'pdf') for (const n of pageNumbers(chunk.pages?.pdf ?? '')) allowed.add(n);
        else if (citation.kind === 'printed') for (const n of pageNumbers(chunk.pages?.printed ?? '')) allowed.add(n);
        for (const item of citedPages(chunk.locator ?? '')) {
          if (!citation.kind || !item.kind || item.kind === citation.kind) for (const n of item.numbers) allowed.add(n);
        }
        if (!citation.kind) for (const n of pageNumbers([chunk.pages?.pdf, chunk.pages?.printed].filter(Boolean).join('、'))) allowed.add(n);
      }
      if (![...citation.numbers].every(page => allowed.has(page))) add('unknown_page', '引用页码未出现在对应提供资料中');
    }
    for (const title of clause.matchAll(/《([^》]+)》/g)) {
      if (!manuals.some(chunk => chunk.sourceTitle === title[1])) add('unknown_source_title', '引用书名未出现在本次资料中');
    }
    // Scope negation to each claim. '未经实车验证，但资料已核验' still
    // positively asserts document review; the first disclaimer cannot mask it.
    const referencesVerified = [...clause.matchAll(/已(?:经)?(?:核验|验证|核实|核对)|\bverified\b/gi)].some(match => {
      const prefix = clause.slice(0, match.index);
      return !/(?:不能称为|不代表|并非|不是|尚未|未经|未|待)[^，,。；;]{0,8}$|(?:not|never)\s+$/i.test(prefix);
    });
    const verificationTargets = citedEntries.length ? citedEntries : citedSources.length
      ? usable.filter(chunk => chunk.sourceId && citedSources.includes(chunk.sourceId.toUpperCase())) : usable;
    if (referencesVerified && (!verificationTargets.length || verificationTargets.some(chunk => referenceVerification(chunk.status) !== 'verified'))) add('verification_overclaim', '不能将待核对资料描述为已核验');
    if (/(?:方法|维修|修理|措施|方案|故障|本机)[^。；;]{0,15}(?:已验证|验证有效|已核实有效|已经确认有效|保证有效)/.test(clause) && !/(?:未|不代表|未经|不能|尚未)[^。；;]{0,15}(?:验证|有效|确认)/.test(clause)) add('diagnosis_overclaim', '文献核对不证明维修方案有效');
    if (/实车(?:已)?验证|厂家(?:已)?(?:确认|验证)|已经确诊|已确诊|确定(?:是|为).*(?:故障|损坏)/.test(clause) && !/(?:未|不代表|未经|不能|尚未)[^，,。；;]{0,15}(?:实车|厂家|确诊|确定)/.test(clause)) add('diagnosis_overclaim', '资料审校不能变成实车确诊或厂家验证');

    for (const certainty of clause.matchAll(/(?:肯定是|必然是|一定是|就是|已经确定|已经确认)[^，,。；;]{0,18}(?:损坏|故障|坏了|失效)/g)) {
      if (!/(?:不|未|不能|无法|并非|不是)[^，,。；;]{0,5}$/.test(clause.slice(0, certainty.index))) add('diagnosis_overclaim', '现象不足以作确定性部件诊断');
    }
    const allowedFacts = citedEntries.length ? trusted.filter(chunk => citedEntries.includes(chunk)) : citedSources.length
      ? trusted.filter(chunk => chunk.sourceId && citedSources.includes(chunk.sourceId.toUpperCase())) : trusted;
    if (/(?:根据|依据|按照|出自|参见)[^。；;]{0,20}(?:手册|说明书)|(?:手册|说明书)[^。；;]{0,12}(?:指出|表明|记载|明确说明|要求|规定)/.test(clause) && !hasExactProposition(clause, allowedFacts)) add('unsupported_source_claim', '未提供对应原文的手册归因不能作为事实');
    if (PARAMETER_CONTEXT.test(clause) || NUMBER_UNIT.test(clause)) {
      NUMBER_UNIT.lastIndex = 0;
      const numericalClaim = [...clause.matchAll(NUMBER_UNIT)].length > 0 ||
        /\b(?:SAE\s*)?\d{1,2}W[- ]?\d{2}\b|\b(?:ISO\s*VG|GL[- ]?)\s*\d+\b/i.test(clause) ||
        /(?:标准|规定值|设定值|调至|应为|必须为|不得超过|上限|下限)[为是：:\s]*[-+]?\d/.test(clause);
      if (numericalClaim && !hasExactProposition(clause, allowedFacts)) add('unsupported_parameter', '专用数值或设置没有对应可信手册的完整原文支持');
    }
    const codeClause = options.model && !/^[PCBU]\d{4}$/i.test(options.model) && !/(?:故障码|fault\s*code|DTC)/i.test(clause)
      ? clause.replace(new RegExp(options.model.normalize('NFKC').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '') : clause;
    if (/(?:故障码|fault\s*code|DTC|\b[PCBU]\d{4}\b|\b[A-Z]{1,5}[- ]?\d{2,6}\b)/i.test(codeClause.replace(ID_PATTERN, '')) && /含义|表示|代表|意味着|解释为|对应|即为|(?:[PCBU]\d{4}|[A-Z]{1,5}[- ]?\d{2,6})\s*(?:是|为|[:：])|means|indicates/i.test(clause) && !/含义.{0,8}(?:未知|待核实|不能|无法)|不能.{0,12}(?:解释|确定|推断)|未.{0,8}(?:提供|核对)/.test(clause)) {
      const codes = [...codeClause.replace(ID_PATTERN, '').matchAll(/\b(?:[PCBU]\d{4}|[A-Z]{1,5}[- ]?\d{2,6})\b/gi)].map(match => normalize(match[0]));
      if (!codes.length || codes.some(code => !allowedFacts.some(chunk => chunk.faultCodes?.some(known => normalize(known) === code))) || !hasExactProposition(clause, allowedFacts)) {
        add('unsupported_fault_code', '故障码含义缺少本机适配原文');
      }
    }
  }
  return { ok: issues.length === 0, issues };
}


/** Keep independently safe paragraphs. Never repair a risky paragraph by deleting
 * its safety conditions, or make another model request to rewrite it. */
export function filterDiagnosticAnswer(content: string, chunks: readonly KnowledgeChunk[], options: { trustedEvidenceIds?: readonly string[]; model?: string } = {}) {
  const validation = validateDiagnosticAnswer(content, chunks, options);
  if (validation.ok) return { content, removedIssues: [] as string[] };
  if (validation.issues.some(issue => issue.code === 'answer_length')) return { content: '', removedIssues: validation.issues.map(issue => issue.code) };
  const paragraphs = content.split(/\n\s*\n/);
  const safe = paragraphs.filter(paragraph => validateDiagnosticAnswer(paragraph, chunks, options).ok &&
    // After any rejected paragraph, only retain explanatory/observational prose;
    // never retain a repair step whose preconditions may have been removed.
    !/拆|更换|测量|检测|调压|清洗|清理|加注|加液|试车|启动|运行|松开|拧|短接|跨接|绕过|带电|开盖|(?:请|先|再|然后|接着|建议|应当|需要|将|把|执行|进行)/.test(paragraph) && /可能|常见|原因|涉及|导致|负荷|cause|because/i.test(paragraph));
  const cleaned = safe.join('\n\n').trim();
  // A heading or generic disclaimer alone is not a useful alternative analysis.
  const substantive = safe.some(paragraph => /可能|常见|原因|散热|冷却|检查|观察|记录|负荷|温升|because|cause|check/i.test(paragraph.replace(/^#{1,6}[^\n]*$/gm, '')));
  return { content: substantive && cleaned && validateDiagnosticAnswer(cleaned, chunks, options).ok ? cleaned : '', removedIssues: validation.issues.map(issue => issue.code) };
}

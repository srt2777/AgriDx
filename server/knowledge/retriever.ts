/**
 * 本地轻量 RAG
 *
 * 设计原则：
 * - 不引入向量库 / ES / Redis / LangChain。
 * - 启动时扫描 server/knowledge/ 下的 .md，并加载拖拉机归档索引中的独立条目。
 * - 查询时用关键词重叠打分（中文 bigram + 英文 token），取 top-K 片段。
 * - 知识库很小，全量塞 prompt 也可；这里做"按需选片"，为未来扩充留接口。
 * - 未来接入 PDF/Word 时，只需在 loadAll() 里加新解析器，返回 {path, heading, text}。
 */
import crypto from 'node:crypto';
import type { KnowledgeChunk, DiagnosticMetadata } from './types';
export type { KnowledgeChunk, DiagnosticMetadata } from './types';
import { loadKnowledgeSnapshot, peekKnowledgeSnapshot, type KnowledgeSnapshot } from './snapshot';
import { archiveApplicability, queryWithoutIdentity, resolveScope, type RetrievalContext } from './scope';
import { mentionsEntryId } from './evidence';

interface IndexedChunk {
  chunk: KnowledgeChunk;
  heading: string;
  haystack: string;
  applicabilityKey: string;
}

const MAX_CHUNKS_IN_PROMPT = 6;
export const DEFAULT_PROMPT_CONTEXT_MAX_CHARS = 8000;
const CACHE_TTL_MS = 30_000;
const CACHE_MAX_ENTRIES = 128;
const NON_DIAGNOSTIC_TYPES = new Set(['机型资料', '资料缺口', '资料索引', '资料核验', '系统适用边界', '通识学习']);

// ---- 启动时索引 ----
let chunks: KnowledgeChunk[] = [];
let index: IndexedChunk[] = [];
let generation = 0;
let preparedSnapshot: KnowledgeSnapshot | undefined;
let retrievalRequests = 0;
let cacheHits = 0;
let scoringPasses = 0;
const retrievalCache = new Map<string, { expiresAt: number; chunks: KnowledgeChunk[] }>();

/** Import-time parsing handles both current six-field cards and older bullet labels. */
function diagnosticFields(text: string): Map<string, string> {
  const fields = new Map<string, string>();
  let current: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^(?:[-*]\s+)?([^：:\n]{1,35})[：:]\s*(.*)$/);
    if (match) {
      current = match[1].trim();
      fields.set(current, [fields.get(current), match[2]].filter(Boolean).join('\n'));
    } else if (current && line.trim() && !/^[-*]\s/.test(line)) {
      fields.set(current, `${fields.get(current)}\n${line.trim()}`);
    } else if (/^[-*]\s/.test(line)) {
      current = undefined;
    }
  }
  return fields;
}

function substantiveClauses(value: string): string[] {
  return value.replace(/[*_`]/g, '').split(/[。；;\n]/).map((clause) => clause.trim())
    .filter((clause) => clause.length >= 4 && !/^(?:资料不足|资料缺口|待补|待核实|尚待|暂无|未知|无资料|未提供|未给出|未记录|未确认|不提供|没有提供)/.test(clause))
    .filter((clause) => !/(?:原文|原表|本页|手册|资料|该页|本条|此条).{0,15}(?:未给|未列|未提供|没有给|没有列|没有提供|不提供)/.test(clause))
    .filter((clause) => !/(?:维护|操作|保养)[／/](?:维护|操作|保养)主题|不表示实车(?:已经|已(?:发生)?)故障|未(?:把|将)该主题(?:列为|作为)独立故障|按本机手册补充|相关内容待补/.test(clause))
    // Matching identity/configuration is important, but is not a diagnostic check of a component.
    .filter((clause) => !/^(?:先|首先|仅|必须)?(?:匹配|确认|核对|核实|补充).{0,8}(?:完整机型|机型|型号|品牌|版本|版次|实际配置|市场|排放|手册编号)/.test(clause))
    .filter((clause) => !/^(?:未配相应附件|不按国四整机|不扩展|仅限|仅适用|适用限制)/.test(clause));
}

function headingWithoutId(chunk: KnowledgeChunk): string {
  return chunk.entryId && chunk.heading.includes('｜') ? chunk.heading.split('｜').slice(1).join('｜') : chunk.heading;
}

/** Coverage means source content exists, never that the actual machine has been diagnosed. */
export function deriveDiagnosticMetadata(chunk: KnowledgeChunk): DiagnosticMetadata {
  const fields = diagnosticFields(chunk.text);
  const fieldText = (labels: RegExp) => [...fields].filter(([label]) => labels.test(label))
    .map(([, value]) => value).join('\n');
  const symptom = fieldText(/^(?:故障现象|适用现象|现象|故障症状|症状)$/);
  const causes = fieldText(/(?:可能原因(?:选摘)?|故障原因|故障表.*原因)$/);
  const checks = fieldText(/^(?:诊断步骤|检查方法|检查步骤|排查步骤|故障排查|初步核对|核对方向|原文核对方向|原文方向|初步方向|必须先区分变速配置)$/);
  const repair = fieldText(/^(?:维修建议|维修方法|维修步骤|处理建议|处理方法|对应处理方向|原文处理方向|手册处理方向|维修边界|整理维修边界)$/);
  const heading = headingWithoutId(chunk);
  const diagnostic = Boolean(chunk.entryId) && chunk.diagnosticEvidence !== false && !NON_DIAGNOSTIC_TYPES.has(chunk.entryType ?? '');
  const coverage = {
    symptom: diagnostic && (substantiveClauses(symptom).length > 0 || (!symptom && /不能|无法|不转|不着|不足|故障|打滑|异常|过热|过高|跑偏|沉重|泄漏|漏油|失效|失灵|不起|无力|异响|冒.*烟/.test(heading))),
    causes: diagnostic && substantiveClauses(causes).length > 0,
    checks: diagnostic && substantiveClauses(checks).some((clause) => /检查|核查|核对|核实|对照|查看|观察|确认|区分|记录|检测|测量|排查|检验|识别|复核/.test(clause)),
    repair: diagnostic && substantiveClauses(repair).some((clause) => /更换|调整|紧固|修理|修复|清洁|清洗|清理|补充|补加|纠正|排除|维护|保养|润滑|降挡|减载|减少|停机|停止|联系|维修人员|经销商|专业人员/.test(clause)),
  };
  // Routine closing warnings may mention high-pressure systems even in a lamp or horn entry.
  // Classify the fault itself, not generic safety/footer text or applicability declarations.
  const riskText = `${heading}\n${symptom}\n${causes}`;
  const highRisk = /制动|刹车|转向|方向盘|高压|共轨|动力输出轴|\bpto\b|液压.{0,12}(?:喷射|泄漏|漏油)|(?<!不)着火|起火|火灾|失控|自动驾驶|无人|失联|断联|通信中断/i.test(riskText);
  return { coverage, riskLevel: highRisk ? 'high' : coverage.symptom ? 'low' : 'unknown' };
}

function prepareChunk(chunk: KnowledgeChunk): IndexedChunk {
  const heading = headingWithoutId(chunk).toLowerCase();
  // Precompute lexical text once, keeping citations/identity from inflating symptom scores.
  const body = chunk.entryId ? chunk.text.split('\n')
    .filter((line) => !/^(?:- )?(?:证据|故障证据|来源|来源编号|资料来源|原始|定位|适用|状态|验证状态)[^：:]*[：:]/.test(line))
    .join('\n').replace(/\b(?:SRC|KB|KB2000|TF1000|NH|ZL|LV|DF|HH)-[A-Z0-9-]+\b/g, '') : chunk.text;
  return { chunk: { ...chunk, diagnosticMetadata: deriveDiagnosticMetadata(chunk) },
    heading, haystack: `${heading}\n${body}`.toLowerCase(),
    applicabilityKey: JSON.stringify([chunk.brand, chunk.model, chunk.models, chunk.requiresExactModel,
      chunk.configuration, chunk.driveConfiguration, chunk.emissionStage, chunk.emissionStageUnknown]) };
}

/** Cache stores public static documents only; returned arrays/metadata cannot mutate it. */
function cloneChunk(chunk: KnowledgeChunk): KnowledgeChunk {
  return { ...chunk,
    models: chunk.models ? [...chunk.models] : undefined,
    faultCodes: chunk.faultCodes ? [...chunk.faultCodes] : undefined,
    roles: chunk.roles ? [...chunk.roles] : undefined,
    pages: chunk.pages ? { ...chunk.pages } : undefined,
    indexedReference: chunk.indexedReference ? Object.freeze({ ...chunk.indexedReference }) : undefined,
    diagnosticMetadata: chunk.diagnosticMetadata ? { ...chunk.diagnosticMetadata,
      coverage: { ...chunk.diagnosticMetadata.coverage } } : undefined,
    relevance: chunk.relevance ? { ...chunk.relevance } : undefined,
  };
}

/** Prepare scoring metadata once for each successfully published immutable snapshot. */
function prepareSnapshot(snapshot: KnowledgeSnapshot): void {
  if (preparedSnapshot === snapshot) return;
  const nextIndex = snapshot.chunks.map(prepareChunk);
  index = nextIndex;
  chunks = nextIndex.map(item => item.chunk);
  preparedSnapshot = snapshot;
  generation++;
  retrievalCache.clear();
}

/** Compatibility entry: retrieval, catalog and health share one validated generation. */
export function loadKnowledgeBase(): { fileCount: number; chunkCount: number } {
  const snapshot = loadKnowledgeSnapshot();
  prepareSnapshot(snapshot);
  return { fileCount: snapshot.fileCount, chunkCount: snapshot.chunks.length };
}

// ---- 关键词打分 ----

function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  // 英文/数字 token
  const enTokens = lower.match(/[a-z0-9]{2,}/g) || [];
  // 中文按 2-gram
  const zhBigrams: string[] = [];
  // Do not fabricate bigrams across identity-removal gaps or punctuation.
  for (const run of lower.match(/[\u4e00-\u9fa5]+/g) || []) {
    for (let i = 0; i < run.length - 1; i++) zhBigrams.push(run.slice(i, i + 2));
  }
  return [...enTokens, ...zhBigrams];
}

/** Vocabulary only: these aliases express symptoms, never infer a failed component. */
const SYMPTOM_ALIASES = [
  ['启动', '起动'],
  ['打不着', '打不着火', '不着车', '不能着车', '打不着车', '无法启动', '无法起动', '不能启动', '不能起动', '启动不了', '起动不了', '启动困难', '起动困难', '不着火'],
  ['启动马达', '起动马达', '启动电机', '起动机'],
  ['开锅', '水温过高', '水温高', '发动机过热'],
  ['动力不足', '没劲', '没力气', '加速无力', '牵引无力'],
  ['升不起来', '升不起', '提不起来', '提升无力', '提升不起', '提升失效', '举不起来'],
  ['掉下来', '自己下降', '农具沉降', '自行下降'],
  ['异响', '响声', '噪声', '噪音', '异常声音'],
  ['震动', '振动', '抖动', '颤动'],
  ['方向重', '方向盘很重', '转向沉重', '转向费力'],
  ['刹不住', '刹车不灵', '制动失灵', '制动不灵'],
  ['刹车跑偏', '制动跑偏'],
  ['冒黑烟', '黑烟'],
  ['漏油', '渗油', '油液泄漏'],
  ['定位丢失', '没有定位', '未定位', '定位失效'],
  ['断联', '失联', '通信中断'],
] as const;

function symptomTokens(query: string): { tokens: Map<string, number>; groups: readonly (readonly string[])[] } {
  const text = queryWithoutIdentity(query).replace(
    /联合收割机|拖拉机|插秧机|植保机|播种机|农业机械|农用机械|农机|请问|请帮我|怎么办|怎么修|怎么处理|怎么回事|是什么原因|什么原因|我的|这台|那台|这个|那个|\b(?:tractor|combine|transplanter|sprayer)\b/gi,
    ' ',
  );
  const tokens = new Map(tokenize(text).map((token) => [token, 1]));
  const groups: (readonly string[])[] = [];
  for (const group of SYMPTOM_ALIASES) {
    if (!group.some((term) => text.includes(term))) continue;
    groups.push(group);
    // Expanded aliases must match the whole phrase. Their incidental bigrams
    // (for example 声音 inside 异常声音) would broaden recall to unrelated faults.
    for (const term of group) {
      if (!tokens.has(term)) tokens.set(term, 0.65);
    }
  }
  return { tokens, groups };
}

function scoreChunk(indexed: IndexedChunk, queryTokens: Map<string, number>, groups: readonly (readonly string[])[]): number {
  const { heading, haystack } = indexed;
  // A shared component name or an incidental bigram does not establish that
  // a clearly stated symptom is covered (打不着 must not match 打不开).
  if (groups.length && !groups.some((group) => group.some((term) => haystack.includes(term)))) return 0;
  // Engine power loss after warming up is not starter torque or implement lift weakness.
  const powerLoss = groups.some(group => group.includes('动力不足'));
  const startingSymptom = groups.some(group => group.includes('启动') || group.includes('起动机') || group.includes('打不着'));
  if (powerLoss && !startingSymptom && /启动机|起动机|启动电机|起动电机|启动马达|起动马达/.test(heading)) return 0;
  let score = 0;
  for (const [t, weight] of queryTokens) {
    if (haystack.includes(t)) {
      // 标题命中权重更高
      score += (heading.includes(t) ? 3 : 1) * weight;
    }
  }
  return score;
}

/**
 * 根据用户问题检索最相关的知识片段。
 * 无命中时返回空数组，调用方决定 fallback。
 */
export function retrieve(query: string, k = MAX_CHUNKS_IN_PROMPT, context: RetrievalContext = {}): KnowledgeChunk[] {
  retrievalRequests++;
  const snapshot = peekKnowledgeSnapshot();
  if (!snapshot) return [];
  prepareSnapshot(snapshot);
  if (chunks.length === 0) return [];
  const limit = Number.isFinite(k) ? Math.max(0, Math.min(chunks.length, Math.floor(k))) : MAX_CHUNKS_IN_PROMPT;
  if (!limit) return [];
  // No questions, histories or generated answers are stored. Scope and permission participate
  // in the digest so cached public docs cannot cross an equipment/permission boundary.
  // Browser snapshots do not expose Node crypto. Disable caching there rather than
  // retain question text or weaken the digest used by the server's shared cache.
  const cacheKey = typeof crypto.createHash === 'function' ? crypto.createHash('sha256').update(JSON.stringify({ query, limit, generation,
    machineType: context.machineType ?? '', brand: context.brand ?? '', model: context.model ?? '',
    engineModel: context.engineModel ?? '', faultCodes: context.faultCodes ?? [],
    permission: 'public-knowledge',
  })).digest('hex') : undefined;
  const now = Date.now();
  const cached = cacheKey ? retrievalCache.get(cacheKey) : undefined;
  if (cached && cached.expiresAt > now) {
    cacheHits++;
    retrievalCache.delete(cacheKey!);
    retrievalCache.set(cacheKey!, cached);
    return cached.chunks.map(cloneChunk);
  }
  if (cached) retrievalCache.delete(cacheKey!);
  const { tokens: qTokens, groups } = symptomTokens(query);
  const scope = resolveScope(query, context);
  const lookupText = query.replace(/\[[^\]]*\]\([^)]+\)|https?:\/\/\S+/gi, ' ');
  const idPattern = /(?<![a-z0-9_-])(?:TK-\d{4}|(?:KB|KB2000|TF1000|NH|ZL|LV|DF|HH)-[A-Z0-9-]+)(?![a-z0-9_-])/gi;
  const lookup = /查阅|查找|查看|查询|摘录|解释|解读|学习/.test(lookupText) || !lookupText.replace(idPattern, '').replace(/[\s\p{P}]/gu, '');
  const requestedIds = new Set(lookup ? lookupText.match(idPattern)?.map(id => id.toUpperCase()) ?? [] : []);
  if (qTokens.size === 0 && requestedIds.size === 0) return [];

  scoringPasses++;
  const scored: KnowledgeChunk[] = [];
  // Many sections share one source/configuration scope. Resolve each distinct scope once.
  const applicabilityByScope = new Map<string, KnowledgeChunk['applicability']>();
  for (const indexed of index) {
    const c = indexed.chunk;
    if (requestedIds.size && (!c.entryId || !requestedIds.has(c.entryId) || !mentionsEntryId(query, c.entryId))) continue;
    // The local file preamble describes editing the sample, not diagnostic evidence.
    if (!c.entryId && c.heading === '(概述)') continue;
    const learning = c.entryType === '通识学习' && c.diagnosticEvidence === false;
    if (!learning && c.entryId && !applicabilityByScope.has(indexed.applicabilityKey)) {
      applicabilityByScope.set(indexed.applicabilityKey, archiveApplicability(c, scope));
    }
    const applicability = learning ? undefined : applicabilityByScope.get(indexed.applicabilityKey);
    if (learning ? !scope.tractorArchive || scope.electric || scope.identityConflict || scope.ambiguous
      : c.entryId ? !applicability : !scope.genericKnowledge) continue;
    const score = requestedIds.size ? 100 : scoreChunk(indexed, qTokens, groups);
    if (score > 0) scored.push({ ...c, applicability,
      relevance: { score, method: 'keyword-weighted-overlap', calibrated: false } });
  }
  // Manual-specific hits take precedence; sample parameters must not contradict their instructions.
  const byScore = (a: KnowledgeChunk, b: KnowledgeChunk) => b.relevance!.score - a.relevance!.score;
  const learning = scored.filter(chunk => chunk.entryType === '通识学习').sort(byScore);
  const archived = scored.filter(chunk => chunk.entryId && chunk.entryType !== '通识学习').sort(byScore);
  const primary = archived.length ? archived : scored.filter(chunk => !chunk.entryId).sort(byScore);
  // Keep matched manual references first and reserve context for relevant general principles.
  const primaryLimit = learning.length && limit > 1 ? limit - 1 : limit;
  const result = [...primary.slice(0, primaryLimit), ...learning.slice(0, Math.max(0, limit - Math.min(primary.length, primaryLimit)))];
  // Opportunistic expiration bounds memory as well as reuse time.
  for (const [key, entry] of retrievalCache) {
    if (entry.expiresAt <= now) retrievalCache.delete(key);
  }
  while (retrievalCache.size >= CACHE_MAX_ENTRIES) {
    retrievalCache.delete(retrievalCache.keys().next().value!);
  }
  if (cacheKey) retrievalCache.set(cacheKey, { expiresAt: now + CACHE_TTL_MS, chunks: result.map(cloneChunk) });
  return result.map(cloneChunk);
}

/** 当前知识条目数（供 /api/health 或前端展示） */
export function stats() {
  const snapshot = peekKnowledgeSnapshot();
  const archivedEntries = snapshot?.archivedEntries ?? 0;
  const learningEntries = snapshot?.learningEntries ?? 0;
  return { chunks: snapshot?.chunks.length ?? 0, archivedEntries, learningEntries, totalEntries: archivedEntries + learningEntries };
}

/** Content-free counters support single-retrieval checks and performance measurements. */
export function retrievalStats() {
  return { requests: retrievalRequests, cacheHits, scoringPasses, generation,
    cacheEntries: retrievalCache.size, cacheTtlMs: CACHE_TTL_MS, cacheMaxEntries: CACHE_MAX_ENTRIES };
}

/** Operational invalidation also permits measuring cold retrieval without reloading manuals. */
export function clearRetrievalCache(): void {
  retrievalCache.clear();
}

/** Source facts remain outside body truncation so applicability limits cannot be lost. */
export function describeSource(chunk: KnowledgeChunk): string {
  if (chunk.entryType === '通识学习') return [
    `通识条目：${chunk.entryId}｜主题：${chunk.locator}｜标题：${chunk.heading}`,
    `整理批次：${chunk.version}｜核验状态：${chunk.status}`,
    `正文定位：${chunk.source}#${chunk.entryId?.toLowerCase()}`,
    `用途限制：${chunk.scopeBoundary}`,
    '来源性质：原创／模型辅助整理的通识资料；不是原厂手册证据。',
  ].join('\n');
  if (!chunk.entryId) return `来源：${chunk.source}｜章节：${chunk.heading}`;
  return [
    `条目：${chunk.entryId}｜来源编号：${chunk.sourceId}｜章节：${chunk.heading}`,
    `知识文档：${chunk.source}`,
    `品牌／型号：${chunk.brand}／${chunk.model}｜资料版本：${chunk.version}`,
    ...(chunk.engineModel ? [`资料明确的发动机型号：${chunk.engineModel}`] : []),
    ...(chunk.faultCodes?.length ? [`资料明确的故障码：${chunk.faultCodes.join('、')}`] : []),
    `原始资料：${chunk.originalPath}｜来源网址：${chunk.sourceUrl}`,
    ...(chunk.sourceTitle ? [`资料标题：${chunk.sourceTitle}`] : []),
    `原文定位：${chunk.locator}`,
    ...(chunk.roles?.length ? [`内容角色：${chunk.roles.join('/')}（${chunk.roleBasis}）`] : []),
    `核验状态：${chunk.status}｜资料类别：${chunk.entryType}`,
    `适用性：${chunk.applicability === 'matched' ? '品牌／型号匹配，市场、配置及手册版本仍需核对' : '具体机型适用性待核实，不直接套用操作或参数'}`,
    `适用限制：${chunk.scopeBoundary}`,
  ].join('\n');
}

function promptBlock(chunk: KnowledgeChunk, ordinal: number): string {
  return `【片段 ${ordinal}】\n${describeSource(chunk)}\n\n${chunk.text}`;
}

/** Keep complete evidence blocks, including their closing safety and configuration limits. */
export function selectPromptChunks(found: KnowledgeChunk[], maxChars = DEFAULT_PROMPT_CONTEXT_MAX_CHARS): KnowledgeChunk[] {
  const budget = Number.isFinite(maxChars) ? Math.max(0, Math.floor(maxChars)) : DEFAULT_PROMPT_CONTEXT_MAX_CHARS;
  const selected: KnowledgeChunk[] = [];
  let used = 0;
  for (const chunk of found) {
    const length = promptBlock(chunk, selected.length + 1).length + (selected.length ? '\n\n---\n\n'.length : 0);
    if (used + length > budget) continue;
    selected.push(chunk);
    used += length;
  }
  return selected;
}

/** 把预算内的完整片段格式化为 system prompt 文本，不截断操作边界。 */
export function formatForPrompt(found: KnowledgeChunk[], maxChars = DEFAULT_PROMPT_CONTEXT_MAX_CHARS): string {
  return selectPromptChunks(found, maxChars).map((chunk, i) => promptBlock(chunk, i + 1)).join('\n\n---\n\n');
}

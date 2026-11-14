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
import { archiveApplicability, queryWithoutIdentity, resolveScope, type ResolvedScope, type RetrievalContext } from './scope';
import { mentionsEntryId, referenceVerification, requiredDiagnosticCoverage } from './evidence';
import { buildVectorIndex, rankVectorCandidates, VECTOR_ONLY_ARCHIVE_LIMIT, VECTOR_ONLY_LEARNING_LIMIT, type VectorIndex } from './vectorRecall';
import { requestedFaultCodes, faultCodeKey } from './fault-codes';

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
let manualScopes: KnowledgeChunk[] = [];
let chunksByFaultNumber = new Map<string, { controller?: string; chunk: KnowledgeChunk }[]>();
let threeFieldCodeScopes: KnowledgeChunk[] = [];
let displayCodeScopes: KnowledgeChunk[] = [];
let retrievalRequests = 0;
let cacheHits = 0;
let scoringPasses = 0;
const retrievalCache = new Map<string, { expiresAt: number; chunks: KnowledgeChunk[] }>();
const manualAvailabilityCache = new Map<string, { available: boolean | undefined }>();
/** 检索选项：vectorRecall 缺省开启；关掉只用于加向量前后的对照验收。 */
export interface RetrieveOptions { vectorRecall?: boolean; }
/** 向量索引按快照 generation 缓存；快照切换时重建，不跨代复用。 */
let vectorIndex: VectorIndex | undefined;
let vectorIndexGeneration = -1;
/** 供测试与阈值校准直接对生产索引做召回探查；诊断服务仍只走 retrieve()。 */
export function getVectorIndex(): VectorIndex {
  if (!vectorIndex || vectorIndexGeneration !== generation) {
    vectorIndex = buildVectorIndex(index.map(item => item.haystack));
    vectorIndexGeneration = generation;
  }
  return vectorIndex;
}

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
    retrieval: chunk.retrieval ? { ...chunk.retrieval, basis: [...chunk.retrieval.basis] } : undefined,
  };
}

/** Prepare scoring metadata once for each successfully published immutable snapshot. */
function prepareSnapshot(snapshot: KnowledgeSnapshot): void {
  if (preparedSnapshot === snapshot) return;
  const nextIndex = snapshot.chunks.map(prepareChunk);
  index = nextIndex;
  chunks = nextIndex.map(item => item.chunk);
  preparedSnapshot = snapshot;
  const manualIds = new Set(snapshot.manualSourceIds);
  manualScopes = [...new Map(nextIndex.filter(item => item.chunk.sourceId && manualIds.has(item.chunk.sourceId))
    .map(item => [item.applicabilityKey, item.chunk])).values()];
  chunksByFaultNumber = new Map();
  const displayScopes = new Map<string, KnowledgeChunk>();
  const threeFieldScopes = new Map<string, KnowledgeChunk>();
  for (const { chunk, applicabilityKey } of nextIndex) {
    if (referenceVerification(chunk.status) === 'failed') continue;
    for (const code of chunk.faultCodes ?? []) {
      const [prefixOrCode, number] = code.split(' ');
      const controller = number ? prefixOrCode : undefined;
      const key = number ? faultCodeKey(number) : prefixOrCode;
      const matching = chunksByFaultNumber.get(key) ?? [];
      matching.push({ controller, chunk });
      chunksByFaultNumber.set(key, matching);
      if (key.startsWith('ERROR-')) displayScopes.set(applicabilityKey, chunk);
      if (key.includes('/')) threeFieldScopes.set(applicabilityKey, chunk);
    }
  }
  displayCodeScopes = [...displayScopes.values()];
  threeFieldCodeScopes = [...threeFieldScopes.values()];
  generation++;
  retrievalCache.clear();
  manualAvailabilityCache.clear();
}

function availabilityKey(query: string, context: RetrievalContext): string | undefined {
  return typeof crypto.createHash === 'function'
    ? crypto.createHash('sha256').update(JSON.stringify([query, context])).digest('hex') : undefined;
}

function rememberManualAvailability(query: string, context: RetrievalContext, scope: ReturnType<typeof resolveScope>): boolean | undefined {
  const available = scope.identityConflict || scope.ambiguous || !scope.tractorArchive ||
    !scope.models.some(model => !['国三', '国四'].includes(model))
    ? undefined : manualScopes.some(chunk => archiveApplicability(chunk, scope) !== undefined);
  const key = availabilityKey(query, context);
  if (key) {
    if (manualAvailabilityCache.size >= CACHE_MAX_ENTRIES) manualAvailabilityCache.delete(manualAvailabilityCache.keys().next().value!);
    manualAvailabilityCache.set(key, { available });
  }
  return available;
}

/** Source availability is independent of topic ranking; never infer "no manual" from zero hits. */
export function hasApplicableManual(query: string, context: RetrievalContext = {}): boolean | undefined {
  const snapshot = peekKnowledgeSnapshot();
  if (!snapshot) return undefined;
  prepareSnapshot(snapshot);
  const key = availabilityKey(query, context);
  const cached = key ? manualAvailabilityCache.get(key) : undefined;
  return cached ? cached.available : rememberManualAvailability(query, context, resolveScope(query, context));
}

/** Same one retrieval, plus independently checked source availability. Coverage belongs to the router. */
export function retrieveWithDiagnostics(query: string, k = MAX_CHUNKS_IN_PROMPT, context: RetrievalContext = {}, options: RetrieveOptions = {}) {
  const found = retrieve(query, k, context, options);
  const manualAvailable = hasApplicableManual(query, context);
  const outcome = manualAvailable === false ? 'no_manual' as const : found.length ? 'insufficient_evidence' as const : 'no_results' as const;
  const ambiguity = getFaultCodeAmbiguity(query, context);
  return { chunks: found, manualAvailable, outcome, ...(ambiguity.length ? { faultCodeAmbiguity: ambiguity } : {}) };
}

export function getFaultCodeAmbiguity(query: string, context: RetrievalContext) {
  if (!chunksByFaultNumber.size) return [];
  return findFaultCodeEvidence(query, context, resolveScope(query, context))?.ambiguity ?? [];
}

function findFaultCodeEvidence(query: string, context: RetrievalContext, scope: ResolvedScope) {
  if (!chunksByFaultNumber.size) return undefined;
  const requests = requestedFaultCodes(queryWithoutIdentity(query), context.faultCodes ?? []);
  const ambiguity: { number: string; controllers: string[] }[] = [];
  const resolved = new Map<KnowledgeChunk, KnowledgeChunk['applicability']>();
  let recognized = false;
  let applicableDisplayTable: boolean | undefined;
  for (const request of requests) {
    const isDotted = request.number.includes('.');
    const isDisplayCode = request.number.startsWith('ERROR-');
    const isThreeFieldCode = request.number.includes('/');
    const known = chunksByFaultNumber.get(isDotted ? faultCodeKey(request.number) : request.number);
    const eligible = (known ?? []).flatMap(({ controller, chunk }) => {
      if (request.controller && controller !== request.controller) return [];
      const applicability = archiveApplicability(chunk, scope);
      return applicability ? [{ controller, chunk, applicability }] : [];
    });
    if (isThreeFieldCode) {
      // Keep all three printed fields, including zero padding. Different editions
      // can assign different meanings to the same tuple even on related models.
      if (!known && !(request.explicit && threeFieldCodeScopes.some(chunk => archiveApplicability(chunk, scope) === 'matched'))) continue;
      recognized = true;
      if (request.incomplete) continue;
      const applicable = eligible.filter(item => item.applicability === 'matched');
      if (!scope.brand || scope.models.length !== 1 || applicable.length !== 1) continue;
      resolved.set(applicable[0].chunk, 'matched');
      continue;
    }
    if (isDisplayCode) {
      // Preserve text search for legacy manuals without an indexed display-code table.
      if (!eligible.length) {
        applicableDisplayTable ??= displayCodeScopes.some(chunk => archiveApplicability(chunk, scope) === 'matched');
        if (!applicableDisplayTable) continue;
      }
    } else if (!(request.explicit && isDotted) &&
        (!known || (request.controller && !known.some(item => item.controller === request.controller)))) continue;
    // An unlisted code in an applicable table must not recall a differently numbered card.
    recognized = true;
    const controllers = [...new Set(eligible.flatMap(item => item.controller ?? []))].sort();
    if (controllers.length > 1) {
      ambiguity.push({ number: request.number, controllers });
      continue;
    }
    for (const { chunk, applicability } of eligible) {
      resolved.set(chunk, request.controller || !isDotted ? applicability : 'pending');
    }
  }
  return recognized ? { resolved, ambiguity } : undefined;
}

/** Compatibility entry: retrieval, catalog and health share one validated generation. */
export function loadKnowledgeBase(): { fileCount: number; chunkCount: number } {
  const snapshot = loadKnowledgeSnapshot();
  prepareSnapshot(snapshot);
  return { fileCount: snapshot.fileCount, chunkCount: snapshot.chunks.length };
}

/**
 * 向量召回补位（知识库第 3 步）。
 *
 * 只在 retrieve() 主循环已过硬过滤的 eligiblePositions 里打分：
 * - 关键词已命中的条目：只在 retrieval 上备注“向量语义亦支持（余弦 x.xx）”，
 *   不改 relevance.score、不改排序；向量永远不替关键词决定答案。
 * - 关键词未命中的条目：按余弦取前几名补进 scored 尾部，relevance.score 为 0
 *   （无关键词重叠）、recall 为 'vector'、referenceOnly 为 true；归档最多补
 *   2 条、通识最多补 1 条；通识仍按 2026-10-22 规则标注 generalEvidence。
 * - 结构引用（componentCandidates）里的条目不重复补。
 */
function applyVectorRecall(args: {
  query: string;
  scope: ResolvedScope;
  scored: KnowledgeChunk[];
  eligiblePositions: number[];
  keywordScoreByPosition: Map<number, number>;
  scoredByPosition: Map<number, KnowledgeChunk>;
  scoredSources: Set<KnowledgeChunk>;
  componentSources: Set<KnowledgeChunk>;
}): void {
  const { query, scope, scored, eligiblePositions, keywordScoreByPosition, scoredByPosition, scoredSources, componentSources } = args;
  // 身份词（品牌/型号）与机型通用词已在主路用掉，这里去掉，避免它们主导相似度：
  // 服务层传给检索的 query 自带“东方红 LF1504 拖拉机”前缀，只剩通用词时
  // （如“量子纠缠”），短篇只要含“拖拉机”就能过阈值，造成无中生有的召回。
  const vectorQuery = queryWithoutIdentity(query).replace(GENERIC_QUERY_WORDS, ' ');
  // 多取一些候选再按上限截断：前排被关键词命中占满时，后排的仅向量命中仍有机会。
  const ranked = rankVectorCandidates(getVectorIndex(), vectorQuery, eligiblePositions, 40);
  let archiveAdded = 0;
  let learningAdded = 0;
  for (const candidate of ranked) {
    const indexed = index[candidate.index];
    if (!indexed) continue;
    const c = indexed.chunk;
    const keywordScore = keywordScoreByPosition.get(candidate.index) ?? 0;
    if (keywordScore > 0) {
      const entry = scoredByPosition.get(candidate.index);
      if (entry?.retrieval && entry.retrieval.recall !== 'keyword+vector') {
        entry.retrieval = { ...entry.retrieval, recall: 'keyword+vector',
          basis: [...entry.retrieval.basis, `向量语义亦支持（余弦 ${candidate.cosine.toFixed(2)}）`] };
      }
      continue;
    }
    if (scoredSources.has(c) || componentSources.has(c)) continue;
    const learning = c.entryType === '通识学习' && c.diagnosticEvidence === false;
    if (learning ? learningAdded >= VECTOR_ONLY_LEARNING_LIMIT : archiveAdded >= VECTOR_ONLY_ARCHIVE_LIMIT) continue;
    const applicability = learning ? undefined : archiveApplicability(c, scope);
    if (!learning && c.entryId && !applicability) continue;
    const vectorNote = `向量语义召回候选（余弦 ${candidate.cosine.toFixed(2)}）；仅召回，不决定答案`;
    const entry: KnowledgeChunk = { ...c, applicability,
      ...(learning && scope.openArchive && c.learningKind !== 'terminology' ? { generalEvidence: true as const } : {}),
      retrieval: learning || !c.entryId
        ? { tier: 'general', basis: ['通用知识；无具体机型手册适用证明', vectorNote], referenceOnly: true, recall: 'vector' }
        : { tier: c.models && c.models.length > 1 ? 'series' : 'exact',
          basis: [c.models && c.models.length > 1 ? '来源明确列出的车型范围覆盖当前选择；未通过前缀推断' : '归档品牌与明确型号适用性筛选',
            ...(applicability === 'pending' ? ['具体机型或配置仍待核对'] : []), vectorNote],
          referenceOnly: true, recall: 'vector' },
      // 无关键词重叠：词法分就是 0；相似度只写在 basis 里，不冒充词法分。
      relevance: { score: 0, method: 'keyword-weighted-overlap', calibrated: false } };
    scored.push(entry);
    scoredSources.add(c);
    scoredByPosition.set(candidate.index, entry);
    if (learning) learningAdded++;
    else archiveAdded++;
  }
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
const GENERIC_QUERY_WORDS = /联合收割机|联合收获机|收割机|收获机|拖拉机|插秧机|植保机|播种机|农业机械|农用机械|农机|请问|请帮我|怎么办|怎么修|怎么处理|怎么回事|是什么原因|什么原因|我的|这台|那台|这个|那个|\b(?:tractor|combine|transplanter|sprayer)\b/gi;
const SYMPTOM_ALIASES = [
  ['启动', '起动'],
  ['打不着', '打不着火', '不着车', '不能着车', '打不着车', '无法启动', '无法起动', '不能启动', '不能起动', '启动不了', '起动不了', '启动困难', '起动困难', '不着火'],
  ['启动马达', '起动马达', '启动电机', '起动机'],
  // “水温表”也在此组：用户问“水温表显示90℃以上”时点名的是这块表，不加它，
  // 症状门不会激活，别的表的标题靠“显示/正常”两个通用词就能压过水温条目
  //（2026-11-07 实测：机油压力表条目 KB-YTO-EBUY-LXFL-033 排在水温条目之前）。
  ['开锅', '水温过高', '水温高', '发动机过热', '水温表'],
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
  const text = queryWithoutIdentity(query).replace(GENERIC_QUERY_WORDS, ' ');
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

/**
 * 故障表标题共用的谓词 / 极性词：它们不点名任何症状主题（哪块表、哪个部件），
 * 只出现在“XX表显示不正常 / XX表指示异常”这类通用表述里。标题命中本来 ×3，
 * 但这些词拿 ×3 时，一块无关表的标题仅凭“显示 / 正常”两个通用词就能压过
 * 真正点名症状的条目（2026-11-07 实测：水温问题上机油压力表条目得分反超
 * 水温表条目）。所以它们在标题里也只按正文权重计分。
 */
const GENERIC_HEADING_TOKENS = new Set(['显示', '指示', '异常', '正常', '不正',
  // “表显”是二元分词切“XX表显示…”时跨“表 / 显示”边界产生的赝词，任何一块
  // 表的标题与任何“X表显示…”的问题都会共享它，不点名任何症状主题。
  '表显']);

/**
 * 症状主题门（仅用于关键词打分）：问题点名了某个症状别名组时，条目必须
 * 含有该组任一词，否则视为主题不符（打不着不能匹配打不开；水温表问题
 * 不能匹配机油压力表条目）。向量召回不用这道门——它的职责就是补回关键
 * 词打分为 0 的语义相关条目（见 headingSharesTopic 的另一条规则）。
 */
function symptomGateBlocked(indexed: IndexedChunk, groups: readonly (readonly string[])[]): boolean {
  const { heading, haystack } = indexed;
  // A shared component name or an incidental bigram does not establish that
  // a clearly stated symptom is covered (打不着 must not match 打不开).
  if (groups.length && !groups.some((group) => group.some((term) => haystack.includes(term)))) return true;
  // Engine power loss after warming up is not starter torque or implement lift weakness.
  const powerLoss = groups.some(group => group.includes('动力不足'));
  const startingSymptom = groups.some(group => group.includes('启动') || group.includes('起动机') || group.includes('打不着'));
  if (powerLoss && !startingSymptom && /启动机|起动机|启动电机|起动电机|启动马达|起动马达/.test(heading)) return true;
  return false;
}

function scoreChunk(indexed: IndexedChunk, queryTokens: Map<string, number>, groups: readonly (readonly string[])[]): number {
  const { heading, haystack } = indexed;
  if (symptomGateBlocked(indexed, groups)) return 0;
  let score = 0;
  for (const [t, weight] of queryTokens) {
    if (haystack.includes(t)) {
      // 标题命中权重更高；通用谓词除外（见 GENERIC_HEADING_TOKENS）。
      score += (heading.includes(t) && !GENERIC_HEADING_TOKENS.has(t) ? 3 : 1) * weight;
    }
  }
  return score;
}

/**
 * 标题主题重叠（仅用于向量召回准入）：条目标题与问题至少共享一个非通用
 * 词，才允许向量相似度把它补回。标题点名的是条目的主题；与问题只共享
 * “显示 / 正常”这类通用谓词时，它的向量相似只来自同源模板或通用表述，
 * 不是同一故障（2026-11-07 实测：水温问题上，机油压力表条目
 * KB-YTO-EBUY-LXFL-033 与问题只共享这两个通用词，却因与水温条目同源、
 * 同故障表样板而被向量召回补进结果）。反过来，标题点名同一部件/症状
 * 的条目不受影响：提升器调整条目之于提升器问题共享“提升 / 升器”，
 * 冷却液泄漏条目之于“水温过高 + 冷却液泄漏”问题共享“泄漏 / 检查”，
 * 混合检索的向量补位契约（仅向量命中只作参考、从不成为直接证据）保持不变。
 */
function headingSharesTopic(indexed: IndexedChunk, queryTokens: Map<string, number>): boolean {
  return tokenize(indexed.heading).some((token) => !GENERIC_HEADING_TOKENS.has(token) && queryTokens.has(token));
}

/**
 * 根据用户问题检索最相关的知识片段。
 * 无命中时返回空数组，调用方决定 fallback。
 */
export function retrieve(query: string, k = MAX_CHUNKS_IN_PROMPT, context: RetrievalContext = {}, options: RetrieveOptions = {}): KnowledgeChunk[] {
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
  // The vector-recall flag participates: on/off 对照不得共用缓存。
  const vectorEnabled = options.vectorRecall !== false;
  const cacheKey = typeof crypto.createHash === 'function' ? crypto.createHash('sha256').update(JSON.stringify({ query, limit, generation,
    machineType: context.machineType ?? '', brand: context.brand ?? '', model: context.model ?? '',
    engineModel: context.engineModel ?? '', faultCodes: context.faultCodes ?? [],
    permission: 'public-knowledge', vectorRecall: vectorEnabled,
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
  rememberManualAvailability(query, context, scope);
  const namedScope = Boolean(scope.brand || scope.models.some(model => !['国三', '国四'].includes(model)));
  const organization = snapshot.retrievalOrganization;
  const symptomText = queryWithoutIdentity(query);
  const symptomMatches = organization.symptoms.filter(symptom => symptom.terms.some(term => symptomText.includes(term)));
  const componentIds = new Set(symptomMatches.flatMap(symptom => symptom.componentIds));
  const generalAllowed = scope.tractorArchive && !scope.electric && !scope.identityConflict && !scope.ambiguous;
  const lookupText = query.replace(/\[[^\]]*\]\([^)]+\)|https?:\/\/\S+/gi, ' ');
  const idPattern = /(?<![a-z0-9_-])(?:TK-\d{4}|(?:KB|KB2000|TF1000|NH|ZL|LV|DF|HH)-[A-Z0-9-]+)(?![a-z0-9_-])/gi;
  const lookup = /查阅|查找|查看|查询|摘录|解释|解读|学习/.test(lookupText) || !lookupText.replace(idPattern, '').replace(/[\s\p{P}]/gu, '');
  const requestedIds = new Set(lookup ? lookupText.match(idPattern)?.map(id => id.toUpperCase()) ?? [] : []);
  const faultCodeEvidence = requestedIds.size ? undefined : findFaultCodeEvidence(query, context, scope);
  if (faultCodeEvidence) {
    const exactMatches: KnowledgeChunk[] = [];
    for (const [chunk, applicability] of faultCodeEvidence.resolved) {
      exactMatches.push(cloneChunk({ ...chunk, applicability,
        retrieval: { tier: (chunk.models?.length ?? 0) > 1 ? 'series' : 'exact',
          basis: [applicability === 'matched' ? '完整故障码精确匹配，车型已筛选' : '资料记录了该故障码，控制器或整机配置需核对'],
          referenceOnly: applicability !== 'matched', recall: 'keyword' },
        relevance: { score: 100, method: 'keyword-weighted-overlap', calibrated: false } }));
      if (exactMatches.length === limit) break;
    }
    return exactMatches;
  }
  if (qTokens.size === 0 && requestedIds.size === 0) return [];

  scoringPasses++;
  const scored: KnowledgeChunk[] = [];
  const componentCandidates: KnowledgeChunk[] = [];
  // 向量召回只在已过硬过滤的条目里打分：eligiblePositions 是 index 下标，
  // keywordScoreByPosition 记关键词分（0 表示关键词未命中）。
  const eligiblePositions: number[] = [];
  const keywordScoreByPosition = new Map<number, number>();
  const scoredByPosition = new Map<number, KnowledgeChunk>();
  const scoredSources = new Set<KnowledgeChunk>();
  const componentSources = new Set<KnowledgeChunk>();
  // Many sections share one source/configuration scope. Resolve each distinct scope once.
  const applicabilityByScope = new Map<string, KnowledgeChunk['applicability']>();
  let position = -1;
  for (const indexed of index) {
    position++;
    const c = indexed.chunk;
    // A failed review cannot consume a top-k slot or reach either answer path.
    if (referenceVerification(c.status) === 'failed') continue;
    if (requestedIds.size && (!c.entryId || !requestedIds.has(c.entryId) || !mentionsEntryId(query, c.entryId))) continue;
    // The local file preamble describes editing the sample, not diagnostic evidence.
    if (!c.entryId && c.heading === '(概述)') continue;
    const learning = c.entryType === '通识学习' && c.diagnosticEvidence === false;
    // A vocabulary edge is not a mechanical cause. Use these records for explicit
    // term/ID lookups, keeping symptom-based ranking on the original evidence set.
    if (c.learningKind === 'terminology' && !requestedIds.size &&
      (!/术语|词汇|词表|概念|定义|英文|英语|上位|下位|关联词|翻译/.test(query) || namedScope)) continue;
    if (!learning && c.entryId && !applicabilityByScope.has(indexed.applicabilityKey)) {
      applicabilityByScope.set(indexed.applicabilityKey, archiveApplicability(c, scope));
    }
    const applicability = learning ? undefined : applicabilityByScope.get(indexed.applicabilityKey);
    // A named machine may receive explicitly labelled general references when
    // its applicable documents do not cover this question. Explicit IDs remain isolated lookups.
    if (learning ? !(scope.openArchive || generalAllowed && namedScope || (requestedIds.size && generalAllowed))
      : c.entryId ? !applicability : !scope.genericKnowledge) continue;
    // 问题点名了症状组时，标题与问题无主题重叠的条目不进向量召回
    //（见 headingSharesTopic）；没点名症状组时不设这道门。
    if (groups.length === 0 || headingSharesTopic(indexed, qTokens)) eligiblePositions.push(position);
    const term = c.learningKind === 'terminology' ? c.heading.split('｜')[1]?.split('（')[0] : undefined;
    const termMatch = term && query.includes(term) ? term.length * 10 : 0;
    const score = requestedIds.size ? 100 : scoreChunk(indexed, qTokens, groups) + termMatch;
    if (!learning && c.entryId && applicability && namedScope && !requestedIds.size && componentIds.size &&
      organization.entryComponents[c.entryId]?.some(component => componentIds.has(component)) && score === 0 &&
      !NON_DIAGNOSTIC_TYPES.has(c.entryType ?? '')) {
      // Structural recall is a reference, not a fabricated symptom match score.
      componentCandidates.push({ ...c, applicability,
        retrieval: { tier: 'component', referenceOnly: true, recall: 'keyword',
          basis: [`本机适用资料中的关联组件：${organization.entryComponents[c.entryId].filter(id => componentIds.has(id)).join('、')}`,
            `运行表现关联：${symptomMatches.map(symptom => symptom.id).join('、')}`] },
        relevance: { score: scoreChunk(indexed, qTokens, []), method: 'keyword-weighted-overlap', calibrated: false } });
      componentSources.add(c);
    }
    keywordScoreByPosition.set(position, score);
    if (score > 0) {
      const entry: KnowledgeChunk = { ...c, applicability, ...(learning && scope.openArchive && c.learningKind !== 'terminology' ? { generalEvidence: true as const } : {}),
        retrieval: learning || !c.entryId
          ? { tier: 'general', basis: ['通用知识；无具体机型手册适用证明'], referenceOnly: true, recall: 'keyword' }
          : { tier: c.models && c.models.length > 1 ? 'series' : 'exact',
            basis: [c.models && c.models.length > 1 ? '来源明确列出的车型范围覆盖当前选择；未通过前缀推断' : '归档品牌与明确型号适用性筛选',
              ...(applicability === 'pending' ? ['具体机型或配置仍待核对'] : [])], referenceOnly: applicability !== 'matched', recall: 'keyword' },
        relevance: { score, method: 'keyword-weighted-overlap', calibrated: false } };
      scored.push(entry);
      scoredByPosition.set(position, entry);
      scoredSources.add(c);
    }
  }
  // 向量召回（第 3 步）：只在已过硬过滤的 eligiblePositions 里补候选；不碰
  // 显式编号查找，不改关键词命中分数与排序，只把漏掉的候选补进 scored 尾部。
  if (vectorEnabled && !requestedIds.size && qTokens.size > 0) {
    applyVectorRecall({ query, scope, scored, eligiblePositions, keywordScoreByPosition,
      scoredByPosition, scoredSources, componentSources });
  }
  // Manual-specific hits take precedence; sample parameters must not contradict their instructions.
  const byScore = (a: KnowledgeChunk, b: KnowledgeChunk) => b.relevance!.score - a.relevance!.score;
  // 关键词命中（分 > 0）与仅向量命中（分 = 0）分开：向量候选只补位，不改变
  // 主路的主题覆盖判定与 primary 选择，不挤掉无编号通用片段。
  const learning = scored.filter(chunk => chunk.entryType === '通识学习' && chunk.relevance!.score > 0).sort(byScore);
  const archived = scored.filter(chunk => chunk.entryId && chunk.entryType !== '通识学习' && chunk.relevance!.score > 0).sort(byScore);
  const vectorArchived = scored.filter(chunk => chunk.retrieval?.recall === 'vector' && chunk.entryId && chunk.entryType !== '通识学习');
  const vectorLearning = scored.filter(chunk => chunk.retrieval?.recall === 'vector' && chunk.entryType === '通识学习');
  const archivedAll = [...archived, ...vectorArchived];
  const learningAll = [...learning, ...vectorLearning];
  const requiredCoverage = requiredDiagnosticCoverage(query);
  const topicCovered = archived.some(chunk => !NON_DIAGNOSTIC_TYPES.has(chunk.entryType ?? '') &&
    chunk.applicability === 'matched' && referenceVerification(chunk.status) === 'verified' &&
    requiredCoverage.every(key => chunk.diagnosticMetadata?.coverage[key] === true));
  // Supplement real content gaps, not just empty results. Structural references
  // preserve exact/declared-series order and can never cross a scope boundary.
  const needsSupplement = namedScope && !requestedIds.size && !topicCovered;
  const scopedArchive = needsSupplement ? [...archived, ...componentCandidates.sort(byScore)] : archived;
  const primaryBase = scopedArchive.length ? scopedArchive : scored.filter(chunk => !chunk.entryId).sort(byScore);
  // 向量候选只补在主路结果之后：不改变 primary 的选择，不挤掉无编号通用片段。
  const primary = [...primaryBase, ...vectorArchived];
  let result: KnowledgeChunk[];
  if (scope.openArchive && !requestedIds.size && archived.length && learning.length) {
    // Open question: archive and 通识 compete in one ranking. The best hit of each kind always keeps a
    // slot, so neither the 6,000 通识 entries nor the higher-scoring book headings crowd the other out.
    const merged = [...archivedAll, ...learningAll].sort(byScore).slice(0, limit);
    if (limit > 1) {
      for (const best of [archivedAll[0], learningAll[0]]) {
        if (merged.includes(best)) continue;
        const other = best.entryType === '通识学习';
        const drop = merged.map((chunk, i) => ({ chunk, i })).reverse()
          .find(({ chunk }) => (chunk.entryType === '通识学习') !== other && chunk !== archivedAll[0] && chunk !== learningAll[0]);
        if (drop) merged[drop.i] = best;
      }
    }
    result = merged.sort(byScore);
  } else {
    // Keep manual references first and reserve context for relevant general principles.
    const supplemental = namedScope && !needsSupplement && !requestedIds.size ? [] : learningAll;
    if (needsSupplement) {
      const references = componentCandidates.sort(byScore);
      // 向量候选只补在主路结果之后：结果头用关键词归档 archived，不能用
      // archivedAll——归档关键词为空时，仅向量命中的条目会排到结构引用前面，
      // 改写 primary 判定（planner-integration “原故障恢复”回归：向量条目
      // KB2000-20261015-YTOLF1504-011 曾排到 010/005 之前，导致观察未记录）。
      const reserve = Number(references.length > 0) + Number(supplemental.length > 0) + Number(vectorArchived.length > 0);
      result = archived.slice(0, archived.length ? Math.max(1, limit - reserve) : 0);
      const componentLimit = Math.max(0, limit - result.length - Number(supplemental.length > 0 && limit > result.length + 1));
      result.push(...references.slice(0, Math.min(2, componentLimit)));
      result.push(...supplemental.slice(0, Math.min(1, Math.max(0, limit - result.length))));
      result.push(...vectorArchived.slice(0, Math.max(0, limit - result.length)));
    } else {
      const primaryLimit = supplemental.length && limit > 1 ? limit - 1 : limit;
      result = [...primary.slice(0, primaryLimit), ...supplemental.slice(0, Math.max(0, limit - Math.min(primary.length, primaryLimit)))];
    }
  }
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

/** 向量索引规模与构建耗时（第 3 步）；未建过索引时返回 0 值，不触发构建。 */
export function vectorRecallStats() {
  return vectorIndex
    ? { ...vectorIndex.stats, generation: vectorIndexGeneration }
    : { documents: 0, features: 0, buildMs: 0, generation: vectorIndexGeneration };
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
    ...(chunk.learningKind === 'terminology' ? [`资料来源：FAO AGROVOC｜概念：${chunk.sourceUrl}`] : []),
    chunk.generalEvidence
      ? '证据性质：通识（无手册页码）。本问题未指定品牌／型号，按用户2026-10-22决定作为通识证据参与分析；不是任何具体手册的说法，不能冒充原厂步骤或专用参数。'
      : chunk.learningKind === 'terminology'
        ? '来源性质：FAO AGROVOC术语关系参考；不是原厂手册证据，也不作为故障诊断证据。'
        : '来源性质：原创／模型辅助整理的通识资料；不是原厂手册证据。',
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
    ...(chunk.retrieval ? [`检索层级：${chunk.retrieval.tier}；${chunk.retrieval.basis.join('；')}。${chunk.retrieval.referenceOnly ? '仅作参考，不证明当前症状的原因、操作许可或专用参数。' : ''}`] : []),
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

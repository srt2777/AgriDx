/**
 * 混合检索的向量召回路（知识库第 3 步）。
 *
 * 定位：只做召回候选，不决定答案。主路（目录 + 关键词 + 型号硬过滤）不变；
 * 向量路在同样的硬过滤之后运行，只能把关键词漏掉的候选补进结果集的尾部，
 * 不能挤掉关键词命中，不能改变证据等级，不能把“资料不足”变成“有资料”。
 *
 * 实现：本地稀疏 TF-IDF 向量 + 倒排表，零依赖、零网络、零模型下载。
 * 特征是中文二元/三元字串 + 英文/数字 token（与关键词路的中文 bigram 口径一致，
 * 但用 IDF 加权 + 长度归一化 + 余弦相似度打分，所以能召回关键词按字面重叠
 * 漏掉的同义表述；三元字串保留短语边界，“没反应”≠“SCR 反应”，减少单字串
 * 跨主题误撞）。不引入向量库 / ES / Redis / LangChain，不调用外部 embedding
 * 服务：诊断服务离线可用，且向量结果永远只是候选。
 *
 * 特征以 32 位 FNV-1a 哈希存，不存原文：建索引不产生数百万个子串，倒排表
 * 常驻约 2.2M 条目。以当前 42 万去重特征估算，哈希碰撞约 20 对，只会把两
 * 个极罕见字串的权重合并，永不凭空造出事实（召回路本身也只产生参考候选）。
 *
 * 不变量（调用方 retriever.ts 负责，见该文件）：
 * - 向量候选只取通过型号 / 排放 / 配置 / 身份冲突 / 核验失败硬过滤的条目。
 * - 仅向量命中的条目 relevance.score 为 0（无关键词重叠），retrieval.recall
 *   为 'vector'，referenceOnly 为 true：路由器只把它当参考上下文，永远不
 *   能成为 direct_reference，也不能让检索结论变成 sufficient。
 * - 通识条目仍按 2026-10-22 规则标注，证据等级最高 partial。
 * - 关键词命中保持原有分数与排序；向量只给关键词命中加一个“亦支持”的备注，
 *   不改动其 relevance.score。
 */
export interface VectorIndexStats {
  documents: number;
  features: number;
  buildMs: number;
}

/** 余弦相似度达到该值才算向量候选；低于该值只算噪声，不补位。
 * 标定（去掉身份词与机型通用词之后，固定 14 问实测）：真正同义表述的补回
 * 项余弦 0.121（提升器），单字串误撞最高 0.114（爬坡没力气）、0.112
 * （打火没反应）；阈值 0.12 刚好把两者分开，余量很薄——见
 * tests/knowledge-hybrid-retrieval.test.ts 的对照表。0.15 是去掉通用词之
 * 前的旧标定（当时查询自带“拖拉机”三个字串，把余弦整体抬高），不再适用。
 * 残余误召风险由补位上限（归档 2、通识 1）与 referenceOnly 兜底。 */
export const VECTOR_RECALL_THRESHOLD = 0.12;
/** 每次检索最多补的仅向量命中条数：归档 2 条、通识 1 条（与现有预留位口径一致）。 */
export const VECTOR_ONLY_ARCHIVE_LIMIT = 2;
export const VECTOR_ONLY_LEARNING_LIMIT = 1;

export interface VectorCandidate {
  /** 在传入的文本数组中的下标。 */
  index: number;
  /** 与查询向量的余弦相似度（0–1）。 */
  cosine: number;
}

export interface VectorIndex {
  /** 特征哈希 -> 倒排表（文档下标升序，权重已 L2 归一化；at 为构建游标，建成后等于长度）。 */
  postings: Map<number, { docs: Int32Array; weights: Float32Array; at: number }>;
  /** 仅保留 df ≥ 2 的特征；df = 1 的特征不建倒排表（见 buildVectorIndex）。 */
  documentFrequency: Map<number, number>;
  documents: number;
  stats: VectorIndexStats;
}

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function fnv1a(code: number, hash: number): number {
  return Math.imul(hash ^ code, FNV_PRIME) >>> 0;
}

/**
 * 单遍扫描文本，直接按字符码算特征哈希，不产生子串。
 * 中文连续段内产二元/三元字串哈希；英文/数字连续段（≥2 字符）产整词哈希。
 * 返回 特征哈希 -> 出现次数。
 */
export function vectorFeatureHashes(text: string): Map<number, number> {
  const lower = text.toLowerCase();
  const counts = new Map<number, number>();
  const bump = (hash: number): void => {
    counts.set(hash, (counts.get(hash) ?? 0) + 1);
  };
  let cjkRun = 0;
  let latinStart = -1;
  let latinHash = FNV_OFFSET;
  for (let i = 0; i <= lower.length; i++) {
    const code = i < lower.length ? lower.charCodeAt(i) : 0;
    const isCjk = code >= 0x4e00 && code <= 0x9fa5;
    const isLatin = (code >= 97 && code <= 122) || (code >= 48 && code <= 57);
    if (isCjk) {
      if (cjkRun >= 1) bump(fnv1a(code, fnv1a(lower.charCodeAt(i - 1), FNV_OFFSET)));
      if (cjkRun >= 2) {
        bump(fnv1a(code, fnv1a(lower.charCodeAt(i - 1), fnv1a(lower.charCodeAt(i - 2), FNV_OFFSET))));
      }
      cjkRun++;
    } else {
      cjkRun = 0;
    }
    if (isLatin) {
      if (latinStart < 0) {
        latinStart = i;
        latinHash = FNV_OFFSET;
      }
      latinHash = fnv1a(code, latinHash);
    } else {
      if (latinStart >= 0 && i - latinStart >= 2) bump(latinHash);
      latinStart = -1;
    }
  }
  return counts;
}

/**
 * 为一批已按检索 haystack（标题 + 正文，小写）准备好的文本建索引。
 * 只建一次，调用方按快照 generation 缓存；文本内容变化必须重建。
 *
 * 两遍完成：第一遍分词并统计 df（每篇只留定长数组，不留 Map）；第二遍按
 * df 一次性分配倒排表并填权重，不产生逐特征对象。df = 1 的特征不建倒排表：
 * 全库 42 万去重特征里 26.5 万只出现一次，占词表六成以上，却只贡献单篇
 * 的边际排序（同一篇仍可通过其余共有特征被召回）；剪掉它们把构建从约
 * 11s 降到约 3s，常驻内存也随之下降。单篇特征数受正文长度限制（最长约
 * 1.2k 字），不另设截断上限。
 */
export function buildVectorIndex(texts: readonly string[]): VectorIndex {
  const started = Date.now();
  const total = Math.max(1, texts.length);
  const documentFeatures: { hashes: Uint32Array; counts: Uint16Array }[] = new Array(texts.length);
  const documentFrequency = new Map<number, number>();
  for (let doc = 0; doc < texts.length; doc++) {
    const counts = vectorFeatureHashes(texts[doc]);
    // 哈希是无符号 32 位：必须用 Uint32Array，Int32Array 会把 ≥2^31 的哈希
    // 变成负数，导致 documentFrequency 查不到、该特征被静默丢掉。
    const hashes = new Uint32Array(counts.size);
    const occurrences = new Uint16Array(counts.size);
    let i = 0;
    for (const [feature, count] of counts) {
      hashes[i] = feature;
      occurrences[i] = count > 65535 ? 65535 : count;
      documentFrequency.set(feature, (documentFrequency.get(feature) ?? 0) + 1);
      i++;
    }
    documentFeatures[doc] = { hashes, counts: occurrences };
  }
  // 倒排表长度就是 df：每篇对同一特征最多贡献一条。
  const postings = new Map<number, { docs: Int32Array; weights: Float32Array; at: number }>();
  for (const [feature, df] of documentFrequency) {
    if (df <= 1) continue;
    postings.set(feature, { docs: new Int32Array(df), weights: new Float32Array(df), at: 0 });
  }
  const idf = (df: number): number => Math.log((total + 1) / (df + 1)) + 1;
  for (let doc = 0; doc < documentFeatures.length; doc++) {
    const { hashes, counts } = documentFeatures[doc];
    const weights = new Float64Array(hashes.length);
    let norm = 0;
    for (let i = 0; i < hashes.length; i++) {
      const df = documentFrequency.get(hashes[i]) ?? 0;
      if (df <= 1) continue;
      // 1 + ln(tf)：同一词重复出现只给对数级加权，避免长文靠堆词取胜。
      const weight = (1 + Math.log(counts[i])) * idf(df);
      weights[i] = weight;
      norm += weight * weight;
    }
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < hashes.length; i++) {
      if (weights[i] === 0) continue;
      const posting = postings.get(hashes[i])!;
      posting.docs[posting.at] = doc;
      posting.weights[posting.at] = weights[i] / norm;
      posting.at++;
    }
  }
  return { postings, documentFrequency, documents: texts.length,
    stats: { documents: texts.length, features: postings.size, buildMs: Date.now() - started } };
}

/**
 * 在 eligible 下标集合内按余弦相似度取前 topN。
 * eligible 必须已经过 retriever 的硬过滤；这里只做打分排序，不再做适用性判断。
 * queryText 应先去掉品牌/型号等身份词与机型通用词（调用方用 queryWithoutIdentity
 * 再去掉 GENERIC_QUERY_WORDS），避免身份词主导相似度。
 */
export function rankVectorCandidates(index: VectorIndex, queryText: string,
  eligible: readonly number[], topN: number, threshold = VECTOR_RECALL_THRESHOLD): VectorCandidate[] {
  const queryCounts = vectorFeatureHashes(queryText);
  const queryItems: { feature: number; weight: number }[] = [];
  for (const [feature, count] of queryCounts) {
    const df = index.documentFrequency.get(feature);
    if (df === undefined || df <= 1) continue;
    // 几乎每篇都出现的词（如“检查”“拖拉机”）IDF 趋近 1，基本不贡献区分度。
    queryItems.push({ feature, weight: (1 + Math.log(count)) * (Math.log((index.documents + 1) / (df + 1)) + 1) });
  }
  if (!queryItems.length) return [];
  let queryNorm = 0;
  for (const item of queryItems) queryNorm += item.weight * item.weight;
  queryNorm = Math.sqrt(queryNorm) || 1;
  for (const item of queryItems) item.weight /= queryNorm;
  const limit = Number.isFinite(topN) ? Math.max(0, Math.floor(topN)) : 0;
  if (!limit) return [];
  // 倒排表累加：只碰含查询特征的文档，不用全量 13k 篇逐篇二分查找。
  const eligibleMarks = new Uint8Array(index.documents);
  for (const doc of eligible) {
    if (doc >= 0 && doc < index.documents) eligibleMarks[doc] = 1;
  }
  const scores = new Float32Array(index.documents);
  for (const item of queryItems) {
    const posting = index.postings.get(item.feature);
    if (!posting) continue;
    for (let j = 0; j < posting.docs.length; j++) {
      const doc = posting.docs[j];
      if (eligibleMarks[doc]) scores[doc] += item.weight * posting.weights[j];
    }
  }
  const ranked: VectorCandidate[] = [];
  for (const doc of eligible) {
    if (doc < 0 || doc >= index.documents) continue;
    const cosine = scores[doc];
    if (cosine >= threshold) ranked.push({ index: doc, cosine });
  }
  ranked.sort((a, b) => b.cosine - a.cosine || a.index - b.index);
  return ranked.slice(0, limit);
}

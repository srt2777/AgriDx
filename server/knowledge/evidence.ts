import type { KnowledgeChunk } from './retriever';
import type { DiagnosticCoverageKey, ReferenceVerification } from '../../shared/diagnosis';

/** Shared by retrieval supplementation and routing; labels never invent source coverage. */
export function requiredDiagnosticCoverage(question: string): DiagnosticCoverageKey[] {
  if (/原因|为什么|为何/.test(question) && !/怎么办|怎么修|维修|处理|排查|检查/.test(question)) return ['symptom', 'causes'];
  if (/怎么判断|如何判断|检查|排查|诊断|检测/.test(question) && !/维修|修理|怎么修|处理|怎么办/.test(question)) return ['symptom', 'checks'];
  if (/维修|修理|怎么修|处理|怎么办|修复/.test(question)) return ['symptom', 'checks', 'repair'];
  if (/故障现象|症状|有什么表现/.test(question)) return ['symptom'];
  return ['symptom', 'causes', 'checks', 'repair'];
}

/** IDs are exact index keys, not fuzzy search terms. */
export function isArchiveId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(value);
}

/** This describes reference review only, never manufacturer or vehicle validation. */
export function referenceVerification(status?: string): ReferenceVerification {
  if (!status?.trim()) return 'unspecified';
  if (/核验失败|核对失败|验证失败|证据不符|与原文不符|来源错误|资料不实|资料伪造|(?:^|[；;。])\s*(?:failed|(?:verification|review)[ _-]+failed|invalid source|rejected)\b/i.test(status)) return 'failed';
  if (/未核验|未核对|未经核验|未经验证|未验证|未完成.*核验|未逐条完成|核验未完成|核对未完成|未全部核验/.test(status)) return 'unverified';
  if (/待核验|待核对|待核实|待确认|部分核验|部分核对|尚未完成/.test(status)) return 'pending';
  // An affirmative, complete clause is required. "计划已核验" and "已核验？"
  // must not be accepted just because they contain the same substring.
  const completeVerification = /(?:^|[；;。])\s*(?:原文(?:文本及页面图像|文本|图像)?|证据页(?:文本及图像)?)?已核验\s*(?:$|[；;。])/;
  // These are explicit reviews of the cited pages, not claims about the whole
  // manual, the manufacturer, or an actual vehicle. Do not infer review from
  // "沿用既有", a cover-only review, a plan, or a question.
  const citedPageReview = /(?:^|[；;。])\s*(?:已(?:核对|目视核对|目视对照)(?:引用页原文|原文|文本|证据页|所列|扫描证据页)|已对照网页正文|已同时阅读可提取文字和对应PDF图像|原件图像目视核验|新增证据页已核对条目|指定正文已完成文本及图像核对|(?:所列证据页|指定正文页文本及图像|证据选页文本\/原图及实际印刷页|证据页渲染\+OCR|证据页\d+dpi完整渲染目视核对|引用选页)[^；;。？?]*已(?:核验|核对|复核)|\d{4}-\d{2}-\d{2}按对应PDF页文本及图像逐条核对)(?:[^；;。？?]*)(?:$|[；;。])/;
  return completeVerification.test(status) || citedPageReview.test(status)
    ? 'verified' : 'unspecified';
}

export function hasIndexedReference(chunk: KnowledgeChunk): boolean {
  return isArchiveId(chunk.entryId) && isArchiveId(chunk.sourceId) &&
    chunk.indexedReference?.entryId === chunk.entryId &&
    chunk.indexedReference?.sourceId === chunk.sourceId &&
    chunk.heading.split('｜')[0].trim() === chunk.entryId;
}

export function mentionsEntryId(query: string, entryId: string): boolean {
  if (!isArchiveId(entryId)) return false;
  // Do not match TEST-001 inside TEST-0010 or SOME-TEST-001.
  return new RegExp(`(?<![A-Za-z0-9_-])${entryId}(?![A-Za-z0-9_-])`, 'i').test(query);
}

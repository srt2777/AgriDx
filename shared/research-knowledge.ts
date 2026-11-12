import data from './research-knowledge.json';
import type { ChatResponse } from './chat';
export const researchKnowledge = data;
export function searchResearchKnowledge(query: string) {
  const q = query.trim().toLowerCase();
  if (!q || q.length > 100) return [];
  return data.entries.filter(entry => entry.entryId.toLowerCase() === q ||
    [entry.title, entry.claim, ...entry.keywords].some(text => text.toLowerCase().includes(q)) ||
    entry.keywords.some(word => q.includes(word.toLowerCase()))).slice(0, 5).map(entry => ({...entry, source: data.sources.find(s=>s.id===entry.sourceId)!}));
}
export function researchKnowledgeReply(question: string): ChatResponse | undefined {
  const match = question.trim().match(/^(?:查研究知识|检索研究知识|查知识条目)\s*[:：]?\s*(.*)$/s);
  const query = match?.[1] ?? (/^RK-(?:CVT|GEAR)-\d{3}$/.test(question.trim()) ? question.trim() : undefined);
  if (query === undefined) return;
  const entries = searchResearchKnowledge(query);
  const content = ['以下为已对照论文正文的研究知识；不是当前设备的确诊或维修操作依据。',
    ...entries.map(entry => `### ${entry.entryId} · ${entry.title}\n${entry.claim}\n\n来源：[${entry.source.title}](${entry.source.url})，${entry.source.year}，${entry.source.journal}，章节 ${entry.locator}。\n\n${entry.scopeBoundary}`),
    entries.length ? '保留论文工况与局限；尚未经过专家审核或独立复现。' : '未找到已整理的正文知识条目。可输入“查研究知识：液压”或“查研究知识：齿轮箱”；不会以文献标题补造结论。'].join('\n\n');
  return {choices:[{message:{role:'assistant',content}}],provider:'knowledge-base',model:'research-knowledge',answerMode:'local-evidence',fellBack:false,
    knowledgeChunks:entries.length,knowledgeSources:entries.map(entry=>({entryId:entry.entryId,entryType:'研究知识',evidenceKind:'literature',evidenceLabel:'研究知识（正文已对照，适用性待核验）',usage:'reference-only',source:entry.source.url,sourceTitle:entry.source.title,sourceId:entry.sourceId,heading:entry.title,locator:`${entry.locator}；DOI：${entry.source.doi}`,scopeBoundary:entry.scopeBoundary,diagnosticEvidence:false,sourceIndexed:true,referenceVerification:'pending',status:'正文已对照；未独立复现或专家审核',applicability:'pending'}))};
}

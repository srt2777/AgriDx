import type { KnowledgeChunk } from '../../server/knowledge/types';

export interface SynonymGroup { canonical: string; aliases: string[] }
export function normalizeQuery(query: string, glossary: readonly SynonymGroup[]): string {
  const additions = glossary.filter(group => group.aliases.some(alias => query.includes(alias))).map(group => group.canonical);
  return [query, ...new Set(additions)].join(' ');
}
export function tokens(text: string): string[] {
  const normalized = text.normalize('NFKC').toLowerCase(); const result: string[] = normalized.match(/[a-z0-9][a-z0-9_.-]*/g) ?? [];
  for (const run of normalized.match(/[\u4e00-\u9fff]+/g) ?? []) for (let i=0;i<run.length-1;i++) result.push(run.slice(i,i+2));
  return result;
}
export interface RankedChunk { chunk: KnowledgeChunk; score: number }
/** Actual BM25 keyword ranking. This does not claim semantic/vector retrieval. */
export class BM25Index {
  private readonly documents: { chunk: KnowledgeChunk; frequencies: Map<string, number>; length: number }[];
  private readonly df = new Map<string, number>(); private readonly averageLength: number;
  constructor(chunks: readonly KnowledgeChunk[]) {
    this.documents = chunks.map(chunk => {
      const terms = tokens(`${chunk.heading}\n${chunk.text}`), frequencies = new Map<string, number>();
      for (const term of terms) frequencies.set(term,(frequencies.get(term)??0)+1);
      for (const term of frequencies.keys()) this.df.set(term,(this.df.get(term)??0)+1);
      return {chunk,frequencies,length:terms.length};
    });
    this.averageLength = this.documents.reduce((sum,doc)=>sum+doc.length,0) / Math.max(1,this.documents.length) || 1;
  }
  search(query: string, eligible: (chunk: KnowledgeChunk)=>boolean, limit=100): RankedChunk[] {
    const terms=[...new Set(tokens(query))]; const count=this.documents.length;
    return this.documents.filter(doc=>eligible(doc.chunk)).map(doc=> {
      let score=0;
      for(const term of terms) {
        const tf=doc.frequencies.get(term)??0; if(!tf) continue;
        const df=this.df.get(term)??0; const idf=Math.log(1+(count-df+0.5)/(df+0.5));
        score+=idf*(tf*2.2)/(tf+1.2*(0.25+0.75*doc.length/this.averageLength));
      }
      return {chunk:doc.chunk,score};
    }).filter(item=>item.score>0).sort((a,b)=>b.score-a.score || (a.chunk.entryId??'').localeCompare(b.chunk.entryId??'')).slice(0,limit);
  }
}
/** Reciprocal-rank fusion uses rank positions rather than incomparable raw scores. */
export function fuseRankings(rankings: readonly RankedChunk[][], limit=100): RankedChunk[] {
  const fused=new Map<string,RankedChunk>();
  for(const ranking of rankings) ranking.forEach((item,index)=>{
    const key=JSON.stringify([item.chunk.entryId,item.chunk.version]); const previous=fused.get(key);
    fused.set(key,{chunk:previous?.chunk??item.chunk,score:(previous?.score??0)+1/(60+index+1)});
  });
  return [...fused.values()].sort((a,b)=>b.score-a.score || (a.chunk.entryId??'').localeCompare(b.chunk.entryId??'')).slice(0,limit);
}

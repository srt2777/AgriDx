import { searchResearchKnowledge } from '../shared/research-knowledge';
import { registerLiteratureTools } from './literature-tools';
import type { LiteratureSearch } from '../shared/literature-archive';
import { build_default_registry } from './default-tools';
import type { SessionDetail, PriorDeviceReport } from '../shared/memory';
import { loadKnowledgeSnapshot } from '../server/knowledge/snapshot';
import { getKnowledgeRelations } from '../server/knowledge/relations';

/** Bind sensitive device/session data from the authenticated host, never from model parameters. */
export function buildContextRegistry(memory?:{session:SessionDetail;priorReports:PriorDeviceReport[]}, literatureSearch?: LiteratureSearch) {
  const registry=build_default_registry();
  registry.register('search_research_knowledge', '检索已对照论文正文的研究知识，保留来源、章节、工况与局限；不代表当前机型适用或维修规程。', {type:'object',properties:{query:{type:'string',minLength:1,maxLength:100}},required:['query'],additionalProperties:false}, ({query}) => ({entries:searchResearchKnowledge(query)}), {risk:'read',max_output:16000});
  if (literatureSearch) registerLiteratureTools(registry, literatureSearch);
  registry.register('get_knowledge_entry','只读获取知识正文、来源和范围；适用性需要另行核对。',{type:'object',properties:{entryId:{type:'string',minLength:1,maxLength:120}},required:['entryId'],additionalProperties:false},({entryId})=>{
    if (typeof entryId === 'string' && entryId.startsWith('RK-')) return searchResearchKnowledge(entryId).find(entry=>entry.entryId===entryId) ?? {error:'NOT_FOUND'};
    const chunk=loadKnowledgeSnapshot().chunks.find(item=>item.entryId===entryId);
    if(!chunk)return {error:'NOT_FOUND'};
    return {entryId:chunk.entryId,content:chunk.text,source:chunk.sourceTitle??chunk.source,sourceId:chunk.sourceId,pages:chunk.pages,models:chunk.models,brand:chunk.brand,scopeBoundary:chunk.scopeBoundary,status:chunk.status,applicability:'待核实',sourceType:chunk.entryType==='通识学习'?'通识（无手册页码）':'手册资料（适用性待核实）'};
  });
  registry.register('get_session_state','读取当前会话中用户报告的症状与进度；用户报告尚未核实。',{type:'object',properties:{},additionalProperties:false},()=>memory?{sourceType:'用户报告，待核实',progress:memory.session.progress,summary:memory.session.summary}: {error:'SESSION_UNAVAILABLE'});
  registry.register('list_prior_reports','读取当前设备的历史用户报告，均待核实。',{type:'object',properties:{},additionalProperties:false},()=>memory?{sourceType:'用户报告，待核实',reports:memory.priorReports.map(({question,progress,updatedAt})=>({question,progress,updatedAt}))}:{error:'SESSION_UNAVAILABLE'});
  registry.register('explore_relations','读取知识目录节点的启发式关系，不能作为维修因果或适用性。',{type:'object',properties:{nodeId:{type:'string',minLength:1,maxLength:300}},required:['nodeId'],additionalProperties:false},({nodeId})=>{
    const relations=getKnowledgeRelations();if(!relations.nodes.includes(nodeId))return {error:'NOT_FOUND'};
    return {sourceType:'目录与待审候选',limitations:relations.limitations,degraded:relations.degraded,neighbors:relations.edges.filter(edge=>edge.from===nodeId||edge.to===nodeId).sort((a,b)=>b.strength-a.strength).slice(0,20)};
  });
  registry.register('ask_user_for_info','信息不足时提出一个简洁问题并结束本轮。',{type:'object',properties:{question:{type:'string',minLength:1,maxLength:500}},required:['question'],additionalProperties:false},({question})=>({question}));
  return registry;
}

import { build_default_registry } from './default-tools';
import type { SessionDetail, PriorDeviceReport } from '../shared/memory';
import { loadKnowledgeSnapshot } from '../server/knowledge/snapshot';
import { getKnowledgeRelations } from '../server/knowledge/relations';
import type { KnowledgeChunk } from '../server/knowledge/types';
import { MAX_TOOL_OUTPUT } from './config';
import { serialize } from './tool-utils';
import { ToolExecutionError } from './tool-types';

/** Budget the JSON envelope before the executor's generic string limit. */
export function knowledgeEntryOutput(chunk: KnowledgeChunk): string {
  const metadata = {
    entryId: chunk.entryId,
    source: chunk.sourceTitle ?? chunk.source,
    sourceId: chunk.sourceId,
    sourceUrl: chunk.sourceUrl,
    originalPath: chunk.originalPath,
    locator: chunk.locator,
    version: chunk.version,
    pages: chunk.pages,
    model: chunk.model,
    models: chunk.models,
    brand: chunk.brand,
    engineModel: chunk.engineModel,
    faultCodes: chunk.faultCodes,
    requiresExactModel: chunk.requiresExactModel,
    configuration: chunk.configuration,
    driveConfiguration: chunk.driveConfiguration,
    emissionStage: chunk.emissionStage,
    emissionStageUnknown: chunk.emissionStageUnknown,
    scopeBoundary: chunk.scopeBoundary,
    status: chunk.status,
    entryType: chunk.entryType,
    diagnosticEvidence: chunk.diagnosticEvidence,
    learningKind: chunk.learningKind,
    roles: chunk.roles,
    roleBasis: chunk.roleBasis,
    riskLevel: chunk.riskLevel,
    riskBasis: chunk.riskBasis,
    applicability: '待核实',
    sourceType: chunk.learningKind === 'terminology' ? 'FAO AGROVOC术语参考（无手册页码）'
      : chunk.entryType === '通识学习' ? '通识（无手册页码）' : '归档资料（适用性待核实）',
  };
  const chars = Array.from(chunk.text);
  const render = (length: number) => serialize({
    ...metadata,
    contentTruncated: length < chars.length,
    contentLength: chars.length,
    content: chars.slice(0, length).join(''),
  });
  const full = render(chars.length);
  if (Array.from(full).length <= MAX_TOOL_OUTPUT) return full;
  // Never return body text with incomplete provenance. This exceptional case
  // is a tool failure, rather than a partial evidence object marked successful.
  if (Array.from(render(0)).length > MAX_TOOL_OUTPUT) {
    throw new ToolExecutionError('OUTPUT_TOO_LARGE', '条目来源与适用范围超过输出预算，未返回正文；请通过知识库目录核对原文。');
  }
  let lower = 0, upper = chars.length;
  while (lower < upper) {
    const middle = Math.ceil((lower + upper) / 2);
    if (Array.from(render(middle)).length <= MAX_TOOL_OUTPUT) lower = middle;
    else upper = middle - 1;
  }
  return render(lower);
}

/** Bind sensitive device/session data from the authenticated host, never from model parameters. */
export function buildContextRegistry(memory?:{session:SessionDetail;priorReports:PriorDeviceReport[]}) {
  const registry=build_default_registry();
  registry.register('get_knowledge_entry','只读获取知识正文、来源和范围；适用性需要另行核对。',{type:'object',properties:{entryId:{type:'string',minLength:1,maxLength:120}},required:['entryId'],additionalProperties:false},({entryId})=>{
    const chunk=loadKnowledgeSnapshot().chunks.find(item=>item.entryId===entryId);
    if(!chunk)throw new ToolExecutionError('NOT_FOUND','没有找到该知识条目；请先检索或浏览目录，核对条目编号。');
    return knowledgeEntryOutput(chunk);
  });
  registry.register('get_session_state','读取当前会话中用户报告的症状与进度；用户报告尚未核实。',{type:'object',properties:{},additionalProperties:false},()=>{
    if(!memory)throw new ToolExecutionError('SESSION_UNAVAILABLE','当前没有可读取的设备会话；请向用户确认本次症状，不要推测历史记录。');
    return {sourceType:'用户报告，待核实',progress:memory.session.progress,summary:memory.session.summary};
  });
  registry.register('list_prior_reports','读取当前设备的历史用户报告，均待核实。',{type:'object',properties:{},additionalProperties:false},()=>{
    if(!memory)throw new ToolExecutionError('SESSION_UNAVAILABLE','当前没有可读取的设备会话；请向用户确认本次症状，不要推测历史记录。');
    return {sourceType:'用户报告，待核实',reports:memory.priorReports.map(({question,progress,updatedAt})=>({question,progress,updatedAt}))};
  });
  registry.register('explore_relations','读取知识目录节点的启发式关系，不能作为维修因果或适用性。',{type:'object',properties:{nodeId:{type:'string',minLength:1,maxLength:300}},required:['nodeId'],additionalProperties:false},({nodeId})=>{
    const relations=getKnowledgeRelations();if(!relations.nodes.includes(nodeId))throw new ToolExecutionError('NOT_FOUND','没有找到该知识目录节点；请核对节点编号。');
    return {sourceType:'目录与待审候选',limitations:relations.limitations,degraded:relations.degraded,neighbors:relations.edges.filter(edge=>edge.from===nodeId||edge.to===nodeId).sort((a,b)=>b.strength-a.strength).slice(0,20)};
  });
  registry.register('ask_user_for_info','信息不足时提出一个简洁问题并结束本轮。',{type:'object',properties:{question:{type:'string',minLength:1,maxLength:500}},required:['question'],additionalProperties:false},({question})=>({question}));
  return registry;
}

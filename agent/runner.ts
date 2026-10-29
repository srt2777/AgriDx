import { ToolExecutor, type ToolRegistry } from './tools';
import type { ChatMessage, Provider, ToolChatOptions } from '../server/llm/types';

export interface AgentToolEvent { step:number; tool:string; args:unknown; ok:boolean; error_type:string|null; duration_ms:number; source:'混合资料'|'通识（无手册页码）'|'助手推断'|'用户报告，待核实'|'未分类' }
export type AgentRunResult = { status:'answered'|'question'; content:string; toolEvents:AgentToolEvent[] } | { status:'fallback'|'cancelled'; reason:string; toolEvents:AgentToolEvent[] };
export interface AgentRunOptions {
  provider:Provider; registry:ToolRegistry; messages:ChatMessage[]; query:string;
  context?:Record<string,unknown>; allowedTools:readonly string[];
  /** Must be explicitly granted by the existing server-side coordination decision. */
  allowExternal:boolean;
  /** The existing diagnosis safety and source gate, supplied by the trusted host. */
  guard:(content:string)=>string|null;
  signal?:AbortSignal; maxSteps?:number; timeoutMs?:number;
}

/** Experimental bounded read-only runner. Not connected to /api/chat. */
export async function runAgent(options:AgentRunOptions):Promise<AgentRunResult> {
  const {provider,registry,signal}=options, toolEvents:AgentToolEvent[]=[];
  const maxSteps=Math.max(1,Math.min(6,Math.floor(options.maxSteps??4))), timeoutMs=Math.max(1,Math.min(120_000,options.timeoutMs??60_000));
  if(signal?.aborted)return {status:'cancelled',reason:'cancelled',toolEvents};
  if(options.allowExternal!==true)return {status:'fallback',reason:'coordination_denied',toolEvents};
  if(!provider.isConfigured()||!provider.chatWithTools)return {status:'fallback',reason:'provider_unavailable',toolEvents};
  const controller=new AbortController(),cancel=()=>controller.abort(), timer=setTimeout(cancel,timeoutMs);
  signal?.addEventListener('abort',cancel,{once:true});
  let rejectOnAbort:()=>void=()=>{};
  const interrupted=new Promise<never>((_,reject)=>{rejectOnAbort=()=>reject(new Error('agent interrupted'));controller.signal.addEventListener('abort',rejectOnAbort,{once:true});});
  void interrupted.catch(()=>{});
  const executor=new ToolExecutor(registry);
  const sourceFor=(name:string):AgentToolEvent['source']=>['search_knowledge','browse_knowledge','get_knowledge_entry','explore_relations'].includes(name)?'混合资料':name==='calculator'||name==='get_current_time'||name==='knowledge_stats'?'通识（无手册页码）':name==='resolve_machine_scope'||name==='ask_user_for_info'?'助手推断':name==='get_session_state'||name==='list_prior_reports'?'用户报告，待核实':'未分类';
  const record=(step:number,offset:number)=>{for(const event of executor.trace.slice(offset))toolEvents.push({step,tool:event.tool,args:'[已脱敏]',ok:event.ok,error_type:event.error_type,duration_ms:event.duration_ms,source:sourceFor(event.tool)});};
  try {
    const allowed=new Set(options.allowedTools.filter(name=>registry.get(name)?.risk==='read'));
    if(!allowed.has('resolve_machine_scope'))return {status:'fallback',reason:'scope_tool_unavailable',toolEvents};
    const scope=await executor.execute('resolve_machine_scope',{query:options.query,context:options.context??{}},{signal:controller.signal});record(0,0);
    if(!scope.ok)return {status:signal?.aborted?'cancelled':'fallback',reason:signal?.aborted?'cancelled':controller.signal.aborted?'deadline':scope.error_type??'scope_failed',toolEvents};
    try {const parsed=JSON.parse(scope.content);if(parsed.identityConflict||parsed.ambiguous)return {status:'fallback',reason:'scope_conflict',toolEvents};}catch{return {status:'fallback',reason:'scope_invalid',toolEvents};}
    // Device identity is supplied by the host, never selected by the model.
    allowed.delete('resolve_machine_scope');
    const messages:ChatMessage[]=[...options.messages,{role:'system',content:`以下是服务端范围解析结果，仅供核对，不代表适用性或实车验证：${scope.content}`}];
    const definitions=registry.schemas([...allowed]) as ToolChatOptions['tools'];
    for(let step=1;step<=maxSteps;step++){
      if(controller.signal.aborted)return {status:signal?.aborted?'cancelled':'fallback',reason:signal?.aborted?'cancelled':'deadline',toolEvents};
      const forced=step===maxSteps;
      const reply=await Promise.race([provider.chatWithTools(messages,{tools:definitions,toolChoice:forced?'none':'auto',signal:controller.signal}),interrupted]);
      if(reply.toolCalls.length===0){const safe=options.guard(reply.content);return safe?{status:'answered',content:safe,toolEvents}:{status:'fallback',reason:'answer_rejected',toolEvents};}
      if(forced||reply.toolCalls.length>4||reply.toolCalls.some(call=>!allowed.has(call.name)))return {status:'fallback',reason:'disallowed_or_excess_tools',toolEvents};
      const question=reply.toolCalls.find(call=>call.name==='ask_user_for_info');
      if(question){
        if(reply.toolCalls.length!==1)return {status:'fallback',reason:'mixed_control_call',toolEvents};
        const offset=executor.trace.length,result=await executor.execute(question.name,question.input,{signal:controller.signal});record(step,offset);
        if(!result.ok)return {status:signal?.aborted?'cancelled':'fallback',reason:result.error_type??'question_failed',toolEvents};
        const text=typeof question.input.question==='string'?options.guard(question.input.question):null;
        return text?{status:'question',content:text,toolEvents}:{status:'fallback',reason:'answer_rejected',toolEvents};
      }
      const boundCalls=reply.toolCalls.map(call=>{
        const input={...call.input};
        if(call.name==='search_knowledge')input.context=options.context??{};
        if(call.name==='browse_knowledge'){
          delete input.brand;delete input.model;
          if(typeof options.context?.brand==='string')input.brand=options.context.brand;
          if(typeof options.context?.model==='string')input.model=options.context.model;
        }
        return {type:'tool_use',id:call.id,name:call.name,input};
      });
      messages.push({role:'assistant',content:reply.content,tool_calls:boundCalls.map(call=>({id:call.id,type:'function',function:{name:call.name,arguments:JSON.stringify(call.input)}}))});
      const offset=executor.trace.length;
      const results=await executor.execute_tool_uses(boundCalls,{signal:controller.signal});record(step,offset);
      for(const result of results)messages.push({role:'tool',tool_call_id:String(result.tool_use_id),content:String(result.content)});
    }
    return {status:'fallback',reason:'step_budget',toolEvents};
  } catch {
    return {status:signal?.aborted?'cancelled':'fallback',reason:signal?.aborted?'cancelled':controller.signal.aborted?'deadline':'provider_or_tool_error',toolEvents};
  } finally {clearTimeout(timer);signal?.removeEventListener('abort',cancel);controller.signal.removeEventListener('abort',rejectOnAbort);}
}

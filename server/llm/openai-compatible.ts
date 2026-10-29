/**
 * OpenAI 兼容 chat/completions 通用请求实现。
 * Gemini (v1beta/openai) 与 DeepSeek 都遵循此格式，差别只在 URL/Model/Key。
 */
import { fetchWithTimeout } from './http';
import {
  ProviderError,
  type ChatMessage,
  type ChatResult,
  type Provider,
  type ProviderName,
  type ToolChatOptions,
  type ToolChatResult,
} from './types';

interface OpenAICompatibleOptions {
  name: ProviderName;
  model: string;
  apiUrl: string;
  apiKeyEnv: string;
  /** 超时毫秒 */
  timeoutMs?: number;
  /** system prompt 末尾追加的"模型自述"提示 */
  selfIntro?: string;
}

export function createOpenAICompatibleProvider(opts: OpenAICompatibleOptions): Provider {
  const { name, model, apiUrl, apiKeyEnv, timeoutMs = 25_000, selfIntro } = opts;

  function getKey(): string | undefined {
    return process.env[apiKeyEnv]?.trim() || undefined;
  }

  return {
    name,
    model,
    isConfigured() {
      const k = getKey();
      return Boolean(k && k.trim().length > 0);
    },
    ...(name === 'gemini' ? {} : { async chatWithTools(messages:ChatMessage[], options:ToolChatOptions):Promise<ToolChatResult> {
      const apiKey=getKey();
      if(!apiKey)throw new ProviderError(name,'configuration',`missing ${apiKeyEnv}`);
      const outgoing=selfIntro?(()=>{const copy=[...messages];if(copy[0]?.role==='system')copy[0]={...copy[0],content:copy[0].content+'\n\n'+selfIntro};else copy.unshift({role:'system',content:selfIntro});return copy;})():messages;
      let data:unknown;
      try {
        data=await fetchWithTimeout(apiUrl,{method:'POST',signal:options.signal,headers:{'Content-Type':'application/json',Authorization:`Bearer ${apiKey}`},body:JSON.stringify({model,messages:outgoing,temperature:0.3,stream:false,...(options.tools.length?{tools:options.tools.map(tool=>({type:'function',function:{name:tool.name,description:tool.description,parameters:tool.input_schema}})),tool_choice:options.toolChoice??'auto'}:{})})},timeoutMs,async response=>{
          if(!response.ok){const kind=response.status===401||response.status===403?'auth':response.status===429?'rate_limit':response.status===400||response.status===422?'bad_request':response.status>=500?'server_error':'unknown';throw new ProviderError(name,kind,`HTTP ${response.status}`);}
          try{return await response.json();}catch(error){if(error instanceof Error&&error.name==='AbortError')throw error;throw new ProviderError(name,'invalid_response','response is not valid JSON');}
        });
      } catch(error) {
        if(error instanceof ProviderError)throw error;
        const kind=error instanceof Error&&error.message==='cancelled'?'cancelled':error instanceof Error&&error.message==='timeout'?'timeout':'network';
        throw new ProviderError(name,kind,'request failed');
      }
      const record=data&&typeof data==='object'?data as Record<string,unknown>:{};
      const choice=Array.isArray(record.choices)?record.choices[0]:undefined;
      const message=choice&&typeof choice==='object'?choice.message:undefined;
      const rawCalls=message?.tool_calls;
      if(rawCalls!==undefined&&(!Array.isArray(rawCalls)||rawCalls.length>4))throw new ProviderError(name,'invalid_response','invalid tool calls');
      const ids=new Set<string>();
      const toolCalls=(rawCalls??[]).map((call:unknown)=>{
        if(!call||typeof call!=='object')throw new ProviderError(name,'invalid_response','invalid tool call');
        const item=call as {id?:unknown;type?:unknown;function?:{name?:unknown;arguments?:unknown}};
        if(typeof item.id!=='string'||!item.id||item.id.length>200||ids.has(item.id)||item.type!=='function'||typeof item.function?.name!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(item.function.name)||typeof item.function.arguments!=='string'||item.function.arguments.length>100_000)throw new ProviderError(name,'invalid_response','invalid tool call');
        ids.add(item.id);let input:unknown;try{input=JSON.parse(item.function.arguments);}catch{throw new ProviderError(name,'invalid_response','invalid tool arguments');}
        if(!input||typeof input!=='object'||Array.isArray(input))throw new ProviderError(name,'invalid_response','invalid tool arguments');
        return {id:item.id,name:item.function.name,input:input as Record<string,unknown>};
      });
      const finish=choice?.finish_reason;
      if(!['tool_calls','stop','length'].includes(finish)||((finish==='tool_calls')!==Boolean(toolCalls.length)))throw new ProviderError(name,'invalid_response','invalid finish reason');
      const content=typeof message?.content==='string'?message.content.trim():'';
      if(!content&&!toolCalls.length)throw new ProviderError(name,'invalid_response','missing assistant content');
      return {content,toolCalls,stopReason:finish as ToolChatResult['stopReason']};
    }}),
    async chat(messages: ChatMessage[]): Promise<ChatResult> {
      const apiKey = getKey();
      if (!apiKey) {
        throw new ProviderError(name, 'configuration', `missing ${apiKeyEnv}`);
      }

      // 追加模型自述（让模型被问到时如实回答自己是谁）
      const outgoing: ChatMessage[] = selfIntro
        ? (() => {
            const withIntro = [...messages];
            if (withIntro[0]?.role === 'system') {
              withIntro[0] = { ...withIntro[0], content: withIntro[0].content + '\n\n' + selfIntro };
            } else {
              withIntro.unshift({ role: 'system', content: selfIntro });
            }
            return withIntro;
          })()
        : messages;

      let data: unknown;
      try {
        data = await fetchWithTimeout(
          apiUrl,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model,
              messages: outgoing,
              temperature: 0.3,
              stream: false,
            }),
          },
          timeoutMs,
          async (response): Promise<unknown> => {
            if (!response.ok) {
              // 上游错误体可能回显凭据或提示词，仅保留状态码。
              const detail = `HTTP ${response.status}`;
              if (response.status === 401 || response.status === 403) {
                throw new ProviderError(name, 'auth', detail);
              }
              if (response.status === 400 || response.status === 422) {
                throw new ProviderError(name, 'bad_request', detail);
              }
              if (response.status === 429) throw new ProviderError(name, 'rate_limit', detail);
              if (response.status >= 500) throw new ProviderError(name, 'server_error', detail);
              throw new ProviderError(name, 'unknown', detail);
            }
            try {
              return await response.json();
            } catch (error) {
              if (error instanceof Error && error.name === 'AbortError') throw error;
              throw new ProviderError(name, 'invalid_response', 'response is not valid JSON');
            }
          },
        );
      } catch (err) {
        if (err instanceof ProviderError) throw err;
        // 网络层错误（含超时）
        const kind = err instanceof Error && err.message === 'timeout' ? 'timeout' : 'network';
        // 原始异常可能包含 URL、代理凭据或请求信息，不能向日志/调用方传播。
        throw new ProviderError(name, kind, kind === 'timeout' ? 'request timed out' : 'request failed');
      }

      const record = data && typeof data === 'object' ? data as Record<string, unknown> : {};
      const choice = Array.isArray(record.choices) ? record.choices[0] : undefined;
      const message = choice && typeof choice === 'object' ? choice.message : undefined;
      const content = typeof message?.content === 'string' ? message.content.trim() : '';
      if (!content) {
        throw new ProviderError(name, 'invalid_response', 'missing assistant content');
      }
      const usage: ChatResult['usage'] = {};
      const rawUsage = record.usage;
      if (rawUsage && typeof rawUsage === 'object') {
        for (const field of ['prompt_tokens', 'completion_tokens', 'total_tokens'] as const) {
          const value = (rawUsage as Record<string, unknown>)[field];
          if (typeof value === 'number' && Number.isFinite(value) && value >= 0) usage[field] = value;
        }
      }
      return {
        content,
        provider: name,
        model: typeof record.model === 'string' && record.model.trim() ? record.model.trim() : model,
        usage: Object.keys(usage).length ? usage : undefined,
      };
    },
  };
}

/**
 * LLM Provider 统一接口
 *
 * 所有 provider 实现该接口，由 router 统一调度。
 * 统一返回结构，路由层不再关心是 Gemini 还是 DeepSeek。
 */

export type ProviderName = 'gemini' | 'deepseek' | 'openai';
export type ProviderErrorKind =
  | 'auth'
  | 'network'
  | 'timeout'
  | 'bad_request'
  | 'server_error'
  | 'rate_limit'
  | 'invalid_response'
  | 'configuration'
  | 'unknown';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatResult {
  /** 模型回复正文 */
  content: string;
  /** 实际命中的供应商 */
  provider: ProviderName;
  /** 实际使用的模型名 */
  model: string;
  /** token 用量（可能缺失） */
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/** 调用失败时抛出，router 据此决定是否 fallback */
export class ProviderError extends Error {
  /** Number of generation attempts made; no extra scoring/classification request. */
  attempts = 0;
  constructor(
    public readonly provider: ProviderName,
    public readonly kind: ProviderErrorKind,
    public readonly detail?: string,
  ) {
    super(`[${provider}] ${kind}`);
    this.name = 'ProviderError';
  }
}

export interface Provider {
  readonly name: ProviderName;
  readonly model: string;
  /** 仅表示已配置非空 API Key，不代表密钥有效或上游已连通。 */
  isConfigured(): boolean;
  /** 发起一次 chat 调用；失败抛 ProviderError */
  chat(messages: ChatMessage[]): Promise<ChatResult>;
}

/**
 * 按配置选择 LLM，并在主选失败时尝试另一家已配置的 provider。
 * auto 保留现有路由：配置 Gemini 时优先 Gemini，否则 DeepSeek。
 * 显式 deepseek/gemini 只设置优先顺序；缺少主选 Key 时仍使用另一家。
 * 状态和日志只包含配置概要与错误类别，不暴露凭据或上游响应体。
 */
import { detectProxy } from './http';
import { createGeminiProvider } from './gemini';
import { createDeepSeekProvider } from './deepseek';
import {
  ProviderError,
  type ProviderErrorKind,
  type ProviderName,
  type ChatMessage,
  type ChatResult,
  type Provider,
} from './types';

export type ProviderPreference = 'auto' | ProviderName;

export interface LlmStatus {
  /** null 表示 LLM_PROVIDER 值无效；不返回原始环境变量。 */
  preference: ProviderPreference | null;
  configValid: boolean;
  configurationError?: 'invalid_provider';
  /** 仅表示至少一家 Key 非空，不代表联网或鉴权已验证。 */
  configured: boolean;
  primary: ProviderName | null;
  proxyConfigured: boolean;
  providers: { provider: ProviderName; model: string; configured: boolean }[];
}

export interface RouteOutcome {
  attempts?: number;
  result: ChatResult;
  primary: ProviderName;
  fellBack: boolean;
  /** 主选失败类别；只在实际调用主选失败后回退成功时提供。 */
  fallbackReason?: ProviderErrorKind;
}

function getPreference(): ProviderPreference | null {
  const value = process.env.LLM_PROVIDER?.trim().toLowerCase() || 'auto';
  return value === 'auto' || value === 'gemini' || value === 'deepseek' ? value : null;
}

function asProviderError(provider: ProviderName, error: unknown): ProviderError {
  return error instanceof ProviderError
    ? error
    : new ProviderError(provider, 'unknown', 'unexpected provider error');
}

export class LlmRouter {
  private readonly gemini: Provider;
  private readonly deepseek: Provider;

  constructor() {
    this.gemini = createGeminiProvider();
    this.deepseek = createDeepSeekProvider();
  }

  /** 不发起联网请求；健康接口可安全暴露此概要。 */
  getStatus(): LlmStatus {
    const preference = getPreference();
    const providers = [this.gemini, this.deepseek].map((provider) => ({
      provider: provider.name,
      model: provider.model,
      configured: provider.isConfigured(),
    }));
    const configured = preference !== null && providers.some((provider) => provider.configured);
    return {
      preference,
      configValid: preference !== null,
      ...(preference === null ? { configurationError: 'invalid_provider' as const } : {}),
      configured,
      primary: configured ? this.pickPrimary(preference!).primary.name : null,
      proxyConfigured: detectProxy().present,
      providers,
    };
  }

  printConfig() {
    const status = this.getStatus();
    console.log(
      `[llm] preference=${status.preference ?? 'invalid'} ` +
      `gemini=${this.gemini.isConfigured() ? 'configured' : 'missing'} ` +
      `deepseek=${this.deepseek.isConfigured() ? 'configured' : 'missing'} ` +
      `proxy=${status.proxyConfigured ? 'detected' : 'none'} (connection unverified)`,
    );
  }

  hasAnyConfigured(): boolean {
    return this.getStatus().configured;
  }

  /** Shadow tool use only; unsupported providers retain the ordinary chat path. */
  toolProvider(): Provider | null {
    const preference=getPreference();
    if(preference===null)return null;
    const provider=this.pickPrimary(preference).primary;
    return provider.isConfigured() && provider.chatWithTools ? provider : null;
  }

  private pickPrimary(preference: ProviderPreference): { primary: Provider; secondary: Provider } {
    // auto 保持旧行为：两家都有 Key 时仍优先 Gemini。
    let first = preference === 'deepseek' ? this.deepseek
      : preference === 'gemini' ? this.gemini
      : this.gemini.isConfigured() || detectProxy().present ? this.gemini : this.deepseek;
    let second = first === this.gemini ? this.deepseek : this.gemini;
    if (!first.isConfigured() && second.isConfigured()) [first, second] = [second, first];
    return { primary: first, secondary: second };
  }

  async chat(messages: ChatMessage[]): Promise<RouteOutcome> {
    const preference = getPreference();
    if (preference === null) {
      throw new ProviderError('deepseek', 'configuration', 'invalid LLM_PROVIDER');
    }
    const { primary, secondary } = this.pickPrimary(preference);
    if (!primary.isConfigured()) {
      throw new ProviderError(primary.name, 'configuration', 'no LLM API key configured');
    }

    let primaryError: ProviderError;
    try {
      const result = await primary.chat(messages);
      return { result, primary: primary.name, fellBack: false, attempts: 1 };
    } catch (error) {
      primaryError = asProviderError(primary.name, error);
      console.warn(`[llm] primary ${primary.name} failed (${primaryError.kind})`);
    }

    if (!secondary.isConfigured()) { primaryError.attempts = 1; throw primaryError; }
    try {
      const result = await secondary.chat(messages);
      return { result, primary: primary.name, fellBack: true, fallbackReason: primaryError.kind, attempts: 2 };
    } catch (error) {
      const secondaryError = asProviderError(secondary.name, error);
      secondaryError.attempts = 2;
      console.warn(`[llm] secondary ${secondary.name} failed (${secondaryError.kind})`);
      throw secondaryError;
    }
  }
}

let singleton: LlmRouter | null = null;
export function getLlmRouter(): LlmRouter {
  if (!singleton) {
    singleton = new LlmRouter();
    singleton.printConfig();
  }
  return singleton;
}

/**
 * 带超时的 fetch（Node 18+ 原生 fetch）
 * 用于避免 provider 网络异常时长时间挂起。
 */
export function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs?: number,
): Promise<Response>;
export function fetchWithTimeout<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  consumeResponse: (response: Response) => Promise<T>,
): Promise<T>;
export async function fetchWithTimeout<T>(
  url: string,
  init: RequestInit,
  timeoutMs = 25_000,
  consumeResponse?: (response: Response) => Promise<T>,
): Promise<T | Response> {
  const controller = new AbortController();
  const external = init.signal;
  const cancel = () => controller.abort();
  if (external?.aborted) cancel();
  else external?.addEventListener('abort',cancel,{once:true});
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    // 非流式 LLM 常先返回响应头再生成正文；截止时间需要覆盖正文读取。
    return consumeResponse ? await consumeResponse(response) : response;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      if (external?.aborted) throw new Error('cancelled');
      throw new Error('timeout');
    }
    throw err;
  } finally {
    clearTimeout(timer);
    external?.removeEventListener('abort',cancel);
  }
}

/**
 * 从环境变量里检测是否配置了出站代理。
 * 不发起真实网络请求，只看变量是否存在——由 router 决定优先级，
 * 真实失败仍走 fallback。
 */
export function detectProxy(): { present: boolean; url: string | null } {
  const url =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    null;
  return { present: Boolean(url), url };
}

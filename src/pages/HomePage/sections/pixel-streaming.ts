/** Pure helpers for the classic-home Pixel Streaming player.
 *
 * The signalling address is build-time configuration only
 * (VITE_PIXEL_STREAMING_URL). It must never contain a secret, token or
 * password: it is the public WebSocket address of the Cirrus signalling
 * server, e.g. wss://example.invalid:443 (placeholder shape only).
 * An empty value means "no stream wired up yet", not an error in itself.
 */

export type StreamStatus = 'unconfigured' | 'connecting' | 'connected' | 'disconnected' | 'failed';

export type UrlProblem = 'unsupported-scheme' | 'invalid-url' | null;

export function resolveSignallingUrl(raw: string | undefined): { url: string | null; problem: UrlProblem } {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return { url: null, problem: null };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { url: null, problem: 'invalid-url' };
  }
  if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
    return { url: null, problem: 'unsupported-scheme' };
  }
  if (!parsed.hostname) return { url: null, problem: 'invalid-url' };
  return { url: trimmed, problem: null };
}

export function streamStatusText(status: StreamStatus, lang: 'zh' | 'en'): string {
  const table: Record<StreamStatus, [string, string]> = {
    unconfigured: ['像素流未接入', 'Pixel stream not configured'],
    connecting: ['连接中…', 'Connecting…'],
    connected: ['已连接', 'Connected'],
    disconnected: ['已断开', 'Disconnected'],
    failed: ['连接失败', 'Connection failed'],
  };
  const [zh, en] = table[status];
  return lang === 'zh' ? zh : en;
}

export function urlProblemText(problem: Exclude<UrlProblem, null>, lang: 'zh' | 'en'): string {
  if (problem === 'unsupported-scheme') {
    return lang === 'zh'
      ? '信令地址只接受 ws:// 或 wss://（Cirrus 信令是 WebSocket 地址，不是 http(s) 网页地址）。'
      : 'The signalling address must be ws:// or wss:// (Cirrus signalling is a WebSocket address, not an http(s) page URL).';
  }
  return lang === 'zh'
    ? '信令地址格式无效，请检查 VITE_PIXEL_STREAMING_URL。'
    : 'The signalling address is malformed; check VITE_PIXEL_STREAMING_URL.';
}

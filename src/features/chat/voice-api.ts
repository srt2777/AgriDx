import { ApiError, isRecord, requestJson, type FetchImplementation } from '../../lib/api-client';

/**
 * Website voice client (ChatPage only).
 *
 * Chain: POST /api/voice/stt (transcribe) -> user reviews/edits the text in
 * the composer -> existing requestChatStream answers -> POST /api/voice/tts
 * reads the answer aloud for voice-initiated turns. The one-shot
 * /api/voice/ask endpoint is deliberately NOT used here: it answers in one
 * step, so the recognised text could never be shown for review before
 * sending, and it carries no session/memory while the web chat does.
 * All calls are same-origin relative paths; no absolute URL, no new fetch
 * wrapper. Server limits mirror server/routes/voice.ts and
 * GET /api/voice/status (30 s / 2 MB recordings, Yunxi voice).
 */
export const VOICE_MAX_RECORD_SECONDS = 30;
export const VOICE_MIN_RECORD_SECONDS = 0.5;
export const VOICE_MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
/** Web spoken replies read at most the first 600 chars (same cap as /ask). */
export const VOICE_SPEAK_MAX_CHARS = 600;
export const VOICE_DEFAULT_VOICE = 'zh-CN-YunxiNeural';
export const VOICE_PREFERRED_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm'] as const;

export interface VoiceStatus {
  sttProvider: string;
  sttModel: string | null;
  ttsVoice: string;
  maxAudioSeconds: number;
  maxUploadBytes: number;
  rateLimitPerMinute: number;
  maxTtsChars: number;
}

export function parseVoiceStatus(value: unknown): VoiceStatus {
  if (!isRecord(value) || typeof value.sttProvider !== 'string' || !value.sttProvider
    || typeof value.ttsVoice !== 'string' || typeof value.maxAudioSeconds !== 'number'
    || typeof value.maxUploadBytes !== 'number' || typeof value.rateLimitPerMinute !== 'number'
    || typeof value.maxTtsChars !== 'number') {
    throw new Error('Invalid voice status');
  }
  return {
    sttProvider: value.sttProvider,
    sttModel: typeof value.sttModel === 'string' ? value.sttModel : null,
    ttsVoice: value.ttsVoice,
    maxAudioSeconds: value.maxAudioSeconds,
    maxUploadBytes: value.maxUploadBytes,
    rateLimitPerMinute: value.rateLimitPerMinute,
    maxTtsChars: value.maxTtsChars,
  };
}

/** Capability probe: false/throw means the server has no voice routes (or the browser has no recorder) — the mic stays hidden. */
export async function requestVoiceStatus(
  signal?: AbortSignal,
  fetchImplementation?: FetchImplementation,
): Promise<VoiceStatus> {
  return parseVoiceStatus(await requestJson('/api/voice/status', { signal, cache: 'no-store' }, fetchImplementation));
}

export interface SttResult {
  text: string;
  language: string;
  durationSeconds: number;
  provider: string;
  model: string | null;
}

export function parseSttResult(value: unknown): SttResult {
  if (!isRecord(value) || typeof value.text !== 'string' || typeof value.language !== 'string'
    || typeof value.durationSeconds !== 'number' || typeof value.provider !== 'string') {
    throw new Error('Invalid STT response');
  }
  return {
    text: value.text,
    language: value.language,
    durationSeconds: value.durationSeconds,
    provider: value.provider,
    model: typeof value.model === 'string' ? value.model : null,
  };
}

/**
 * Transcribe a recording. The server accepts the raw audio body
 * (audio/* or application/octet-stream, no multipart, no field name);
 * MediaRecorder webm/opus goes straight through — ffmpeg transcodes it
 * server-side, so no in-browser conversion is needed.
 */
export async function requestVoiceStt(
  audio: Blob,
  signal?: AbortSignal,
  fetchImplementation?: FetchImplementation,
): Promise<SttResult> {
  return parseSttResult(await requestJson('/api/voice/stt', {
    method: 'POST',
    headers: { 'Content-Type': audio.type || 'audio/webm' },
    body: audio,
    signal,
  }, fetchImplementation));
}

export interface TtsResult {
  audio: Blob;
  durationSeconds: number | null;
  truncated: boolean;
}

/**
 * Synthesize speech. The server strips Markdown before synthesis, so the
 * raw answer text is sent as-is; the caller truncates long answers to
 * VOICE_SPEAK_MAX_CHARS first (see truncateSpeechText). Returns the WAV
 * blob plus the server's duration/truncation headers. Raw fetch (not
 * requestJson) because the response body is audio, same as
 * requestChatStream's SSE body in ./api.ts.
 */
export async function requestVoiceTts(
  text: string,
  signal?: AbortSignal,
  fetchImplementation?: FetchImplementation,
): Promise<TtsResult> {
  signal?.throwIfAborted();
  const requestOptions: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
    signal,
  };
  const response = typeof __AGRIDX_DEV_PREVIEW__ !== 'undefined' && __AGRIDX_DEV_PREVIEW__ && fetchImplementation === fetch
    ? await (await import('../../dev-preview/api')).previewFetch('/api/voice/tts', requestOptions)
    : await (fetchImplementation ?? fetch)('/api/voice/tts', requestOptions);
  signal?.throwIfAborted();
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    signal?.throwIfAborted();
    throw new ApiError(response.status, payload);
  }
  const durationHeader = response.headers.get('X-Audio-Duration-Seconds');
  const durationSeconds = durationHeader === null ? null : Number(durationHeader);
  return {
    audio: await response.blob(),
    durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : null,
    truncated: response.headers.get('X-Audio-Text-Truncated') === '1',
  };
}

/**
 * Cut spoken text at a sentence boundary where possible, mirroring
 * server/voice/stripMarkdown.ts truncateForSpeech (the server applies the
 * same rule at its own 2000-char cap; the web cap is 600).
 */
export function truncateSpeechText(text: string, maxChars: number = VOICE_SPEAK_MAX_CHARS): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  const cut = text.slice(0, maxChars);
  const boundary = Math.max(
    cut.lastIndexOf('。'),
    cut.lastIndexOf('！'),
    cut.lastIndexOf('？'),
    cut.lastIndexOf('；'),
    cut.lastIndexOf('\n'),
  );
  const spoken = (boundary > maxChars * 0.5 ? cut.slice(0, boundary + 1) : cut).trim();
  return { text: spoken, truncated: true };
}

/**
 * Prefer webm/opus (ffmpeg decodes it server-side); fall back to the
 * browser default when nothing listed is supported. The checker is
 * injected so node tests can stub MediaRecorder.isTypeSupported.
 */
export function pickRecordingMimeType(
  isTypeSupported?: (mimeType: string) => boolean,
): string | undefined {
  if (!isTypeSupported) return undefined;
  for (const mimeType of VOICE_PREFERRED_MIME_TYPES) {
    try {
      if (isTypeSupported(mimeType)) return mimeType;
    } catch { /* Treat a throwing checker as unsupported and keep trying. */ }
  }
  return undefined;
}

/** Server `code` from an ApiError payload, if any. */
export function voiceErrorCode(error: unknown): string | undefined {
  if (error instanceof ApiError && isRecord(error.payload) && typeof error.payload.code === 'string') {
    return error.payload.code;
  }
  return undefined;
}

/**
 * One place for every voice failure message. Returns null for aborts
 * (user stopped / navigated away), which must stay silent. Server codes
 * are kept in parentheses so a failure can be traced back to the API.
 */
export function describeVoiceError(error: unknown): string | null {
  if (error instanceof DOMException) {
    if (error.name === 'AbortError') return null;
    if (error.name === 'NotAllowedError') return '麦克风权限被拒绝，请在浏览器地址栏允许麦克风后重试';
    if (error.name === 'NotFoundError') return '没找到麦克风设备，请检查麦克风是否已连接';
    if (error.name === 'NotReadableError') return '麦克风正被其他应用占用，请关闭占用它的应用后重试';
    if (error.name === 'NotSupportedError' || error.name === 'SecurityError') return '当前浏览器或页面不支持录音，请使用最新版 Chrome 或 Edge 并通过 HTTPS 访问';
    return '录音失败，请稍后重试';
  }
  if (error instanceof ApiError) {
    const code = voiceErrorCode(error);
    switch (code) {
      case 'stt_empty': return '没听清，请再说一次';
      case 'voice_audio_too_long': return '录音超过 30 秒上限，请说短一点';
      case 'voice_audio_too_large': return '录音文件过大，请说短一点';
      case 'voice_unsupported_media': return '录音格式不受支持，请换个浏览器再试';
      case 'voice_rate_limited': return '语音请求太频繁，请稍等再试（voice_rate_limited）';
      case 'voice_unavailable': return '语音服务暂不可用，请稍后重试（voice_unavailable）';
      case 'stt_unavailable':
      case 'ffmpeg_unavailable': return `语音识别服务暂不可用，请稍后重试（${code}）`;
      case 'stt_failed':
      case 'ffmpeg_failed':
      case 'tts_unavailable': return `语音处理失败，请稍后重试（${code}）`;
      case 'llm_unavailable': return '智能诊断服务暂时无法连接，请稍后重试（llm_unavailable）';
      case 'bad_request': {
        const message = isRecord(error.payload) && typeof error.payload.error === 'string' && error.payload.error
          ? error.payload.error : '语音请求有误，请重试';
        return code ? `${message}（${code}）` : message;
      }
      case 'not_found': return '语音服务暂不可用（not_found）';
      default: break;
    }
    switch (error.status) {
      case 400: return code ? `语音请求有误，请重试（${code}）` : '语音请求有误，请重试';
      case 413: return '录音超过上限，请说短一点';
      case 415: return '录音格式不受支持，请换个浏览器再试';
      case 429: return '语音请求太频繁，请稍等再试';
      case 502:
      case 503: return code ? `语音服务暂不可用，请稍后重试（${code}）` : '语音服务暂不可用，请稍后重试';
      default: return code ? `语音请求失败，请稍后重试（${code}）` : `语音请求失败，请稍后重试（HTTP ${error.status}）`;
    }
  }
  if (error instanceof TypeError) return '网络连接中断，请检查网络后重试';
  if (error instanceof Error && error.name === 'AbortError') return null;
  return '语音请求失败，请稍后重试';
}

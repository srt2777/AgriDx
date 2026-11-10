import { randomUUID } from 'node:crypto';
import { json, raw, Router, type NextFunction, type Request, type Response } from 'express';
import { DiagnosticInputError, parseDiagnosticRequest } from '../diagnosis/request';
import type { DiagnosticService } from '../diagnosis/service';
import { sameOrigin } from '../memory/routes';
import { VoiceError } from '../voice/errors';
import { DEFAULT_VOICE, resolveVoice, synthesizeWav16k, type AllowedVoice, type SynthesizedSpeech } from '../voice/edgeTts';
import { transcodeToWav16k } from '../voice/ffmpeg';
import { createSttProvider, type SttProvider } from '../voice/stt';
import { stripMarkdownForSpeech, truncateForSpeech } from '../voice/stripMarkdown';

/**
 * Robot voice endpoints (RV0.2.0, server-side only; no firmware change).
 *
 * POST /api/voice/tts  JSON {text, voice?}            -> audio/wav 16kHz mono
 * POST /api/voice/stt  audio/wav body                -> {text, language, ...}
 * POST /api/voice/ask  audio/wav body (+ ?machineType=&brand=&model=)
 *                       -> {question, transcript, answer, audioUrl, ...} in one JSON
 * GET  /api/voice/audio/:id                          -> audio/wav 16kHz mono
 * GET  /api/voice/status                              -> provider/limits
 *
 * Contract for the ESP32 firmware:
 * - Uploads are raw audio bodies (audio/wav, no multipart, no Origin header);
 *   sameOrigin therefore lets MCU requests through exactly like /api/chat.
 * - /ask answers in a single small JSON with an audioUrl; the WAV itself lives
 *   in an in-memory store (5-minute TTL, max 20 entries, oldest evicted first)
 *   and is fetched by a second GET /api/voice/audio/:id. A ~45 s answer is
 *   ~1.44 MB WAV, ~1.9 MB base64 — far too big to hold as JSON + base64 in the
 *   MCU's internal RAM, so /ask never embeds audioBase64. The firmware already
 *   downloads audioUrl with a streaming write into PSRAM; its base64 branch is
 *   kept only as a fallback and is never exercised by this server.
 *   The spoken text is truncated to 600 chars (VOICE_ASK_MAX_TTS_CHARS): a
 *   ~600-char answer synthesizes to ~45 s of audio and the firmware caps
 *   playback at 60 s; the full text answer is still shown on screen, only the
 *   spoken part is cut (audioTextTruncated: true when cut).
 * - Recordings are capped at 30 s / 2 MB; longer audio gets 413.
 */
export const VOICE_MAX_AUDIO_SECONDS = 30;
export const VOICE_MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
export const VOICE_RATE_LIMIT_PER_MINUTE = 10;
export const VOICE_MAX_TTS_CHARS = 2000;
export const VOICE_ASK_MAX_TTS_CHARS = 600;
// Synthesized audio kept for GET /api/voice/audio/:id: 5-minute TTL, max 20
// entries; when full the oldest entry is evicted first.
export const VOICE_AUDIO_TTL_MS = 5 * 60 * 1000;
export const VOICE_AUDIO_MAX_ENTRIES = 20;

export interface StoredVoiceAudio {
  wav: Buffer;
  expiresAt: number;
}

// Exposed so tests can simulate expiry (set expiresAt in the past);
// production code only goes through storeVoiceAudio / takeVoiceAudio.
export const voiceAudioStore = new Map<string, StoredVoiceAudio>();

function storeVoiceAudio(wav: Buffer): string {
  const now = Date.now();
  for (const [id, entry] of voiceAudioStore) {
    if (entry.expiresAt <= now) voiceAudioStore.delete(id);
  }
  while (voiceAudioStore.size >= VOICE_AUDIO_MAX_ENTRIES) {
    const oldest = voiceAudioStore.keys().next().value;
    if (oldest === undefined) break;
    voiceAudioStore.delete(oldest);
  }
  const id = randomUUID();
  voiceAudioStore.set(id, { wav, expiresAt: now + VOICE_AUDIO_TTL_MS });
  return id;
}

export interface VoiceRouteDeps {
  sttProvider?: SttProvider;
  synthesizeWav?: (text: string, voice?: AllowedVoice, maxChars?: number) => Promise<SynthesizedSpeech>;
}

/**
 * Voice gets its own stricter bucket than chat/telemetry: the firmware's
 * telemetry already uses ~13 req/min and each group is capped at 30/min/IP,
 * so voice is limited to 10/min/IP to leave headroom for chat + telemetry.
 */
function createVoiceRateLimiter() {
  const buckets = new Map<string, { count: number; reset: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || 'unknown';
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.reset < now) buckets.delete(key);
    }
    const bucket = buckets.get(ip);
    if (!bucket) buckets.set(ip, { count: 1, reset: now + 60_000 });
    else if (++bucket.count > VOICE_RATE_LIMIT_PER_MINUTE) {
      res.status(429).json({ error: '语音请求过于频繁，请稍后再试', code: 'voice_rate_limited' });
      return;
    }
    next();
  };
}

const audioBody = raw({
  type: (req) => {
    const contentType = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    return contentType.startsWith('audio/') || contentType === 'application/octet-stream';
  },
  limit: VOICE_MAX_UPLOAD_BYTES,
});

function voiceFailure(error: unknown, res: Response): void {
  if (res.headersSent) return;
  if (error instanceof VoiceError) {
    res.status(error.status).json({ code: error.code, error: error.message });
    return;
  }
  if (error instanceof DiagnosticInputError) {
    res.status(400).json({ error: error.message, code: error.code });
    return;
  }
  console.error('[voice] unexpected error:', error);
  res.status(502).json({ error: '语音服务暂时不可用，请稍后重试', code: 'voice_unavailable' });
}

type AsyncHandler = (req: Request, res: Response) => Promise<void>;
function wrap(handler: AsyncHandler) {
  return (req: Request, res: Response) => {
    handler(req, res).catch((error: unknown) => voiceFailure(error, res));
  };
}

/** Normalize an uploaded recording to 16 kHz mono WAV and enforce the 30 s cap. */
async function normalizeUpload(req: Request): Promise<{ wav: Buffer; durationSeconds: number }> {
  const body = req.body as unknown;
  if (!Buffer.isBuffer(body) || body.length === 0) {
    throw new VoiceError(415, 'voice_unsupported_media', '录音请以 audio/wav 原始音频上传');
  }
  const { wav, info } = await transcodeToWav16k(body);
  if (info.durationSeconds > VOICE_MAX_AUDIO_SECONDS) {
    throw new VoiceError(413, 'voice_audio_too_long', `录音超过 ${VOICE_MAX_AUDIO_SECONDS} 秒上限，请说短一点`);
  }
  return { wav, durationSeconds: info.durationSeconds };
}

function machineContextFromQuery(req: Request): Record<string, string> {
  const context: Record<string, string> = {};
  for (const field of ['machineType', 'brand', 'model', 'engineModel'] as const) {
    const value = req.query[field];
    if (typeof value === 'string' && value) context[field] = value;
  }
  return context;
}

export function createVoiceRoutes(diagnose: DiagnosticService, deps: VoiceRouteDeps = {}): Router {
  const router = Router();
  const stt = deps.sttProvider ?? createSttProvider();
  const synth = deps.synthesizeWav ?? synthesizeWav16k;
  // Scope both middlewares to /voice only: this router is mounted at /api,
  // and unscoped router.use() would also rate-limit /api/chat and friends.
  router.use('/voice', createVoiceRateLimiter());
  router.use('/voice', sameOrigin);

  router.get('/voice/status', (_req, res) => {
    res.json({
      sttProvider: stt.name,
      sttModel: stt.model ?? null,
      ttsVoice: DEFAULT_VOICE,
      audioFormat: 'wav16k-mono',
      sampleRateHz: 16000,
      maxAudioSeconds: VOICE_MAX_AUDIO_SECONDS,
      maxUploadBytes: VOICE_MAX_UPLOAD_BYTES,
      rateLimitPerMinute: VOICE_RATE_LIMIT_PER_MINUTE,
      maxTtsChars: VOICE_MAX_TTS_CHARS,
    });
  });

  router.post('/voice/tts', json({ limit: '16kb' }), wrap(async (req, res) => {
    const text = (req.body as { text?: unknown } | undefined)?.text;
    if (typeof text !== 'string' || !text.trim()) {
      throw new VoiceError(400, 'bad_request', '请提供要合成的文本');
    }
    if (text.length > VOICE_MAX_TTS_CHARS) {
      throw new VoiceError(400, 'bad_request', `合成文本过长（上限 ${VOICE_MAX_TTS_CHARS} 字符）`);
    }
    const voice = resolveVoice((req.body as { voice?: unknown }).voice);
    const stripped = stripMarkdownForSpeech(text);
    const { text: spokenText, truncated } = truncateForSpeech(stripped, VOICE_MAX_TTS_CHARS);
    const { wav, info } = await synth(spokenText, voice, VOICE_MAX_TTS_CHARS);
    res.set({
      'Content-Type': 'audio/wav',
      'Cache-Control': 'no-store',
      'X-Audio-Sample-Rate': String(info.sampleRateHz),
      'X-Audio-Duration-Seconds': info.durationSeconds.toFixed(3),
      ...(truncated ? { 'X-Audio-Text-Truncated': '1' } : {}),
    });
    res.send(wav);
  }));

  router.post('/voice/stt', audioBody, wrap(async (req, res) => {
    const { wav, durationSeconds } = await normalizeUpload(req);
    const result = await stt.transcribe(wav);
    if (!result.text) {
      throw new VoiceError(400, 'stt_empty', '未识别到语音内容，请靠近麦克风再说一次');
    }
    res.set('Cache-Control', 'no-store');
    res.json({
      text: result.text,
      language: result.language ?? 'zh',
      durationSeconds,
      provider: stt.name,
      model: stt.model ?? null,
    });
  }));

  router.post('/voice/ask', audioBody, wrap(async (req, res) => {
    const controller = new AbortController();
    const disconnect = () => { if (!res.writableEnded) controller.abort(); };
    req.on('aborted', disconnect);
    res.on('close', disconnect);
    try {
      const { wav, durationSeconds } = await normalizeUpload(req);
      const sttResult = await stt.transcribe(wav);
      const question = sttResult.text;
      if (!question) {
        throw new VoiceError(400, 'stt_empty', '未识别到语音内容，请靠近麦克风再说一次');
      }
      // Reuse the /api/chat diagnosis service directly (stateless, no
      // sessionId/memory); no separate LLM logic is written here.
      const input = parseDiagnosticRequest({
        messages: [{ role: 'user', content: question }],
        ...machineContextFromQuery(req),
      });
      let payload;
      try {
        payload = await diagnose(input, undefined, controller.signal);
      } catch (error) {
        if (error instanceof DiagnosticInputError) throw error;
        console.error('[voice] diagnose failed:', error);
        throw new VoiceError(502, 'llm_unavailable', '智能诊断服务暂时无法连接，请稍后重试');
      }
      const answer = payload?.choices?.[0]?.message?.content;
      if (typeof answer !== 'string' || !answer.trim()) {
        throw new VoiceError(502, 'llm_unavailable', '智能诊断未返回有效回答，请稍后重试');
      }
      // TTS failure must not lose the text answer: return text + audioError.
      // Audio is stored in memory and handed out as an audioUrl (see header
      // comment); /ask never embeds base64 audio.
      let audioUrl: string | null = null;
      let audioDurationSeconds: number | null = null;
      let audioTextTruncated = false;
      let audioError: { code: string; error: string } | null = null;
      try {
        const stripped = stripMarkdownForSpeech(answer);
        const { text: spokenText, truncated } = truncateForSpeech(stripped, VOICE_ASK_MAX_TTS_CHARS);
        const spoken = await synth(spokenText, DEFAULT_VOICE, VOICE_ASK_MAX_TTS_CHARS);
        audioUrl = `/api/voice/audio/${storeVoiceAudio(spoken.wav)}`;
        audioDurationSeconds = spoken.info.durationSeconds;
        audioTextTruncated = truncated || spoken.truncated;
      } catch (error) {
        if (error instanceof VoiceError) {
          audioError = { code: error.code, error: error.message };
        } else {
          console.error('[voice] tts failed in /ask:', error);
          audioError = { code: 'tts_unavailable', error: '语音合成服务暂时不可用，仅显示文字回答' };
        }
      }
      res.set('Cache-Control', 'no-store');
      res.json({
        question,
        transcript: question,
        answer,
        sttProvider: stt.name,
        sttModel: stt.model ?? null,
        questionDurationSeconds: durationSeconds,
        audioUrl,
        audioFormat: 'wav16k-mono',
        audioSampleRateHz: 16000,
        audioDurationSeconds,
        audioTextTruncated,
        audioError,
      });
    } finally {
      req.off('aborted', disconnect);
      res.off('close', disconnect);
    }
  }));

  // Synthesized audio stored by /ask: same rate limit + sameOrigin as the
  // other voice endpoints (both are scoped to /voice above). Expired or
  // unknown ids get 404. Entries are not one-shot: the firmware may retry a
  // failed download within the 5-minute TTL.
  router.get('/voice/audio/:id', (req, res) => {
    const entry = voiceAudioStore.get(req.params.id);
    if (!entry || entry.expiresAt <= Date.now()) {
      if (entry) voiceAudioStore.delete(req.params.id);
      res.status(404).json({ code: 'voice_audio_not_found', error: '语音音频已过期或不存在，请重新提问' });
      return;
    }
    res.set({
      'Content-Type': 'audio/wav',
      'Cache-Control': 'no-store',
      'Content-Length': String(entry.wav.length),
    });
    res.send(entry.wav);
  });

  // Oversized upload bodies arrive here (router-level raw parser), not as a
  // generic 500 from the app error handler.
  router.use((error: Error & { type?: string }, _req: Request, res: Response, next: NextFunction) => {
    if (error.type === 'entity.too.large') {
      res.status(413).json({ code: 'voice_audio_too_large', error: '录音体积过大（上限 2 MB，约 30 秒）' });
      return;
    }
    next(error);
  });

  return router;
}

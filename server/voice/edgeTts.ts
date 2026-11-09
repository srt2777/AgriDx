import { EdgeTTS } from 'node-edge-tts';
import { VoiceError } from './errors';
import { transcodeToWav16k, type WavInfo } from './ffmpeg';
import { stripMarkdownForSpeech, truncateForSpeech } from './stripMarkdown';

/** Fixed decision (RV0.2.0): male voice 云希. Overrides only within the allowlist. */
export const DEFAULT_VOICE = 'zh-CN-YunxiNeural';
export const ALLOWED_VOICES = ['zh-CN-YunxiNeural', 'zh-CN-XiaoxiaoNeural', 'zh-CN-YunjianNeural', 'zh-CN-YunyangNeural'] as const;
export type AllowedVoice = (typeof ALLOWED_VOICES)[number];

export interface SynthesizedSpeech {
  wav: Buffer;
  info: WavInfo;
  /** Text actually spoken, after Markdown stripping and truncation. */
  spokenText: string;
  truncated: boolean;
}

function isAllowedVoice(value: string): value is AllowedVoice {
  return (ALLOWED_VOICES as readonly string[]).includes(value);
}

export function resolveVoice(value: unknown): AllowedVoice {
  if (value === undefined) return DEFAULT_VOICE;
  if (typeof value === 'string' && isAllowedVoice(value)) return value;
  throw new VoiceError(400, 'bad_request', `不支持的音色，仅支持：${ALLOWED_VOICES.join('、')}`);
}

/**
 * Synthesize with Edge-TTS (Microsoft Edge online TTS, no key) and transcode
 * to 16 kHz mono WAV for the MAX98357A. Throws VoiceError on any failure;
 * callers must surface the error and fall back to text only — never fake audio.
 */
export async function synthesizeWav16k(
  rawText: string,
  voice: AllowedVoice = DEFAULT_VOICE,
  maxChars = 1200,
): Promise<SynthesizedSpeech> {
  const stripped = stripMarkdownForSpeech(rawText);
  if (!stripped) throw new VoiceError(400, 'bad_request', '可合成的文本为空');
  const { text: spokenText, truncated } = truncateForSpeech(stripped, maxChars);
  const mp3 = await synthesizeMp3(spokenText, voice);
  const { wav, info } = await transcodeToWav16k(mp3);
  return { wav, info, spokenText, truncated };
}

async function synthesizeMp3(text: string, voice: AllowedVoice): Promise<Buffer> {
  // The `ws` client does not read proxy env vars on its own; in proxied
  // environments (deploy hosts behind an egress proxy) hand the proxy
  // through explicitly. No proxy env set -> direct connection as before.
  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || undefined;
  const tts = new EdgeTTS({ voice, lang: 'zh-CN', proxy, timeout: 60_000 });
  const chunks: Buffer[] = [];
  try {
    for await (const chunk of tts.streamAudio(text)) {
      if (Buffer.isBuffer(chunk)) chunks.push(chunk);
    }
  } catch (error) {
    console.error('[voice] edge-tts failed:', error instanceof Error ? error.message : String(error));
    throw new VoiceError(502, 'tts_unavailable', '语音合成服务暂时不可用，请稍后重试；已返回文字回答');
  }
  const mp3 = Buffer.concat(chunks);
  if (mp3.length === 0) throw new VoiceError(502, 'tts_unavailable', '语音合成返回空音频，请稍后重试；已返回文字回答');
  return mp3;
}

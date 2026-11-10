import { spawn } from 'node:child_process';
import { VoiceError } from './errors';

/** 16 kHz mono 16-bit PCM WAV: the only audio format the robot plays. */
export const VOICE_SAMPLE_RATE_HZ = 16000;
export const VOICE_CHANNELS = 1;

export interface WavInfo {
  sampleRateHz: number;
  channels: number;
  bitsPerSample: number;
  durationSeconds: number;
}

/** Parse a RIFF/WAVE header (ffmpeg output is a standard 44-byte header). */
export function getWavInfo(wav: Buffer): WavInfo {
  if (wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') {
    throw new VoiceError(502, 'ffmpeg_failed', '语音转码输出不是有效的 WAV 音频');
  }
  let offset = 12;
  let channels = 0;
  let sampleRateHz = 0;
  let bitsPerSample = 0;
  let dataBytes = 0;
  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      channels = wav.readUInt16LE(offset + 10);
      sampleRateHz = wav.readUInt32LE(offset + 12);
      bitsPerSample = wav.readUInt16LE(offset + 22);
    } else if (id === 'data') {
      // ffmpeg writing to a pipe cannot seek back to patch sizes, so it
      // writes 0xFFFFFFFF for the data chunk; derive the size from the buffer.
      dataBytes = size === 0xffffffff ? wav.length - (offset + 8) : size;
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (!channels || !sampleRateHz || !bitsPerSample || !dataBytes) {
    throw new VoiceError(502, 'ffmpeg_failed', '语音转码输出的 WAV 头不完整');
  }
  const bytesPerSecond = (sampleRateHz * channels * bitsPerSample) / 8;
  return { sampleRateHz, channels, bitsPerSample, durationSeconds: dataBytes / bytesPerSecond };
}

function runFfmpeg(args: string[], input: Buffer, timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], { timeout: timeoutMs });
    const chunks: Buffer[] = [];
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        reject(new VoiceError(503, 'ffmpeg_unavailable', '服务器未安装 ffmpeg，语音转码不可用'));
      } else {
        reject(new VoiceError(502, 'ffmpeg_failed', `语音转码失败：${error.message}`));
      }
    });
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else {
        console.error('[voice] ffmpeg failed:', stderr.slice(-500));
        reject(new VoiceError(502, 'ffmpeg_failed', '语音转码失败，请换一段录音重试'));
      }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

/**
 * Transcode any ffmpeg-readable upload (WAV/MP3/PCM from the ESP32) to
 * 16 kHz mono 16-bit PCM WAV. Throws VoiceError, never returns fake audio.
 */
export async function transcodeToWav16k(input: Buffer, timeoutMs = 30_000): Promise<{ wav: Buffer; info: WavInfo }> {
  const wav = await runFfmpeg(
    ['-i', 'pipe:0', '-ar', String(VOICE_SAMPLE_RATE_HZ), '-ac', String(VOICE_CHANNELS),
      '-c:a', 'pcm_s16le', '-f', 'wav', 'pipe:1'],
    input,
    timeoutMs,
  );
  if (wav.length === 0) throw new VoiceError(502, 'ffmpeg_failed', '语音转码输出为空');
  return { wav, info: getWavInfo(wav) };
}

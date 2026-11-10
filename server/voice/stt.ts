import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VoiceError } from './errors';

export interface SttResult {
  text: string;
  language?: string;
}

export interface SttProvider {
  readonly name: string;
  readonly model?: string;
  transcribe(wav16k: Buffer): Promise<SttResult>;
}

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const STT_TIMEOUT_MS = 120_000;

/**
 * Pluggable STT. Selection by env (default faster-whisper):
 * - faster-whisper: local CPU, `pip install faster-whisper`, model auto-downloads
 *   from Hugging Face on first use (tiny ~75 MB). Verified locally, see README.
 * - sensevoice: FunASR iic/SenseVoiceSmall, CPU-capable in principle (234M params,
 *   ~17x realtime on CPU per upstream benchmarks), needs `pip install funasr`
 *   + torch and a ~470 MB model download from ModelScope. Adapter implemented
 *   but NOT verified on this host — deploy host must install + verify first.
 * - stub: test-only. Returns VOICE_STT_STUB_TEXT (or empty -> stt_empty).
 *   Never the default; never returns a real transcript.
 */
export function createSttProvider(env: NodeJS.ProcessEnv = process.env): SttProvider {
  const provider = (env.VOICE_STT_PROVIDER ?? 'faster-whisper').trim().toLowerCase();
  if (provider === 'stub') return new StubSttProvider(env.VOICE_STT_STUB_TEXT ?? '');
  if (provider === 'faster-whisper') {
    return new CommandSttProvider('faster-whisper', env.VOICE_STT_MODEL?.trim() || 'tiny',
      path.join(SCRIPTS_DIR, 'stt_faster_whisper.py'), env);
  }
  if (provider === 'sensevoice') {
    return new CommandSttProvider('sensevoice', 'iic/SenseVoiceSmall',
      path.join(SCRIPTS_DIR, 'stt_sensevoice.py'), env);
  }
  throw new Error(`[voice] unknown VOICE_STT_PROVIDER: ${provider} (faster-whisper | sensevoice | stub)`);
}

class StubSttProvider implements SttProvider {
  readonly name = 'stub';
  constructor(private readonly stubText: string) {}
  async transcribe(): Promise<SttResult> {
    return { text: this.stubText, language: 'zh' };
  }
}

/** Runs a Python sidecar over a temp WAV file; the model runs locally on CPU. */
class CommandSttProvider implements SttProvider {
  constructor(
    public readonly name: string,
    public readonly model: string,
    private readonly script: string,
    private readonly env: NodeJS.ProcessEnv,
  ) {}

  async transcribe(wav16k: Buffer): Promise<SttResult> {
    const tmpFile = path.join(os.tmpdir(), `agridx-voice-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
    await fs.promises.writeFile(tmpFile, wav16k);
    try {
      const stdout = await this.runSidecar(tmpFile);
      let parsed: unknown;
      try {
        parsed = JSON.parse(stdout);
      } catch {
        throw new VoiceError(502, 'stt_failed', '语音识别返回了无法解析的结果');
      }
      const text = typeof (parsed as { text?: unknown })?.text === 'string'
        ? ((parsed as { text: string }).text ?? '').trim()
        : '';
      const language = typeof (parsed as { language?: unknown })?.language === 'string'
        ? (parsed as { language: string }).language
        : undefined;
      return { text, language };
    } finally {
      await fs.promises.unlink(tmpFile).catch(() => {});
    }
  }

  private runSidecar(tmpFile: string): Promise<string> {
    const python = this.env.VOICE_STT_PYTHON?.trim() || 'python3';
    return new Promise((resolve, reject) => {
      const child = spawn(python, [this.script, tmpFile, this.model], { timeout: STT_TIMEOUT_MS });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
      child.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
          reject(new VoiceError(503, 'stt_unavailable', `语音识别不可用：找不到 Python 解释器（${python}），请安装 faster-whisper`));
        } else {
          reject(new VoiceError(502, 'stt_failed', `语音识别失败：${error.message}`));
        }
      });
      child.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
          return;
        }
        console.error(`[voice] stt ${this.name} failed (exit ${code}):`, stderr.slice(-500));
        if (/ModuleNotFoundError|No module named/.test(stderr)) {
          reject(new VoiceError(503, 'stt_unavailable',
            this.name === 'sensevoice'
              ? '语音识别不可用：服务器未安装 funasr，请按 server/voice/README.md 安装后重试'
              : '语音识别不可用：服务器未安装 faster-whisper，请执行 pip install faster-whisper 后重试'));
          return;
        }
        reject(new VoiceError(502, 'stt_failed', '语音识别失败，请换一段录音重试'));
      });
    });
  }
}

import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { after, before, test } from 'node:test';
import type { DiagnosticService } from '../server/diagnosis/service';
import { createVoiceRoutes, voiceAudioStore } from '../server/routes/voice';
import { VoiceError } from '../server/voice/errors';
import { getWavInfo, transcodeToWav16k } from '../server/voice/ffmpeg';
import { createSttProvider, type SttProvider } from '../server/voice/stt';
import { stripMarkdownForSpeech, truncateForSpeech } from '../server/voice/stripMarkdown';
import type { SynthesizedSpeech } from '../server/voice/edgeTts';

process.env.NODE_ENV = 'test';

/** Build a minimal PCM16 WAV in memory (no fixture files, no network). */
function makeWav16k(sampleRateHz: number, seconds: number, freqHz = 440): Buffer {
  const samples = Math.floor(sampleRateHz * seconds);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + samples * 2, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRateHz, 24);
  header.writeUInt32LE(sampleRateHz * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(samples * 2, 40);
  const pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    pcm.writeInt16LE(Math.floor(12000 * Math.sin((2 * Math.PI * freqHz * i) / sampleRateHz)), i * 2);
  }
  return Buffer.concat([header, pcm]);
}

test('stripMarkdownForSpeech removes markers, links and list bullets', () => {
  const out = stripMarkdownForSpeech('**检查**一下\n# 油压\n- 换机油\n[手册](http://x)');
  assert.equal(out, '检查一下 油压 换机油 手册');
});

test('truncateForSpeech cuts at a sentence boundary and flags it', () => {
  const { text, truncated } = truncateForSpeech('第一句。第二句。第三句。', 5);
  assert.equal(truncated, true);
  assert.equal(text, '第一句。');
});

test('getWavInfo reads sample rate and duration from a WAV header', () => {
  const info = getWavInfo(makeWav16k(8000, 2));
  assert.equal(info.sampleRateHz, 8000);
  assert.equal(info.channels, 1);
  assert.equal(info.durationSeconds, 2);
});

test('transcodeToWav16k converts 8 kHz mono to 16 kHz mono', async (t) => {
  let result;
  try {
    result = await transcodeToWav16k(makeWav16k(8000, 1));
  } catch (error) {
    if (error instanceof VoiceError && error.code === 'ffmpeg_unavailable') {
      t.skip('ffmpeg not installed');
      return;
    }
    throw error;
  }
  assert.equal(result.info.sampleRateHz, 16000);
  assert.equal(result.info.channels, 1);
  assert.ok(Math.abs(result.info.durationSeconds - 1) < 0.05);
});

test('createSttProvider stub returns the configured test text', async () => {
  const provider = createSttProvider({ VOICE_STT_PROVIDER: 'stub', VOICE_STT_STUB_TEXT: '你好' });
  assert.equal(provider.name, 'stub');
  assert.equal((await provider.transcribe(makeWav16k(16000, 1))).text, '你好');
});

// ---- HTTP tests against the voice router only, with fake STT/TTS/diagnose. ----

const fakeDiagnose = (async () => ({
  choices: [{ message: { role: 'assistant', content: '**检查**一下油压。' } }],
})) as unknown as DiagnosticService;

const fakeStt: SttProvider = {
  name: 'stub-test',
  model: 'test',
  transcribe: async () => ({ text: '拖拉机启动不了怎么办', language: 'zh' }),
};

let capturedTtsText = '';
function fakeSynth(text: string): Promise<SynthesizedSpeech> {
  capturedTtsText = text;
  const wav = makeWav16k(16000, 1);
  return Promise.resolve({ wav, info: getWavInfo(wav), spokenText: text, truncated: false });
}

function buildApp(synth: (text: string) => Promise<SynthesizedSpeech> = fakeSynth): express.Express {
  const app = express();
  app.set('trust proxy', 1);
  app.use('/api', createVoiceRoutes(fakeDiagnose, { sttProvider: fakeStt, synthesizeWav: synth }));
  return app;
}

let server: http.Server;
let port: number;

before(async () => {
  await new Promise<void>((resolve) => {
    server = buildApp().listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  port = address.port;
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

function requestRaw(requestPath: string, options: {
  method?: string;
  body?: Buffer | string;
  contentType?: string;
  origin?: string;
  forwardedFor?: string;
}): Promise<RawResponse> {
  const body = options.body === undefined
    ? undefined
    : Buffer.isBuffer(options.body) ? options.body : Buffer.from(options.body, 'utf8');
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: '127.0.0.1',
      port,
      path: requestPath,
      method: options.method ?? 'POST',
      agent: false,
      headers: {
        ...(body === undefined ? {} : {
          'Content-Type': options.contentType ?? 'application/json',
          'Content-Length': body.length,
        }),
        ...(options.origin ? { Origin: options.origin } : {}),
        ...(options.forwardedFor ? { 'X-Forwarded-For': options.forwardedFor } : {}),
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    request.on('error', reject);
    if (body !== undefined) request.write(body);
    request.end();
  });
}

function jsonBody(response: RawResponse): Record<string, unknown> {
  return JSON.parse(response.body.toString('utf8')) as Record<string, unknown>;
}

test('GET /voice/status reports the provider and limits', async () => {
  const response = await requestRaw('/api/voice/status', { method: 'GET', forwardedFor: '10.0.0.1' });
  assert.equal(response.status, 200);
  const body = jsonBody(response);
  assert.equal(body.sttProvider, 'stub-test');
  assert.equal(body.sampleRateHz, 16000);
  assert.equal(body.maxAudioSeconds, 30);
  assert.equal(body.rateLimitPerMinute, 10);
});

test('POST /voice/tts returns 16 kHz mono WAV with Markdown stripped', async () => {
  const response = await requestRaw('/api/voice/tts', {
    body: JSON.stringify({ text: '**检查**一下油压。' }),
    forwardedFor: '10.0.0.2',
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers['content-type'], 'audio/wav');
  assert.equal(capturedTtsText, '检查一下油压。');
  const info = getWavInfo(response.body);
  assert.equal(info.sampleRateHz, 16000);
  assert.equal(info.channels, 1);
  assert.ok(info.durationSeconds > 0);
});

test('POST /voice/tts rejects empty and oversized text', async () => {
  const empty = await requestRaw('/api/voice/tts', {
    body: JSON.stringify({ text: '  ' }),
    forwardedFor: '10.0.0.3',
  });
  assert.equal(empty.status, 400);
  const long = await requestRaw('/api/voice/tts', {
    body: JSON.stringify({ text: '啊'.repeat(2001) }),
    forwardedFor: '10.0.0.3',
  });
  assert.equal(long.status, 400);
});

test('POST /voice/tts rejects a cross-site Origin like /api/chat does', async () => {
  const response = await requestRaw('/api/voice/tts', {
    body: JSON.stringify({ text: '你好' }),
    origin: 'https://evil.example',
    forwardedFor: '10.0.0.4',
  });
  assert.equal(response.status, 403);
});

test('POST /voice/stt transcribes an 8 kHz upload after normalization', async () => {
  const response = await requestRaw('/api/voice/stt', {
    body: makeWav16k(8000, 1),
    contentType: 'audio/wav',
    forwardedFor: '10.0.0.5',
  });
  assert.equal(response.status, 200);
  const body = jsonBody(response);
  assert.equal(body.text, '拖拉机启动不了怎么办');
  assert.equal(body.durationSeconds, 1);
});

test('POST /voice/stt rejects a JSON body and a >30 s recording', async () => {
  const wrongType = await requestRaw('/api/voice/stt', {
    body: JSON.stringify({ audio: 'x' }),
    forwardedFor: '10.0.0.6',
  });
  assert.equal(wrongType.status, 415);
  const tooLong = await requestRaw('/api/voice/stt', {
    body: makeWav16k(16000, 31),
    contentType: 'audio/wav',
    forwardedFor: '10.0.0.6',
  });
  assert.equal(tooLong.status, 413);
  assert.equal(jsonBody(tooLong).code, 'voice_audio_too_long');
});

test('POST /voice/ask returns question + transcript + answer + audioUrl (no base64)', async () => {
  const response = await requestRaw(`/api/voice/ask?brand=${encodeURIComponent('纽荷兰')}&model=WORKMASTER25`, {
    body: makeWav16k(8000, 1),
    contentType: 'audio/wav',
    forwardedFor: '10.0.0.7',
  });
  assert.equal(response.status, 200);
  const body = jsonBody(response);
  assert.equal(body.question, '拖拉机启动不了怎么办');
  assert.equal(body.transcript, '拖拉机启动不了怎么办');
  assert.equal(body.answer, '**检查**一下油压。');
  assert.equal(body.audioFormat, 'wav16k-mono');
  assert.equal(body.audioSampleRateHz, 16000);
  // No embedded audio: the MCU cannot hold ~1.9 MB base64 in internal RAM.
  assert.equal('audioBase64' in body, false);
  assert.equal(typeof body.audioUrl, 'string');
  assert.match(body.audioUrl as string, /^\/api\/voice\/audio\/[0-9a-f-]{36}$/);
  assert.equal(body.audioError, null);
  // Follow the audioUrl: it must serve the synthesized WAV.
  const audioResponse = await requestRaw(body.audioUrl as string, {
    method: 'GET',
    forwardedFor: '10.0.0.7',
  });
  assert.equal(audioResponse.status, 200);
  assert.equal(audioResponse.headers['content-type'], 'audio/wav');
  const info = getWavInfo(audioResponse.body);
  assert.equal(info.sampleRateHz, 16000);
  assert.equal(info.channels, 1);
  assert.ok(info.durationSeconds > 0);
});

test('GET /api/voice/audio/:id returns 404 for unknown and expired ids', async () => {
  const unknown = await requestRaw('/api/voice/audio/00000000-0000-0000-0000-000000000000', {
    method: 'GET',
    forwardedFor: '10.0.0.10',
  });
  assert.equal(unknown.status, 404);
  assert.equal(jsonBody(unknown).code, 'voice_audio_not_found');
  // Create a real entry, then expire it via the test-exposed store.
  const ask = await requestRaw('/api/voice/ask', {
    body: makeWav16k(8000, 1),
    contentType: 'audio/wav',
    forwardedFor: '10.0.0.11',
  });
  assert.equal(ask.status, 200);
  const audioUrl = jsonBody(ask).audioUrl as string;
  const id = audioUrl.split('/').pop() as string;
  const entry = voiceAudioStore.get(id);
  assert.ok(entry);
  entry.expiresAt = Date.now() - 1;
  const expired = await requestRaw(audioUrl, { method: 'GET', forwardedFor: '10.0.0.11' });
  assert.equal(expired.status, 404);
  assert.equal(jsonBody(expired).code, 'voice_audio_not_found');
  assert.equal(voiceAudioStore.has(id), false);
});

test('POST /voice/ask still returns the text answer when TTS fails', async () => {
  const failingApp = express();
  failingApp.set('trust proxy', 1);
  failingApp.use('/api', createVoiceRoutes(fakeDiagnose, {
    sttProvider: fakeStt,
    synthesizeWav: async () => {
      throw new VoiceError(502, 'tts_unavailable', '语音合成服务暂时不可用');
    },
  }));
  const failingServer = failingApp.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => failingServer.on('listening', resolve));
  const address = failingServer.address();
  assert.ok(address && typeof address !== 'string');
  try {
    const wav = makeWav16k(8000, 1);
    const response = await new Promise<RawResponse>((resolvePromise, reject) => {
      const request = http.request({
        hostname: '127.0.0.1',
        port: (address as { port: number }).port,
        path: '/api/voice/ask',
        method: 'POST',
        agent: false,
        headers: { 'Content-Type': 'audio/wav', 'Content-Length': wav.length, 'X-Forwarded-For': '10.0.0.8' },
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('error', reject);
        res.on('end', () => resolvePromise({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      });
      request.on('error', reject);
      request.write(wav);
      request.end();
    });
    assert.equal(response.status, 200);
    const body = jsonBody(response);
    assert.equal(body.answer, '**检查**一下油压。');
    assert.equal(body.audioUrl, null);
    assert.equal((body.audioError as { code: string }).code, 'tts_unavailable');
  } finally {
    await new Promise<void>((resolve) => failingServer.close(() => resolve()));
  }
});

test('voice endpoints rate-limit at 10/min per IP', async () => {
  let lastStatus = 0;
  let lastBody: Record<string, unknown> = {};
  for (let i = 0; i < 11; i++) {
    const response = await requestRaw('/api/voice/tts', {
      body: JSON.stringify({ text: '你好' }),
      forwardedFor: '10.0.0.9',
    });
    lastStatus = response.status;
    if (response.headers['content-type']?.includes('application/json')) lastBody = jsonBody(response);
  }
  assert.equal(lastStatus, 429);
  assert.equal(lastBody.code, 'voice_rate_limited');
});

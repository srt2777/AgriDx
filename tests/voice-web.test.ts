import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { ApiError } from '../src/lib/api-client';
import { securityHeaders } from '../server/http/middleware';
import {
  describeVoiceError, pickRecordingMimeType, requestVoiceStt, requestVoiceStatus,
  requestVoiceTts, truncateSpeechText, voiceErrorCode,
  VOICE_MAX_RECORD_SECONDS, VOICE_SPEAK_MAX_CHARS,
} from '../src/features/chat/voice-api';

type FetchStub = (input: string, init?: RequestInit) => Promise<Response>;

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
    blob: async () => new Blob([]),
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function wavResponse(headers: Record<string, string>): Response {
  const wav = new Blob(['RIFFfake-wav-bytes'], { type: 'audio/wav' });
  return {
    ok: true,
    status: 200,
    headers: new Headers(headers),
    json: async () => { throw new Error('not json'); },
    blob: async () => wav,
    text: async () => 'wav',
  } as unknown as Response;
}

function stubFetch(handler: (input: string, init?: RequestInit) => Promise<Response>): FetchStub {
  return ((input: string | URL | Request, init?: RequestInit) => handler(String(input), init)) as unknown as FetchStub;
}

const statusBody = {
  sttProvider: 'faster-whisper', sttModel: 'tiny', ttsVoice: 'zh-CN-YunxiNeural',
  audioFormat: 'wav16k-mono', sampleRateHz: 16000, maxAudioSeconds: 30,
  maxUploadBytes: 2097152, rateLimitPerMinute: 10, maxTtsChars: 2000,
};

test('voice status parses the server capability envelope', async () => {
  const seen: string[] = [];
  const fetchImpl = stubFetch(async (input) => {
    seen.push(input);
    return jsonResponse(200, statusBody);
  });
  const status = await requestVoiceStatus(undefined, fetchImpl);
  assert.equal(seen[0], '/api/voice/status');
  assert.equal(status.sttProvider, 'faster-whisper');
  assert.equal(status.maxAudioSeconds, VOICE_MAX_RECORD_SECONDS);
  assert.equal(status.maxTtsChars, 2000);
  await assert.rejects(requestVoiceStatus(undefined, stubFetch(async () => jsonResponse(200, { sttProvider: 1 }))), /Invalid voice status/);
});

test('STT posts the raw recording body and returns the transcript', async () => {
  let captured: { input: string; init?: RequestInit } | undefined;
  const fetchImpl = stubFetch(async (input, init) => {
    captured = { input, init };
    return jsonResponse(200, { text: '拖拉机水温高怎么办', language: 'zh', durationSeconds: 2.4, provider: 'faster-whisper', model: 'tiny' });
  });
  const audio = new Blob(['fake-opus-bytes'], { type: 'audio/webm;codecs=opus' });
  const result = await requestVoiceStt(audio, undefined, fetchImpl);
  assert.equal(result.text, '拖拉机水温高怎么办');
  assert.equal(captured?.input, '/api/voice/stt');
  assert.equal(captured?.init?.method, 'POST');
  assert.equal((captured?.init?.headers as Record<string, string>)['Content-Type'], 'audio/webm;codecs=opus');
  assert.equal(captured?.init?.body, audio);
});

test('STT failures surface the server code for friendly messages', async () => {
  const failing = (status: number, body: unknown) => stubFetch(async () => jsonResponse(status, body));
  await assert.rejects(
    requestVoiceStt(new Blob(['x'], { type: 'audio/webm' }), undefined, failing(400, { code: 'stt_empty', error: '未识别到语音内容' })),
    (error: unknown) => error instanceof ApiError && error.status === 400 && voiceErrorCode(error) === 'stt_empty',
  );
  await assert.rejects(
    requestVoiceStt(new Blob(['x'], { type: 'audio/webm' }), undefined, failing(429, { code: 'voice_rate_limited', error: 'too many' })),
    (error: unknown) => error instanceof ApiError && voiceErrorCode(error) === 'voice_rate_limited',
  );
  await assert.rejects(
    requestVoiceStt(new Blob(['x'], { type: 'audio/webm' }), undefined, failing(503, { code: 'stt_unavailable', error: 'no stt' })),
    (error: unknown) => error instanceof ApiError && error.status === 503,
  );
});

test('TTS posts JSON text and reads duration/truncation headers', async () => {
  let capturedBody = '';
  const fetchImpl = stubFetch(async (input, init) => {
    capturedBody = String(init?.body ?? '');
    assert.equal(input, '/api/voice/tts');
    assert.equal(init?.method, 'POST');
    return wavResponse({ 'Content-Type': 'audio/wav', 'X-Audio-Sample-Rate': '16000', 'X-Audio-Duration-Seconds': '3.250' });
  });
  const result = await requestVoiceTts('水温高先检查冷却液', undefined, fetchImpl);
  assert.deepEqual(JSON.parse(capturedBody), { text: '水温高先检查冷却液' });
  assert.equal(result.audio.type, 'audio/wav');
  assert.equal(result.durationSeconds, 3.25);
  assert.equal(result.truncated, false);

  const truncated = await requestVoiceTts('很长', undefined, stubFetch(async () => wavResponse({ 'X-Audio-Duration-Seconds': '51.7', 'X-Audio-Text-Truncated': '1' })));
  assert.equal(truncated.truncated, true);
  assert.equal(truncated.durationSeconds, 51.7);

  await assert.rejects(
    requestVoiceTts('x', undefined, stubFetch(async () => jsonResponse(502, { code: 'tts_unavailable', error: 'tts down' }))),
    (error: unknown) => error instanceof ApiError && error.status === 502 && voiceErrorCode(error) === 'tts_unavailable',
  );
});

test('spoken text truncates to 600 chars at a sentence boundary', () => {
  assert.equal(VOICE_SPEAK_MAX_CHARS, 600);
  const short = '水温高。';
  assert.deepEqual(truncateSpeechText(short), { text: short, truncated: false });
  const exact = '水'.repeat(600);
  assert.deepEqual(truncateSpeechText(exact), { text: exact, truncated: false });
  const withBoundary = `${'水温高，先检查冷却液。'.repeat(50)}${'再'.repeat(100)}`;
  assert.ok(withBoundary.length > 600);
  const cut = truncateSpeechText(withBoundary);
  assert.equal(cut.truncated, true);
  assert.ok(cut.text.length <= 600);
  assert.ok(cut.text.endsWith('。'));
  const noBoundary = '拖'.repeat(700);
  const hard = truncateSpeechText(noBoundary);
  assert.equal(hard.truncated, true);
  assert.equal(hard.text.length, 600);
});

test('recording prefers webm/opus and falls back to the browser default', () => {
  assert.equal(pickRecordingMimeType((mime) => mime === 'audio/webm;codecs=opus'), 'audio/webm;codecs=opus');
  assert.equal(pickRecordingMimeType((mime) => mime === 'audio/webm'), 'audio/webm');
  assert.equal(pickRecordingMimeType(() => false), undefined);
  assert.equal(pickRecordingMimeType(), undefined);
});

test('voice errors map to friendly Chinese copy with the server code', () => {
  const apiError = (status: number, code: string) => new ApiError(status, { code, error: 'server text' });
  assert.equal(describeVoiceError(apiError(400, 'stt_empty')), '没听清，请再说一次');
  assert.equal(describeVoiceError(apiError(413, 'voice_audio_too_long')), '录音超过 30 秒上限，请说短一点');
  assert.equal(describeVoiceError(apiError(415, 'voice_unsupported_media')), '录音格式不受支持，请换个浏览器再试');
  assert.equal(describeVoiceError(apiError(429, 'voice_rate_limited')), '语音请求太频繁，请稍等再试（voice_rate_limited）');
  assert.equal(describeVoiceError(apiError(503, 'stt_unavailable')), '语音识别服务暂不可用，请稍后重试（stt_unavailable）');
  assert.equal(describeVoiceError(apiError(502, 'tts_unavailable')), '语音处理失败，请稍后重试（tts_unavailable）');
  assert.equal(describeVoiceError(apiError(429, 'something_new')), '语音请求太频繁，请稍等再试');
  assert.equal(describeVoiceError(new ApiError(500, null)), '语音请求失败，请稍后重试（HTTP 500）');
  assert.equal(describeVoiceError(new TypeError('fetch failed')), '网络连接中断，请检查网络后重试');

  const micError = (name: string) => { const error = new DOMException('denied', name); return error; };
  assert.equal(describeVoiceError(micError('NotAllowedError')), '麦克风权限被拒绝，请在浏览器地址栏允许麦克风后重试');
  assert.equal(describeVoiceError(micError('NotFoundError')), '没找到麦克风设备，请检查麦克风是否已连接');
  assert.equal(describeVoiceError(micError('NotReadableError')), '麦克风正被其他应用占用，请关闭占用它的应用后重试');
  assert.equal(describeVoiceError(micError('AbortError')), null);
  assert.equal(voiceErrorCode(new ApiError(400, null)), undefined);
});

/**
 * The chat page records on this origin: Permissions-Policy must allow the
 * microphone for self, or getUserMedia rejects with NotAllowedError before
 * any recording starts (regression: the header used to be microphone=()).
 * Camera and geolocation stay disabled, and third-party frames stay blocked.
 */
test('security headers allow same-origin microphone for voice input', async () => {
  const app = express();
  app.use(securityHeaders);
  app.get('/', (_req, res) => res.send('ok'));
  const server = await new Promise<http.Server>((resolve) => {
    const started = app.listen(0, '127.0.0.1', () => resolve(started));
  });
  try {
    const port = (server.address() as { port: number }).port;
    const headers = await new Promise<http.IncomingHttpHeaders>((resolve, reject) => {
      http.get({ hostname: '127.0.0.1', port, path: '/', agent: false }, (response) => {
        response.resume();
        response.on('end', () => resolve(response.headers));
      }).on('error', reject);
    });
    const policy = headers['permissions-policy'];
    assert.ok(typeof policy === 'string' && policy.includes('microphone=(self)'), `expected microphone=(self), got ${policy}`);
    assert.ok(policy.includes('camera=()') && policy.includes('geolocation=()'), `camera/geolocation must stay disabled, got ${policy}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

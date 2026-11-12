// 司稼小机器人 RV0.2.0 — 语音模块实现（S3 专用）
// 本文件只在 SIJIA_VOICE_ENABLED=1（S3 环境）时编译；C3 环境下整个文件是空的
// （且 platformio.ini 的 C3 环境用 build_src_filter 排除了本文件，双重保险）。
//
// 硬件链路：INMP441（I2S RX，16kHz 单声道）与 MAX98357A（I2S TX）共用 BCLK/WS，
// 数据线分开；引脚以 include/display_config.h 的当前配置为准，避开原生 USB。
// 实现：ESP-IDF i2s_std 单端口 TX+RX（两路共享时钟），32-bit 槽位：
//   - 录音：INMP441 输出 24-bit 左对齐数据，取 int32 高 16 位作 PCM16；
//   - 播报：PCM16 左移 16 位放进 32-bit 槽位，MAX98357A 按 16-bit 解。
//   - INMP441 的 L/R 脚应接地（左声道输出）；若模块 L/R 接高，
//     下面 VOICE_RX_SLOT_MASK 需改成 I2S_STD_SLOT_RIGHT（目前固定 LEFT）。
// 录音/播报缓冲放 PSRAM（S3 有 8MB；录音 480KB + 音频 1.9MB + 上传体 481KB）。
// 网络与 I2S 全在 voiceTask（core 0）里跑，绝不直接碰 LVGL；
// 结果经 VoiceResult + 互斥量交给主循环，由主循环更新界面（与 netTask 同一模式）。

#if SIJIA_VOICE_ENABLED

#include "voice.h"
#include "display_config.h"
#include "secrets.h"
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <esp_heap_caps.h>
#include <driver/i2s_std.h>
#include <driver/gpio.h>
#include <math.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/semphr.h>

// ---------- 内部常量 ----------
#define VOICE_I2S_PORT I2S_NUM_0
#define VOICE_RX_SLOT_MASK I2S_STD_SLOT_LEFT  // INMP441 左声道（L/R 接地）
#define VOICE_REC_PCM_BYTES ((size_t)VOICE_MAX_RECORD_S * VOICE_SAMPLE_RATE * 2)
#define VOICE_AUDIO_CAP_BYTES ((size_t)VOICE_MAX_AUDIO_S * VOICE_SAMPLE_RATE * 2 + 8192)
#define VOICE_UP_CAP_BYTES (44 + VOICE_REC_PCM_BYTES)
static_assert(VOICE_HTTP_TIMEOUT_MS <= UINT16_MAX, "HTTPClient timeout must fit uint16_t");

#if VOICE_PLAYBACK_ENABLED
static const char *VOICE_ASK_URL = "/api/voice/ask";
#else
static const char *VOICE_ASK_URL = "/api/voice/stt";
#endif
//  // 相对路径，拼在 SIJIA_BASE_URL 后

// ---------- 命令（UI 线程写，voiceTask 读）----------
enum VoiceCmd { CMD_NONE = 0, CMD_START, CMD_STOP_SEND, CMD_STOP_PLAY };
static volatile VoiceCmd g_cmd = CMD_NONE;
static volatile bool g_stopPlayback = false;

// ---------- 状态与结果 ----------
static volatile VoiceState g_state = VOICE_IDLE;
static VoiceResult g_result;
static SemaphoreHandle_t g_resultMutex = nullptr;
static volatile bool g_available = false;  // I2S + 缓冲都就绪才为 true
static uint32_t g_recordStartMs = 0;

// ---------- 缓冲（PSRAM；失败则回退内部 RAM，仍失败则语音不可用）----------
static uint8_t *g_recPcm = nullptr;    // 录音 PCM16（最长 15 秒）
static size_t g_recLen = 0;
static uint8_t *g_upBody = nullptr;    // 上传体：44 字节 WAV 头 + PCM（raw audio/wav）
static uint8_t *g_audio = nullptr;     // 下载的 WAV 音频（最长 60 秒）
static size_t g_audioLen = 0;
static constexpr size_t VOICE_STAGE_SAMPLES = 512;
static int32_t g_rxStage[VOICE_STAGE_SAMPLES];  // 32 ms at 16 kHz; preserve internal RAM for TLS.
static int32_t g_txStage[VOICE_STAGE_SAMPLES];

// ---------- I2S 句柄 ----------
static i2s_chan_handle_t g_txChan = nullptr;
static i2s_chan_handle_t g_rxChan = nullptr;
static uint32_t g_txRateHz = VOICE_SAMPLE_RATE;  // 当前 TX 时钟（按音频采样率重配）

static uint8_t *voiceAlloc(size_t n) {
  uint8_t *p = (uint8_t *)heap_caps_malloc(n, MALLOC_CAP_SPIRAM);
  if (!p) p = (uint8_t *)malloc(n);
  return p;
}

static void voicePublishResult(const VoiceResult &r) {
  if (g_resultMutex) xSemaphoreTake(g_resultMutex, portMAX_DELAY);
  g_result = r;
  g_result.ready = true;
  if (g_resultMutex) xSemaphoreGive(g_resultMutex);
}

// ---------- 小工具：小端写 ----------
static void put16le(uint8_t *p, uint16_t v) { p[0] = v & 0xFF; p[1] = (v >> 8) & 0xFF; }
static void put32le(uint8_t *p, uint32_t v) {
  p[0] = v & 0xFF; p[1] = (v >> 8) & 0xFF; p[2] = (v >> 16) & 0xFF; p[3] = (v >> 24) & 0xFF;
}
static uint16_t get16le(const uint8_t *p) { return (uint16_t)p[0] | ((uint16_t)p[1] << 8); }
static uint32_t get32le(const uint8_t *p) {
  return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

// 44 字节 WAV 头（16kHz 单声道 16-bit PCM）。
static void writeWavHeader(uint8_t *p, uint32_t pcmBytes) {
  memcpy(p, "RIFF", 4);
  put32le(p + 4, 36 + pcmBytes);
  memcpy(p + 8, "WAVE", 4);
  memcpy(p + 12, "fmt ", 4);
  put32le(p + 16, 16);
  put16le(p + 20, 1);  // PCM
  put16le(p + 22, 1);  // 单声道
  put32le(p + 24, VOICE_SAMPLE_RATE);
  put32le(p + 28, VOICE_SAMPLE_RATE * 2);
  put16le(p + 32, 2);
  put16le(p + 34, 16);
  memcpy(p + 36, "data", 4);
  put32le(p + 40, pcmBytes);
}

// ---------- WAV 解析（只认 PCM16；别的格式返回 ok=false，走“只显示文字”回落）----------
struct WavInfo {
  bool ok = false;
  uint32_t dataOff = 0, dataLen = 0;
  uint32_t rate = 0;
  int channels = 0;
};
static WavInfo parseWav(const uint8_t *buf, size_t len) {
  WavInfo w;
  if (len < 44 || memcmp(buf, "RIFF", 4) != 0 || memcmp(buf + 8, "WAVE", 4) != 0) return w;
  size_t off = 12;
  bool haveFmt = false, haveData = false;
  while (off + 8 <= len) {
    uint32_t chunkSize = get32le(buf + off + 4);
    if (off + 8 + chunkSize > len) break;
    if (memcmp(buf + off, "fmt ", 4) == 0 && chunkSize >= 16) {
      if (get16le(buf + off + 8) != 1) return w;        // 非 PCM 不播
      w.channels = get16le(buf + off + 10);
      w.rate = get32le(buf + off + 12);
      if (get16le(buf + off + 22) != 16) return w;      // 非 16-bit 不播
      if (w.channels < 1 || w.channels > 2) return w;
      if (w.rate < 8000 || w.rate > 48000) return w;
      haveFmt = true;
    } else if (memcmp(buf + off, "data", 4) == 0) {
      w.dataOff = (uint32_t)(off + 8);
      w.dataLen = chunkSize;
      haveData = true;
    }
    off += 8 + chunkSize + (chunkSize & 1);  // chunk 按偶数对齐
  }
  w.ok = haveFmt && haveData && w.dataOff + w.dataLen <= len;
  return w;
}

// ---------- base64 解码（容忍服务端返回 audioBase64；约定首选 audioUrl）----------
static int b64Val(char c) {
  if (c >= 'A' && c <= 'Z') return c - 'A';
  if (c >= 'a' && c <= 'z') return c - 'a' + 26;
  if (c >= '0' && c <= '9') return c - '0' + 52;
  if (c == '+') return 62;
  if (c == '/') return 63;
  return -1;
}
static size_t base64Decode(const char *in, size_t inLen, uint8_t *out, size_t outCap) {
  size_t o = 0;
  int acc = 0, nbits = 0;
  for (size_t i = 0; i < inLen; i++) {
    char c = in[i];
    if (c == '=') break;
    int v = b64Val(c);
    if (v < 0) continue;  // 跳过空白/换行
    acc = (acc << 6) | v;
    nbits += 6;
    if (nbits >= 8) {
      nbits -= 8;
      if (o >= outCap) return 0;  // 超出上限：整段丢弃，不播残缺音频
      out[o++] = (uint8_t)((acc >> nbits) & 0xFF);
    }
  }
  return o;
}

// ---------- I2S ----------
// 单端口 TX+RX：两路共享 BCLK/WS（ESP-IDF 要求同一端口的两路时钟配置一致）。
static bool voiceI2sBegin() {
  i2s_chan_config_t chanCfg = I2S_CHANNEL_DEFAULT_CONFIG(VOICE_I2S_PORT, I2S_ROLE_MASTER);
  // TX supplies the shared clock during RX recording; send silence on underflow.
  chanCfg.auto_clear_after_cb = true;
  esp_err_t err = i2s_new_channel(&chanCfg, &g_txChan, &g_rxChan);
  if (err != ESP_OK) {
    Serial.printf("[语音] I2S 建通道失败：%s\n", esp_err_to_name(err));
    return false;
  }
  i2s_std_config_t txCfg = {
    .clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(VOICE_SAMPLE_RATE),
    .slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_32BIT, I2S_SLOT_MODE_MONO),
    .gpio_cfg = {
      .mclk = GPIO_NUM_NC,
      .bclk = (gpio_num_t)PIN_I2S_BCLK,
      .ws = (gpio_num_t)PIN_I2S_WS,
      .dout = (gpio_num_t)PIN_I2S_DOUT,
      .din = (gpio_num_t)PIN_I2S_DIN,
      .invert_flags = { .mclk_inv = false, .bclk_inv = false, .ws_inv = false },
    },
  };
  i2s_std_config_t rxCfg = {
    .clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(VOICE_SAMPLE_RATE),
    .slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_32BIT, I2S_SLOT_MODE_MONO),
    .gpio_cfg = {
      .mclk = GPIO_NUM_NC,
      .bclk = (gpio_num_t)PIN_I2S_BCLK,
      .ws = (gpio_num_t)PIN_I2S_WS,
      .dout = (gpio_num_t)PIN_I2S_DOUT,
      .din = (gpio_num_t)PIN_I2S_DIN,
      .invert_flags = { .mclk_inv = false, .bclk_inv = false, .ws_inv = false },
    },
  };
  // 录音只用左声道（INMP441 L/R 接地）；播报同样左声道单声道。
  txCfg.slot_cfg.slot_mask = VOICE_RX_SLOT_MASK;
  rxCfg.slot_cfg.slot_mask = VOICE_RX_SLOT_MASK;
  err = i2s_channel_init_std_mode(g_txChan, &txCfg);
  if (err != ESP_OK) {
    Serial.printf("[语音] I2S TX 初始化失败：%s\n", esp_err_to_name(err));
    return false;
  }
  err = i2s_channel_init_std_mode(g_rxChan, &rxCfg);
  if (err != ESP_OK) {
    Serial.printf("[语音] I2S RX 初始化失败：%s\n", esp_err_to_name(err));
    return false;
  }
  // INMP441 SD is high-impedance outside its slot. An unconnected wire must
  // settle low rather than generate floating-input noise that looks like speech.
  gpio_set_pull_mode((gpio_num_t)PIN_I2S_DIN, GPIO_PULLDOWN_ONLY);
  return true;
}

// Full-duplex RX is a slave of TX's shared clock in ESP-IDF. Keep BOTH
// channel clock configurations equal and always restore 16 kHz for recording.
static bool voiceSetClock(uint32_t rate) {
  if (rate == g_txRateHz) return true;
  i2s_std_clk_config_t clkCfg = I2S_STD_CLK_DEFAULT_CONFIG(rate);
  esp_err_t tx = i2s_channel_reconfig_std_clock(g_txChan, &clkCfg);
  esp_err_t rx = i2s_channel_reconfig_std_clock(g_rxChan, &clkCfg);
  if (tx != ESP_OK || rx != ESP_OK) {
    g_txRateHz = 0;  // A partial change must be retried, never mistaken for the old rate.
    Serial.printf("[voice] I2S clock reconfiguration failed: TX=%s RX=%s\n",
                  esp_err_to_name(tx), esp_err_to_name(rx));
    return false;
  }
  g_txRateHz = rate;
  return true;
}

static bool voiceStartReceive() {
  if (!voiceSetClock(VOICE_SAMPLE_RATE)) return false;
  // Clear every queued TX buffer so a previous spoken answer cannot briefly
  // repeat through the speaker while starting the microphone clock.
  memset(g_txStage, 0, sizeof(g_txStage));
  for (unsigned i = 0; i < 8; ++i) {
    size_t loaded = 0;
    if (i2s_channel_preload_data(g_txChan, g_txStage, sizeof(g_txStage), &loaded) != ESP_OK) return false;
    if (loaded < sizeof(g_txStage)) break;
  }
  if (i2s_channel_enable(g_txChan) != ESP_OK) return false;
  if (i2s_channel_enable(g_rxChan) != ESP_OK) {
    i2s_channel_disable(g_txChan);
    return false;
  }
  return true;
}

// ---------- 上传 ----------
// 约定：raw audio/wav 体（44 字节 WAV 头 + PCM16），Content-Type: audio/wav，
// 不带 sessionId。语音接口接受 raw 音频，multipart 会被 415 拒绝。
// 返回 true 且 respBody 非空表示拿到服务端 JSON；
// 只有尚未建立连接时重试一次，避免重复提交已经发出的录音。
static bool voiceUploadOnce(const uint8_t *body, size_t bodyLen, String &respBody, bool &retryable) {
  retryable = true;
  WiFiClientSecure client;
  client.setHandshakeTimeout(10);
  client.setInsecure();  // 演示终端：跳过证书校验（与 /api/chat 同一取舍）
  HTTPClient http;
  http.setConnectTimeout(10000);
  http.begin(client, String(SIJIA_BASE_URL) + VOICE_ASK_URL);
  // 注意：不要加 Origin 头；HTTPClient 默认不发，正好通过正式站同源检查。
  http.addHeader("Content-Type", "audio/wav");
  http.setTimeout(VOICE_HTTP_TIMEOUT_MS);
  const uint32_t started = millis();
  int code = http.POST(const_cast<uint8_t *>(body), bodyLen);
  Serial.printf("[voice] %s HTTP=%d upload_and_stt_ms=%lu bytes=%u\n", VOICE_ASK_URL, code, (unsigned long)(millis() - started), (unsigned)bodyLen);
  if (code != 200) {
    // The STT server may already have processed this audio. In particular,
    // a 502 or a read timeout must not silently repeat a slow recognition.
    retryable = code == HTTPC_ERROR_CONNECTION_REFUSED;
    http.end();
    return false;  // voiceUpload checks whether a connection was established.
  }
  respBody = http.getString();
  http.end();
  return respBody.length() > 0;
}

static bool voiceUpload(const uint8_t *body, size_t bodyLen, String &respBody) {
  bool retryable = true;
  if (voiceUploadOnce(body, bodyLen, respBody, retryable)) return true;
  if (!retryable) return false;
  delay(1000);
  return voiceUploadOnce(body, bodyLen, respBody, retryable);
}

// ---------- 音频下载（audioUrl；相对路径时拼正式站地址）----------
static bool voiceDownloadAudio(const String &url, size_t &outLen) {
  String full = url;
  if (full.startsWith("/")) full = String(SIJIA_BASE_URL) + full;
  WiFiClientSecure client;
  client.setHandshakeTimeout(10);
  client.setInsecure();
  HTTPClient http;
  http.setConnectTimeout(10000);
  http.begin(client, full);
  http.setTimeout(30000);
  int code = http.GET();
  Serial.printf("[语音] GET 音频 → HTTP %d（%s）\n", code, full.c_str());
  if (code != 200) {
    http.end();
    return false;
  }
  int total = http.getSize();  // -1 表示 chunked，未知长度
  if (total > (int)VOICE_AUDIO_CAP_BYTES) {
    Serial.printf("[语音] 音频过大（%d 字节 > 上限），放弃播报，只显示文字\n", total);
    http.end();
    return false;
  }
  WiFiClient *stream = http.getStreamPtr();
  size_t got = 0;
  uint32_t t0 = millis();
  while (http.connected() && (total < 0 || got < (size_t)total) && got < VOICE_AUDIO_CAP_BYTES) {
    size_t avail = stream->available();
    if (avail > 0) {
      size_t want = avail;
      if (total > 0 && got + want > (size_t)total) want = (size_t)total - got;
      if (got + want > VOICE_AUDIO_CAP_BYTES) want = VOICE_AUDIO_CAP_BYTES - got;
      int n = stream->readBytes(g_audio + got, want);
      if (n <= 0) break;
      got += (size_t)n;
      t0 = millis();  // 收到数据就重置无数据超时（总时长不限，只限停滞）
    } else {
      if (millis() - t0 > 30000) break;  // 30 秒没数据就放弃
      delay(10);
    }
  }
  http.end();
  if (got == 0) return false;
  outLen = got;
  return true;
}

// ---------- 播报 ----------
// 从 g_audio 播 WAV；返回 true 表示完整播完，false 表示被打断或播报失败。
// 中途点屏（voiceStopPlayback）或 BOOT 再按都会在下一个 chunk 边界停下。
static bool voicePlayAudio() {
  WavInfo w = parseWav(g_audio, g_audioLen);
  if (!w.ok) {
    Serial.println("[语音] 音频不是合法 PCM16 WAV，放弃播报，只显示文字");
    return false;
  }
  // Reject failed clock changes rather than play at the wrong speed. RX and TX
  // share clock settings; the next recording restores both to 16 kHz.
  if (!voiceSetClock(w.rate)) return false;
  if (i2s_channel_enable(g_txChan) != ESP_OK) {
    Serial.println("[语音] I2S TX 使能失败，放弃播报");
    return false;
  }
  const int16_t *pcm = (const int16_t *)(g_audio + w.dataOff);
  size_t frames = w.dataLen / 2 / (size_t)w.channels;  // 每帧 = 各声道一个采样
  bool finished = true;
  size_t i = 0;
  while (i < frames) {
    if (g_stopPlayback) { finished = false; break; }
    size_t chunk = frames - i > VOICE_STAGE_SAMPLES ? VOICE_STAGE_SAMPLES : frames - i;
    for (size_t k = 0; k < chunk; k++) {
      int32_t s;
      if (w.channels == 2) {
        s = ((int32_t)pcm[(i + k) * 2] + (int32_t)pcm[(i + k) * 2 + 1]) / 2;  // 立体声下混单声道
      } else {
        s = pcm[i + k];
      }
      float g = (float)s * VOICE_PLAYBACK_GAIN;
      if (g > 32767.0f) g = 32767.0f;
      if (g < -32768.0f) g = -32768.0f;
      g_txStage[k] = (int32_t)((int16_t)g) * 65536;  // Avoid shifting a negative signed value.
    }
    size_t written = 0;
    esp_err_t err = i2s_channel_write(g_txChan, g_txStage, chunk * 4, &written,
                                      1000);  // IDF API takes milliseconds, not FreeRTOS ticks.
    if (err != ESP_OK || written != chunk * 4) {
      Serial.printf("[语音] I2S 写失败：%s\n", esp_err_to_name(err));
      finished = false;
      break;
    }
    i += chunk;
  }
  i2s_channel_disable(g_txChan);
  Serial.printf("[语音] 播报%s（%lu 帧，%lu Hz）\n", finished ? "完成" : "被打断",
                (unsigned long)frames, (unsigned long)w.rate);
  return finished;
}

// ---------- 一次语音问答全流程（在 voiceTask 里跑；阻塞是预期的）----------
static void voiceRunOnce() {
  // --- 1. 录音 ---
  g_state = VOICE_RECORDING;
  g_recordStartMs = millis();
  g_recLen = 0;
  g_stopPlayback = false;
  if (!voiceStartReceive()) {
    Serial.println("[语音] I2S RX 使能失败");
    VoiceResult r;
    r.error = "麦克风启动失败";
    voicePublishResult(r);
    g_state = VOICE_IDLE;
    return;
  }
  Serial.println("[语音] 开始录音（松开按钮发送，最长 15 秒）");
  while (true) {
    if (g_cmd == CMD_STOP_SEND) { g_cmd = CMD_NONE; break; }
    uint32_t elapsed = millis() - g_recordStartMs;
    if (elapsed >= (uint32_t)VOICE_MAX_RECORD_S * 1000) {
      Serial.println("[语音] 录音到 15 秒上限，自动停止并发送");
      break;
    }
    size_t bytesRead = 0;
    esp_err_t err = i2s_channel_read(g_rxChan, g_rxStage, sizeof(g_rxStage),
                                     &bytesRead, 100);  // IDF timeout is milliseconds.
    // A 512-sample read needs 32 ms at 16 kHz. Even on a timeout, keep a
    // legitimate partial block instead of dropping captured samples.
    if (bytesRead == 0) continue;
    if (err != ESP_OK && err != ESP_ERR_TIMEOUT) break;
    size_t samples = bytesRead / 4;  // 每个采样 4 字节（32-bit 槽位）
    size_t room = (VOICE_REC_PCM_BYTES - g_recLen) / 2;
    if (samples > room) samples = room;
    int16_t *dst = (int16_t *)(g_recPcm + g_recLen);
    for (size_t k = 0; k < samples; k++) dst[k] = (int16_t)(g_rxStage[k] >> 16);
    g_recLen += samples * 2;
    if (g_recLen >= VOICE_REC_PCM_BYTES) break;
  }
  i2s_channel_disable(g_rxChan);
  i2s_channel_disable(g_txChan);
  uint32_t recMs = millis() - g_recordStartMs;
  Serial.printf("[语音] 录音结束：%lu ms，%u 字节 PCM\n", (unsigned long)recMs,
                (unsigned)g_recLen);
  if (recMs < VOICE_MIN_RECORD_MS ||
      g_recLen < (size_t)VOICE_SAMPLE_RATE * 2 * VOICE_MIN_RECORD_MS / 1000) {
    VoiceResult r;
    r.error = g_recLen ? "录音太短" : "麦克风没有数据，请检查接线";
    voicePublishResult(r);
    g_state = VOICE_IDLE;
    return;
  }

  // Only signal metrics are logged: never raw samples, transcripts or audio.
  const int16_t *recorded = (const int16_t *)g_recPcm;
  const size_t sampleCount = g_recLen / sizeof(int16_t);
  int64_t sum = 0;
  uint64_t sumSquares = 0;
  uint32_t peak = 0, nonzero = 0;
  int32_t minimum = 32767, maximum = -32768;
  for (size_t i = 0; i < sampleCount; ++i) {
    const int32_t value = recorded[i];
    const uint32_t absolute = value < 0 ? (uint32_t)-value : (uint32_t)value;
    if (absolute > peak) peak = absolute;
    if (value != 0) ++nonzero;
    if (value < minimum) minimum = value;
    if (value > maximum) maximum = value;
    sum += value;
    sumSquares += (uint64_t)((int64_t)value * value);
  }
  const double mean = (double)sum / sampleCount;
  const double meanSquare = (double)sumSquares / sampleCount;
  const double rms = sqrt(meanSquare);
  const double acRms = sqrt(fmax(0.0, meanSquare - mean * mean));
  Serial.printf("[voice] samples=%lu peak=%lu rms=%.2f ac_rms=%.2f nonzero=%lu/%lu\n",
                (unsigned long)sampleCount, (unsigned long)peak, rms, acRms,
                (unsigned long)nonzero, (unsigned long)sampleCount);
  if (!nonzero || peak < VOICE_MIN_PEAK_PCM16 ||
      acRms < VOICE_MIN_RMS_PCM16 || maximum - minimum < VOICE_MIN_PEAK_PCM16) {
    VoiceResult r;
    r.error = "没有录到声音，请检查麦克风";
    voicePublishResult(r);
    g_state = VOICE_IDLE;
    return;
  }

  // --- 2. 组装 raw WAV 上传体（44 字节头 + PCM），上传 ---
  g_state = VOICE_THINKING;
  writeWavHeader(g_upBody, (uint32_t)g_recLen);
  memcpy(g_upBody + 44, g_recPcm, g_recLen);
  size_t bodyLen = 44 + g_recLen;

  String respBody;
  if (WiFi.status() != WL_CONNECTED || !voiceUpload(g_upBody, bodyLen, respBody)) {
    Serial.println("[语音] 上传失败（未联网或服务端无响应）");
    VoiceResult r;
    r.error = "语音发送失败，请检查网络后重试";
    voicePublishResult(r);
    g_state = VOICE_IDLE;
    return;
  }
  JsonDocument doc;
  if (deserializeJson(doc, respBody)) {
    Serial.println("[语音] 服务端返回的 JSON 解析失败");
    VoiceResult r;
    r.error = "服务端返回异常，请重试";
    voicePublishResult(r);
    g_state = VOICE_IDLE;
    return;
  }
  VoiceResult r;
#if !VOICE_PLAYBACK_ENABLED
  // Match the website: transcribe first, then the UI submits the transcript
  // through the normal chat path with the existing multi-turn history.
  r.transcript = doc["text"] | "";
  r.transcript.trim();
  r.ok = r.transcript.length() > 0;
  if (!r.ok) r.error = "未识别到语音，请再说一次";
  g_state = VOICE_IDLE;
  voicePublishResult(r);
  return;
#endif
  r.answer = doc["answer"] | "";
  r.transcript = doc["transcript"] | "";
  if (r.answer.length() == 0) {
    Serial.println("[语音] 服务端未返回文字答案");
    r.error = "服务端未返回答案，请重试";
    voicePublishResult(r);
    g_state = VOICE_IDLE;
    return;
  }
  r.ok = true;

#if !VOICE_PLAYBACK_ENABLED
  // The current unit has a microphone and screen, but no amplifier/speaker.
  // Deliver the answer once immediately after the HTTP response; intentionally
  // disabled playback must not trigger the UI's "audio missing" warning.
  r.audioMissing = false;
  r.audioPlayed = false;
  voicePublishResult(r);
  g_state = VOICE_IDLE;
  return;
#else
  // --- 3. 取音频：首选 audioUrl 下载；其次容忍 audioBase64；都没有则只显示文字 ---
  String audioUrl = doc["audioUrl"] | "";
  String audioB64 = doc["audioBase64"] | "";
  bool haveAudio = false;
  if (audioUrl.length() > 0) {
    haveAudio = voiceDownloadAudio(audioUrl, g_audioLen);
    if (!haveAudio) Serial.println("[语音] 音频下载失败，只显示文字");
  } else if (audioB64.length() > 0) {
    g_audioLen = base64Decode(audioB64.c_str(), audioB64.length(), g_audio,
                              VOICE_AUDIO_CAP_BYTES);
    haveAudio = g_audioLen > 0;
    if (!haveAudio) Serial.println("[语音] base64 音频解码失败，只显示文字");
  } else {
    Serial.println("[语音] 服务端未返回音频（TTS 失败或未启用），只显示文字");
  }
  r.audioMissing = !haveAudio;

  // --- 4. 播报（有音频才进；无音频直接回结果，不编假音频）---
  if (haveAudio) {
    g_state = VOICE_PLAYING;
    g_stopPlayback = false;
    bool played = voicePlayAudio();
    // 被打断也算“播过”（确实出过声）；解析/使能失败则算没播。
    r.audioPlayed = played || g_stopPlayback;
    if (!played && !g_stopPlayback) r.audioMissing = true;
  }
  voicePublishResult(r);
  g_state = VOICE_IDLE;
#endif  // VOICE_PLAYBACK_ENABLED
}

static void voiceTask(void *param) {
  (void)param;
  for (;;) {
    VoiceCmd cmd = g_cmd;
    if (cmd == CMD_START && g_state == VOICE_IDLE) {
      g_cmd = CMD_NONE;
      voiceRunOnce();
    } else {
      // 正忙时的开始请求、播报打断后残留的命令都在这里清掉；
      // 录音中的 CMD_STOP_SEND 由 voiceRunOnce 内部消费，不会走到这里。
      if (cmd != CMD_NONE) g_cmd = CMD_NONE;
      vTaskDelay(pdMS_TO_TICKS(20));
    }
  }
}

// ---------- 对外接口 ----------
void voiceInit() {
  g_resultMutex = xSemaphoreCreateMutex();
  if (!g_resultMutex) {
    Serial.println("[voice] result mutex allocation failed");
    return;
  }
  g_recPcm = voiceAlloc(VOICE_REC_PCM_BYTES);
  g_upBody = voiceAlloc(VOICE_UP_CAP_BYTES);
#if VOICE_PLAYBACK_ENABLED
  g_audio = voiceAlloc(VOICE_AUDIO_CAP_BYTES);
#endif
  if (!g_recPcm || !g_upBody || (VOICE_PLAYBACK_ENABLED && !g_audio)) {
    Serial.println("[语音] 缓冲分配失败（PSRAM/内存不足），语音不可用");
    return;
  }
  if (!voiceI2sBegin()) {
    Serial.println("[语音] I2S 初始化失败，语音不可用");
    return;
  }
#ifdef CONFIG_FREERTOS_UNICORE
  BaseType_t created = xTaskCreate(voiceTask, "sijia-voice", 10240, nullptr, 1, nullptr);
#else
  BaseType_t created = xTaskCreatePinnedToCore(voiceTask, "sijia-voice", 10240, nullptr, 1, nullptr, 0);
#endif
  g_available = created == pdPASS;
  if (!g_available) {
    Serial.println("[voice] task allocation failed");
    return;
  }
  Serial.printf("[语音] 就绪：16kHz 单声道，DIN %d / DOUT %d / BCLK %d / WS %d\n",
                PIN_I2S_DIN, PIN_I2S_DOUT, PIN_I2S_BCLK, PIN_I2S_WS);
}

bool voiceStartRecording() {
  if (!g_available) return false;
  if (WiFi.status() != WL_CONNECTED) return false;
  if (g_state != VOICE_IDLE) return false;
  g_cmd = CMD_START;
  return true;
}

bool voiceStopRecordingAndSend() {
  if (g_state != VOICE_RECORDING) return false;
  g_cmd = CMD_STOP_SEND;
  return true;
}

bool voiceStopPlayback() {
  if (g_state != VOICE_PLAYING) return false;
  g_stopPlayback = true;
  g_cmd = CMD_STOP_PLAY;  // 任务循环里清掉，避免残留命令触发下一轮
  return true;
}

VoiceState voiceGetState() { return g_state; }

uint32_t voiceGetElapsedMs() {
  if (g_state != VOICE_RECORDING) return 0;
  return millis() - g_recordStartMs;
}

bool voiceIsBusy() { return g_state != VOICE_IDLE; }

bool voiceTakeResult(VoiceResult &out) {
  if (g_resultMutex) xSemaphoreTake(g_resultMutex, portMAX_DELAY);
  if (!g_result.ready) {
    if (g_resultMutex) xSemaphoreGive(g_resultMutex);
    return false;
  }
  out = g_result;
  g_result.ready = false;
  if (g_resultMutex) xSemaphoreGive(g_resultMutex);
  return true;
}

#endif  // SIJIA_VOICE_ENABLED

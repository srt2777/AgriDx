// 司稼小机器人 RV0.2.0 — 语音模块（S3 专用）
// 本文件只在 S3 环境编译进固件：platformio.ini 里 S3 环境传 -DSIJIA_VOICE_ENABLED=1，
// C3 两个环境传 -DSIJIA_VOICE_ENABLED=0 且 build_src_filter 排除 src/voice.cpp，
// 所以 C3 固件不含任何语音代码、不增加体积。
//
// 链路（已定决策，不在端侧做 STT/TTS）：
//   录音（INMP441，16kHz 单声道）→ POST /api/voice/ask → 文字 answer + 语音音频
//   → I2S 播 MAX98357A。服务端用 Edge-TTS 云希男声 zh-CN-YunxiNeural 合成语音。
//
// 接口约定（与并行做服务端的同事约定；本固件按此约定实现，见 docs/VOICE.md §2）：
//   上传：raw audio/wav 体（44 字节 WAV 头 + 16kHz 单声道 16-bit PCM，
//         Content-Type: audio/wav）；不带 sessionId
//         （与 PR #245 后的 /api/chat 一致：服务端按 stateless 处理）。
//         服务端只接受 raw 音频，multipart 会被 415 拒绝。
//   返回：JSON，{"answer": "...", "transcript": "..."(可选，识别出的提问文字）,
//         "audioUrl": "https://agridx.xyz/api/voice/audio/<id>"}。
//         首选 audioUrl（固件 GET 下来播；JSON 保持小，省内存）。
//         容忍 audioBase64（base64 编码的 WAV，与 audioUrl 二选一；若服务端
//         先实现 base64 也能播，但约定仍以 audioUrl 为准）。
//   超时：单次 60 秒（HTTPClient 的 timeout 参数是 uint16_t），网络失败重试 1 次；
//         HTTP 4xx 不重试。TTS 失败时服务端只返回 answer、不带音频字段，
//         固件只显示文字，不编假音频、不伪造播报成功。
//
// 状态机（voiceTask 拥有；UI 线程只读状态、只发开始/停止命令，不直接碰 I2S/网络）：
//   IDLE → RECORDING（按住麦克风按钮 / BOOT 长按）→ THINKING（松开，上传中）
//   → PLAYING（有音频则播报）→ IDLE。任一环节失败 → IDLE，并把原因放进结果里。
// 播报中点对话屏可打断（voiceStopPlayback）；录音最长 15 秒，到时自动停并发送；
// 录音短于 0.5 秒视为误触，直接丢弃不发送。
//
// 2026-11-11：正式站 GET /api/voice/status 已返回 200，服务端 /ask 合同已核对。
// 接口可访问不等于录音/播报已通过：INMP441 接线及端到端真机验证仍需实测。

#pragma once

#include <Arduino.h>

// 语音总开关：只在 platformio.ini 的 S3 环境定义为 1；C3 环境为 0 或未定义。
#ifndef SIJIA_VOICE_ENABLED
#define SIJIA_VOICE_ENABLED 0
#endif

#if SIJIA_VOICE_ENABLED

// ---------- 可调参数（改这里，不用改逻辑）----------
#define VOICE_SAMPLE_RATE   16000  // 录音与约定下发的采样率：16kHz 单声道
#define VOICE_MAX_RECORD_S  15     // 最长录音 15 秒（15s × 32KB/s = 480KB，放 PSRAM）
#define VOICE_MIN_RECORD_MS 500    // 短于 0.5 秒视为误触，丢弃不发送
#define VOICE_MAX_AUDIO_S   60     // 最长播报音频 60 秒（60s × 32KB/s ≈ 1.9MB，放 PSRAM）
#define VOICE_HTTP_TIMEOUT_MS 60000   // uint16_t-safe; 120000 would wrap to 54464.
#define VOICE_MIN_RMS_PCM16   4.0     // Reject zero/near-silent or constant disconnected-input data.
#define VOICE_MIN_PEAK_PCM16  16      // Conservative floor; no claim of speech detection.
#define VOICE_PLAYBACK_GAIN 0.85f  // 播报软件增益（防削波；MAX98357A 无音量脚）
#ifndef VOICE_PLAYBACK_ENABLED
#define VOICE_PLAYBACK_ENABLED 0  // 本机只有 INMP441：语音输入后立即显示文字，不下载/空播 TTS。
#endif
// 接好 MAX98357A 和扬声器后可显式设为 1。该可选模式仍沿用“播报结束再交付
// 一次结果”的旧行为，避免主界面重复添加同一回答；默认 0 不等待客户端音频播放。
// 即使为 0，录音时仍需启动静音 TX，为全双工 RX 提供 BCLK/WS。

// ---------- 状态 ----------
enum VoiceState {
  VOICE_IDLE = 0,       // 空闲
  VOICE_RECORDING,      // 录音中（按住说话）
  VOICE_THINKING,       // 已松开：上传录音并等待识别；默认随后交给普通对话流程
  VOICE_PLAYING,        // 播报中（点对话屏可打断）
};

// 一次语音问答的结果（voiceTask 写，主循环取走；取走后 ready 清零）。
struct VoiceResult {
  bool ready = false;
  bool ok = false;            // true：拿到有效识别文字，或可选播报模式的完整答案
  String answer;              // 服务端文字答案（失败时为空）
  String transcript;          // 服务端回传的识别文字（可选；没有就为空）
  bool audioPlayed = false;   // 音频是否实际播报过
  bool audioMissing = false;  // 播报启用但音频失败才为 true；主动关闭播报不是错误。
  String error;               // 失败原因（串口日志 + 屏上 toast 用，不编答案）
};

// ---------- 对外接口（main.cpp 只调这些；I2S/HTTP 细节全在 voice.cpp 内）----------
// 初始化 I2S（INMP441 录 + MAX98357A 播，共用 BCLK/WS）并启动语音任务；setup() 里调一次。
void voiceInit();

// 开始录音：按住说话按下时调；正忙（录音/思考/播报中）或未初始化返回 false。
bool voiceStartRecording();

// 停止录音并发送：按住说话松开时调；不在录音中返回 false。
// 录音过短（<0.5s）时直接丢弃、返回 false；到 15 秒上限时任务会自动停并发送。
bool voiceStopRecordingAndSend();

// 打断播报：播报中点对话屏时调；不在播报中返回 false。
bool voiceStopPlayback();

// 当前状态（主循环轮询，刷新状态行；不加锁读一个 volatile 枚举是安全的）。
VoiceState voiceGetState();

// 录音已进行毫秒数（仅 RECORDING 时有意义，状态行显示“录音中 Ns”用）。
uint32_t voiceGetElapsedMs();

// 语音是否正忙（录音/思考/播报任一状态）；文字问答发起前用它互斥，避免两路并发。
bool voiceIsBusy();

// 取走一份语音结果；没有新结果返回 false（取走后 ready 清零）。
bool voiceTakeResult(VoiceResult &out);

#endif  // SIJIA_VOICE_ENABLED

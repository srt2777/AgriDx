# 司稼小机器人 RV0.2.0 — 语音版（固件部分，S3 专用）

> 状态：**服务端 + 固件已合流（分支 `codex/robot-voice-rv020-20261110`），本地编译
> 与服务端 curl 端到端均通过；未在真机上验证录音/播报。**
> 链路：固件 raw WAV 上传 → 服务端 STT → /api/chat 诊断 → Edge-TTS → `audioUrl`
> 下载播报（接口约定见 §2；服务端说明见 `server/voice/README.md`）。
> 喇叭 4Ω 3W 尚未到货，真机播放目前无法验证（见 §6 未验证清单）。

---

## 1. 链路与分工

```
INMP441 麦克风 ──I2S──▶ ESP32-S3 ──WiFi──▶ POST /api/voice/ask ──▶ 服务端
                                                                     ├─ STT（服务端定）
                                                                     ├─ /api/chat 问答（已有）
                                                                     └─ Edge-TTS 云希男声
                                                                        zh-CN-YunxiNeural
服务端返回：文字 answer + 音频 ──WiFi──▶ ESP32-S3 ──I2S──▶ MAX98357A 功放 ──▶ 喇叭
```

固件**只负责录音上传、下载音频、播放**，不在端侧做 STT/TTS。
音色固定为服务端 Edge-TTS 云希男声 `zh-CN-YunxiNeural`，下发 16kHz 单声道 WAV。

## 2. 接口约定（与服务端同事约定；固件已按此实现）

### 上传：`POST https://agridx.xyz/api/voice/ask`

- 方式：**raw audio/wav**（整段请求体就是一个 WAV 文件：44 字节头 + PCM，
  `Content-Type: audio/wav`）。服务端 `/api/voice/ask` 只接受 raw 音频，
  multipart 会被 415 拒绝，所以固件不再发 multipart。
- 内容：16kHz 单声道 16-bit PCM WAV（固件现场生成 WAV 头 + 录音 PCM）。
- **不带 `sessionId`**：与 PR #245 后的 `/api/chat` 一致，服务端按 stateless 处理，
  多轮靠 `messages` 历史（固件收到文字答案后会把识别文字 + 答案写进同一份历史）。
- 不发 `Origin` 头（与 `/api/chat` 同一原因：正式站同源检查）。
- 超时：单次 120 秒（录音上传 + LLM + TTS 比纯文字问答慢）；传输失败/5xx 重试 1 次，
  HTTP 4xx 不重试。

### 返回：JSON

```json
{
  "answer": "……（文字答案，必填，全文）",
  "transcript": "……（识别出的提问文字；有则固件在对话屏显示用户气泡并写进历史）",
  "audioUrl": "https://agridx.xyz/api/voice/audio/<id>"
}
```

- 音频：**音频 URL**（`audioUrl`，可为绝对地址或以 `/` 开头的相对路径，
  固件 GET 下来播）。选 URL 不选 base64 的原因是：TTS 音频 base64 后塞进 JSON，
  单片机要把上百 KB～1MB 的 JSON 整个读进内存再解码，内存风险大；
  URL 方式下 JSON 保持很小，音频以 4KB 分块流式下载进 PSRAM。
  服务端把合成好的 WAV 存在内存里（5 分钟 TTL、上限 20 条，过期 GET 到 404），
  固件要在拿到 `audioUrl` 后尽快下载。
- 念出来的文字只取答案前 600 字（`audioTextTruncated=true` 时表示截断过，
  实测约 600 字答案合成约 45 秒音频；1200 字会超固件 60 秒播报上限导致整段播不了）；
  **文字答案仍是全文**，只显示在屏幕上，不截断。
- 容忍 `audioBase64`：若服务端返回 `audioBase64` 字段（base64 编码的 WAV），
  固件也能解码播报；但**约定以 `audioUrl` 为准**，当前服务端只返回 `audioUrl`。
- TTS 失败时：服务端只返回 `answer`、不带音频字段即可；固件只显示文字，
  并提示“语音未生成，只显示文字”，**不编假音频、不谎称已播报**。

## 3. 接线（S3，登仕唐 ESP32-S3-N16R8）

| 信号 | S3 引脚 | 说明 |
|---|---|---|
| I2S BCLK | GPIO 17 | INMP441 与 MAX98357A 共用 |
| I2S WS | GPIO 18 | 共用 |
| I2S DIN（麦克风数据入） | GPIO 19（默认）或 38（后备） | 见下 ⚠ |
| I2S DOUT（功放数据出） | GPIO 20（默认）或 47（后备） | 见下 ⚠ |
| INMP441 L/R | 接地 | 左声道输出（固件只读左声道；模块 L/R 接高时需改代码的 `VOICE_RX_SLOT_MASK`） |
| INMP441 VDD / GND | 3V3 / GND | 不要接 5V |
| MAX98357A VIN / GND | 5V / GND | 功放供电走 5V；SD 脚悬空（默认 I2S 模式） |
| MAX98357A 喇叭输出 | 4Ω 3W 喇叭 | 喇叭未到货，待验证 |

> ⚠ **GPIO 19/20 撞 S3 原生 USB**：GPIO 19 = USB D−、GPIO 20 = USB D+。
> 板子到货后必须先确认 Type-C 走哪条路，再决定用默认脚还是后备脚：
> - Type-C 直连原生 USB（D−/D+ 直接进芯片）：19/20 被 USB 占用，I2S 数据线必须改后备脚，
>   否则录音/播报与 USB 串口/烧录互相干扰；
> - 板载桥接芯片（CH340/CP210x 等，Type-C 只走 UART0）：19/20 空闲，用默认脚。
>
> 切换方法（不用改代码）：`platformio.ini` 里 S3 环境加 `-DVOICE_I2S_USE_ALT_PINS=1`，
> 或改 `include/display_config.h` 里 `VOICE_I2S_USE_ALT_PINS` 的默认值；
> 改完重新编译烧录。后备脚 38/47 是 S3 通用 GPIO，换脚后仍需实机验证。

## 4. 用法（屏上操作）

| 操作 | 效果 |
|---|---|
| 对话屏按住绿色“按住说话”按钮 | 开始录音；按钮变“松开发送”，状态行显示“● 录音中 N 秒，松开发送” |
| 松开按钮 | 停止录音并发送；状态行变“语音思考中…”；拿到答案后有音频则播报 |
| 录音满 15 秒 | 自动停止并发送（不用一直按住） |
| 录音短于 0.5 秒就松开 | 视为误触，直接丢弃不发送，提示“录音太短” |
| 播报中点对话屏 | 打断播报（点预设按钮/滑动切页不会误打断） |
| BOOT 键按住 ≥800ms | 开始录音（同时自动切到对话屏），松开发送；短按无动作，防误触 |
| BOOT 键按一下（播报中） | 打断播报；继续按住满 800ms 会接着开始录音 |

- 语音问答与文字问答互斥：语音进行中点预设问题会提示“语音进行中，请稍等”；
  文字问答进行中按麦克风会提示“正在诊断，请稍等”。
- 识别文字（服务端回传 `transcript`）会显示为用户气泡，并与答案一起写进同一份多轮历史，
  追问时与文字问答共用上下文；服务端没回传 `transcript` 时只显示答案气泡，不编造提问文字。
- TTS 失败/无音频/音频损坏时：只显示文字并提示，不编假音频。
- 录音最长 15 秒、播报音频最长 60 秒（超长截断/拒收，只显示文字）。

## 5. 代码结构（只改固件，不改服务端）

| 文件 | 改动 |
|---|---|
| `src/voice.cpp`（新增） | 语音模块全部实现：I2S 录/播、WAV 生成/解析、raw WAV 上传、音频下载、base64 解码、状态机 + voiceTask |
| `include/voice.h`（新增） | 对外接口：`voiceInit / voiceStartRecording / voiceStopRecordingAndSend / voiceStopPlayback / voiceGetState / voiceGetElapsedMs / voiceIsBusy / voiceTakeResult`；状态枚举与 `VoiceResult` |
| `include/display_config.h` | I2S 引脚：BCLK 17、WS 18、DIN/DOUT 默认 19/20、后备 38/47（`VOICE_I2S_USE_ALT_PINS` 切换）+ 19/20 撞原生 USB 的到货确认说明；S3 增加 `PIN_BOOT_BTN 0` |
| `src/main.cpp` | 仅 S3 LVGL 分支：麦克风按钮、语音状态行、播报中点屏打断、BOOT 长按录音、语音/文字互斥、语音结果进对话；C3/OLED 分支未动 |
| `platformio.ini` | S3 环境加 `-DSIJIA_VOICE_ENABLED=1`；C3 两个环境加 `-DSIJIA_VOICE_ENABLED=0` 且 `build_src_filter` 排除 `voice.cpp`（C3 不编语音代码、不增体积） |
| `docs/VOICE.md`（本文件） | 接口约定、接线、用法、验证状态 |

实现要点：

- I2S 用 ESP-IDF `i2s_std` 单端口 TX+RX（两路共享 BCLK/WS），16kHz、32-bit 槽位、
  单声道左声道；录音取 INMP441 的 24-bit 左对齐数据的高 16 位作 PCM16，
  播报把 PCM16 左移 16 位放进 32-bit 槽位；播报软件增益 0.85（防削波，`VOICE_PLAYBACK_GAIN`）。
- 录音/音频/上传体缓冲放 PSRAM（约 480KB + 1.9MB + 480KB，上传体 = 44 字节头 + 录音 PCM）；C3 无 PSRAM 也不启用语音。
- 网络与 I2S 全在 `voiceTask`（core 0）里跑，绝不直接碰 LVGL；
  结果经 `VoiceResult` + 互斥量交给主循环更新界面（与 `netTask` 同一模式）。
- 下发音频采样率与 16kHz 不一致时，固件会重配 TX 时钟再播（8000–48000Hz 接受；
  非 PCM16 或损坏的 WAV 直接放弃播报、只显示文字）。

## 6. 验证状态与未验证清单

本地编译（2026-11-10，PlatformIO 6.2.0，`~/pio-venv/bin/pio`；合流后重编；
编译前在 `include/` 下由 `secrets.h.example` 复制出占位 `secrets.h`，仅供编译，
已在 `.gitignore` 里）：

| 环境 | 结果 | RAM | Flash（ELF） | firmware.bin |
|---|---|---|---|---|
| `esp32-s3-n16r8`（含语音） | SUCCESS（260 秒） | 39.3%（128,720 / 327,680） | 30.3%（1,984,890 / 6,553,600） | 2,016,208 字节 |
| `esp32-c3-devkitm-1`（不含语音） | SUCCESS（211 秒） | 与合流前一致 | 与合流前一致 | 2,005,904 字节 |
| `esp32-c3-devkitm-1-oled`（不含语音） | SUCCESS（105 秒） | 与合流前一致 | 与合流前一致 | 1,665,280 字节 |

S3 比合流前少 864 字节（2,017,072 → 2,016,208，multipart 组装代码删掉所致）；
两个 C3 的 `firmware.bin` 与合流前逐字节一致，C3 不含语音代码的证据：
两个 C3 环境的构建目录里都没有 `src/voice.cpp.o`（只有 S3 有）；
`main.cpp` 里所有语音引用都在 `#if SIJIA_VOICE_ENABLED`（C3 为 0）内；
C3 的 `display_config.h` 一节未动（I2S 引脚只在 S3 定义）。

服务端本地端到端（2026-11-10，本地起服务，`VOICE_STT_PROVIDER=faster-whisper`、
`VOICE_STT_PYTHON=$HOME/.venvs/voice-rv020/bin/python`；本机无 DeepSeek/Gemini key，
回答是知识库-only）：

- `POST /api/voice/tts`「拖拉机发动机启动困难怎么办」→ 200，WAV 16kHz 单声道
  3.0 秒、96,078 字节（2.5 秒）。
- `POST /api/voice/ask`（上传上述 WAV）→ 200，28.1 秒；识别
  `transcript` =「脫拉激發動機啟動困難怎麼辦」（faster-whisper tiny 把简体
  误认成繁体，见下）；文字答案 276 字（知识库-only，明确写了“未配置外部 AI
  密钥，本次没有调用外部模型”）；`audioUrl` =
  `/api/voice/audio/31a1a888-999e-4004-9813-b567c6803402`，`audioDurationSeconds`
  = 51.696，`audioTextTruncated=false`，无 `audioBase64` 字段。
- `GET` 该 `audioUrl` → 200，WAV 16kHz 单声道 51.696 秒、1,654,350 字节。
- `POST /api/voice/stt`（同一 WAV）→ 200，识别文字同上，14.3 秒；
  `POST /api/voice/tts`「你好，我是司稼。」→ 200，WAV 2.4 秒、76,878 字节。

⚠ 实测提醒（供协调员判断，不改本次 600 字上限）：这次 276 字答案合成
51.7 秒音频（约 0.19 秒/字，含列表停顿），比任务前提“600 字约 45.5 秒”
慢得多；按此语速 600 字答案约 110 秒，会超固件 60 秒播报上限（固件拒收
超大音频、只显示文字）。600 字上限比 1200 字安全，但不能保证任何答案
都在 60 秒内；列表式、带追问的答案尤其慢。是否进一步压低上限或让 TTS
提速，由协调员另定。

未做 / 未验证（不要声称已做）：

- [x] 服务端 `POST /api/voice/ask` 联调——**本地 curl 已做**（见上：录音 WAV
      上传 → 识别 → 回答 → `audioUrl` 下载全通）；但**真机固件 → 真服务端**
      的联调未做（板子在途，固件还没烧过语音版）。
- [ ] 真机录音（INMP441 到货后测：录音电平、底噪、有无杂音）。
- [ ] 真机播报（喇叭 4Ω 3W 未到货，**不要声称已在真机上听过**；到货后测音量、失真、打断）。
- [ ] 默认脚 19/20 与原生 USB 的冲突确认（板子到货后按 §3 确认 Type-C 走线，再定用默认脚还是后备脚）。
- [ ] 后备脚 38/47 实机验证。
- [ ] 端到端：按住说话 → 文字 + 语音同时回来 → 播报 → 点屏打断 → 追问多轮。
- [ ] 弱网/断网下的失败提示（上传超时 120 秒、重试 1 次的表现）。
- [ ] 长答案（>60 秒音频）的截断提示。

## 7. 本地验证命令

```bash
cd robot/firmware/rv0.1.0
# 编译前先在 include/ 下由 secrets.h.example 复制出 secrets.h（占位值即可，仅供编译；
# secrets.h 已在 .gitignore 里，绝不提交；真机联调前再填真实热点）
cp include/secrets.h.example include/secrets.h
~/pio-venv/bin/pio run -e esp32-s3-n16r8
~/pio-venv/bin/pio run -e esp32-c3-devkitm-1
~/pio-venv/bin/pio run -e esp32-c3-devkitm-1-oled
```

# 司稼机器人语音服务端（RV0.2.0）

服务端语音部分，不改固件。链路：ESP32 录音上传 → STT → 复用 `/api/chat`
的诊断服务（`runtime.diagnose`，无 sessionId、无记忆）→ Edge-TTS → 16 kHz
单声道 WAV 下发。

## 端点（挂载于 `/api`，见 `server/app.ts`）

| 端点 | 请求 | 响应 |
| --- | --- | --- |
| `POST /api/voice/tts` | JSON `{text, voice?}`，文本上限 2000 字符 | `audio/wav`（16 kHz 单声道），失败返回 JSON 错误 |
| `POST /api/voice/stt` | 原始音频体 `audio/wav`（或 `application/octet-stream`） | JSON `{text, language, durationSeconds, provider, model}` |
| `POST /api/voice/ask` | 原始音频体；机器信息走 query（`machineType/brand/model/engineModel`） | 一个小 JSON：`{question, transcript, answer, audioUrl, audioFormat: "wav16k-mono", audioSampleRateHz: 16000, audioDurationSeconds, audioTextTruncated, audioError}`，音频另用 `GET /api/voice/audio/:id` 取 |
| `GET /api/voice/audio/:id` | — | `audio/wav`（16 kHz 单声道）；过期/未知 id 返回 404 `voice_audio_not_found` |
| `GET /api/voice/status` | — | provider 与各上限 |

组合端点选 **JSON + 音频 URL 二次取**：`/ask` 只返回小 JSON（含
`audioUrl`），音频由固件再 GET 下来。45 秒回答约 1.44 MB WAV、约 1.9 MB
base64，塞进 JSON 会撑爆单片机内部 RAM，所以 `/ask` 不再返回 `audioBase64`。
合成好的 WAV 存在服务端内存里（5 分钟 TTL、上限 20 条，超了先淘汰最旧的）。

## 固件约定

- 上传不用 multipart、不用 Origin 头（`sameOrigin` 与 `/api/chat` 一致，
  无 Origin 的 MCU 请求直接放行）。
- `/ask` 响应里有 `transcript`（= 识别出的 question，固件显示用户气泡用）
  和 `audioUrl`（相对路径，固件拼上正式站地址后 GET 下载，流式写 PSRAM）。
- TTS 失败时 `/ask` 仍返回 200 + 文字回答，`audioUrl: null`，
  `audioError: {code, error}`；固件只显示文字，**不要编造音频**。
- `/tts` 本身失败返回 502 `{code: "tts_unavailable", ...}`。

## 限流与上限

- 语音端点独立限流 **10 次/分钟/IP**（`server/routes/voice.ts` 内置）。
  固件遥测已占约 13 次/分钟，站内各组上限 30 次/分钟/IP，语音留足余量。
- 录音上限 **30 秒 / 2 MB**，超限 413（`voice_audio_too_long` /
  `voice_audio_too_large`）；TTS 文本上限 2000 字符，`/ask` 回答**念出来
  的部分**截断至 600 字符（句末截断，`audioTextTruncated: true`；实测约
  600 字答案合成约 45 秒音频，1200 字会超固件 60 秒播报上限导致整段播不了），
  文字答案仍全文返回、只显示在屏幕上。
- TTS 文本先过 `stripMarkdownForSpeech`（去 `**`、`#`、列表标记、链接等）
  再合成。

## TTS

Edge-TTS（`rany2/edge-tts`，经 `node-edge-tts` 调用微软 Edge 在线语音，
无 key、无 GPU）。固定男声云希 `zh-CN-YunxiNeural`；`voice` 参数只允许
`zh-CN-YunxiNeural / XiaoxiaoNeural / YunjianNeural / YunyangNeural`。
合成出 MP3 后用系统 `ffmpeg` 转码为 16 kHz 单声道 PCM WAV
（MAX98357A 播放格式）。需要能访问微软 TTS 服务的网络；无网络时
`/tts` 明确报 502，不返回假音频。`ws` 不读代理环境变量，代码会把
`HTTPS_PROXY` / `HTTP_PROXY`（若设置）透传给 Edge-TTS，适用于经出口
代理上网的部署主机；无代理时直连。

## STT（可插拔 provider）

`VOICE_STT_PROVIDER` 选择（默认 `faster-whisper`）：

| provider | 状态 | 部署要求 |
| --- | --- | --- |
| `faster-whisper`（默认，模型 `tiny`） | **本地已验证闭环**（2026-11-10，见下） | 部署主机 `pip install faster-whisper`；模型首次使用时从 Hugging Face 自动下载（tiny 约 75 MB）。注意：faster-whisper 1.2.1 与 PyAV ≥15 不兼容（`av.open(metadata_errors=...)` 已移除），本仓库的 sidecar 用 Python 标准库解 WAV 后以 float32 ndarray 传给模型，绕过 PyAV 解码，无需降级 PyAV |
| `sensevoice`（FunASR `iic/SenseVoiceSmall`） | 适配器已写，**未验证、未部署** | 需 `pip install funasr` + torch（数 GB），模型从 ModelScope 下载（约 470 MB fp16）；上游称 CPU 可跑（234M 参数、非自回归，上游基准约 17 倍实时），但本机未安装验证，部署前必须先在目标主机上实测 |
| `stub` | 仅测试用 | 返回 `VOICE_STT_STUB_TEXT`，不产生真实转录；生产禁用 |

相关环境变量：`VOICE_STT_PROVIDER`、`VOICE_STT_MODEL`（默认 `tiny`）、
`VOICE_STT_LANGUAGE`（默认 `zh`）、`VOICE_STT_PYTHON`（Python 解释器路径，
默认 `python3`；本机验证用 venv，见下）。

本地验证（2026-11-10）：`~/.venvs/voice-rv020` 内装 faster-whisper，
`VOICE_STT_PYTHON=$HOME/.venvs/voice-rv020/bin/python`；Edge-TTS 合成的
中文提问音频经 `/api/voice/stt` 实测出文字（详见 PR 说明 / 任务报告）。

## 依赖

只新增一个：`node-edge-tts ^1.2.12`（`package.json`）。ffmpeg、Python
faster-whisper 是系统级依赖，不进 `package.json`。

默认识别进程在首个请求时加载模型，后续请求复用该模型。每个服务进程最多接受一条正在识别和两条等待请求，排队与识别共用 55 秒预算，空闲 5 分钟退出。部署时请提前下载模型，避免首个请求同时等待模型下载。

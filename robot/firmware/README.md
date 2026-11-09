# 固件（firmware）

司稼小机器人固件工程（Arduino + LVGL）。工程与版本对应：子目录注明对应 RV 版本（例如 `firmware/rv0.1.0/`）。

## 当前状态

RV0.1.0 已落地：问答终端 + 监控页面，工程在 [`rv0.1.0/`](rv0.1.0/)（PlatformIO，ESP32-S3 默认环境 + ESP32-C3 过渡环境）。硬件到货（预计 2026-11-10）后联调。

- 工程：`rv0.1.0/`（`platformio.ini`、`src/main.cpp`、`include/display_config.h`）
- 已编译发布：`rv0.1.0/release/`（`firmware.bin`、S3 16MB 合并镜像 `sijia-rv0.1.0-merged-16MB.bin`、C3 4MB 合并镜像 `sijia-rv0.1.0-c3-merged-4MB.bin`、`FLASH_INFO.txt` 含 SHA256 与烧录地址）
- 指南：[`rv0.1.0/docs/ASSEMBLY.md`](rv0.1.0/docs/ASSEMBLY.md)（组装）、[`rv0.1.0/docs/FLASHING.md`](rv0.1.0/docs/FLASHING.md)（烧录与首启）
- 版本规则：[`../VERSIONS.md`](../VERSIONS.md)（RV 版本与项目 4.x、界面 NV/OV 隔离）

注意：release 里的 .bin 是占位 WiFi 编译的，能开机看界面但连不上网；联网须按 FLASHING.md 填好真实 `secrets.h` 重新编译。首次开机前必须先填好真实账号，否则占位值会存进 NVS，之后改 `secrets.h` 重烧也不生效，只能整片擦除重烧。

接口（已实测通路，见各版本方案）：

- 诊断：`POST https://agridx.xyz/api/chat`，请求体 `{"messages": [{"role": "user", "content": "..."}]}`，不要加 Origin 头。
- 遥测：`GET /api/telemetry/scenario`、`GET /api/telemetry/history?channel=X&window=5m|15m|1h`、`GET /api/telemetry/stream`（SSE）。数据为仿真，界面须标明。

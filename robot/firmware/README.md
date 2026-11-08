# 固件（firmware）

司稼小机器人固件工程（Arduino + LVGL）随版本落地后放入本目录。

- 工程与版本对应：子目录或分支注明对应 RV 版本（例如 `firmware/rv0.1.0/`）。
- 当前状态：暂无代码。RV0.1.0 固件（问答终端 + 监控页面）编写中，硬件到货（预计 2026-11-10）后联调。

接口（已实测通路，见各版本方案）：

- 诊断：`POST https://agridx.xyz/api/chat`，请求体 `{"messages": [{"role": "user", "content": "..."}]}`，不要加 Origin 头。
- 遥测：`GET /api/telemetry/scenario`、`GET /api/telemetry/history?channel=X&window=5m|15m|1h`、`GET /api/telemetry/stream`（SSE）。数据为仿真，界面须标明。

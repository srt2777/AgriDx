# 司稼小机器人固件 RV0.1.0

> **2026-11-11 本地 S3 修复版：** 当前三页界面（监测 / 对话 / 联网）、完整 16px 基本汉字字库、模拟 SSE 遥测、常亮显示、INMP441 接线与密码保护 OTA，见 [修复与验收记录](docs/REPAIR-20261111.md)。第二版实机验收仍在进行中。以下 RV0.1.0 说明包含历史设计，其首页、轮询、字库、待机及旧 OTA 描述不代表本次修复后的行为。

ESP32-S3 + 3.2 寸触摸屏的问答终端 + 监控页面。司稼跑在正式站，机器人只做交互终端。

- **问答**：`POST /api/chat`（正式站，不发 Origin 头），预设问题一键提问，多轮带最近 10 条消息；回答约 15–20 秒，界面有“正在诊断…”等待态；回退（本地资料）如实标注，不冒充 AI 回答。
- **监控**：`GET /api/telemetry/history` 每 15 秒轮询水温 / 机油压力 / 转速三通道，`GET /api/telemetry/scenario` 每 60 秒读场景；数据是仿真，页面常驻“模拟数据”标记；阈值（注意/报警）每次从服务器返回的通道信息里读，不硬编码。
- **界面**：原生 LVGL 9，三屏左右滑动（首页 / 对话 / 监控），复刻旧版 UI1.14 浅色风格；DMA 刷新 + PSRAM 双缓冲 + SPI 40MHz，滑动靠局部重绘保持流畅。

## 硬件（与实购清单一致）

| 件 | 型号/说明 |
|---|---|
| 主控 | 登仕唐 ESP32-S3-N16R8（16MB Flash + 8MB PSRAM） |
| 屏幕 | DZYJ 3.2 寸 SPI 触摸屏，ILI9341 320×240 + XPT2046（默认配置档 A） |
| 语音（RV0.2.0 用） | MAX98357A 功放 + INMP441 麦克风（本版固件未接语音） |
| 供电 | 18650 电池模块 + 电池（5V 输出建议 ≥2A；整机峰值约 1.0–1.3A；换 3C 电芯见 docs/ASSEMBLY.md） |

组装、接线、功耗预算、换电池/换屏幕余量：见 [docs/ASSEMBLY.md](docs/ASSEMBLY.md)。
烧录步骤、首启检查、故障排查：见 [docs/FLASHING.md](docs/FLASHING.md)。

## C3 + 3.2 寸触摸屏（原 C3 板，合宙 LuatOS ESP32-C3）

环境 `esp32-c3-devkitm-1-tft`：LVGL TFT UI v2（胶囊翻页指示器、监测小卡片 + 趋势图、
10 秒无操作进待机拖拉机动画），与 S3 的 3.2 寸界面同一套（从 S3 分支选择性移植，
语音与 WiFi 改动原样保留）。编译：`pio run -e esp32-c3-devkitm-1-tft`。

接线（9 根信号线，屏是 ILI9341 320×240 + XPT2046；触摸与显示共用同一组 SPI 总线，
T_CLK 并 SCK、T_DIN 并 MOSI、T_DO 并 MISO）：

| 屏 | 板子 | 说明 |
|---|---|---|
| VCC | 3V3 | **只能接 3V3，绝不能接 5V（已有一块 OLED 接 5V 烧屏）** |
| GND | GND | |
| MOSI | GPIO7 | C3 硬件 SPI2 默认脚；T_DIN 并在这里 |
| MISO | GPIO5 | MISO 默认脚 GPIO2 是 strapping 脚，改用 5；T_DO 并在这里 |
| SCK | GPIO6 | C3 硬件 SPI2 默认脚；T_CLK 并在这里 |
| CS | GPIO4 | |
| DC | GPIO3 | |
| RST | GPIO10 | |
| BL | GPIO1 | 背光，PWM 调光 |
| T_CS | GPIO0 | 触摸片选；GPIO0 是 strapping 脚，烧录进不了下载模式时先拔掉 T_CS 线再烧 |
| T_IRQ | GPIO12 | 触摸中断 |

（上表是 9 根信号线 + VCC/GND 共 11 根接线；OLED 的 GPIO12/13 这块板上不用，T_IRQ 用了 GPIO12，GPIO13 留空。）

注意：

- Flash 必须是 DIO 40MHz（合宙板外置闪存只接了 DIO 两根数据线，QIO 读分区表会出错 `0xfcde`），本环境已配好，不要用旧 C3 过渡环境（默认 QIO）烧这块板。
- 内存：C3 无 PSRAM，LVGL 堆 48KB、绘图双缓冲各 10 行（PARTIAL 渲染）；固件约 2.0MB，分区表 app0 约 2.9MB，放得下。
- WiFi 三组与 OLED 版共用同一套逻辑（优先级 2807 > vivoS30 > 原有，换组先断开）；只烧 `firmware.bin` 到 `0x10000`，不要整片擦除（NVS 里已有 WiFi）。
- 触摸标定是经验值（`display_config.h` 里 `TOUCH_X_MIN/MAX` 等），到货后按实际触摸位置微调。

## 快速开始（PlatformIO）

1. 装 VS Code + PlatformIO 插件（或命令行 `pip install platformio`）。
2. 复制 `include/secrets.h.example` 为 `include/secrets.h`，填 WiFi 名称和密码（不要提交到 GitHub；校园网认证页连不上，用手机热点）。
3. 接线（见 ASSEMBLY.md），USB 连电脑，执行：
   ```
   pio run -t upload
   ```
   首次编译会下载 ESP32 工具链与 LVGL/TFT_eSPI/ArduinoJson/XPT2046 库，约几分钟。
4. 串口监视：`pio device monitor -b 115200`，应看到 `[司稼] 就绪`。

## 直接烧 .bin（不用编译）

`release/` 里是编好的烧录文件（与本版源码同一提交编译）：

```
esptool.py --chip esp32s3 --port COMx --baud 921600 write-flash \
  0x0      release/bootloader.bin \
  0x8000   release/partitions.bin \
  0x10000  release/firmware.bin
```

或直接烧合并镜像（一个文件，0x0 起）：

```
esptool.py --chip esp32s3 --port COMx --baud 921600 write-flash 0x0 release/sijia-rv0.1.0-merged.bin
```

首次烧录后按 EN 复位。地址以本次发布里的 `release/FLASH_INFO.txt` 为准。

## 换屏幕（配置档）

改 `platformio.ini` 里的 `-D` 宏（与 `include/display_config.h` 保持一致），重新编译即可：

| 宏 | 屏幕 |
|---|---|
| `-DSCREEN_PROFILE_ILI9341_320X240`（默认） | 3.2 寸 ILI9341 320×240（实购屏） |
| `-DSCREEN_PROFILE_ILI9488_480X320` | 3.5 寸 ILI9488 480×320 |
| `-DSCREEN_PROFILE_ST7796_320X480` | 3.5 寸 ST7796 320×480 竖屏（需另排界面，预留） |

触摸芯片不同（XPT2046/FT6236/GT911）时要换驱动库；屏幕驱动丝印以到货实物为准，不要凭卖家标题猜。

## 字库

`src/fonts/` 是 `lv_font_conv` 从 Noto Sans CJK SC 生成的子集：

- `font_zh_16.c`（580 字）：界面 + 常用字 + 符号，回答正文用它。
- `font_zh_22.c` / `font_zh_12.c`（208 字）：标题 / 小字，只含界面用字。

回答里出现字库外的生僻字会显示为空白。扩充方法：改 `tools/gen_fonts.py` 里的字符表，跑 `python3 tools/gen_fonts.py` 重新生成（需要系统里有 Noto Sans CJK 字体）。

## 已知限制（RV0.1.0）

- 遥测用 15 秒轮询（SSE 实时流是下一步；正式站每 IP 每分钟限 30 次请求，本固件约 13 次/分钟）。
- 没有屏幕键盘：提问用 4 个预设问题 + 对话页追问芯片；输入法随 RV0.2.0 语音版来。
- 触摸标定是经验值（`display_config.h` 里 `TOUCH_X_MIN/MAX` 等），到货后按实际触摸位置微调。
- HTTPS 用 `setInsecure()` 跳过证书校验（演示终端可接受；不要用它传敏感信息）。
- 表盘量程按正式站仿真配置的固定值（水温 0–140°C、油压 0–800kPa、转速 0–4000rpm）。
- 0.96 寸 OLED 副屏（U8g2）不在本工程里，是独立的显示变体，见方案 §2.3。

## 版本

RV0.1.0，与 `robot/versions/v0.1.0.md` 对应；机器人版本独立编号，不升 AgriDx 项目版本。

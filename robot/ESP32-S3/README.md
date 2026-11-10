# ESP32-S3

司稼小机器人用的两块芯片之一：ESP32-S3（登仕唐 N16R8，16MB Flash + 8MB PSRAM）。S3 是主控、默认环境。

## S3 的两个屏幕

| 屏幕 | 界面 | PlatformIO 环境 | 状态 |
|---|---|---|---|
| [3.2 寸触摸屏](Mac/3.2inch-Touch/)（ILI9341，320×240，XPT2046 触摸） | LVGL 彩色界面（三屏滑动） | `esp32-s3-n16r8`（默认环境） | 可用 |
| [0.96 寸 OLED](Mac/0.96inch-OLED/)（SSD1315，128×64，I2C） | U8g2 黑白界面 | （环境待定） | 规划中，暂不可用 |

3.2 寸触摸屏是 RV0.1.0 的默认组合。0.96 寸 OLED 在 S3 上还没通：SCL 与 TFT_DC（GPIO 9）撞脚，要先移到空闲脚（见 `docs/ASSEMBLY.md` §4.3），对应的 S3 OLED 编译环境也还没进 `platformio.ini`。先用 C3 + 0.96 寸 OLED（[`../ESP32-C3/Mac/0.96inch-OLED/`](../ESP32-C3/Mac/0.96inch-OLED/)）。

## 按电脑分

- [Windows](Windows/)：串口是 COMx，快捷键 Ctrl+Alt+B/U/S，中文路径注意 GBK 报错（见该目录 README）。
- [Mac](Mac/)：串口是 /dev/cu.*，快捷键 Cmd+Option+B/U/S。

两个系统编出来的固件是一样的，只是烧录命令里的串口号和 esptool 写法不同。

## 固件工程（共用）

源码只有一份，在 [`../firmware/rv0.1.0/`](../firmware/rv0.1.0/)（PlatformIO 工程）。上面两个屏幕只是同一个工程的不同编译环境，改代码都在那一个工程里改，不要各处复制。

S3 有 OTA 自动更新（见 `docs/FLASHING.md` §8）。组装、烧录、首启、故障排查：见 [`../firmware/rv0.1.0/docs/FLASHING.md`](../firmware/rv0.1.0/docs/FLASHING.md) 和 [`../firmware/rv0.1.0/docs/ASSEMBLY.md`](../firmware/rv0.1.0/docs/ASSEMBLY.md)。

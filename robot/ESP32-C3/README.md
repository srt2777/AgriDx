# ESP32-C3

司稼小机器人用的两块芯片之一：ESP32-C3（合宙 LuatOS 等 4MB Flash 板子）。C3 是过渡版——先拿它顶着用，S3 到了换回 S3。C3 只是 RV0.1.0 的一个编译变体，不是新版本。

## C3 和 S3 的区别

| 项 | ESP32-C3 | ESP32-S3 |
|---|---|---|
| Flash | 4 MB | 16 MB |
| PSRAM | 无 | 8 MB |
| 核心 | 单核 | 双核 |
| OTA 自动更新 | 无（单 app 分区，升级靠 USB 重烧） | 有 |
| BOOT 键 | GPIO 9 | GPIO 0 |

## C3 的两个屏幕

| 屏幕 | 界面 | PlatformIO 环境 |
|---|---|---|
| [0.96 寸 OLED](Mac/0.96inch-OLED/)（SSD1315，128×64，I2C） | U8g2 黑白界面（状态 / 监测 / 问答三页） | `esp32-c3-devkitm-1-oled` |
| [3.2 寸触摸屏](Mac/3.2inch-Touch/)（ILI9341，320×240，XPT2046 触摸） | LVGL 彩色界面（三屏滑动） | `esp32-c3-devkitm-1` |

0.96 寸 OLED 接线：SDA GPIO 12、SCL GPIO 13（I2C 地址 0x3C）。3.2 寸屏接线见固件工程的 `docs/ASSEMBLY.md`。

## 按电脑分

- [Windows](Windows/)：串口是 COMx，快捷键 Ctrl+Alt+B/U/S，中文路径注意 GBK 报错（见该目录 README）。
- [Mac](Mac/)：串口是 /dev/cu.*，快捷键 Cmd+Option+B/U/S。

两个系统编出来的固件是一样的，只是烧录命令里的串口号和 esptool 写法不同。

## 固件工程（共用）

源码只有一份，在 [`../firmware/rv0.1.0/`](../firmware/rv0.1.0/)（PlatformIO 工程）。上面两个屏幕只是同一个工程的不同编译环境，改代码都在那一个工程里改，不要各处复制。

组装、烧录、首启、故障排查：见 [`../firmware/rv0.1.0/docs/FLASHING.md`](../firmware/rv0.1.0/docs/FLASHING.md) 和 [`../firmware/rv0.1.0/docs/ASSEMBLY.md`](../firmware/rv0.1.0/docs/ASSEMBLY.md)。

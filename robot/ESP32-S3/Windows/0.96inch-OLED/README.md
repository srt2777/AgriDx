# ESP32-S3 + 0.96 寸 OLED · Windows

**状态：规划中，暂不可用。** 这个组合还没有对应的 PlatformIO 编译环境，不要按下面“烧录”那节操作——目前没有可烧的命令。

## 为什么还没通

- S3 上 0.96 寸 OLED 的 SCL（GPIO 9）与 3.2 寸屏的 TFT_DC（GPIO 9）撞脚，接 OLED 前必须把 SCL 移到空闲脚（如 GPIO 7），见 `docs/ASSEMBLY.md` §4.3。
- `platformio.ini` 里还没有 S3 的 OLED 环境（现在只有 C3 的 `esp32-c3-devkitm-1-oled`）。
- S3 的 OLED 适配正在做，等它合进 main 后这里会补上环境名和烧录命令。

## 先用什么

0.96 寸 OLED 现在能用的是 C3 那套：[`../../../ESP32-C3/Windows/0.96inch-OLED/`](../../../ESP32-C3/Windows/0.96inch-OLED/)（环境 `esp32-c3-devkitm-1-oled`，U8g2 黑白界面，SDA GPIO 12 / SCL GPIO 13）。

3.2 寸触摸屏在 S3 上是能用的：[`../3.2inch-Touch/`](../3.2inch-Touch/)（环境 `esp32-s3-n16r8`，默认环境）。

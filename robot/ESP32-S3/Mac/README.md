# ESP32-S3 · Mac

S3 在 Mac 上烧录。固件和 Windows 编出来的一样，只是串口号、esptool 写法和快捷键不同。

## Mac 和 Windows 不一样的地方

| 项 | Mac | Windows |
|---|---|---|
| 串口号 | `/dev/cu.usbserial-*` | `COM3`、`COM4` 这类 |
| 查串口号 | `ls /dev/cu.*`，或 `pio device list` | 设备管理器 → 端口，或 `pio device list` |
| 装 esptool | `pip3 install esptool`，命令用 `esptool.py` 或 `python3 -m esptool` | `py -m pip install esptool`，命令用 `esptool` 或 `py -m esptool` |
| PlatformIO 快捷键 | 编译 `Cmd+Option+B`，上传 `Cmd+Option+U`，串口监视器 `Cmd+Option+S` | 编译 `Ctrl+Alt+B`，上传 `Ctrl+Alt+U`，串口监视器 `Ctrl+Alt+S` |
| PlatformIO 目录 | `~/.platformio` | `%USERPROFILE%\.platformio` |
| 中文路径 | 默认 UTF-8，路径含中文一般也没事 | 中文 Windows 可能触发 GBK 解码报错，见 Windows 目录 README |

串口监视器波特率 115200。烧录与看串口互斥：烧录时先关掉串口监视器。

## 选屏幕

- [3.2 寸触摸屏](3.2inch-Touch/)：LVGL 彩色界面，环境 `esp32-s3-n16r8`（默认环境）。
- [0.96 寸 OLED](0.96inch-OLED/)：规划中，暂不可用。

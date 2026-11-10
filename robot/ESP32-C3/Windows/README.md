# ESP32-C3 · Windows

C3 在 Windows 上烧录。固件和 Mac 编出来的一样，只是串口号、esptool 写法和快捷键不同。

## Windows 和 Mac 不一样的地方

| 项 | Windows | Mac |
|---|---|---|
| 串口号 | `COM3`、`COM4` 这类 | `/dev/cu.usbserial-*` |
| 查串口号 | 设备管理器 → 端口，或 `pio device list` | `ls /dev/cu.*`，或 `pio device list` |
| 装 esptool | `py -m pip install esptool`，命令用 `esptool` 或 `py -m esptool` | `pip3 install esptool`，命令用 `esptool.py` 或 `python3 -m esptool` |
| PlatformIO 快捷键 | 编译 `Ctrl+Alt+B`，上传 `Ctrl+Alt+U`，串口监视器 `Ctrl+Alt+S` | 编译 `Cmd+Option+B`，上传 `Cmd+Option+U`，串口监视器 `Cmd+Option+S` |
| PlatformIO 目录 | `%USERPROFILE%\.platformio` | `~/.platformio` |

## Windows 特别注意：中文路径 GBK 报错

中文 Windows 下，路径里任何一段含中文（如 `C:\Users\中文用户名\...`、TEMP 文件夹）都可能触发 `UnicodeDecodeError: 'gbk' codec can't decode`。永久解决：设环境变量 `PYTHONUTF8=1` 与 `PYTHONIOENCODING=utf-8`（PowerShell：`[System.Environment]::SetEnvironmentVariable('PYTHONUTF8','1','User')`，同理设 `PYTHONIOENCODING` 为 `utf-8`），彻底关掉重开 VS Code 再烧；或把工程移到纯英文路径（如 `C:\sijia\rv0.1.0`）。Mac 默认 UTF-8，没有这个问题。

## 选屏幕

- [0.96 寸 OLED](0.96inch-OLED/)：U8g2 黑白界面，环境 `esp32-c3-devkitm-1-oled`。
- [3.2 寸触摸屏](3.2inch-Touch/)：LVGL 彩色界面，环境 `esp32-c3-devkitm-1`。

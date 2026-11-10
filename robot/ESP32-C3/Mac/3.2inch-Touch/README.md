# ESP32-C3 + 3.2 寸触摸屏 · Mac

**组合**：ESP32-C3（DevKitM-1 等 4MB 板子）+ 3.2 寸触摸屏（ILI9341，320×240，XPT2046 触摸）+ Mac。

**界面**：LVGL 彩色界面，三屏左右滑动（首页 / 对话 / 监控），复刻旧版 UI1.14 浅色风格。

**接线**：MOSI 7、MISO 5、SCK 6、TFT_CS 10、DC 4、RST 3、BL 1、T_CS 0、T_IRQ 11（见 `docs/ASSEMBLY.md` §4.1 C3 表，按自己板子的引脚图核对）。

## 烧录（PlatformIO，推荐）

工程在 [`../../../firmware/rv0.1.0/`](../../../firmware/rv0.1.0/)，环境名 `esp32-c3-devkitm-1`。先按 `docs/FLASHING.md` §1.3 把 `include/secrets.h.example` 复制为 `include/secrets.h` 并填好 WiFi（不要提交到 GitHub）。

```bash
pio run -e esp32-c3-devkitm-1                 # 编译
pio run -e esp32-c3-devkitm-1 -t upload       # 烧录
pio device monitor -b 115200                   # 看串口日志
```

VS Code 里：编译 `Cmd+Option+B`，上传 `Cmd+Option+U`，串口监视器 `Cmd+Option+S`。烧 C3 必须加 `-e esp32-c3-devkitm-1`，不带 `-e` 会按默认的 S3 环境烧，报错 `Wrong chip argument?`。串口一般是 `/dev/cu.usbmodem*`（C3 的 USB CDC）。烧录与看串口互斥：烧录时先关掉串口监视器。

## 直接烧 .bin（不用编译）

烧合并镜像（一个文件，0x0 起，已含 bootloader / 分区表 / boot_app0 / 固件）：

```bash
python3 -m esptool --chip esp32c3 --port /dev/cu.usbmodemXXX --baud 921600 write_flash 0x0 sijia-rv0.1.0-c3-merged-4MB.bin
```

合并镜像在 [`../../../firmware/rv0.1.0/release/`](../../../firmware/rv0.1.0/release/) 下。四个文件分开烧见 `docs/FLASHING.md` §3.1。

## 注意

- C3 是过渡版，没有 OTA，升级靠 USB 重烧；没有 PSRAM，滑动比 S3 卡一点属正常。
- NVS 陷阱：首次开机把 `secrets.h` 写进 NVS，之后只读 NVS。更新固件不要 `erase_flash`；换 WiFi 要整片擦除重烧。
- T_CS 线接在 IO0 上时可能进不了下载模式：先拔掉 T_CS 线再烧。
- BOOT 键是 GPIO 9。烧不进下载模式时按住 BOOT 再按 RESET。

组装、首启检查、故障排查：见 [`../../../firmware/rv0.1.0/docs/FLASHING.md`](../../../firmware/rv0.1.0/docs/FLASHING.md)。

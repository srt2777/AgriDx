# ESP32-S3 + 3.2 寸触摸屏 · Mac

**组合**：ESP32-S3-N16R8（16MB Flash + 8MB PSRAM）+ 3.2 寸触摸屏（ILI9341，320×240，XPT2046 触摸）+ Mac。这是 RV0.1.0 的默认组合。

**界面**：LVGL 彩色界面，三屏左右滑动（首页 / 对话 / 监控），复刻旧版 UI1.14 浅色风格。

**接线**：MOSI 11、MISO 13、SCK 12、TFT_CS 10、DC 9、RST 14、BL 21、T_CS 15、T_IRQ 16（见 `docs/ASSEMBLY.md` §4.1 S3 表）。

## 烧录（PlatformIO，推荐）

工程在 [`../../../firmware/rv0.1.0/`](../../../firmware/rv0.1.0/)，环境名 `esp32-s3-n16r8`（默认环境，不加 `-e` 就是它）。先按 `docs/FLASHING.md` §1.3 把 `include/secrets.h.example` 复制为 `include/secrets.h` 并填好 WiFi（不要提交到 GitHub）。

```bash
pio run                 # 编译（默认就是 S3）
pio run -t upload       # 烧录
pio device monitor -b 115200   # 看串口日志
```

VS Code 里：编译 `Cmd+Option+B`，上传 `Cmd+Option+U`，串口监视器 `Cmd+Option+S`。串口一般是 `/dev/cu.usbserial-*`。烧录与看串口互斥：烧录时先关掉串口监视器。

## 直接烧 .bin（不用编译）

烧合并镜像（一个文件，0x0 起，已含 bootloader / 分区表 / boot_app0 / 固件）：

```bash
python3 -m esptool --chip esp32s3 --port /dev/cu.usbserial-XXX --baud 921600 write_flash 0x0 sijia-rv0.1.0-merged-16MB.bin
```

合并镜像在 [`../../../firmware/rv0.1.0/release/`](../../../firmware/rv0.1.0/release/) 下。四个文件分开烧见 `docs/FLASHING.md` §3.1。

注意：`release/` 里的 .bin 是占位 WiFi 编译的，能开机看界面但连不上网；要联网用，先填好真实 `secrets.h` 再重新编译烧录（见 `docs/FLASHING.md` §1.3 与 §8.3）。

## 注意

- S3 有 OTA 自动更新（见 `docs/FLASHING.md` §8）：联网后自动查新版，有新版自己下载重启，不用插线。
- NVS 陷阱：首次开机把 `secrets.h` 写进 NVS，之后只读 NVS。更新固件不要 `erase_flash`；换 WiFi 要整片擦除重烧（OTA 升级不碰 NVS，不断网）。
- BOOT 键是 GPIO 0。烧不进下载模式时按住 BOOT 再按 RESET。

组装、首启检查、故障排查：见 [`../../../firmware/rv0.1.0/docs/FLASHING.md`](../../../firmware/rv0.1.0/docs/FLASHING.md)。

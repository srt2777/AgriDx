# ESP32-C3 + 0.96 寸 OLED · Mac

**组合**：ESP32-C3（合宙 LuatOS 等 4MB 板子）+ 0.96 寸 OLED（SSD1315，128×64，I2C）+ Mac。

**界面**：U8g2 黑白界面，三页（状态 / 监测 / 问答），BOOT 键短按翻页、长按提问。不是 LVGL 彩色界面。

**接线**：VCC→3V3、GND→GND、SDA→GPIO 12、SCL→GPIO 13（I2C 地址 0x3C）。不要接 5V。

另有一种 C3 板子叫 SuperMini，0.96 寸 OLED 接 SDA GPIO 4 / SCL GPIO 5（不是 12/13），对应另一个编译环境，正在做，合进 main 后这里会补上。

## 烧录（PlatformIO，推荐）

工程在 [`../../../firmware/rv0.1.0/`](../../../firmware/rv0.1.0/)，环境名 `esp32-c3-devkitm-1-oled`。先按 `docs/FLASHING.md` §1.3 把 `include/secrets.h.example` 复制为 `include/secrets.h` 并填好 WiFi（不要提交到 GitHub）。

```bash
pio run -e esp32-c3-devkitm-1-oled                 # 编译
pio run -e esp32-c3-devkitm-1-oled -t upload       # 烧录
pio device monitor -b 115200                        # 看串口日志
```

VS Code 里：编译 `Cmd+Option+B`，上传 `Cmd+Option+U`，串口监视器 `Cmd+Option+S`。烧 C3 必须加 `-e esp32-c3-devkitm-1-oled`，不带 `-e` 会按默认的 S3 环境烧，报错 `Wrong chip argument?`。串口一般是 `/dev/cu.usbmodem*`（C3 的 USB CDC）。

## 直接烧 .bin（不用编译）

只烧 `firmware.bin` 到 `0x10000`（不碰 NVS，WiFi 不用重配）：

```bash
python3 -m esptool --chip esp32c3 --port /dev/cu.usbmodemXXX write_flash -z 0x10000 firmware.bin
```

`firmware.bin` 在编译输出 `.pio/build/esp32-c3-devkitm-1-oled/` 下。**不要烧整片合并镜像**（会清掉 NVS，WiFi 凭证就没了）。烧录与看串口互斥：烧录时先关掉串口监视器。

## 注意

- C3 没有 OTA，升级靠 USB 重烧。
- NVS 陷阱：首次开机把 `secrets.h` 写进 NVS，之后只读 NVS。更新固件不要 `erase_flash`；换 WiFi 要整片擦除重烧。
- Flash 是 DIO 40m（`platformio.ini` 里已写死，QIO 会读坏分区表）。
- BOOT 键是 GPIO 9。烧不进下载模式时按住 BOOT 再按 RESET。

组装、首启检查、故障排查：见 [`../../../firmware/rv0.1.0/docs/FLASHING.md`](../../../firmware/rv0.1.0/docs/FLASHING.md)。

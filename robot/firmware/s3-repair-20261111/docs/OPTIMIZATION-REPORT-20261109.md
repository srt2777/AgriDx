# 司稼小机器人 RV0.1.0 指南优化报告（2026-11-09）

> 优化对象：`robot/firmware/rv0.1.0/docs/ASSEMBLY.md`（275 → 295 行）、`FLASHING.md`（175 → 201 行），配图 4 张。只改指南与配图，未动 `src/`、`include/`、`platformio.ini`，未推 GitHub，未改版本。行数净增是新加的警告、故障行与「端侧模型预留」节；正文已按用户要求做过一轮简洁化（能用表的用表）。

## 前 5 条优化

### 1. I2S 引脚 GPIO 19/20 撞原生 USB（最严重，RV0.2.0 前必改）

- **来源**：Espressif《ESP32-S3 数据手册》/《技术参考手册》——GPIO 19/20 是原生 USB D−/D+。https://www.espressif.com/sites/default/files/documentation/esp32-s3_datasheet_en.pdf
- **改了什么**：`ASSEMBLY.md` §4.2 加警告——`display_config.h` 里 DIN/DOUT 现在是 GPIO 19/20，若登仕唐板的唯一 Type-C 走原生 USB，RV0.2.0 一启用 I2S 就会断烧录与串口；到货先查明 Type-C 走原生 USB 还是 CH340/CP210x 桥接，再决定是否把 DIN/DOUT 移到空闲 GPIO（如 38/47）。RV0.1.0 不用 I2S，本版不受影响。

### 2. OLED SCL 与 TFT DC 撞引脚（代码级冲突）

- **来源**：逐行读 `include/display_config.h` 发现——`PIN_TFT_DC` 与 `PIN_OLED_SCL` 都是 GPIO 9。
- **改了什么**：`ASSEMBLY.md` §4.3 与 `FLASHING.md` §6 给出确切修复——把 OLED 的 SCL 移到空闲 GPIO（如 GPIO 7），同步改 `display_config.h` 里的 `PIN_OLED_SCL`；写 OLED 版固件前必须先改好。RV0.1.0 主固件不含 OLED 代码，本版不受影响。

### 3. 烧录补齐 4 个文件 + `qio`，并发现当前合并镜像缺 `boot_app0`

- **来源**：esptool 文档（OTA 分区表下 `boot_app0.bin` 在 0xe000，otadata 为空时靠它选默认 app）；Arduino-ESP32 / PlatformIO 每次上传都会自动带上它。https://docs.espressif.com/projects/esptool/en/latest/
- **改了什么**：`FLASHING.md` §3 改为 4 文件表与命令（0x0 / 0x8000 / 0xe000 / 0x10000），合并命令加 `--flash_mode qio`（N16R8 是 Quad Flash + Octal PSRAM 的正确组合；`platformio.ini` 里没写 flash_mode，不要按它反推），并写明 `boot_app0.bin` 的真实位置在框架包（`~/.platformio/packages/framework-arduinoespressif32/tools/partitions/boot_app0.bin`），不在 `.pio/build/` 输出目录里。
- **实测发现**：读 `release/sijia-rv0.1.0-merged-16MB.bin` 的字节，0xe000 处全为 0xFF——当前合并镜像是 3 个文件合并的，未含 `boot_app0`。指南已加警告：全新擦除后不要直接烧它，先按 §3.2 重新合并或按 §3.1 分开烧 4 个文件。

### 4. SPI 40 MHz 标注为超频，给出降频验证路径

- **来源**：ILI9341 数据手册——写操作标称上限 10 MHz（读约 6.7 MHz）；`tft_setup.h` 里 `SPI_FREQUENCY` 由 `SCREEN_SPI_MHZ`（40）推导，`SPI_READ_FREQUENCY` 20 MHz 同样超标称。
- **改了什么**：`ASSEMBLY.md` §4.1 明确写清 40 MHz 是超数据手册标称的超频常用值，花屏时先降到 10 MHz 验证再逐步上调；`FLASHING.md` 故障表「花屏」行与之对应。另补 MISO/SDO 高阻冲突说明（屏 MISO 可悬空，只留触摸 T_DO 接 GPIO 13）。

### 5. N16R8 配置三件套 + PSRAM 校验 + 新增「端侧模型预留」节

- **来源**：`board_build.flash_size` 会被静默忽略，须用 `board_upload.flash_size`（PlatformIO 文档；实证：https://github.com/basmalik1/esp32-iot-telemetry）；OPI PSRAM 需 `board_build.arduino.memory_type = qio_opi` 与 `board_build.flash_mode = qio`；论文：Kurnianingsih 等 2026（同款 ESP32-S3，147K 参数教师模型蒸馏到 33K、INT8 量化 3.98 倍得 70.9 KB，RMSE 只损失 1.6%）https://etasr.com/index.php/ETASR/article/download/19973/6939/98643 ；Li 等 2026（农机边缘预警，12 维时频特征融合成 8 维）；Zhou 等 2026（云边协同，边缘提特征、云端融合与重训）；Cotrino Herrera 等 2026（CNN 离线 99.95%，部署到 ESP32 后 94.2%）https://latamt.ieeer9.org/index.php/transactions/article/view/10411
- **改了什么**：`FLASHING.md` §1.2 要求 `board_upload.flash_size` 与 `board_build.flash_size` 两行都要有 16MB；§4 首启清单加 PSRAM 须为 8388608 字节的检查；`ASSEMBLY.md` 新增 §9「下一步：端侧模型预留」——16MB Flash 预留 1MB 模型分区、RMS/FFT/峭度/1×/2×/BPFO/BPFI 特征管线作为未来模型输入、只传特征（12 维 float32 仅 48 字节，可装进 ESP-NOW 250 字节单包）、int8 模型 ≤100 KB、TFLite Micro 或 ESP-DL（https://github.com/espressif/esp-dl）两条路线、冻结特征向量定义。

## 其他改动（简述）

- 故障表新增：`USE_HSPI_PORT` 崩溃行（TFT_eSPI 默认 SPI 口与 Flash 冲突，Arduino Forum 相关讨论已核实）、空白串口反复重启（Flash 大小错配）、顶栏「在线」但问答失败（固件只在启动时测一次 health，已知局限）、中文方框（标题是「司稼」，不是「你好司稼」——`main.cpp` 无此文案）。
- 供电：烧录/调试时先断开 18650 的 5V 输出、只留 USB（两路 5V 不许并联，除非已确认电源路径隔离）；升压输出先空载量到 5.0V 再接板；大电流负载错峰（同类项目实测错峰降峰值）；MAX98357A 静态电流更正为约 2.4 mA；355 mA 注明是 3.3V 侧值。
- 组装步骤 5–7 重写为接线/供电检查——RV0.1.0 固件无 I2S/OLED 代码，功能验证等 OLED 版 / RV0.2.0 固件（原指南写的功能验证做不到）。
- 末尾新增 `FLASHING.md` §8「二期 OTA（RV0.2.0）」：ElegantOTA 三行 + `lib_compat_mode = strict` + 必须保留双 app 分区表 + ArduinoOTA 在 N16R8 上已有跑通实证（https://github.com/RabbitWhite1/hd-esp32-s3）；ElegantOTA 开源版为 AGPL-3.0。来源：https://github.com/ayushsharma82/ElegantOTA
- 借鉴来源（仓库）：TFT_eSPI（https://github.com/Bodmer/TFT_eSPI）、XPT2046_Touchscreen（https://github.com/PaulStoffregen/XPT2046_Touchscreen）、Car-Dashboard-ESP32-CYD 四点标定存 NVS（https://github.com/muki01/Car-Dashboard-ESP32-CYD）、18650 供电链与断电编程规则（https://github.com/Hirunthakan432/Laser-Distance-Meter-Nano-ESP32）、同款四件套供电实测（https://github.com/hpy666666/xiaozhi-esp32-pet）。
- 本次编译实际解析版本已写入指南（`release/FLASH_INFO.txt`）：PlatformIO 6.2.0 / espressif32 8.0.0 / Arduino core 3.3.12 / LVGL 9.6.0 / TFT_eSPI 2.5.43 / ArduinoJson 7.4.3；定稿时把这三个库版本钉死。
- 修正一处文件名错误：项目 TFT_eSPI 配置在 `include/tft_setup.h`，不是 `User_Setup.h`（`include/` 下无此文件）。

## 筛掉的想法及原因

| 想法 | 原因 |
|---|---|
| 本期就训一个端侧模型下放 | 无拖拉机故障标注数据；采数→标注→训练→量化→部署→验证 6 周内走不完 |
| 大 Transformer / GRU 上 S3 | TFLite Micro 在 S3 上有 1024 个张量分配上限，GRU 基线已实测失败（Kurnianingsih 等，2026） |
| 1 kHz 采样下用 BPFO/BPFI 确诊轴承故障 | Nyquist 500 Hz，高于 500 Hz 的轴承特征频率会混叠，只能作「疑似指示」 |
| 承诺 99%+ 端侧准确率 | CNN 离线 99.95%，部署到 ESP32 后实测跌到 94.2%（Cotrino Herrera 等，2026） |
| 照搬 Li 等 2026 的模型 | 主模型跑在 ARM Cortex-A78、占 31.5 MB 内存，塞不进 ESP32-S3；只借特征维度与融合思路 |
| 照搬 Cotrino 的 US$270.7 测试台 | 超 ¥130 传感器预算 |
| 照抄 CYD / Feather 项目的引脚 | 板子不同（CYD 是 ESP32-2432S028R 非 S3；Feather 引脚 35/36/37 不适用），只借方法（标定、DMA 双缓冲） |
| 屏幕 VCC 想当然接 5V | 有同款 ILI9341 项目屏接 3.3V，以实物说明为准 |
| 换大屏后 UI 自动适配 | LVGL 布局按 320×240 固定像素排，大屏只会留白，须按约 1.5 倍放大字号与按钮 |

## 配图清单（`docs/assets/`，均已目视检查）

| 图 | 内容 | 引用位置 |
|---|---|---|
| `wiring.png` | 接线示意图：SPI 总线 MOSI 11 / MISO 13 / SCK 12，控制 CS 10 / DC 9 / RST 14 / LED 21 / T_CS 15 / T_IRQ 16，I2S BCLK 17 / WS 18 / DIN 19 / DOUT 20（红字注 GPIO 19/20 撞 USB），OLED SDA 8 / SCL 9（注 GPIO 9 冲突），电池 5V/GND | `ASSEMBLY.md` §4 |
| `power.png` | 功耗预算柱状图：各部件典型与峰值，总量约 0.35–0.55 A / 峰值约 1.0–1.3 A，2A 预算虚线 | `ASSEMBLY.md` §6 |
| `flashing.png` | 烧录流程图：装工具 → 填 WiFi → 编译 → 烧录（4 个 .bin：0x0 / 0x8000 / 0xe000 / 0x10000）→ 看串口 → 首启清单，不过回故障表 §5 | `FLASHING.md` §2 |
| `layout.png` | 屏幕布局图：320×240 三屏滑动（首页 / 问答 / 监控），底部圆点指示，监控页 85 °C 告警线 | `ASSEMBLY.md` §5 |

## 必须等硬件到货（预计 11-10）才能实测验证

- 屏幕背面丝印是不是 ILI9341、引脚图与指南 §4 是否一致（不对就改 `display_config.h`）
- 登仕唐板 Type-C 走原生 USB 还是 CH340/CP210x 桥接（决定 I2S 引脚是否必改）
- 4 文件烧录（含 `boot_app0`）全新擦除后能否正常启动
- 40 MHz 下屏幕实测是否花屏（花屏则降 10 MHz）
- 触摸标定原始值（200/3800 是否准）、四点标定
- 升压模块 5V 输出电流、整机峰值电流实测（USB 电流表）
- 启动日志 PSRAM 是否为 8388608 字节
- WiFi 联网、问答（约 15–20 秒）、监控页、断网提示全流程（当前 .bin 是占位配网，见末尾）
- OLED 的 SCL 移到 GPIO 7 后实测（写 OLED 版固件时）

## 写报告时状态（2026-11-09 01:47 CST）

`release/` 目录下 `.bin` 文件**已生成**（2026-11-09 01:43 构建）：`bootloader.bin`（19,968 字节）、`partitions.bin`（3,072 字节）、`firmware.bin`（1,945,360 字节）、`sijia-rv0.1.0-merged-16MB.bin`（2,010,896 字节），另有 `FLASH_INFO.txt`。但注意两点：① 合并镜像 0xe000 处全为 0xFF，未含 `boot_app0.bin`（见上文第 3 条）；② 这批 `.bin` 是用占位配网编译的（`secrets.h` 里是「你的WiFi名称」），烧进去能上电、能滑动、能看界面，但连不上 WiFi，问答和监控都走不通——实测前须按 `FLASHING.md` §1.3 填真实 WiFi 后重新编译、重新合并（含 `boot_app0`）。

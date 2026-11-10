// 司稼小机器人 RV0.1.0 — 屏幕配置档
// ---- 屏幕配置档说明 ----
// UI 按 320×240 横屏的固定像素排布；换 480×320 屏时能显示但周围留白，
// 要放大字号/按钮才满屏（见 docs/ASSEMBLY.md §7）。竖屏配置档 C 需另排界面。
// 注意：不同屏幕到货后先看驱动芯片丝印，再选配置档；不要凭卖家标题猜驱动。

#pragma once

// ---- 配置档 A（默认）：DZYJ 3.2 寸 SPI 触摸屏，ILI9341 320x240 + XPT2046 ----
// 到货已确认（2026-11-10 商品图）：ILI9341、320x240、SPI、16 位 RGB 65K 彩色、
// 电阻触摸、3.3-5V、-20~60°C、带 SD 卡槽（本次不用接）、配触控笔。
// 板子 89x55mm，显示区域 64.8x48.6mm，安装孔距 83x49mm，孔径 φ3mm。
#ifdef SCREEN_PROFILE_ILI9341_320X240
  #define SCREEN_DRIVER_ILI9341
  #define SCREEN_WIDTH  320
  #define SCREEN_HEIGHT 240
  #define SCREEN_ROTATION 1        // 横屏
  // SPI 频率：首次点亮用 10MHz（多项目共识：ILI9341 先 10MHz 验证稳定再试
  // 40MHz；80MHz 不可靠，只适用于 ST7789）。点亮稳定后可改 27 再试 40，
  // 花屏就降回来（见 docs/FLASHING.md 故障表）。
  #define SCREEN_SPI_MHZ  10
  #define SCREEN_TOUCH_XPT2046
#endif

// ---- 配置档 B：3.5 寸 SPI 触摸屏，ILI9488 480x320 + XPT2046 ----
// 480x320 下同一套 UI，留白变大，字号不变；触摸映射按 480x320 重新标定。
#ifdef SCREEN_PROFILE_ILI9488_480X320
  #define SCREEN_DRIVER_ILI9488
  #define SCREEN_WIDTH  480
  #define SCREEN_HEIGHT 320
  #define SCREEN_ROTATION 1
  #define SCREEN_SPI_MHZ  40
  #define SCREEN_TOUCH_XPT2046
#endif

// ---- 配置档 C：3.5 寸 SPI 触摸屏，ST7796 320x480（竖屏）----
// 竖屏需要另排界面（本版 UI 按横屏设计），仅作预留：选 C 后需自行调整布局。
// 如无竖屏需求，不要选 C。
#ifdef SCREEN_PROFILE_ST7796_320X480
  #define SCREEN_DRIVER_ST7796
  #define SCREEN_WIDTH  320
  #define SCREEN_HEIGHT 480
  #define SCREEN_ROTATION 0        // 竖屏
  #define SCREEN_SPI_MHZ  40
  #define SCREEN_TOUCH_XPT2046
#endif

#ifndef SCREEN_WIDTH
// OLED 版不接 TFT 屏，不需要屏幕配置档；TFT 版必须选一个配置档。
#if !USE_OLED_DISPLAY
  #error "未选择屏幕配置档：请在 platformio.ini 的 build_flags 里加 -DSCREEN_PROFILE_ILI9341_320X240（或 B/C）"
#endif
#endif

// ---- 引脚（按板子选一节；S3 节是登仕唐 ESP32-S3-N16R8，C3 节是 DevKitM-1 默认）----
#ifdef CONFIG_IDF_TARGET_ESP32C3
// ---- C3 引脚（过渡版；按自己的板子引脚图调整）----
// SPI 走 GPIO 矩阵任意分配：MOSI/SCK/CS 用硬件 SPI2（FSPI）默认脚，MISO 从 strapping 脚
// GPIO2 移到 GPIO5。避开：strapping（2/8/9）、USB D-/D+（18/19）、UART0（20/21）。
// GPIO 0 也是 strapping 脚，本表把它用作 T_CS——烧录进不了下载模式时先拔掉 T_CS 线
// 再烧（见 docs/FLASHING.md §2.2 与 §5）。
// MOSI 7 / SCK 6 / CS 10 是 C3 硬件 SPI2 默认脚；MISO 默认脚 GPIO2 是 strapping 脚，改用 5。
#define PIN_TFT_CS   10
#define PIN_TFT_DC    4
#define PIN_TFT_RST   3
#define PIN_TFT_BL    1   // 背光，PWM 调光
#define PIN_TOUCH_CS  0
#define PIN_TOUCH_IRQ 11
// 0.96 寸 OLED（副屏，U8g2，SSD1306 I2C）：SDA/SCL 任意 GPIO，以实物为准。
#define PIN_OLED_SDA 12
#define PIN_OLED_SCL 13
// OLED I2C 地址（7 位）：模块跳线标 0x78 是 8 位写地址，折合 7 位就是 0x3C。
#define OLED_I2C_ADDR 0x3C
// BOOT 按键（strapping 脚；只在启动后读，OLED 版用它切页/长按提问）。
#define PIN_BOOT_BTN  9
#else
// ---- S3 引脚（登仕唐 ESP32-S3-N16R8 核心板，ESP32-S3-WROOM-1-N16R8 模组，
// 双核 240MHz，16MB Flash + 8MB PSRAM，商品图 2026-11-10 已核对）----
// 引脚已逐根核对禁区，无冲突（2026-11-10）：
//   - GPIO 34-37 是板载 Flash/PSRAM 专用，禁止当普通 IO；
//   - strapping 脚 GPIO 0/45/46（GPIO 0 拉低进下载模式，别占）；
//   - 原生 USB 是 GPIO 19(D-)/20(D+)——I2S 的 19/20 冲突是实锤，
//     TFT 本版不用 I2S 不受影响；语音版 fallback 不要再往 19/20 上想；
//   - 板载 WS2812B RGB 灯占 GPIO 48，别当普通 IO 用；
//   - ADC2 在 WiFi 开启时不可用，优先用 ADC1。
// 本方案 9 根 TFT 引脚全在 GPIO 9-21 之间，均不在禁区里；MOSI 11 / MISO 13 /
// SCK 12 / CS 10 是 ESP32-S3 硬件 SPI 默认引脚。
#define PIN_TFT_CS   10
#define PIN_TFT_DC    9
#define PIN_TFT_RST  14
#define PIN_TFT_BL   21   // 背光，PWM 调光
#define PIN_TOUCH_CS 15
#define PIN_TOUCH_IRQ 16
// 0.96 寸 OLED（副屏，U8g2，SSD1306 I2C）：SDA 是 GPIO 8、SCL 是 GPIO 9。
// 注意：SCL 与 TFT_DC（GPIO 9）撞脚；S3 上接 OLED 前必须把 SCL 移到空闲 GPIO
//（如 GPIO 7），同步改这里（见 docs/ASSEMBLY.md §4.3）。OLED 版目前只支持 C3（SCL 13）。
#define PIN_OLED_SDA  8
#define PIN_OLED_SCL  9
#endif

// ---- 触摸标定（XPT2046 原始值 0~4095；到货后按实际触摸位置微调）----
// 标定方法：点四个角，看串口打印的原始值，填进下面四个数。
#define TOUCH_X_MIN 200
#define TOUCH_X_MAX 3800
#define TOUCH_Y_MIN 200
#define TOUCH_Y_MAX 3800

// ---- 功耗余量（换电池/换屏时对照 docs/ASSEMBLY.md 的功耗预算表）----
// 整机峰值约 1.0~1.3A；18650 模块 5V 输出建议 ≥2A。换 3C 高倍率电芯时：
// 瓶颈是升压模块不是电芯，换电池前核对模块标称输出；背光 PWM 可降功耗。
#define BACKLIGHT_BRIGHTNESS 220   // 0~255；模块供电吃紧时降到 160 左右

// ---- I2S 语音引脚（RV0.2.0 语音版预留，本版固件未用；以下仅 S3）----
// C3 上 I2S 引脚待 RV0.2.0 再定（S3 的 18/19/20 在 C3 上是 USB/UART0，不能照搬）。
#ifndef CONFIG_IDF_TARGET_ESP32C3
// 麦克风 INMP441 与功放 MAX98357A 共用 BCLK/WS，数据线分开；以核心板引脚图为准。
#define PIN_I2S_BCLK 17
#define PIN_I2S_WS   18
#define PIN_I2S_DIN  19   // 麦克风数据入
#define PIN_I2S_DOUT 20   // 功放数据出
#endif

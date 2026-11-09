// 司稼小机器人 RV0.1.0 — 屏幕配置档
// ---- 屏幕配置档说明 ----
// UI 按 320×240 横屏的固定像素排布；换 480×320 屏时能显示但周围留白，
// 要放大字号/按钮才满屏（见 docs/ASSEMBLY.md §7）。竖屏配置档 C 需另排界面。
// 注意：不同屏幕到货后先看驱动芯片丝印，再选配置档；不要凭卖家标题猜驱动。

#pragma once

// ---- 配置档 A（默认）：DZYJ 3.2 寸 SPI 触摸屏，ILI9341 320x240 + XPT2046 ----
// 到货核对：屏背面驱动芯片丝印应为 ILI9341；若是 ST7789/ST7796，改用配置档 B/C。
#ifdef SCREEN_PROFILE_ILI9341_320X240
  #define SCREEN_DRIVER_ILI9341
  #define SCREEN_WIDTH  320
  #define SCREEN_HEIGHT 240
  #define SCREEN_ROTATION 1        // 横屏
  #define SCREEN_SPI_MHZ  40       // 不稳定时降到 27
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
  #error "未选择屏幕配置档：请在 platformio.ini 的 build_flags 里加 -DSCREEN_PROFILE_ILI9341_320X240（或 B/C）"
#endif

// ---- 引脚（按板子选一节；S3 节是登仕唐 ESP32-S3-N16R8，C3 节是 DevKitM-1 默认）----
#ifdef CONFIG_IDF_TARGET_ESP32C3
// ---- C3 引脚（过渡版；按自己的板子引脚图调整）----
// SPI 走 GPIO 矩阵任意分配：MOSI/SCK/CS 用硬件 SPI2（FSPI）默认脚，MISO 从 strapping 脚
// GPIO2 移到 GPIO5。避开：strapping（2/8/9）、USB D-/D+（18/19）、UART0（20/21）。
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
#else
// ---- S3 引脚（按登仕唐 ESP32-S3-N16R8 核心板引脚图核对；SPI 默认引脚）----
// MOSI 11 / MISO 13 / SCK 12 / CS 10 是 ESP32-S3 硬件 SPI 默认引脚。
#define PIN_TFT_CS   10
#define PIN_TFT_DC    9
#define PIN_TFT_RST  14
#define PIN_TFT_BL   21   // 背光，PWM 调光
#define PIN_TOUCH_CS 15
#define PIN_TOUCH_IRQ 16
// 0.96 寸 OLED（副屏，U8g2，SSD1306 I2C）：SDA/SCL 建议 GPIO 8/9，以实物为准。
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

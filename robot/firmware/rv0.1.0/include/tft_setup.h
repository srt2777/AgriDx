// 司稼小机器人 RV0.1.0 — TFT_eSPI 用户配置（工程内覆盖库默认配置）
// 由 display_config.h 选择屏幕配置档；换屏时改 platformio.ini 的 -D 宏即可。
// 加载机制（TFT_eSPI 2.5）：TFT_eSPI.h 用 __has_include(<tft_setup.h>) 在包含
// 路径上找本文件，找到就直接采用，不再加载库默认配置；不要定义
// USER_SETUP_LOADED（那样库自己的 .cpp 编译时拿不到任何配置）。
// 本工程 include/ 已加 -I，所以主程序和库文件都能找到它。
#pragma once
#include "display_config.h"

#ifdef SCREEN_DRIVER_ILI9341
  #define ILI9341_DRIVER
#endif
#ifdef SCREEN_DRIVER_ILI9488
  #define ILI9488_DRIVER
#endif
#ifdef SCREEN_DRIVER_ST7796
  #define ST7796_DRIVER
#endif

#define TFT_WIDTH  SCREEN_WIDTH
#define TFT_HEIGHT SCREEN_HEIGHT
#define TFT_MOSI 11
#define TFT_MISO 13
#define TFT_SCLK 12
#define TFT_CS   PIN_TFT_CS
#define TFT_DC   PIN_TFT_DC
#define TFT_RST  PIN_TFT_RST
#define TFT_BL   PIN_TFT_BL
#define TFT_BACKLIGHT_ON HIGH

// SPI 频率：40MHz；个别屏不稳定时在 display_config.h 里降到 27。
#define SPI_FREQUENCY  (SCREEN_SPI_MHZ * 1000000)
#define SPI_READ_FREQUENCY  20000000
#define SPI_TOUCH_FREQUENCY  2500000

// 触摸：XPT2046 由独立库驱动（与 TFT 共用 SPI 总线，用事务隔离）。
// DMA：LVGL 刷新用 pushPixelsDMA，比 CPU 逐像素写快，是滑动流畅的关键。
#define SUPPORT_TRANSACTIONS

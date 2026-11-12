// 司稼小机器人 RV0.1.0 — LVGL 9 配置（精简版，只开用到的部件）
// 放在 include/，由 -DLV_CONF_INCLUDE_SIMPLE 生效。
#pragma once
#ifndef LV_CONF_INCLUDE_SIMPLE
#define LV_CONF_INCLUDE_SIMPLE
#endif
#define LV_CONF_H

#define LV_COLOR_FORMAT_DEFAULT LV_COLOR_FORMAT_RGB565
#define LV_COLOR_16_SWAP 0        // 字节序由 TFT_eSPI 的 setSwapBytes(true) 处理
// LVGL 内部堆（对象/样式）；绘图缓冲另算（见 main.cpp DRAW_BUF_LINES）。
// C3 TFT 新环境（SIJIA_C3_TFT）只有约 400KB SRAM、无 PSRAM，堆改小到 48KB；
// S3 保持 64KB 不动。旧 C3 过渡环境不用这个宏，保持 64KB（行为不变）。
#ifdef SIJIA_C3_TFT
#define LV_MEM_SIZE (48 * 1024)
#else
#define LV_MEM_SIZE (96 * 1024)
#endif
#define LV_DEF_REFR_PERIOD 16  // 16 ms target period; actual frame rate depends on rendering and SPI.

#define LV_USE_TILEVIEW 1
#define LV_USE_SCALE 1   // LVGL 9 的表盘叫 scale；meter 在 LVGL 9 已删除
#define LV_USE_CHART 1
#define LV_USE_LINE 1
#define LV_USE_LABEL 1
#define LV_USE_BTN 1
#define LV_USE_BAR 0
#define LV_USE_SLIDER 0
#define LV_USE_SWITCH 0
#define LV_USE_TEXTAREA 1
#define LV_USE_KEYBOARD 1
#define LV_USE_TABLE 0
#define LV_USE_LIST 0
#define LV_USE_DROPDOWN 0
#define LV_USE_ROLLER 0
#define LV_USE_SPINNER 1
#define LV_USE_ARC 1
#define LV_USE_IMG 0
// 以下部件未用且默认开启会拖入不需要的依赖，显式关掉
#define LV_USE_CALENDAR 0
#define LV_USE_CANVAS 0
#define LV_USE_CHECKBOX 0
#define LV_USE_MSGBOX 0
#define LV_USE_TABVIEW 0
#define LV_USE_LED 0
#define LV_USE_SPINBOX 0
#define LV_USE_MENU 0
#define LV_USE_ANIMIMG 0
#define LV_USE_IMAGEBUTTON 0
#define LV_USE_WIN 0
#define LV_USE_SPAN 0
#define LV_USE_QRCODE 0
#define LV_USE_BARCODE 0
#define LV_USE_BUTTONMATRIX 1

#define LV_FONT_MONTSERRAT_28 1  // 监测卡片大数字用（内建字体，只含 ASCII 数字/符号）
#define LV_FONT_DEFAULT &lv_font_montserrat_14
// 注意：默认字体只能用 LVGL 内建字体；中文字库 font_zh_16 在 main.cpp 里
// 声明，界面通过屏幕样式统一设为 font_zh_16（见 buildUi），不依赖这里。
#define LV_FONT_FMT_TXT_LARGE 1  // Full CJK bitmap exceeds 1 MiB (32-bit glyph offsets).
#define LV_USE_FONT_COMPRESSED 1  // Retained for optional RLE fonts; current font_zh_* are plain bitmaps.
#define LV_USE_LOG 0
#define LV_USE_ASSERT_NULL 1
#define LV_USE_ASSERT_MALLOC 1

// UI objects/styles and draw buffers use fast internal RAM. TLS uses PSRAM.
#if defined(ESP_PLATFORM)
#include "sdkconfig.h"
#if defined(CONFIG_IDF_TARGET_ESP32S3)
#define LV_USE_SNAPSHOT 1
#define LV_MEM_POOL_INCLUDE "esp_heap_caps.h"
#define LV_MEM_POOL_ALLOC(size) heap_caps_malloc((size), MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT)
#endif
#endif

#define LV_FONT_MONTSERRAT_16 1

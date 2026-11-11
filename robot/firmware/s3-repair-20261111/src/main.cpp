// 司稼小机器人 RV0.1.0 — LVGL 界面 + WiFi 问答 + 遥测监控
// 硬件：ESP32-S3-N16R8 + 3.2 寸 ILI9341 触摸屏（默认配置档 A）
//   板子已按商品图核实（2026-11-10）：ESP32-S3-WROOM-1-N16R8，双核 240MHz，
//   16MB Flash + 8MB PSRAM（OPI）；双 Type-C：CH340 口（USB-ISP）烧录，
//   原生 USB 口（OTG）默认不用。禁区见 display_config.h（34-37/0/45/46/19/20/48）。
// TFT UI：2026-11-11 对齐正式站旧版蓝白工作台，仅监测 / 对话两页；
//   默认监测页，底部文字导航可点，保留左右滑动；预设问题位于对话页。
//   按钮点按反馈（pressed 变色 + 0.96 缩放、100ms 过渡）；问答等待三点呼吸动画；
//   10 秒无操作进待机屏（拖拉机动画：轮子转 + 排气管冒尾气 + 呼吸光晕，点一下唤醒）；
//   监测页 3 张小卡片 + 1 张水温趋势图（不再是 3 个大圆表）。
//   设计参考（只借鉴做法、不粘代码；GPL/无 licence 项目只看设计）：
//   benevid/claude-usage-stick（当前页变胶囊）、muki01/Car-Dashboard-ESP32-CYD
//   （圆点可点）、El-EnderJ/NeoCalculator（ILI9341 先 10MHz 点亮再试 40MHz）、
//   facebookincubator/muse-gadget-sdk（Apache-2.0，局部重绘）。
//   第二个显示版本：ESP32-C3 + 0.96 寸 OLED（SSD1306 128x64，见 src/oled_ui.*）。
//   编译宏 USE_OLED_DISPLAY=1 时编 OLED UI，=0 时编原来的 LVGL TFT UI；
//   联网/问答/遥测/NVS/OTA 逻辑两个版本共用，显示层各自独立。
// 架构：司稼跑在正式站 agridx.xyz；机器人只做交互终端（问答 + 监控）。
//   - 问答：POST /api/chat（不发 Origin 头，见方案 §3.2）
//   - 语音（RV0.2.0，S3 专用）：POST /api/voice/ask（录音上传，文字+音频返回），
//     见 src/voice.* 与 docs/VOICE.md；C3 两个环境不编语音代码。
//   - 监控：GET /api/telemetry/history（每 15 秒轮询三通道）+ GET /api/telemetry/scenario（每 60 秒）
//   - OTA：联网自动更新（WiFi 存 NVS，version.json 查新版，HTTPUpdate 下载，见 FLASHING.md §8）
//   - 遥测限流：正式站每 IP 每分钟 30 次请求；本固件遥测约 13 次/分钟，留足余量给手机/网页。
// 流畅要点：DMA 刷新 + PSRAM 双缓冲 + LVGL 局部重绘 + SPI 40MHz；网络在独立任务里跑，不卡界面。
// 中文字库：src/fonts/font_zh_16.c（lv_font_conv 子集，见 README “字库”一节）。

// 显示版本选择：默认 0（LVGL TFT 版）；OLED 环境在 platformio.ini 里传 -DUSE_OLED_DISPLAY=1。
#ifndef USE_OLED_DISPLAY
#define USE_OLED_DISPLAY 0
#endif

#include <Arduino.h>
#if defined(CONFIG_IDF_TARGET_ESP32S3)
#include <esp_ota_ops.h>
#endif
#if defined(CONFIG_IDF_TARGET_ESP32S3)
// Full-frame LVGL rendering traverses the complete object tree. Its deepest
// draw path exceeds Arduino's default 8KB loop task stack.
SET_LOOP_TASK_STACK_SIZE(16384);
#endif
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#if ENABLE_OTA
#include <HTTPUpdate.h>
#endif
#include <Preferences.h>
#include <ArduinoJson.h>
#if USE_OLED_DISPLAY
#include "oled_ui.h"
#else
#include <TFT_eSPI.h>
#include <XPT2046_Touchscreen.h>
#include <lvgl.h>
#include <esp_heap_caps.h>
#if defined(CONFIG_IDF_TARGET_ESP32S3)
#include <mbedtls/platform.h>
#endif
#endif

#if defined(SIJIA_C3_TFT) && defined(SPI_PORT) && defined(REG_SPI_BASE) && defined(DR_REG_SPI2_BASE)
// 防回归：C3 上 REG_SPI_BASE(SPI_PORT) 必须落在 SPI2 基址。否则 TFT_eSPI 的 SPI 寄存器指针
// 全是 “0+偏移”，tft.init() 第一次写寄存器就 Store access fault（地址 0x10）。
// 修法见 tools/patch_tft_espi_c3.py；这里编译不过说明补丁没打上，再跑一次 pio run 即可。
static_assert(REG_SPI_BASE(SPI_PORT) == DR_REG_SPI2_BASE,
              "TFT_eSPI SPI register base is wrong: tools/patch_tft_espi_c3.py did not patch the library");
#endif
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/semphr.h>
#include "display_config.h"
#include "secrets.h"
#include "version.h"
#include "local_console.h"
#if defined(CONFIG_IDF_TARGET_ESP32S3) && !USE_OLED_DISPLAY
#define SIJIA_STREAM_TELEMETRY 1
#include "telemetry_stream.h"
#include "wifi_panel.h"
#include "touch_calibration.h"
#else
#define SIJIA_STREAM_TELEMETRY 0
#endif
#if SIJIA_VOICE_ENABLED
#include "voice.h"  // RV0.2.0 语音（S3 专用；C3 环境 SIJIA_VOICE_ENABLED=0，不编）
#endif
#include <math.h>   // 待机动画用 sinf/cosf

// 第二组 WiFi（新增，最优先）：旧版 secrets.h 里没有这两个宏时给空值，
// 这样旧 secrets.h 也能编译（第二组视作未配置，只连第一组）；
// 新版 secrets.h.example 里有占位符行，填入真实账号后生效。
#ifndef WIFI_SSID_2
#define WIFI_SSID_2 ""
#endif
#ifndef WIFI_PASS_2
#define WIFI_PASS_2 ""
#endif
// 第三组 WiFi（新增，其次）：与第二组同理，旧 secrets.h 里没有时给空值。
#ifndef WIFI_SSID_3
#define WIFI_SSID_3 ""
#endif
#ifndef WIFI_PASS_3
#define WIFI_PASS_3 ""
#endif

// ---------- 颜色（2026-11-11 正式站旧版蓝白工作台；仅 LVGL TFT 版用）----------
// 来源：https://agridx.xyz/assets/index-CNZeewB8.css（build cae1d91c6adfd07b761373cc69b450d4ecbedd2e）
// 与 GitHub main 的 src/ui/workbench.css 对照：--wb-*；蓝色用于操作，绿色用于正常状态。
#if !USE_OLED_DISPLAY
#define C_BG       lv_color_hex(0xF3F6FB)
#define C_CARD     lv_color_hex(0xFFFFFF)
#define C_SUBBG    lv_color_hex(0xEDF3FF)
#define C_BORDER   lv_color_hex(0xDCE5EF)
#define C_TEXT     lv_color_hex(0x172B45)
#define C_SUBTEXT  lv_color_hex(0x64748B)
#define C_PRIMARY  lv_color_hex(0x2863D6)
#define C_PRIMARY_DARK lv_color_hex(0x1E50B5)
#define C_TINT     lv_color_hex(0xEDF3FF)
#define C_GREEN    lv_color_hex(0x13866C)
#define C_DARKGREEN lv_color_hex(0x13866C)
#define C_GREENBG  C_TINT
#define C_RED      lv_color_hex(0xC0392B)
#define C_AMBER    lv_color_hex(0xB7791F)
#define C_LIGHTRED lv_color_hex(0xFDECEA)   // 报警横条底
#define C_LIGHTAMBER lv_color_hex(0xFDF3E0) // 注意横条底
#define C_WHITE    lv_color_hex(0xFFFFFF)

// ---------- 字库（由 lv_font_conv 生成，见 src/fonts/）----------
LV_FONT_DECLARE(font_zh_16);
LV_FONT_DECLARE(font_zh_22);
LV_FONT_DECLARE(font_zh_12);

// ---------- 屏幕 / 触摸 ----------
static TFT_eSPI tft;
static XPT2046_Touchscreen ts(PIN_TOUCH_CS, PIN_TOUCH_IRQ);
static lv_display_t *disp = nullptr;
static uint16_t *drawBuf1 = nullptr, *drawBuf2 = nullptr;
static bool g_displayDma = false;
static uint32_t g_flushPeakUs = 0, g_handlerPeakMs = 0, g_flushCount = 0;
static uint32_t g_flushTotalUs = 0, g_touchPeakUs = 0, g_handlerTotalMs = 0;
static uint32_t g_frameCount = 0, g_framePeakUs = 0, g_frameStartUs = 0;
static bool g_frameHasPixels = false;
#if defined(CONFIG_IDF_TARGET_ESP32S3)
static bool g_fastDisplay = true;
static bool g_dmaPending = false;
static uint32_t g_dmaSubmitUs = 0;

static void finishDisplayDma(lv_display_t *d) {
  if (!g_dmaPending) return;
  const uint32_t waitStarted = micros();
  tft.dmaWait();
  tft.endWrite();
  g_dmaPending = false;
  const uint32_t elapsed = g_dmaSubmitUs + (micros() - waitStarted);
  g_flushPeakUs = max(g_flushPeakUs, elapsed);
  g_flushTotalUs += elapsed;
  lv_display_flush_ready(d);
}
#endif

static void displayRefreshEvent(lv_event_t *event) {
  if (lv_event_get_code(event) == LV_EVENT_REFR_START) {
    g_frameStartUs = micros();
    g_frameHasPixels = false;
    return;
  }
#if defined(CONFIG_IDF_TARGET_ESP32S3)
  // The touch controller shares the SPI bus. Finish the last transaction
  // before returning from the LVGL refresh to its input timers.
  finishDisplayDma(disp);
#endif
  if (g_frameHasPixels) {
    g_frameCount++;
    g_framePeakUs = max(g_framePeakUs, micros() - g_frameStartUs);
  }
}
// 显存：S3 有 PSRAM，双缓冲 40 行放 PSRAM；C3 无 PSRAM，双缓冲放内部 RAM。
// C3 TFT 新环境（SIJIA_C3_TFT）只用 10 行：双缓冲共 320x10x2x2 = 12.8KB，
// 给 WiFi/TCP/LVGL 堆多留内部 RAM；PARTIAL 渲染一次只刷一小块，10 行够用。
#if defined(SIJIA_C3_TFT)
static const uint16_t DRAW_BUF_LINES = 10;   // 每缓冲 10 行，内部 RAM
#elif defined(CONFIG_IDF_TARGET_ESP32S3)
static const uint16_t DRAW_BUF_LINES = 20;   // Internal DMA-capable RAM, 25.6 KB total.
#else
static const uint16_t DRAW_BUF_LINES = 20;   // 每缓冲 20 行，内部 RAM
#endif

static void flush_cb(lv_display_t *d, const lv_area_t *area, uint8_t *color_p) {
  const uint32_t started = micros();
  g_frameHasPixels = true;
  ++g_flushCount;
  uint32_t w = area->x2 - area->x1 + 1, h = area->y2 - area->y1 + 1;
  tft.startWrite();
  tft.setAddrWindow(area->x1, area->y1, w, h);
#if defined(SIJIA_C3_TFT)
  // C3：TFT_eSPI 的 initDMA() 传给 spi_bus_initialize 的 DMA 通道号在 C3 上不合法（要 auto-alloc），
  // 启动即 ESP_ERROR_CHECK 崩。这里本来就是推完立刻 dmaWait()，DMA 没有异步收益，C3 直接 CPU 写。
  tft.pushPixels((uint16_t *)color_p, w * h);   // setSwapBytes(true) 已设，字节序与 DMA 路径一致
#else
  if (g_displayDma) {
    tft.pushPixelsDMA((uint16_t *)color_p, w * h);
#if defined(CONFIG_IDF_TARGET_ESP32S3)
    if (g_fastDisplay) {
      g_dmaSubmitUs = micros() - started;
      g_dmaPending = true;
      return;
    }
#endif
    tft.dmaWait();
  } else {
    tft.pushPixels((uint16_t *)color_p, w * h);
  }
#endif
  tft.endWrite();
  const uint32_t elapsed = micros() - started;
  g_flushPeakUs = max(g_flushPeakUs, elapsed);
  g_flushTotalUs += elapsed;
  lv_display_flush_ready(d);
}

// ---------- 交互计时（待机 10 秒用；任何一次触摸/点按都重置）----------
static uint32_t g_lastInteractMs = 0;
static bool g_standbyOn = false;
static void wakeStandby();
static void markActive() { g_lastInteractMs = millis(); }

static void touch_cb(lv_indev_t *indev, lv_indev_data_t *data) {
  (void)indev;
  // XPT2046 already filters samples. Rejecting every >80px movement locks fast swipes.
  const uint32_t touchStarted = micros();
  const bool pressed = ts.touched();
  TS_Point p;
  if (pressed) p = ts.getPoint();
  g_touchPeakUs = max(g_touchPeakUs, micros() - touchStarted);
  if (touchCalibrationActive()) {
    touchCalibrationFeed(pressed, pressed ? p.x : 0, pressed ? p.y : 0);
    data->state = LV_INDEV_STATE_RELEASED;
    return;
  }
  if (!pressed) { data->state = LV_INDEV_STATE_RELEASED; return; }
  int32_t sx, sy;
  touchCalibrationMap(p.x, p.y, sx, sy);
  data->point.x = sx;
  data->point.y = sy;
  data->state = LV_INDEV_STATE_PRESSED;
  markActive();
}
#endif  // !USE_OLED_DISPLAY

// ---------- 预设问题（方案 §3.3；第一条是 2026-11-09 实测过的问题）----------
static const char *PRESET_LABELS[4] = {"发动机启动困难", "水温高怎么办", "变速箱异响", "保养周期"};
static const char *PRESET_QUESTIONS[4] = {
  "拖拉机发动机启动困难怎么办",
  "拖拉机水温高怎么办",
  "拖拉机变速箱异响怎么办",
  "拖拉机保养周期怎么定",
};

// ---------- 遥测通道（正式站 config/telemetry-demo.json 已核实，2026-11-09）----------
// 通道 id 是写死的（配置里的真实 id）；量程/阈值/单位每次从 history 响应里读，不硬编码。
struct TeleChannel {
  const char *id;          // 如 diesel.engine.coolant
  const char *label;       // 屏上显示名
  float value = NAN;
  float minV = 0, maxV = 100;
  int precision = 0;
  bool hasAttention = false, hasAlarm = false;
  float attentionAbove = NAN, attentionBelow = NAN, alarmAbove = NAN, alarmBelow = NAN;
  // 单位按值存在通道自己的缓冲里（°C/kPa/RPM 都短，8 字节够用）：
  // 千万不要存指向 JsonDocument 的指针——doc 是 netFetchHistory 的局部变量，
  // 函数返回就释放，指针成野指针，三个通道的 unit 会全指同一块已释放内存，
  // 监测页三行单位全显示成同一个、还随堆内存复用在 RPM/°C 之间乱跳。
  char unit[8] = "";
  uint32_t updatedAt = 0;  // millis
};
static TeleChannel g_channels[3] = {
  {"diesel.engine.coolant", "水温"},
  {"diesel.engine.oil-pressure", "机油压力"},
  {"diesel.engine.rpm", "转速"},
};
static const char *SCENARIO_ZH[5][2] = {
  {"normal", "正常运行"}, {"coolant-rise", "冷却液温度爬升"}, {"battery-spread", "电池压差扩大"},
  {"position-drift", "定位漂移"}, {"slow-lift", "液压提升缓慢"},
};
static char g_scenarioZh[24] = "正常运行";
static char g_scenarioId[24] = "normal";

// ---------- 聊天状态 ----------
static const int MAX_HISTORY_MSGS = 10;   // 多轮最多带 10 条
struct ChatMsg { String role, content; };
static ChatMsg g_history[MAX_HISTORY_MSGS];
static int g_historyCount = 0;
static bool g_chatBusy = false;
static bool g_online = false;

// ---------- 网络任务与主循环之间传结果（互斥 + 标志位；网络任务绝不直接碰 LVGL）----------
struct ChatResult {
  bool ready = false, ok = false;
  String answer, mode, provider;
  String sources[3];
  int sourceCount = 0, sourceTotal = 0;
};
struct TeleResult { bool ready = false, ok = false; };
static ChatResult g_chatResult;
static TeleResult g_teleResult;
static SemaphoreHandle_t g_resultMutex = nullptr;
static volatile bool g_chatPending = false;
static String g_pendingQuestion;
static volatile bool g_telePending = false;

static String g_nextSsid, g_nextPassword;
static bool g_wifiConfigPending = false;
static int g_nextWifiSlot = 2;
static bool queueWifiConfigSlot(const String &ssid, const String &password, int slot) {
  if (slot < 1 || slot > 3) return false;
  if (!ssid.length() || ssid.length() > 32 || password.length() > 64 ||
      (password.length() && password.length() < 8)) return false;
  if (g_resultMutex) xSemaphoreTake(g_resultMutex, portMAX_DELAY);
  g_nextSsid = ssid; g_nextPassword = password; g_nextWifiSlot = slot; g_wifiConfigPending = true;
  if (g_resultMutex) xSemaphoreGive(g_resultMutex);
  return true;
}

static bool queueWifiConfig(const String &ssid, const String &password) {
  return queueWifiConfigSlot(ssid, password, 2);
}

// ---------- 两个显示版本共用的状态与助手函数（LVGL 与 OLED 都用同一份）----------
// 最后一问 / 最后答案：问答页（LVGL 对话页 / OLED 问答页）都从这里取。
static String g_lastQuestion;
static String g_lastAnswer;

// 通道状态码（-1 无数据，0 正常，1 注意，2 报警）；LVGL 与 OLED 共用同一判定。
static int chanStateCode(const TeleChannel &ch) {
  if (isnan(ch.value)) return -1;
  if (ch.hasAlarm && ((!isnan(ch.alarmAbove) && ch.value > ch.alarmAbove) ||
                      (!isnan(ch.alarmBelow) && ch.value < ch.alarmBelow))) return 2;
  if (ch.hasAttention && ((!isnan(ch.attentionAbove) && ch.value > ch.attentionAbove) ||
                          (!isnan(ch.attentionBelow) && ch.value < ch.attentionBelow))) return 1;
  return 0;
}

// 发起一次提问（网络任务接手；返回 false 表示正忙或未联网，调用方自行提示）。
// LVGL 版由预设问题按钮调；OLED 版由 BOOT 长按调。
static bool startAsk(const char *q) {
  if (g_chatBusy) return false;
  if (!g_online) return false;
  g_chatBusy = true;
  if (g_historyCount < MAX_HISTORY_MSGS) {
    g_history[g_historyCount].role = "user";
    g_history[g_historyCount].content = String(q);
    g_historyCount++;
  }
  g_lastQuestion = String(q);
  g_pendingQuestion = String(q);
  g_chatPending = true;
  return true;
}

// 从网络任务取走一份问答结果（取走后 ready 清零）；没有新结果返回 false。
static bool takeChatResult(ChatResult &out) {
  if (g_resultMutex) xSemaphoreTake(g_resultMutex, portMAX_DELAY);
  if (!g_chatResult.ready) {
    if (g_resultMutex) xSemaphoreGive(g_resultMutex);
    return false;
  }
  out = g_chatResult;
  g_chatResult.ready = false;
  if (g_resultMutex) xSemaphoreGive(g_resultMutex);
  return true;
}

// ---------- 三 WiFi（优先级：第二组 > 第三组 > 第一组）----------
// 三组账号：第一组是原有的（NVS 键 ssid/pass，最后备选），
// 第二组是新增的（NVS 键 ssid2/pass2，最优先），第三组是新增的（NVS 键 ssid3/pass3，其次）。
// g_wifiActive 记录当前在用哪组：0 未连，1 第一组，2 第二组，3 第三组。
static String g_wifiSsid, g_wifiPass;    // 第一组（原有，最后备选）
static String g_wifiSsid2, g_wifiPass2;  // 第二组（新增，最优先）
static String g_wifiSsid3, g_wifiPass3;  // 第三组（新增，其次）
static int g_wifiActive = 0;
// 掉线计时：本轮掉线开始时刻（0 表示在线）与上次切组时刻。
static uint32_t s_wifiDownSince = 0;
static uint32_t s_wifiLastSwitch = 0;

// 按优先级（第二组 > 第三组 > 第一组）取当前组之后、下一个已配置的组；没有返回 0。
// 当前组是 0（从未连上）时从最高优先级开始找。
static int nextWifiGroup(int cur) {
  const int order[3] = {2, 3, 1};
  int start = -1;
  for (int i = 0; i < 3; i++) {
    if (order[i] == cur) { start = i; break; }
  }
  for (int k = 1; k <= 3; k++) {
    int g = order[(start + k) % 3];
    if (g == 1 && g_wifiSsid.length() > 0) return 1;
    if (g == 2 && g_wifiSsid2.length() > 0) return 2;
    if (g == 3 && g_wifiSsid3.length() > 0) return 3;
  }
  return 0;
}

// 换组前先断开并等 station 回到空闲：上一组还在连着时驱动拒绝换配置
// （E wifi:sta is connecting, cannot set config），新组根本没换过去。
// 最多等 maxMs，以先到为准；station 已空闲时立即返回。
static void wifiDisconnectSettle(uint32_t maxMs) {
  WiFi.disconnect(true, false);
  delay(20);
  WiFi.mode(WIFI_STA);
  uint32_t t0 = millis();
  while (millis() - t0 < maxMs) {
    wl_status_t st = WiFi.status();
    if (st == WL_DISCONNECTED || st == WL_IDLE_STATUS) break;
    delay(10);
  }
}

// 切到指定组（先断开并等 station 空闲 ≤100ms，再异步 WiFi.begin）；g 无效时什么都不做。
static void switchWifiGroup(int g) {
  if (g < 1 || g > 3) return;  // g 无效时什么都不做
  wifiDisconnectSettle(100);
  if (g == 1) {
    WiFi.begin(g_wifiSsid.c_str(), g_wifiPass.c_str());
  } else if (g == 2) {
    WiFi.begin(g_wifiSsid2.c_str(), g_wifiPass2.c_str());
  } else {
    WiFi.begin(g_wifiSsid3.c_str(), g_wifiPass3.c_str());
  }
  g_wifiActive = g;
  s_wifiLastSwitch = millis();
  Serial.printf("[司稼] WiFi 改试第 %d 组\n", g);
}

// 维护 WiFi 在线状态（内部每秒检查一次）；状态变了返回 true。
// 注意：g_online 在 setup() 里由 /api/health 检查结果设定；这里只看 WiFi 链路。
// 掉线重连：刚掉线先重连当前网络（异步，不阻塞）；若一直掉线，
// 每 15 秒按优先级轮换到下一组，直到连上（切组间隔 15 秒，不来回跳）。
static bool maintainWifi() {
  static uint32_t lastWifiCheck = 0;
  uint32_t now = millis();
  if (now - lastWifiCheck < 1000) return false;
  lastWifiCheck = now;
  bool up = WiFi.status() == WL_CONNECTED;
  if (!up && s_wifiDownSince == 0) s_wifiDownSince = now;
  if (up != g_online) {
    g_online = up;
    if (!up) {
      s_wifiDownSince = now;
      s_wifiLastSwitch = 0;
      WiFi.reconnect();
    } else {
      s_wifiDownSince = 0;
      s_wifiLastSwitch = 0;
    }
    return true;
  }
  if (!up && s_wifiDownSince != 0 && now - s_wifiDownSince >= 15000 &&
      (s_wifiLastSwitch == 0 || now - s_wifiLastSwitch >= 15000)) {
    int nxt = nextWifiGroup(g_wifiActive);
    if (nxt != 0 && nxt != g_wifiActive) {
      switchWifiGroup(nxt);
    } else {
      WiFi.reconnect();
      s_wifiLastSwitch = now;
    }
  }
  return false;
}

static void wifiManagerTask(void *) {
  if (g_wifiActive == 0) { const int group = nextWifiGroup(0); if (group) switchWifiGroup(group); }
  for (;;) {
    String ssid, password;
    bool pending;
    int slot = 2;
    if (g_resultMutex) xSemaphoreTake(g_resultMutex, portMAX_DELAY);
    pending = g_wifiConfigPending;
    if (pending) {
      ssid = g_nextSsid; password = g_nextPassword; slot = g_nextWifiSlot;
      g_wifiConfigPending = false; g_nextPassword = "";
    }
    if (g_resultMutex) xSemaphoreGive(g_resultMutex);
    if (pending) {
      Preferences prefs;
      bool saved = prefs.begin("sijia", false);
      if (saved) {
        const char *ssidKey = slot == 1 ? "ssid" : slot == 2 ? "ssid2" : "ssid3";
        const char *passKey = slot == 1 ? "pass" : slot == 2 ? "pass2" : "pass3";
        saved = prefs.putString(ssidKey, ssid) == ssid.length();
        saved = (prefs.putString(passKey, password) == password.length()) && saved;
        saved = saved && prefs.getString(ssidKey, "") == ssid && prefs.getString(passKey, "") == password;
        prefs.end();
      }
      if (saved) {
        if (slot == 1) { g_wifiSsid = ssid; g_wifiPass = password; }
        else if (slot == 2) { g_wifiSsid2 = ssid; g_wifiPass2 = password; }
        else { g_wifiSsid3 = ssid; g_wifiPass3 = password; }
        g_online = false; s_wifiDownSince = millis();
        switchWifiGroup(slot);
        Serial.println("[wifi] credentials saved; connecting");
      } else Serial.println("[wifi] could not save credentials");
    }
    maintainWifi();
    vTaskDelay(pdMS_TO_TICKS(100));
  }
}

#if USE_OLED_DISPLAY
// OLED 快照：把共享状态抄一份给 OLED 渲染（OLED 只读快照，不直接碰共享变量）。
static OledPageData buildOledSnapshot() {
  OledPageData s;
  s.wifiConnected = WiFi.status() == WL_CONNECTED;
  s.online = g_online;
  strncpy(s.ssid, WiFi.SSID().c_str(), sizeof(s.ssid) - 1);
  strncpy(s.ip, WiFi.localIP().toString().c_str(), sizeof(s.ip) - 1);
  strncpy(s.scenario, g_scenarioZh, sizeof(s.scenario) - 1);
  // OLED 上标签用短名（机油压力→油压），一行才放得下数值+状态。
  static const char *SHORT_LABELS[3] = {"水温", "油压", "转速"};
  for (int i = 0; i < 3; i++) {
    s.teleLabel[i] = SHORT_LABELS[i];
    s.teleValid[i] = !isnan(g_channels[i].value);
    s.teleValue[i] = g_channels[i].value;
    // unit 现在是通道自己的 char[8] 缓冲（永不为空指针），按值拷进快照。
    strncpy(s.teleUnit[i], g_channels[i].unit, sizeof(s.teleUnit[i]) - 1);
    s.teleUnit[i][sizeof(s.teleUnit[i]) - 1] = '\0';
    s.telePrecision[i] = g_channels[i].precision;
    s.teleState[i] = chanStateCode(g_channels[i]);
  }
  strncpy(s.lastQuestion, g_lastQuestion.c_str(), sizeof(s.lastQuestion) - 1);
  strncpy(s.lastAnswer, g_lastAnswer.c_str(), sizeof(s.lastAnswer) - 1);
  s.chatBusy = g_chatBusy;
  return s;
}
#endif  // USE_OLED_DISPLAY

#if ENABLE_OTA
// OTA 状态（网络任务写，主循环读；网络任务绝不直接碰 LVGL）
enum OtaState { OTA_IDLE = 0, OTA_UPDATING, OTA_FAILED };
struct OtaStatus { bool dirty = false; int state = OTA_IDLE; };
static OtaStatus g_otaStatus;

static void otaSetState(int state) {
  if (g_resultMutex) xSemaphoreTake(g_resultMutex, portMAX_DELAY);
  g_otaStatus.state = state;
  g_otaStatus.dirty = true;
  if (g_resultMutex) xSemaphoreGive(g_resultMutex);
}
#endif

// ---------- 小工具 ----------
// 答案是 Markdown 风格文本：去 **、行首 #、反引号，保留换行与序号。
static String stripMarkdown(const String &in) {
  String out;
  out.reserve(in.length());
  bool lineStart = true;
  for (size_t i = 0; i < in.length(); i++) {
    char c = in[i];
    if (c == '*' && i + 1 < in.length() && in[i + 1] == '*') { i++; continue; }
    if (c == '*' || c == '`') continue;
    if (lineStart && c == '#') continue;   // 行首 # 去掉（# 后面的空格留着无妨）
    out += c;
    lineStart = (c == '\n');
  }
  out.trim();
  return out;
}

static String httpGet(const String &url, int timeoutMs) {
  WiFiClientSecure client;
  client.setHandshakeTimeout(10);
  client.setInsecure();   // 演示终端：跳过证书校验（见 README 安全说明）
  HTTPClient http;
  http.setConnectTimeout(10000);
  http.begin(client, url);
  http.setTimeout(timeoutMs);
  int code = http.GET();
  String body;
  if (code == 200) body = http.getString();
  http.end();
  return body;
}

// ---------- 网络任务（FreeRTOS，core 0；绝不直接碰 LVGL）----------
static bool netPostChatOnce(const String &question, ChatResult &out) {
  WiFiClientSecure client;
  client.setHandshakeTimeout(10);
  client.setInsecure();
  HTTPClient http;
  http.setConnectTimeout(10000);
  http.begin(client, String(SIJIA_BASE_URL) + "/api/chat");
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(60000);
  // 注意：不要加 Origin 头；HTTPClient 默认不发，正好通过正式站同源检查。
  JsonDocument req;
  req["diagnosisMode"] = "auto";
  JsonArray msgs = req["messages"].to<JsonArray>();
  for (int i = 0; i < g_historyCount; i++) {
    JsonObject m = msgs.add<JsonObject>();
    m["role"] = g_history[i].role;
    m["content"] = g_history[i].content;
  }
  // startAsk() 已把问题追加进 g_history；只有历史已满（追加失败）时才在这里补发，
  // 否则问题会发两遍，服务器看到的提问会被重复。
  if (g_historyCount == 0 || g_history[g_historyCount - 1].content != question) {
    JsonObject m = msgs.add<JsonObject>();
    m["role"] = "user";
    m["content"] = question;
  }
  // 不发 sessionId：服务器的 sessionId 必须是 UUID 且对应已建好的诊断记录，
  // 机器人没有建记录的流程，发过去会被 400 拒绝（“诊断记录编号格式错误”）。
  // 不带 sessionId 时服务器按无记忆方式直接回答；多轮上下文由上面发的
  // messages 历史携带。
  JsonObject telemetry = req["telemetrySummary"].to<JsonObject>();
  telemetry["source"] = "simulated";
  telemetry["text"] = "屏幕读数来自网站模拟遥测并在终端增强波动和故障，不是实际农机测量；阈值为演示阈值。";
  String body;
  serializeJson(req, body);
  const uint32_t chatStarted = millis();
  int code = http.POST(body);
  Serial.printf("[chat] HTTP=%d response_ms=%lu history=%d\n", code, (unsigned long)(millis() - chatStarted), g_historyCount);
  if (code != 200) { http.end(); return false; }
  String payload = http.getString();
  http.end();
  JsonDocument doc;
  if (deserializeJson(doc, payload)) return false;
  const char *content = doc["choices"][0]["message"]["content"];
  if (!content) return false;
  out.answer = stripMarkdown(String(content));
  out.mode = doc["answerMode"] | "";
  out.provider = doc["provider"] | "";
  out.sourceCount = 0;
  out.sourceTotal = 0;
  JsonArray srcs = doc["knowledgeSources"].as<JsonArray>();
  if (!srcs.isNull()) {
    out.sourceTotal = (int)srcs.size();
    for (JsonObject s : srcs) {
      if (out.sourceCount >= 3) break;
      const char *t = s["sourceTitle"] | s["heading"] | s["source"] | s["entryId"] | (const char *)nullptr;
      if (t && *t) out.sources[out.sourceCount++] = String(t);
    }
  }
  out.ok = true;
  return true;
}

// 问答：60 秒超时，失败重试 1 次（方案 §3.2 的接口契约）。
static bool netPostChat(const String &question, ChatResult &out) {
  if (netPostChatOnce(question, out)) return true;
  delay(1000);
  return netPostChatOnce(question, out);
}

// 冷却液趋势：history 5 分钟窗口（1 秒 1 个点，最多 300 个），抽稀到 60 个画图。
static float g_trendVals[60];
static float g_metricTrends[3][60];
static int g_selectedMetric = 0;
static uint32_t g_chartUpdated = 0;
static lv_obj_t *g_metricCards[3] = {};
static int g_trendCount = 0;

static bool netFetchHistory(TeleChannel &ch, bool isCoolant) {
  String url = String(SIJIA_BASE_URL) + "/api/telemetry/history?channel=" + ch.id + "&window=5m";
  String payload = httpGet(url, 10000);
  if (payload.length() == 0) return false;
  JsonDocument doc;
  if (deserializeJson(doc, payload)) return false;
  JsonObject c = doc["channel"].as<JsonObject>();
  if (c.isNull()) return false;
  // 单位按值拷进通道自己的缓冲：c["unit"] 指向 doc 的内部缓冲，
  // doc 是本函数局部变量，返回即释放；直接存指针会成野指针（见 TeleChannel::unit）。
  strncpy(ch.unit, c["unit"] | "", sizeof(ch.unit) - 1);
  ch.unit[sizeof(ch.unit) - 1] = '\0';
  ch.minV = c["range"]["min"] | 0.0f;
  ch.maxV = c["range"]["max"] | 100.0f;
  ch.precision = c["precision"] | 0;
  JsonObject th = c["threshold"].as<JsonObject>();
  ch.hasAttention = ch.hasAlarm = false;
  if (!th.isNull()) {
    JsonObject att = th["attention"].as<JsonObject>(), alm = th["alarm"].as<JsonObject>();
    if (!att.isNull()) {
      if (!att["above"].isNull()) { ch.hasAttention = true; ch.attentionAbove = att["above"]; }
      if (!att["below"].isNull()) { ch.hasAttention = true; ch.attentionBelow = att["below"]; }
    }
    if (!alm.isNull()) {
      if (!alm["above"].isNull()) { ch.hasAlarm = true; ch.alarmAbove = alm["above"]; }
      if (!alm["below"].isNull()) { ch.hasAlarm = true; ch.alarmBelow = alm["below"]; }
    }
  }
  JsonArray pts = doc["points"].as<JsonArray>();
  if (pts.isNull() || pts.size() == 0) return false;
  float last = pts[pts.size() - 1]["value"] | NAN;
  if (!isnan(last)) { ch.value = last; ch.updatedAt = millis(); }
  if (isCoolant) {
    int n = (int)pts.size(), step = n > 60 ? n / 60 : 1, cnt = 0;
    for (int i = 0; i < n && cnt < 60; i += step) {
      float v = pts[i]["value"] | NAN;
      if (!isnan(v)) g_trendVals[cnt++] = v;
    }
    g_trendCount = cnt;
  }
  return true;
}

static bool netFetchScenario() {
  String payload = httpGet(String(SIJIA_BASE_URL) + "/api/telemetry/scenario", 10000);
  if (payload.length() == 0) return false;
  JsonDocument doc;
  if (deserializeJson(doc, payload)) return false;
  const char *id = doc["id"];
  if (!id) return false;
  strncpy(g_scenarioId, id, sizeof(g_scenarioId) - 1);
  for (auto &row : SCENARIO_ZH) {
    if (strcmp(id, row[0]) == 0) { strncpy(g_scenarioZh, row[1], sizeof(g_scenarioZh) - 1); break; }
  }
  return true;
}

#if ENABLE_OTA
// ---------- OTA 联网自动更新 ----------
// version.json 在 main 上（见 FLASHING.md §8）。
static const char *OTA_VERSION_URL =
    "https://raw.githubusercontent.com/srt2777/AgriDx/main/"
    "robot/firmware/rv0.1.0/version.json";

// 版本号按数字分段比较（0.1.10 > 0.1.9；字符串比较会错判）：-1 更小，0 相同，1 更大。
static int compareVersions(const String &a, const String &b) {
  size_t ia = 0, ib = 0;
  while (ia < a.length() || ib < b.length()) {
    long na = 0, nb = 0;
    while (ia < a.length() && a[ia] != '.') {
      if (isdigit((unsigned char)a[ia])) na = na * 10 + (a[ia] - '0');
      ia++;
    }
    while (ib < b.length() && b[ib] != '.') {
      if (isdigit((unsigned char)b[ib])) nb = nb * 10 + (b[ib] - '0');
      ib++;
    }
    if (na != nb) return na < nb ? -1 : 1;
    ia++;
    ib++;
  }
  return 0;
}

// 查一次新版；有新版就下载并重启。失败只记日志，下次检查再试，不死循环。
static void otaCheckAndUpdate() {
  String body = httpGet(String(OTA_VERSION_URL), 60000);
  if (body.length() == 0) {
    Serial.println("[OTA] 版本检查失败（无响应），下次再试");
    return;
  }
  JsonDocument doc;
  if (deserializeJson(doc, body)) {
    Serial.println("[OTA] version.json 解析失败，下次再试");
    return;
  }
  const char *ver = doc["version"];
  const char *url = doc["url"];
  if (!ver || !url || !*url) {
    Serial.println("[OTA] version.json 缺 version/url，下次再试");
    return;
  }
  if (compareVersions(String(ver), String(FIRMWARE_VERSION)) <= 0) {
    Serial.printf("[OTA] 已是最新（当前 %s，远程 %s）\n", FIRMWARE_VERSION, ver);
    return;
  }
  Serial.printf("[OTA] 发现新版 %s，开始下载\n", ver);
  otaSetState(OTA_UPDATING);
  WiFiClientSecure client;
  client.setHandshakeTimeout(10);
  client.setInsecure();  // 演示用：跳过证书校验（取舍见 FLASHING.md §8）
  httpUpdate.setFollowRedirects(HTTPC_FORCE_FOLLOW_REDIRECTS);
  httpUpdate.rebootOnUpdate(true);
  t_httpUpdate_return ret = httpUpdate.update(client, String(url));
  if (ret == HTTP_UPDATE_OK) {
    // 正常情况下 update() 内部已重启；走到这里是兜底。
    Serial.println("[OTA] 下载成功，重启进新版");
    delay(500);
    ESP.restart();
  } else {
    Serial.printf("[OTA] 更新失败：%s\n", httpUpdate.getLastErrorString().c_str());
    otaSetState(OTA_FAILED);
  }
}
#endif  // ENABLE_OTA

static void netTask(void *param) {
  (void)param;
  int teleCycle = 0;
#if ENABLE_OTA
  // OTA 检查：联网后约 10 秒查第一次，之后每 24 小时查一次。
  uint32_t otaLastCheckMs = 0;
  uint32_t otaIntervalMs = 10000;
  bool otaWifiSeen = false;
#endif
  for (;;) {
    if (WiFi.status() != WL_CONNECTED) { vTaskDelay(pdMS_TO_TICKS(1000)); continue; }
#if ENABLE_OTA
    if (!otaWifiSeen) { otaWifiSeen = true; otaLastCheckMs = millis(); }
    if (!g_chatPending && !g_telePending &&
        (millis() - otaLastCheckMs >= otaIntervalMs)) {
      otaLastCheckMs = millis();
      otaIntervalMs = 24UL * 3600UL * 1000UL;
      otaCheckAndUpdate();
    }
#endif
    if (g_chatPending) {
      g_chatPending = false;
      ChatResult r;
      r.ok = netPostChat(g_pendingQuestion, r);
      if (g_resultMutex) xSemaphoreTake(g_resultMutex, portMAX_DELAY);
      g_chatResult = r;
      g_chatResult.ready = true;
      if (g_resultMutex) xSemaphoreGive(g_resultMutex);
      continue;
    }
    if (!SIJIA_STREAM_TELEMETRY && g_telePending) {
      g_telePending = false;
      bool ok = true;
      for (int i = 0; i < 3; i++) ok = netFetchHistory(g_channels[i], i == 0) && ok;
      if ((teleCycle++ % 4) == 0) ok = netFetchScenario() && ok;
      if (g_resultMutex) xSemaphoreTake(g_resultMutex, portMAX_DELAY);
      g_teleResult.ok = ok;
      g_teleResult.ready = true;
      if (g_resultMutex) xSemaphoreGive(g_resultMutex);
    }
    vTaskDelay(pdMS_TO_TICKS(100));
  }
}

// ---------- UI（仅 LVGL TFT 版；OLED 版见 src/oled_ui.*）----------
#if !USE_OLED_DISPLAY
static lv_obj_t *g_topStatus = nullptr;   // 顶栏在线状态
// 两页底部导航：0=监测（默认），1=对话；蓝色文字与浅蓝底表示当前页。
static lv_obj_t *g_dots[3] = {nullptr, nullptr};
static lv_obj_t *g_tileview = nullptr;
static lv_obj_t *g_msgList = nullptr;     // 对话消息容器
static lv_obj_t *g_thinking = nullptr;    // “正在诊断…”行
#if SIJIA_VOICE_ENABLED
static lv_obj_t *g_voiceBtnLabel = nullptr;  // 麦克风按钮文字（按住说话/松开发送）
static lv_obj_t *g_voiceStatus = nullptr;    // 语音状态行（录音/思考/播报中）
#endif
static lv_obj_t *g_thinkLabel = nullptr;  // “正在诊断” + 省略号循环
static lv_obj_t *g_thinkDots[3] = {nullptr, nullptr, nullptr};  // 三点呼吸动画
static lv_timer_t *g_thinkTimer = nullptr;
static int g_thinkStep = 0;
static lv_obj_t *g_sourcesBox = nullptr;  // 最新一条回答的依据区
static lv_obj_t *g_sourcesLabel = nullptr;
static lv_obj_t *g_sourcesBtn = nullptr;
static lv_obj_t *g_toast = nullptr;
static lv_obj_t *g_alarmOverlay = nullptr;
static lv_obj_t *g_alarmTitle = nullptr;
static lv_obj_t *g_alarmDetail = nullptr;
static lv_obj_t *g_alarmPanel = nullptr;
static char g_alarmQuestion[192] = "";
// 只记有效采样的严重程度；缺失值不视为恢复，持续同等级不重复弹窗。
static int g_lastAlertCode[3] = {0, 0, 0};
// 监测页：3 张小卡片（大数字 + 单位 + 名称状态 + 底部细条）+ 1 张趋势图
static lv_obj_t *g_meterVal[3] = {nullptr, nullptr, nullptr};   // 大数字（22px）
static lv_obj_t *g_meterUnit[3] = {nullptr, nullptr, nullptr};  // 单位（12px）
static lv_obj_t *g_meterName[3] = {nullptr, nullptr, nullptr};  // “水温 · 正常”
static lv_obj_t *g_meterBarBg[3] = {nullptr, nullptr, nullptr};
static lv_obj_t *g_meterFill[3] = {nullptr, nullptr, nullptr};  // 底部细条（按阈值变色）
static lv_obj_t *g_alertStrip = nullptr;  // 告警横条（场景 + 状态，常驻，不弹窗）
static lv_obj_t *g_scenarioLabel = nullptr;
static lv_obj_t *g_updatedLabel = nullptr;
static lv_obj_t *g_chart = nullptr;
static lv_chart_series_t *g_chartSer = nullptr;
static lv_obj_t *g_thresholdLine = nullptr;
static lv_obj_t *g_chartTitle = nullptr;
static uint32_t g_lastTeleOk = 0;
static bool g_sourcesOpen = false;
// 按钮点按反馈：pressed 变色 + 缩放 0.96，100ms 过渡（见 stylePressable）。
static lv_style_transition_dsc_t g_pressTrans;
static const lv_style_prop_t g_pressProps[] = {
  LV_STYLE_BG_COLOR, LV_STYLE_TRANSFORM_SCALE_X, LV_STYLE_TRANSFORM_SCALE_Y,
  LV_STYLE_BORDER_COLOR, (lv_style_prop_t)0};
// ---------- 待机屏（10 秒无操作进；拖拉机动画只动轮子/尾气/光晕等小对象，
// LVGL 只重绘这些脏区，不全屏刷新）----------
#define STANDBY_TIMEOUT_MS 60000
static lv_obj_t *g_standbyOverlay = nullptr;
static lv_obj_t *g_standbyHalo = nullptr;    // 呼吸光晕
static lv_obj_t *g_standbyTitle = nullptr;   // “待机中”
static lv_obj_t *g_spokes[2][2] = {{nullptr, nullptr}, {nullptr, nullptr}};  // 轮辐线
static lv_obj_t *g_puffs[3] = {nullptr, nullptr, nullptr};   // 排气管尾气
static lv_obj_t *g_groundDots[3] = {nullptr, nullptr, nullptr};  // 地面移动点
static float g_wheelAngle = 0.0f;
static float g_puffPhase[3] = {0.0f, 0.33f, 0.66f};
static int32_t g_groundX[3] = {60, 140, 220};

static lv_obj_t *mkLabel(lv_obj_t *parent, const char *txt, const lv_font_t *font, lv_color_t color) {
  lv_obj_t *l = lv_label_create(parent);
  lv_label_set_text(l, txt);
  lv_obj_set_style_text_font(l, font, 0);
  lv_obj_set_style_text_color(l, color, 0);
  return l;
}

static void styleCard(lv_obj_t *o) {
  lv_obj_set_style_bg_color(o, C_CARD, 0);
  lv_obj_set_style_radius(o, 8, 0);
  lv_obj_set_style_border_width(o, 1, 0);
  lv_obj_set_style_border_color(o, C_BORDER, 0);
  lv_obj_set_style_shadow_width(o, 0, 0);
}

// ---------- 动效小件 ----------
static void animOpaCb(void *var, int32_t v) {
  lv_obj_set_style_opa((lv_obj_t *)var, (lv_opa_t)v, 0);
}

// 新气泡/新卡片淡入（250ms）；只影响该对象，不动全屏。
static void fadeIn(lv_obj_t *o) { lv_obj_set_style_opa(o, LV_OPA_COVER, 0); }

// 按钮点按反馈：pressed 时换底色 + 缩到 0.96，100ms 过渡（g_pressTrans 在 buildUi 里初始化）。
static void stylePressable(lv_obj_t *b, lv_color_t pressedBg) {
  lv_obj_set_style_bg_color(b, pressedBg, LV_STATE_PRESSED);
  // LVGL 9 里缩放属性叫 TRANSFORM_SCALE（旧名 zoom 是 v8 的别名映射）
}

static void showToast(const char *txt) {
  if (!g_toast) return;
  lv_label_set_text(lv_obj_get_child(g_toast, 0), txt);
  lv_obj_set_hidden(g_toast, false);
  lv_timer_t *t = lv_timer_create([](lv_timer_t *timer) {
    lv_obj_set_hidden(g_toast, true);
    lv_timer_del(timer);
  }, 2500, nullptr);
  lv_timer_set_repeat_count(t, 1);
}

// 复用原回调名；只改变两枚文字导航的选中样式。
static lv_obj_t *g_navUnderline = nullptr;
static lv_obj_t *g_presetOverlay = nullptr;
static int g_activePage = 0;
static void updateDots(int page) {
  const bool changed = page != g_activePage;
  g_activePage = page;
  if (g_navUnderline && changed) {
    lv_anim_t anim; lv_anim_init(&anim);
    lv_anim_set_var(&anim, g_navUnderline);
    lv_anim_set_values(&anim, lv_obj_get_x(g_navUnderline), 8 + page * 106);
    lv_anim_set_duration(&anim, 180);
    lv_anim_set_exec_cb(&anim, [](void *o, int32_t x) { lv_obj_set_x(static_cast<lv_obj_t *>(o), x); });
    lv_anim_set_path_cb(&anim, lv_anim_path_ease_out);
    lv_anim_start(&anim);
  }
  for (int i = 0; i < 3; i++) {
    if (!g_dots[i]) continue;
    lv_obj_set_style_bg_color(g_dots[i], i == page ? C_TINT : C_CARD, 0);
    lv_obj_set_style_text_color(lv_obj_get_child(g_dots[i], 0),
                               i == page ? C_PRIMARY : C_SUBTEXT, 0);
  }
}

// 点导航切换到对应页，手势滑动仍可使用。
static void onDotClicked(lv_event_t *e) {
  int idx = (int)(intptr_t)lv_event_get_user_data(e);
  if (idx < 0 || idx >= 3) return;
  markActive();
  lv_tileview_set_tile_by_index(g_tileview, idx, 0, LV_ANIM_OFF);
  updateDots(idx);
}

// ---------- 对话 ----------
static void fitChatContent();
static void addUserBubble(const char *q) {
  while (lv_obj_get_child_count(g_msgList) >= 8) lv_obj_delete(lv_obj_get_child(g_msgList, 0));
  lv_obj_t *row = lv_obj_create(g_msgList);
  lv_obj_set_scrollable(row, false);
  lv_obj_set_width(row, lv_pct(100));
  lv_obj_set_height(row, LV_SIZE_CONTENT);
  lv_obj_set_style_bg_color(row, C_TINT, 0);
  lv_obj_set_style_radius(row, 8, 0);
  lv_obj_set_style_border_width(row, 1, 0);
  lv_obj_set_style_border_color(row, C_BORDER, 0);
  lv_obj_set_style_shadow_width(row, 0, 0);
  lv_obj_set_style_pad_all(row, 6, 0);
  lv_obj_t *l = mkLabel(row, q, &font_zh_16, C_TEXT);
  lv_label_set_long_mode(l, LV_LABEL_LONG_WRAP);
  lv_obj_set_width(l, lv_pct(100));
  fadeIn(row);
  fitChatContent();
}

static void addAssistantCard(const char *answer, const char *tag) {
  lv_obj_t *row = lv_obj_create(g_msgList);
  lv_obj_set_scrollable(row, false);
  lv_obj_set_width(row, lv_pct(100));
  lv_obj_set_height(row, LV_SIZE_CONTENT);
  styleCard(row);
  lv_obj_set_style_pad_all(row, 6, 0);
  lv_obj_set_layout(row, LV_LAYOUT_FLEX);
  lv_obj_set_flex_flow(row, LV_FLEX_FLOW_COLUMN);
  lv_obj_set_style_pad_gap(row, 4, 0);
  lv_obj_t *tagL = mkLabel(row, tag, &font_zh_12, C_PRIMARY);
  lv_obj_set_width(tagL, lv_pct(100));
  lv_obj_t *l = mkLabel(row, answer, &font_zh_16, C_TEXT);
  lv_obj_set_style_text_line_space(l, 4, 0);
  lv_label_set_long_mode(l, LV_LABEL_LONG_WRAP);
  lv_obj_set_width(l, lv_pct(100));
  lv_obj_update_layout(g_msgList);
  lv_obj_scroll_to_view(row, LV_ANIM_OFF);
  fadeIn(row);
  fitChatContent();
}

// “正在诊断”省略号循环（· 是字库符号之一）。
static void onThinkTick(lv_timer_t *t) {
  (void)t;
  g_thinkStep = (g_thinkStep + 1) % 4;
  char buf[24] = "正在诊断";
  for (int i = 0; i < g_thinkStep; i++) strcat(buf, "·");
  lv_label_set_text(g_thinkLabel, buf);
}

static void setThinking(bool on) {
  if (g_thinkTimer) { lv_timer_del(g_thinkTimer); g_thinkTimer = nullptr; }
  for (int i=0;i<3;++i) { lv_anim_delete(g_thinkDots[i], animOpaCb); lv_obj_set_hidden(g_thinkDots[i], true); }
  lv_label_set_text(g_thinkLabel, "正在诊断，请稍等");
  lv_obj_set_hidden(g_thinking, !on);
  fitChatContent();
}

static void askQuestion(const char *q) {
#if SIJIA_VOICE_ENABLED
  if (voiceIsBusy()) { showToast("语音进行中，请稍等"); return; }
#endif
  if (!startAsk(q)) {
    showToast(g_chatBusy ? "正在诊断，请稍等" : "未联网，请检查 WiFi");
    return;
  }
  addUserBubble(q);
  lv_tileview_set_tile_by_index(g_tileview, 1, 0, LV_ANIM_OFF);
  updateDots(1);
  setThinking(true);
}

static void onPreset(lv_event_t *e) {
  int idx = (int)(intptr_t)lv_event_get_user_data(e);
  markActive();
  askQuestion(PRESET_QUESTIONS[idx]);
}
static void onInputPlaceholder(lv_event_t *e) {
  (void)e;
  markActive();
#if SIJIA_VOICE_ENABLED
  // S3 语音版：文字输入还没做，引导用户用麦克风按钮说话。
  showToast("按住说话，松开后发送");
#else
  // C3 环境没有麦克风按钮，保持原来的提示文字（一个字也不改，
  // 保证 C3 固件与改动前一致）。
  showToast("输入法在 RV0.2.0（语音版）提供，当前用预设问题提问");
#endif
}
#if SIJIA_VOICE_ENABLED
// 麦克风按钮：按下开始录音，松开发送（按钮文字由 updateVoiceUi 按状态刷新）。
static void onMicPressed(lv_event_t *e) {
  (void)e;
  if (g_chatBusy) { showToast("正在诊断，请稍等"); return; }
  if (!voiceStartRecording()) {
    showToast(g_online ? "语音正忙或不可用" : "未联网，请检查 WiFi");
  }
}
static void onMicReleased(lv_event_t *e) {
  (void)e;
  voiceStopRecordingAndSend();  // 不在录音中时返回 false，什么都不做
}
// 播报中点对话屏打断（点预设按钮/滑动切页不走这里，不会误打断）。
static void onChatTap(lv_event_t *e) {
  (void)e;
  if (voiceGetState() == VOICE_PLAYING) {
    voiceStopPlayback();
    showToast("已停止播报");
  }
}
#endif
static void onSourcesToggle(lv_event_t *e) {
  (void)e;
  markActive();
  g_sourcesOpen = !g_sourcesOpen;
  if (g_sourcesOpen) lv_obj_set_hidden(g_sourcesBox, false);
  else lv_obj_set_hidden(g_sourcesBox, true);
  fitChatContent();
  lv_label_set_text(lv_obj_get_child(g_sourcesBtn, 0),
                    g_sourcesOpen ? "查看依据与核对项（收起）" : "查看依据与核对项（展开）");
}
static void onNewChat(lv_event_t *e) {
  (void)e;
  markActive();
  g_historyCount = 0;
  lv_obj_clean(g_msgList);
  lv_obj_set_hidden(g_sourcesBox, true);
  g_sourcesOpen = false;
  showToast("已开始新对话");
}
static void onTileChanged(lv_event_t *e) {
  (void)e;
  markActive();
  lv_obj_t *tile = lv_tileview_get_tile_active(g_tileview);
  int col = lv_obj_get_index(tile);
  updateDots(col);
}

// ---------- 监控 ----------
static void onAlarmDismiss(lv_event_t *e) {
  (void)e;
  markActive();
  lv_obj_set_hidden(g_alarmOverlay, true);
}

static void onAlarmDiagnose(lv_event_t *e) {
  (void)e;
  markActive();
  lv_obj_set_hidden(g_alarmOverlay, true);
  lv_tileview_set_tile_by_index(g_tileview, 1, 0, LV_ANIM_OFF);
  updateDots(1);
  askQuestion(g_alarmQuestion);
}

static void maybeShowTelemetryAlert() {
  int changedChannel = -1;
  int changedCode = 0;
  for (int i = 0; i < 3; i++) {
    const int code = chanStateCode(g_channels[i]);
    if (code < 0) continue;
    if (code > g_lastAlertCode[i] && code > changedCode) {
      changedChannel = i;
      changedCode = code;
    }
    g_lastAlertCode[i] = code;
  }
  if (changedChannel < 0 || !g_alarmOverlay) return;
  wakeStandby();
  const TeleChannel &ch = g_channels[changedChannel];
  char value[24];
  snprintf(value, sizeof(value), "%.*f", ch.precision, ch.value);
  const char *severity = changedCode == 2 ? "报警" : "注意";
  const lv_color_t color = changedCode == 2 ? C_RED : C_AMBER;
  char detail[96];
  snprintf(detail, sizeof(detail), "%s  %s %s", ch.label, value, ch.unit);
  lv_label_set_text(g_alarmTitle, severity);
  lv_obj_set_style_text_color(g_alarmTitle, color, 0);
  lv_obj_set_style_border_color(g_alarmPanel, color, 0);
  lv_label_set_text(g_alarmDetail, detail);
  snprintf(g_alarmQuestion, sizeof(g_alarmQuestion),
           "模拟数据中，拖拉机%s为%s%s，提示%s，应该怎样排查？",
           ch.label, value, ch.unit, severity);
  lv_obj_set_hidden(g_alarmOverlay, false);
  lv_obj_move_foreground(g_alarmOverlay);
}

static const char *chanStateText(const TeleChannel &ch, lv_color_t *color) {
  switch (chanStateCode(ch)) {
    case 2: *color = C_RED; return "报警";
    case 1: *color = C_AMBER; return "注意";
    case 0: *color = C_DARKGREEN; return "正常";
    default: *color = C_SUBTEXT; return "—";
  }
}

static void setLabelIfChanged(lv_obj_t *label, const char *text) {
  if (strcmp(lv_label_get_text(label), text) != 0) lv_label_set_text(label, text);
}

static void refreshMetricChart() {
  // Same 60-second horizontal window; tenths preserve smooth sub-degree changes.
  const bool redrawChart = g_chartUpdated == 0 || millis() - g_chartUpdated >= 2000;
  const auto &selected = g_channels[g_selectedMetric];
  const float thr = selected.hasAlarm ? (isfinite(selected.alarmAbove) ? selected.alarmAbove : selected.alarmBelow) : NAN;
  if (redrawChart && g_trendCount > 0) {
    g_chartUpdated = millis();
    const float *trend = g_metricTrends[g_selectedMetric];
    float low = trend[0], high = low;
    for (int i = 1; i < g_trendCount; ++i) {
      low = fminf(low, trend[i]); high = fmaxf(high, trend[i]);
    }
    const float minimumSpan[] = {8.0f, 40.0f, 400.0f};
    const float padding = minimumSpan[g_selectedMetric] * 0.06f;
    float span = fmaxf(minimumSpan[g_selectedMetric], high - low + 2 * padding);
    float middle = (low + high) * 0.5f;
    int chartMin = (int)floorf((middle - span / 2) * 10);
    int chartMax = (int)ceilf((middle + span / 2) * 10);
    lv_chart_set_range(g_chart, LV_CHART_AXIS_PRIMARY_Y, chartMin, chartMax);
    int32_t *ys = lv_chart_get_series_y_array(g_chart, g_chartSer);
    for (int i = 0; i < 60; ++i)
      ys[i] = i < g_trendCount ? (int32_t)lroundf(trend[i] * 10) : LV_CHART_POINT_NONE;
    lv_chart_refresh(g_chart);
    char tbuf[96];
    snprintf(tbuf, sizeof(tbuf), "%s %.0f-%.0f%s · 60秒", g_selectedMetric == 1 ? "油压" : selected.label,
             chartMin / 10.0f, chartMax / 10.0f, selected.unit);
    setLabelIfChanged(g_chartTitle, tbuf);
    if (g_thresholdLine) {
      const float scaledThreshold = thr * 10;
      const bool visible = isfinite(thr) && scaledThreshold >= chartMin && scaledThreshold <= chartMax;
      lv_obj_set_hidden(g_thresholdLine, !visible);
      if (visible) {
        lv_coord_t h = lv_obj_get_height(g_chart) - 2;
        lv_coord_t y = (lv_coord_t)lroundf((chartMax - scaledThreshold) / (chartMax - chartMin) * h);
        static lv_point_precise_t pts[2];
        pts[0].x = 0; pts[0].y = y;
        pts[1].x = lv_obj_get_width(g_chart) - 2; pts[1].y = y;
        lv_line_set_points(g_thresholdLine, pts, 2);
      }
    }
  }
}

static void applyTelemetryToUi() {
  // 三张小卡片：大数字 + 单位 + 名称状态 + 底部细条（数值按阈值绿→黄→红）
  for (int i = 0; i < 3; i++) {
    TeleChannel &ch = g_channels[i];
    char buf[24];
    if (isnan(ch.value)) snprintf(buf, sizeof(buf), "--");
    else if (ch.precision == 0) snprintf(buf, sizeof(buf), "%.0f", ch.value);
    else snprintf(buf, sizeof(buf), "%.*f", ch.precision, ch.value);
    setLabelIfChanged(g_meterVal[i], buf);
    setLabelIfChanged(g_meterUnit[i], ch.unit);
    lv_color_t c;
    const char *st = chanStateText(ch, &c);
    char nbuf[32];
    snprintf(nbuf, sizeof(nbuf), "%s · %s", i == 1 ? "油压" : ch.label, st);
    setLabelIfChanged(g_meterName[i], nbuf);
    if (!lv_color_eq(lv_obj_get_style_text_color(g_meterName[i], LV_PART_MAIN), c))
      lv_obj_set_style_text_color(g_meterName[i], c, 0);
    // 底部细条：宽度按量程比例，颜色跟状态走
    lv_coord_t bw = lv_obj_get_width(g_meterBarBg[i]);
    float frac = 0.0f;
    if (!isnan(ch.value) && ch.maxV > ch.minV)
      frac = (ch.value - ch.minV) / (ch.maxV - ch.minV);
    if (frac < 0) frac = 0;
    if (frac > 1) frac = 1;
    const lv_coord_t width = (lv_coord_t)(frac * bw);
    if (lv_obj_get_style_width(g_meterFill[i], LV_PART_MAIN) != width)
      lv_obj_set_width(g_meterFill[i], width);
    if (!lv_color_eq(lv_obj_get_style_bg_color(g_meterFill[i], LV_PART_MAIN), c))
      lv_obj_set_style_bg_color(g_meterFill[i], c, 0);
  }
  // 常驻横条显示最严重状态；异常首次出现或升级时另弹提示。
  int worstCode = 0;  // 0 正常，1 注意，2 报警
  int worstIdx = 0;
  for (int i = 0; i < 3; i++) {
    int code = chanStateCode(g_channels[i]);
    if (code > worstCode) { worstCode = code; worstIdx = i; }
  }
  char sbuf[64];
  const lv_color_t background = worstCode == 2 ? C_LIGHTRED : worstCode == 1 ? C_LIGHTAMBER : C_GREENBG;
  const lv_color_t foreground = worstCode == 2 ? C_RED : worstCode == 1 ? C_AMBER : C_DARKGREEN;
  if (worstCode != 0) {
    snprintf(sbuf, sizeof(sbuf), "%s：%s %.0f%s", worstCode == 2 ? "报警" : "注意",
             g_channels[worstIdx].label, g_channels[worstIdx].value, g_channels[worstIdx].unit);
  } else {
    snprintf(sbuf, sizeof(sbuf), "暂无告警");
  }
  setLabelIfChanged(g_scenarioLabel, sbuf);
  if (!lv_color_eq(lv_obj_get_style_bg_color(g_alertStrip, LV_PART_MAIN), background))
    lv_obj_set_style_bg_color(g_alertStrip, background, 0);
  if (!lv_color_eq(lv_obj_get_style_text_color(g_scenarioLabel, LV_PART_MAIN), foreground))
    lv_obj_set_style_text_color(g_scenarioLabel, foreground, 0);
  refreshMetricChart();
  g_lastTeleOk = millis();
  setLabelIfChanged(g_updatedLabel, "更新于刚刚");
  maybeShowTelemetryAlert();
}

// ---------- 界面搭建 ----------
static void buildTopBar(lv_obj_t *scr) {
  lv_obj_t *bar = lv_obj_create(scr);
  lv_obj_set_width(bar, lv_pct(100));
  lv_obj_set_height(bar, 30);
  lv_obj_set_style_bg_color(bar, C_CARD, 0);
  lv_obj_set_style_radius(bar, 0, 0);
  lv_obj_set_style_border_width(bar, 0, 0);
  lv_obj_set_style_border_side(bar, LV_BORDER_SIDE_BOTTOM, 0);
  lv_obj_set_style_border_width(bar, 1, LV_PART_MAIN);
  lv_obj_set_style_border_color(bar, C_BORDER, 0);
  lv_obj_set_style_pad_all(bar, 4, 0);
  lv_obj_set_style_pad_left(bar, 8, 0);
  lv_obj_set_style_pad_right(bar, 8, 0);
  lv_obj_set_style_shadow_width(bar, 0, 0);
  lv_obj_set_layout(bar, LV_LAYOUT_FLEX);
  lv_obj_set_flex_flow(bar, LV_FLEX_FLOW_ROW);
  lv_obj_set_flex_align(bar, LV_FLEX_ALIGN_SPACE_BETWEEN, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
  mkLabel(bar, "司稼 · 智能运维", &font_zh_16, C_TEXT);
  g_topStatus = mkLabel(bar, "连接中…", &font_zh_12, C_SUBTEXT);
}

static void buildPresetBar(lv_obj_t *tile) {
  // 四个快捷诊断问题横向滚动；不再占用独立首页。
  lv_obj_t *grid = lv_obj_create(tile);
  lv_obj_set_width(grid, lv_pct(100));
  lv_obj_set_height(grid, 30);
  lv_obj_set_style_bg_opa(grid, LV_OPA_TRANSP, 0);
  lv_obj_set_style_border_width(grid, 0, 0);
  lv_obj_set_style_pad_all(grid, 0, 0);
  lv_obj_set_style_pad_gap(grid, 6, 0);
  lv_obj_set_layout(grid, LV_LAYOUT_FLEX);
  lv_obj_set_flex_flow(grid, LV_FLEX_FLOW_ROW);
  lv_obj_set_scroll_dir(grid, LV_DIR_HOR);
  lv_obj_set_scrollbar_mode(grid, LV_SCROLLBAR_MODE_OFF);
  for (int i = 0; i < 4; i++) {
    lv_obj_t *b = lv_btn_create(grid);
    lv_obj_set_width(b, LV_SIZE_CONTENT);
    lv_obj_set_height(b, 28);
    lv_obj_set_style_pad_hor(b, 8, 0);
    lv_obj_set_style_pad_ver(b, 4, 0);
    lv_obj_set_style_bg_color(b, C_CARD, 0);
    lv_obj_set_style_radius(b, 6, 0);
    lv_obj_set_style_border_width(b, 1, 0);
    lv_obj_set_style_border_color(b, C_BORDER, 0);
    lv_obj_set_style_shadow_width(b, 0, 0);
    stylePressable(b, C_TINT);  // 旧版工作台：点按浅蓝底、蓝色边框
    lv_obj_set_style_border_color(b, C_PRIMARY, LV_STATE_PRESSED);
    lv_obj_t *l = lv_label_create(b);
    lv_label_set_text(l, PRESET_LABELS[i]);
    lv_obj_set_style_text_font(l, &font_zh_12, 0);
    lv_obj_set_style_text_color(l, C_TEXT, 0);
    lv_obj_center(l);
    lv_obj_add_event_cb(b, onPreset, LV_EVENT_CLICKED, (void *)(intptr_t)i);
  }
}

static void onQuickQuestion(lv_event_t *event) {
  const char *question = static_cast<const char *>(lv_event_get_user_data(event));
  lv_obj_set_hidden(g_presetOverlay, true);
  askQuestion(question);
}
static void onQuickMenu(lv_event_t *) {
  if (!g_presetOverlay) {
    g_presetOverlay = lv_obj_create(lv_layer_top());
    lv_obj_set_size(g_presetOverlay, 304, 214);
    lv_obj_center(g_presetOverlay);
    styleCard(g_presetOverlay);
    lv_obj_set_scrollable(g_presetOverlay, false);
    lv_obj_set_style_pad_all(g_presetOverlay, 8, 0);
    lv_obj_t *title = mkLabel(g_presetOverlay, "常用问题", &font_zh_16, C_TEXT);
    lv_obj_set_pos(title, 2, 3);
    lv_obj_t *close = lv_btn_create(g_presetOverlay);
    lv_obj_set_pos(close, 236, 0); lv_obj_set_size(close, 44, 28);
    lv_obj_set_style_shadow_width(close, 0, 0);
    lv_obj_set_style_bg_color(close, C_TINT, 0);
    lv_obj_t *cl = mkLabel(close, "关闭", &font_zh_12, C_PRIMARY); lv_obj_center(cl);
    lv_obj_add_event_cb(close, [](lv_event_t *) { lv_obj_set_hidden(g_presetOverlay, true); }, LV_EVENT_CLICKED, nullptr);
    static const char *labels[] = {"水温高", "启动困难", "变速箱异响", "保养周期", "先检查哪里", "说简单一点"};
    static const char *questions[] = {"拖拉机水温高怎么办", "拖拉机发动机启动困难怎么办", "拖拉机变速箱异响怎么办", "拖拉机保养周期怎么定", "那我应该先检查哪里？", "请用更简短易懂的话说明下一步操作。"};
    for (int i = 0; i < 6; ++i) {
      lv_obj_t *button = lv_btn_create(g_presetOverlay);
      lv_obj_set_pos(button, (i % 2) * 146, 38 + (i / 2) * 52);
      lv_obj_set_size(button, 138, 44);
      lv_obj_set_style_bg_color(button, C_TINT, 0);
      lv_obj_set_style_shadow_width(button, 0, 0);
      lv_obj_set_style_radius(button, 8, 0);
      lv_obj_t *text = mkLabel(button, labels[i], &font_zh_16, C_PRIMARY); lv_obj_center(text);
      lv_obj_add_event_cb(button, onQuickQuestion, LV_EVENT_CLICKED, (void *)questions[i]);
    }
  }
  lv_obj_set_hidden(g_presetOverlay, false);
  lv_obj_move_foreground(g_presetOverlay);
  markActive();
}

static void buildChatTile(lv_obj_t *tile) {
  lv_obj_set_layout(tile, LV_LAYOUT_FLEX);
  lv_obj_set_flex_flow(tile, LV_FLEX_FLOW_COLUMN);
  lv_obj_set_style_pad_all(tile, 6, 0);
  lv_obj_set_style_pad_gap(tile, 3, 0);

  g_msgList = lv_obj_create(tile);
  lv_obj_set_width(g_msgList, lv_pct(100));
  lv_obj_set_height(g_msgList, LV_SIZE_CONTENT);
  lv_obj_set_flex_grow(g_msgList, 0);
  lv_obj_set_style_max_height(g_msgList, 126, 0);
  lv_obj_set_scroll_dir(g_msgList, LV_DIR_VER);
  lv_obj_set_style_bg_opa(g_msgList, LV_OPA_TRANSP, 0);
  lv_obj_set_style_border_width(g_msgList, 0, 0);
  lv_obj_set_style_pad_all(g_msgList, 2, 0);
  lv_obj_set_style_pad_gap(g_msgList, 6, 0);
  lv_obj_set_layout(g_msgList, LV_LAYOUT_FLEX);
  lv_obj_set_flex_flow(g_msgList, LV_FLEX_FLOW_COLUMN);
#if SIJIA_VOICE_ENABLED
  // 播报中点对话区打断（LV_EVENT_CLICKED 只在轻点时触发，滑动不触发）。
  lv_obj_add_event_cb(g_msgList, onChatTap, LV_EVENT_CLICKED, nullptr);
#endif
  // 欢迎行
  lv_obj_t *w = lv_obj_create(g_msgList);
  lv_obj_set_width(w, lv_pct(100));
  lv_obj_set_height(w, LV_SIZE_CONTENT);
  styleCard(w);
  lv_obj_set_style_pad_all(w, 6, 0);
  lv_obj_t *wl = mkLabel(w, "按住下方按钮说出故障，松开发送。", &font_zh_16, C_TEXT);
  lv_label_set_long_mode(wl, LV_LABEL_LONG_WRAP);
  lv_obj_set_width(wl, lv_pct(100));
  // 思考中：文字 + 三点呼吸动画（点按预设问题后立即出现）
  g_thinking = lv_obj_create(tile);
  lv_obj_set_width(g_thinking, lv_pct(100));
  lv_obj_set_height(g_thinking, 24);
  lv_obj_set_style_bg_opa(g_thinking, LV_OPA_TRANSP, 0);
  lv_obj_set_style_border_width(g_thinking, 0, 0);
  lv_obj_set_style_pad_all(g_thinking, 0, 0);
  lv_obj_set_layout(g_thinking, LV_LAYOUT_FLEX);
  lv_obj_set_flex_flow(g_thinking, LV_FLEX_FLOW_ROW);
  lv_obj_set_flex_align(g_thinking, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
  lv_obj_set_style_pad_gap(g_thinking, 4, 0);
  g_thinkLabel = mkLabel(g_thinking, "正在诊断", &font_zh_16, C_SUBTEXT);
  for (int i = 0; i < 3; i++) {
    g_thinkDots[i] = lv_obj_create(g_thinking);
    lv_obj_set_size(g_thinkDots[i], 8, 8);
    lv_obj_set_style_radius(g_thinkDots[i], LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_bg_color(g_thinkDots[i], C_PRIMARY, 0);
    lv_obj_set_style_border_width(g_thinkDots[i], 0, 0);
  }
  lv_obj_set_hidden(g_thinking, true);
#if SIJIA_VOICE_ENABLED
  // 语音状态行（默认隐藏；录音/思考/播报中才显示，见 updateVoiceUi）。
  g_voiceStatus = mkLabel(tile, "", &font_zh_12, C_SUBTEXT);
  lv_obj_set_width(g_voiceStatus, lv_pct(100));
  lv_obj_set_hidden(g_voiceStatus, true);
#endif
  // 依据区（默认隐藏，回答带依据时才出现）
  g_sourcesBox = lv_obj_create(tile);
  lv_obj_set_width(g_sourcesBox, lv_pct(100));
  lv_obj_set_height(g_sourcesBox, LV_SIZE_CONTENT);
  styleCard(g_sourcesBox);
  lv_obj_set_style_pad_all(g_sourcesBox, 6, 0);
  g_sourcesLabel = mkLabel(g_sourcesBox, "", &font_zh_16, C_SUBTEXT);
  lv_label_set_long_mode(g_sourcesLabel, LV_LABEL_LONG_WRAP);
  lv_obj_set_width(g_sourcesLabel, lv_pct(100));
  lv_obj_set_hidden(g_sourcesBox, true);
  g_sourcesBtn = lv_btn_create(tile);
  lv_obj_set_width(g_sourcesBtn, lv_pct(100));
  lv_obj_set_height(g_sourcesBtn, 28);
  lv_obj_set_style_bg_color(g_sourcesBtn, C_CARD, 0);
  lv_obj_set_style_radius(g_sourcesBtn, 6, 0);
  lv_obj_set_style_border_width(g_sourcesBtn, 1, 0);
  lv_obj_set_style_border_color(g_sourcesBtn, C_BORDER, 0);
  lv_obj_set_style_shadow_width(g_sourcesBtn, 0, 0);
  stylePressable(g_sourcesBtn, C_TINT);
  lv_obj_t *sl = lv_label_create(g_sourcesBtn);
  lv_label_set_text(sl, "查看依据与核对项（展开）");
  lv_obj_set_style_text_font(sl, &font_zh_12, 0);
  lv_obj_set_style_text_color(sl, C_PRIMARY, 0);
  lv_obj_center(sl);
  lv_obj_add_event_cb(g_sourcesBtn, onSourcesToggle, LV_EVENT_CLICKED, nullptr);
  lv_obj_set_hidden(g_sourcesBtn, true);
  // Fixed compact voice control: status messages must not move a held button.
  lv_obj_t *bottom = lv_obj_create(tile);
  lv_obj_set_width(bottom, lv_pct(100));
  lv_obj_set_height(bottom, 28);
  lv_obj_add_flag(bottom, LV_OBJ_FLAG_FLOATING);
  lv_obj_align(bottom, LV_ALIGN_BOTTOM_MID, 0, 0);
  lv_obj_set_scrollable(bottom, false);
  lv_obj_set_style_bg_opa(bottom, LV_OPA_TRANSP, 0);
  lv_obj_set_style_border_width(bottom, 0, 0);
  lv_obj_set_style_pad_all(bottom, 0, 0);
  lv_obj_set_layout(bottom, LV_LAYOUT_FLEX);
  lv_obj_set_flex_flow(bottom, LV_FLEX_FLOW_ROW);
  lv_obj_set_style_pad_gap(bottom, 6, 0);
  lv_obj_set_flex_align(bottom, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
#if SIJIA_VOICE_ENABLED
  // 麦克风按钮（RV0.2.0 语音）：按住录音，松开发送；最长 15 秒自动停并发送。
  lv_obj_t *mic = lv_btn_create(bottom);
  lv_obj_set_width(mic, 120);
  lv_obj_set_height(mic, 28);
  lv_obj_set_style_pad_all(mic, 2, 0);
  lv_obj_set_style_bg_color(mic, C_PRIMARY, 0);
  lv_obj_set_style_bg_color(mic, C_PRIMARY_DARK, LV_STATE_PRESSED);
  lv_obj_set_style_radius(mic, 6, 0);
  lv_obj_set_style_border_width(mic, 0, 0);
  lv_obj_set_style_shadow_width(mic, 0, 0);
  g_voiceBtnLabel = lv_label_create(mic);
  lv_label_set_text(g_voiceBtnLabel, "按住说话");
  lv_obj_set_style_text_font(g_voiceBtnLabel, &font_zh_16, 0);
  lv_obj_set_style_text_color(g_voiceBtnLabel, C_WHITE, 0);
  lv_obj_center(g_voiceBtnLabel);
  lv_obj_add_event_cb(mic, onMicPressed, LV_EVENT_PRESSED, nullptr);
  lv_obj_add_event_cb(mic, onMicReleased, LV_EVENT_RELEASED, nullptr);
  lv_obj_add_event_cb(mic, onMicReleased, LV_EVENT_PRESS_LOST, nullptr);
  lv_obj_t *quick = lv_btn_create(bottom);
  lv_obj_set_size(quick, 56, 28);
  lv_obj_set_style_bg_color(quick, C_TINT, 0);
  lv_obj_set_style_shadow_width(quick, 0, 0);
  lv_obj_set_style_pad_all(quick, 2, 0);
  lv_obj_t *quickLabel = mkLabel(quick, "常用", &font_zh_16, C_PRIMARY); lv_obj_center(quickLabel);
  lv_obj_add_event_cb(quick, onQuickMenu, LV_EVENT_CLICKED, nullptr);
#endif

}

// Do not reserve a tall blank message area above the talk button. Short
// conversations fit their content; long answers use all remaining space.
static void fitChatContent() {
  if (!g_msgList) return;
  lv_obj_t *tile = lv_obj_get_parent(g_msgList);
  lv_obj_update_layout(tile);
  int available = lv_obj_get_content_height(tile);
  int visibleSiblings = 0;
  for (uint32_t i = 0; i < lv_obj_get_child_count(tile); ++i) {
    lv_obj_t *child = lv_obj_get_child(tile, i);
    if (child == g_msgList || lv_obj_has_flag(child, LV_OBJ_FLAG_HIDDEN)) continue;
    available -= lv_obj_get_height(child);
    ++visibleSiblings;
  }
  available -= visibleSiblings * 3;
  lv_obj_set_style_max_height(g_msgList, max(32, available), 0);
  lv_obj_update_layout(tile);
}

static void onMetricClicked(lv_event_t *event) {
  const int index = (int)(intptr_t)lv_event_get_user_data(event);
  if (index < 0 || index >= 3 || index == g_selectedMetric) return;
  g_selectedMetric = index;
  g_chartUpdated = 0;
  for (int i = 0; i < 3; ++i) {
    lv_obj_set_style_border_color(g_metricCards[i], i == index ? C_PRIMARY : C_BORDER, 0);
    lv_obj_set_style_bg_color(g_metricCards[i], i == index ? C_TINT : C_CARD, 0);
  }
  refreshMetricChart();
  markActive();
}

static void buildMonitorTile(lv_obj_t *tile) {
  // 320x240：30px 顶栏 + 32px 导航；中间三张 64px 指标卡和紧凑趋势图。
  lv_obj_set_layout(tile, LV_LAYOUT_FLEX);
  lv_obj_set_flex_flow(tile, LV_FLEX_FLOW_COLUMN);
  lv_obj_set_style_pad_all(tile, 6, 0);
  lv_obj_set_style_pad_gap(tile, 4, 0);
  // 三张小卡片
  lv_obj_t *row = lv_obj_create(tile);
  lv_obj_set_width(row, lv_pct(100));
  lv_obj_set_height(row, 64);
  lv_obj_set_style_bg_opa(row, LV_OPA_TRANSP, 0);
  lv_obj_set_style_border_width(row, 0, 0);
  lv_obj_set_style_pad_all(row, 0, 0);
  lv_obj_set_style_pad_gap(row, 6, 0);
  lv_obj_set_layout(row, LV_LAYOUT_FLEX);
  lv_obj_set_flex_flow(row, LV_FLEX_FLOW_ROW);
  for (int i = 0; i < 3; i++) {
    lv_obj_t *card = lv_obj_create(row);
    lv_obj_set_width(card, 0);
    lv_obj_set_flex_grow(card, 1);
    lv_obj_set_height(card, 64);
    styleCard(card);
    g_metricCards[i] = card;
    lv_obj_set_scrollable(card, false);
    lv_obj_add_flag(card, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_add_event_cb(card, onMetricClicked, LV_EVENT_CLICKED, (void *)(intptr_t)i);
    lv_obj_set_style_border_color(card, i == 0 ? C_PRIMARY : C_BORDER, 0);
    lv_obj_set_style_bg_color(card, i == 0 ? C_TINT : C_CARD, 0);
    lv_obj_set_style_pad_all(card, 4, 0);
    lv_obj_set_style_pad_gap(card, 2, 0);
    lv_obj_set_layout(card, LV_LAYOUT_FLEX);
    lv_obj_set_flex_flow(card, LV_FLEX_FLOW_COLUMN);
    // 22px 数值给四位转速和单位留出空间，避免窄卡片截断。
    lv_obj_t *vrow = lv_obj_create(card);
    lv_obj_remove_flag(vrow, (lv_obj_flag_t)(LV_OBJ_FLAG_CLICKABLE | LV_OBJ_FLAG_SCROLLABLE));
    lv_obj_set_width(vrow, lv_pct(100));
    lv_obj_set_height(vrow, 26);
    lv_obj_set_style_bg_opa(vrow, LV_OPA_TRANSP, 0);
    lv_obj_set_style_border_width(vrow, 0, 0);
    lv_obj_set_style_pad_all(vrow, 0, 0);
    lv_obj_set_layout(vrow, LV_LAYOUT_FLEX);
    lv_obj_set_flex_flow(vrow, LV_FLEX_FLOW_ROW);
    lv_obj_set_flex_align(vrow, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_END, LV_FLEX_ALIGN_CENTER);
    lv_obj_set_style_pad_gap(vrow, 2, 0);
    g_meterVal[i] = lv_label_create(vrow);
    lv_label_set_text(g_meterVal[i], "--");
    lv_obj_set_style_text_font(g_meterVal[i], &font_zh_22, 0);
    lv_obj_set_style_text_color(g_meterVal[i], C_TEXT, 0);
    g_meterUnit[i] = mkLabel(vrow, "", &font_zh_12, C_SUBTEXT);
    // 名称 + 状态（“水温 · 正常”，状态变色）
    g_meterName[i] = mkLabel(card, i == 1 ? "油压" : g_channels[i].label, &font_zh_12, C_SUBTEXT);
    // 底部细条：灰底 + 按量程比例填充，颜色跟状态走
    g_meterBarBg[i] = lv_obj_create(card);
    lv_obj_set_width(g_meterBarBg[i], lv_pct(100));
    lv_obj_set_height(g_meterBarBg[i], 4);
    lv_obj_set_style_bg_color(g_meterBarBg[i], C_SUBBG, 0);
    lv_obj_set_style_radius(g_meterBarBg[i], 2, 0);
    lv_obj_set_style_border_width(g_meterBarBg[i], 0, 0);
    lv_obj_set_style_pad_all(g_meterBarBg[i], 0, 0);
    lv_obj_remove_flag(g_meterBarBg[i], (lv_obj_flag_t)(LV_OBJ_FLAG_CLICKABLE | LV_OBJ_FLAG_SCROLLABLE));
    g_meterFill[i] = lv_obj_create(g_meterBarBg[i]);
    lv_obj_remove_flag(g_meterFill[i], (lv_obj_flag_t)(LV_OBJ_FLAG_CLICKABLE | LV_OBJ_FLAG_SCROLLABLE));
    lv_obj_set_size(g_meterFill[i], 0, 4);
    lv_obj_set_style_bg_color(g_meterFill[i], C_GREEN, 0);
    lv_obj_set_style_radius(g_meterFill[i], 2, 0);
    lv_obj_set_style_border_width(g_meterFill[i], 0, 0);
    lv_obj_set_style_pad_all(g_meterFill[i], 0, 0);
  }
  // 告警横条：左“场景：… · 暂无告警/报警…”，右常驻“模拟数据”标记
  g_alertStrip = lv_obj_create(tile);
  lv_obj_set_width(g_alertStrip, lv_pct(100));
  lv_obj_set_height(g_alertStrip, 20);
  lv_obj_set_style_bg_color(g_alertStrip, C_GREENBG, 0);
  lv_obj_set_style_radius(g_alertStrip, 4, 0);
  lv_obj_set_style_border_width(g_alertStrip, 0, 0);
  lv_obj_set_style_pad_all(g_alertStrip, 3, 0);
  lv_obj_set_layout(g_alertStrip, LV_LAYOUT_FLEX);
  lv_obj_set_flex_flow(g_alertStrip, LV_FLEX_FLOW_ROW);
  lv_obj_set_flex_align(g_alertStrip, LV_FLEX_ALIGN_SPACE_BETWEEN, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
  g_scenarioLabel = mkLabel(g_alertStrip, "等待数据", &font_zh_12, C_DARKGREEN);
  lv_obj_set_width(g_scenarioLabel, 0);
  lv_obj_set_flex_grow(g_scenarioLabel, 1);
  lv_label_set_long_mode(g_scenarioLabel, LV_LABEL_LONG_DOT);
  mkLabel(g_alertStrip, "模拟增强", &font_zh_12, C_DARKGREEN);
  // 趋势图标题行：左标题，右更新时间
  lv_obj_t *trow = lv_obj_create(tile);
  lv_obj_set_width(trow, lv_pct(100));
  lv_obj_set_height(trow, 14);
  lv_obj_set_style_bg_opa(trow, LV_OPA_TRANSP, 0);
  lv_obj_set_style_border_width(trow, 0, 0);
  lv_obj_set_style_pad_all(trow, 0, 0);
  lv_obj_set_layout(trow, LV_LAYOUT_FLEX);
  lv_obj_set_flex_flow(trow, LV_FLEX_FLOW_ROW);
  lv_obj_set_flex_align(trow, LV_FLEX_ALIGN_SPACE_BETWEEN, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
  g_chartTitle = mkLabel(trow, "水温趋势 · 近60秒", &font_zh_12, C_TEXT);
  lv_obj_set_width(g_chartTitle, 0);
  lv_obj_set_flex_grow(g_chartTitle, 1);
  lv_label_set_long_mode(g_chartTitle, LV_LABEL_LONG_DOT);
  g_updatedLabel = mkLabel(trow, "尚未更新", &font_zh_12, C_SUBTEXT);
  // 水温趋势图：只画水温实线 + 报警阈值虚线
  g_chart = lv_chart_create(tile);
  lv_obj_set_width(g_chart, lv_pct(100));
  lv_obj_set_height(g_chart, 48);
  lv_obj_set_style_bg_color(g_chart, C_CARD, 0);
  lv_obj_set_style_radius(g_chart, 8, 0);
  lv_obj_set_style_border_width(g_chart, 1, 0);
  lv_obj_set_style_border_color(g_chart, C_BORDER, 0);
  lv_obj_set_style_pad_all(g_chart, 0, 0);
  lv_chart_set_type(g_chart, LV_CHART_TYPE_LINE);
  lv_chart_set_point_count(g_chart, 60);
  lv_obj_set_style_width(g_chart, 0, LV_PART_INDICATOR);
  lv_obj_set_style_height(g_chart, 0, LV_PART_INDICATOR);
  lv_obj_set_style_line_width(g_chart, 1, LV_PART_ITEMS);
  lv_chart_set_range(g_chart, LV_CHART_AXIS_PRIMARY_Y, 65, 95);
  lv_obj_set_style_shadow_width(g_chart, 0, 0);
  lv_obj_set_style_line_color(g_chart, C_BORDER, LV_PART_MAIN);
  g_chartSer = lv_chart_add_series(g_chart, C_PRIMARY, LV_CHART_AXIS_PRIMARY_Y);
  for (int i = 0; i < 60; i++) lv_chart_set_series_value_by_id(g_chart, g_chartSer, i, LV_CHART_POINT_NONE);
  // 报警阈值虚线（覆盖在图上，Y 按阈值换算）
  g_thresholdLine = lv_line_create(g_chart);
  lv_obj_set_style_line_color(g_thresholdLine, C_RED, 0);
  lv_obj_set_style_line_width(g_thresholdLine, 1, 0);
  lv_obj_set_style_line_dash_width(g_thresholdLine, 4, 0);
  lv_obj_set_style_line_dash_gap(g_thresholdLine, 4, 0);
  static lv_point_precise_t initPts[2] = {{0, 10}, {300, 10}};
  lv_line_set_points(g_thresholdLine, initPts, 2);
}

// ---------- 待机屏（10 秒无操作进；拖拉机动画）----------
static lv_obj_t *mkRect(lv_obj_t *parent, int32_t x, int32_t y, int32_t w, int32_t h,
                        lv_color_t bg, int32_t radius) {
  lv_obj_t *o = lv_obj_create(parent);
  lv_obj_remove_flag(o, (lv_obj_flag_t)(LV_OBJ_FLAG_CLICKABLE | LV_OBJ_FLAG_SCROLLABLE));
  lv_obj_set_style_shadow_width(o, 0, 0);
  lv_obj_set_pos(o, x, y);
  lv_obj_set_size(o, w, h);
  lv_obj_set_style_bg_color(o, bg, 0);
  lv_obj_set_style_radius(o, radius, 0);
  lv_obj_set_style_border_width(o, 0, 0);
  lv_obj_set_style_pad_all(o, 0, 0);
  return o;
}

static lv_obj_t *g_bootSplash = nullptr, *g_bootSegment = nullptr;
static lv_timer_t *g_bootTimer = nullptr;
static uint32_t g_bootSplashAt = 0;
static void showBootSplash() {
  g_bootSplashAt = millis();
  g_bootSplash = lv_obj_create(lv_layer_top());
  lv_obj_remove_style_all(g_bootSplash);
  lv_obj_set_size(g_bootSplash, 320, 240);
  lv_obj_set_style_bg_color(g_bootSplash, C_BG, 0);
  lv_obj_set_style_bg_opa(g_bootSplash, LV_OPA_COVER, 0);
  lv_obj_t *motto = mkLabel(g_bootSplash, "耕知·耘诊", &font_zh_22, C_PRIMARY);
  lv_obj_align(motto, LV_ALIGN_TOP_MID, 0, 61);
  lv_obj_t *name = mkLabel(g_bootSplash, "司稼 AgriDx", &font_zh_16, C_TEXT);
  lv_obj_align(name, LV_ALIGN_TOP_MID, 0, 103);
  lv_obj_t *loading = mkLabel(g_bootSplash, "正在加载中", &font_zh_12, C_SUBTEXT);
  lv_obj_align(loading, LV_ALIGN_TOP_MID, 0, 141);
  lv_obj_t *track = mkRect(g_bootSplash, 92, 172, 136, 4, C_BORDER, 2);
  g_bootSegment = mkRect(track, 0, 0, 38, 4, C_PRIMARY, 2);
  g_bootTimer = lv_timer_create([](lv_timer_t *) {
    const uint32_t phase = (millis() - g_bootSplashAt) % 1200;
    const int x = phase < 600 ? phase * 98 / 600 : (1200 - phase) * 98 / 600;
    lv_obj_set_x(g_bootSegment, x);
  }, 40, nullptr);
}
static void finishBootSplash() {
  if (g_bootTimer) { lv_timer_delete(g_bootTimer); g_bootTimer = nullptr; }
  if (g_bootSplash) { lv_obj_delete(g_bootSplash); g_bootSplash = g_bootSegment = nullptr; }
}

#if defined(CONFIG_IDF_TARGET_ESP32S3)
static lv_obj_t *g_standbyCache = nullptr;
static lv_draw_buf_t g_standbyDrawBuf{};

static bool standbyObjectAnimates(lv_obj_t *child) {
  for (auto *puff : g_puffs) if (child == puff) return true;
  for (auto *dot : g_groundDots) if (child == dot) return true;
  for (auto &wheel : g_spokes)
    for (auto *spoke : wheel) if (child == spoke) return true;
  return false;
}

static void setStandbyCache(bool enabled) {
  const uint32_t children = lv_obj_get_child_count(g_standbyOverlay);
  if (enabled && !g_standbyCache) {
    const size_t bytes = SCREEN_WIDTH * SCREEN_HEIGHT * sizeof(uint16_t);
    auto *pixels = heap_caps_malloc(bytes, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!pixels) return;
    for (uint32_t i = 0; i < children; ++i) {
      auto *child = lv_obj_get_child(g_standbyOverlay, i);
      if (standbyObjectAnimates(child)) lv_obj_set_hidden(child, true);
    }
    const bool ready =
      lv_draw_buf_init(&g_standbyDrawBuf, SCREEN_WIDTH, SCREEN_HEIGHT,
                       LV_COLOR_FORMAT_RGB565, LV_STRIDE_AUTO, pixels, bytes) == LV_RESULT_OK &&
      lv_snapshot_take_to_draw_buf(g_standbyOverlay, LV_COLOR_FORMAT_RGB565,
                                   &g_standbyDrawBuf) == LV_RESULT_OK;
    for (uint32_t i = 0; i < children; ++i) {
      auto *child = lv_obj_get_child(g_standbyOverlay, i);
      if (standbyObjectAnimates(child)) lv_obj_set_hidden(child, false);
    }
    if (!ready) {
      heap_caps_free(pixels);
      return;
    }
    g_standbyCache = lv_image_create(g_standbyOverlay);
    lv_image_set_src(g_standbyCache, &g_standbyDrawBuf);
    lv_obj_remove_flag(g_standbyCache, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_pos(g_standbyCache, 0, 0);
  }
  if (!g_standbyCache) return;
  const uint32_t total = lv_obj_get_child_count(g_standbyOverlay);
  for (uint32_t i = 0; i < total; ++i) {
    auto *child = lv_obj_get_child(g_standbyOverlay, i);
    if (child != g_standbyCache && !standbyObjectAnimates(child))
      lv_obj_set_hidden(child, enabled);
  }
  lv_obj_set_hidden(g_standbyCache, !enabled);
  if (enabled) lv_obj_move_background(g_standbyCache);
}
#endif

static void showStandby() {
  if (g_standbyOn || !g_standbyOverlay) return;
  g_standbyOn = true;
  lv_obj_set_hidden(g_standbyOverlay, false);
#if defined(CONFIG_IDF_TARGET_ESP32S3)
  setStandbyCache(g_fastDisplay);
#endif
  fadeIn(g_standbyOverlay);
  analogWrite(PIN_TFT_BL, 110);  // 待机调暗背光
  Serial.println("[司稼] 60秒无操作，开始漫游");
}

static void wakeStandby() {
  if (!g_standbyOn) return;
  g_standbyOn = false;
  lv_obj_set_hidden(g_standbyOverlay, true);
  g_chartUpdated = 0;
  applyTelemetryToUi();
  analogWrite(PIN_TFT_BL, BACKLIGHT_BRIGHTNESS);
  markActive();
  Serial.println("[司稼] 待机唤醒");
}

static void onStandbyTap(lv_event_t *e) {
  (void)e;
  wakeStandby();
}

// 待机动画定时器（40ms）：只动轮辐线、尾气、地面点、光晕这几个小对象，
// LVGL 只重绘它们的脏区，不全屏刷新。
static lv_timer_t *g_standbyTimer = nullptr;

static void onStandbyTick(lv_timer_t *t) {
  (void)t;
  if (!g_standbyOn || !g_standbyOverlay) return;
  // 轮子：两根轮辐线绕轮心转
  static uint32_t lastTick = 0;
  const uint32_t now = millis();
  const float dt = lastTick ? min(uint32_t(100), now - lastTick) / 40.0f : 1.0f;
  lastTick = now;
  g_wheelAngle += 0.18f * dt;
  static lv_point_precise_t pts[2][2][2];
  constexpr int32_t radius = 11;
  const int32_t x = (int32_t)(radius * cosf(g_wheelAngle));
  const int32_t y = (int32_t)(radius * sinf(g_wheelAngle));
  for (int w = 0; w < 2; w++) {
    pts[w][0][0] = {radius - x, radius - y};
    pts[w][0][1] = {radius + x, radius + y};
    pts[w][1][0] = {radius + y, radius - x};
    pts[w][1][1] = {radius - y, radius + x};
    lv_line_set_points(g_spokes[w][0], pts[w][0], 2);
    lv_line_set_points(g_spokes[w][1], pts[w][1], 2);
  }
  // 排气管尾气：3 团依次上升、变大、变淡
  for (int i = 0; i < 3; i++) {
    g_puffPhase[i] += 0.012f * dt;
    if (g_puffPhase[i] > 1.0f) g_puffPhase[i] -= 1.0f;
    float p = g_puffPhase[i];
    int32_t sz = 6 + (int32_t)(p * 8);
    const lv_coord_t xPos = 236 - sz / 2;
    const lv_coord_t yPos = (lv_coord_t)(76 - p * 36 - sz / 2);
    const lv_opa_t opacity = (lv_opa_t)((1.0f - p) * 160);
#if defined(CONFIG_IDF_TARGET_ESP32S3)
    if (g_fastDisplay) {
      if (lv_obj_get_style_width(g_puffs[i], LV_PART_MAIN) != sz)
        lv_obj_set_size(g_puffs[i], sz, sz);
      if (lv_obj_get_style_x(g_puffs[i], LV_PART_MAIN) != xPos ||
          lv_obj_get_style_y(g_puffs[i], LV_PART_MAIN) != yPos)
        lv_obj_set_pos(g_puffs[i], xPos, yPos);
      // The puffs have no children. Blend their backgrounds without a
      // temporary opacity layer for the entire widget.
      if (lv_obj_get_style_bg_opa(g_puffs[i], LV_PART_MAIN) != opacity)
        lv_obj_set_style_bg_opa(g_puffs[i], opacity, 0);
    } else
#endif
    {
      lv_obj_set_size(g_puffs[i], sz, sz);
      lv_obj_set_pos(g_puffs[i], xPos, yPos);
      lv_obj_set_style_opa(g_puffs[i], opacity, 0);
    }
  }
  // 地面点左移（拖拉机原地开的感觉），出界绕回
  for (int i = 0; i < 3; i++) {
    g_groundX[i] -= max(1, (int)(1.5f * dt));
    if (g_groundX[i] < 34) g_groundX[i] = 286;
    lv_obj_set_x(g_groundDots[i], g_groundX[i]);
  }
  // Keep the large halo/title static: resizing and translucent blending forced
  // most of the 320x240 screen to redraw every animation tick.

}

static void buildStandbyOverlay(lv_obj_t *scr) {
  // 待机屏与 OLED 同一套语言（拖拉机动画），但按 TFT 浅色风格画：浅底 + 绿拖拉机。
  g_standbyOverlay = lv_obj_create(scr);
  lv_obj_add_flag(g_standbyOverlay, LV_OBJ_FLAG_FLOATING);
  lv_obj_set_scrollable(g_standbyOverlay, false);
  lv_obj_set_size(g_standbyOverlay, SCREEN_WIDTH, SCREEN_HEIGHT);
  lv_obj_set_pos(g_standbyOverlay, 0, 0);
  lv_obj_set_style_bg_color(g_standbyOverlay, C_BG, 0);
  lv_obj_set_style_radius(g_standbyOverlay, 0, 0);
  lv_obj_set_style_border_width(g_standbyOverlay, 0, 0);
  lv_obj_set_style_shadow_width(g_standbyOverlay, 0, 0);
  lv_obj_set_style_pad_all(g_standbyOverlay, 0, 0);
  lv_obj_add_event_cb(g_standbyOverlay, onStandbyTap, LV_EVENT_CLICKED, nullptr);
  // 呼吸光晕（拖拉机背后）
  g_standbyHalo = lv_obj_create(g_standbyOverlay);
  lv_obj_set_size(g_standbyHalo, 150, 150);
  lv_obj_set_pos(g_standbyHalo, 85, 37);
  lv_obj_set_style_bg_color(g_standbyHalo, C_GREENBG, 0);
  lv_obj_set_style_radius(g_standbyHalo, LV_RADIUS_CIRCLE, 0);
  lv_obj_set_style_border_width(g_standbyHalo, 0, 0);
  // 地面线 + 移动点
  static lv_point_precise_t groundPts[2] = {{36, 168}, {284, 168}};
  lv_obj_t *gl = lv_line_create(g_standbyOverlay);
  lv_line_set_points(gl, groundPts, 2);
  lv_obj_set_style_line_color(gl, C_BORDER, 0);
  lv_obj_set_style_line_width(gl, 2, 0);
  for (int i = 0; i < 3; i++) {
    g_groundDots[i] = lv_obj_create(g_standbyOverlay);
    lv_obj_set_size(g_groundDots[i], 5, 5);
    lv_obj_set_pos(g_groundDots[i], g_groundX[i], 167);
    lv_obj_set_style_bg_color(g_groundDots[i], C_BORDER, 0);
    lv_obj_set_style_radius(g_groundDots[i], LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_border_width(g_groundDots[i], 0, 0);
  }
  // 拖拉机：车身 + 驾驶室 + 车窗 + 排气管 + 车灯 + 两个轮子
  mkRect(g_standbyOverlay, 64, 108, 192, 40, C_GREEN, 8);       // 车身
  mkRect(g_standbyOverlay, 92, 76, 58, 36, C_DARKGREEN, 6);     // 驾驶室
  mkRect(g_standbyOverlay, 100, 82, 42, 22, C_BG, 4);           // 车窗
  mkRect(g_standbyOverlay, 232, 80, 8, 32, C_TEXT, 2);          // 排气管
  lv_obj_t *light = lv_obj_create(g_standbyOverlay);
  lv_obj_set_size(light, 10, 10);
  lv_obj_set_pos(light, 244, 118);
  lv_obj_set_style_bg_color(light, C_WHITE, 0);
  lv_obj_set_style_radius(light, LV_RADIUS_CIRCLE, 0);
  lv_obj_set_style_border_width(light, 0, 0);
  static const int32_t WCX[2] = {104, 216};
  static const int32_t WCY = 152;
  for (int w = 0; w < 2; w++) {
    lv_obj_t *wheel = lv_obj_create(g_standbyOverlay);
    lv_obj_set_size(wheel, 30, 30);
    lv_obj_set_pos(wheel, WCX[w] - 15, WCY - 15);
    lv_obj_set_style_bg_color(wheel, C_TEXT, 0);
    lv_obj_set_style_radius(wheel, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_border_width(wheel, 0, 0);
    lv_obj_t *hub = lv_obj_create(g_standbyOverlay);
    lv_obj_set_size(hub, 10, 10);
    lv_obj_set_pos(hub, WCX[w] - 5, WCY - 5);
    lv_obj_set_style_bg_color(hub, C_CARD, 0);
    lv_obj_set_style_radius(hub, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_border_width(hub, 0, 0);
    for (int k = 0; k < 2; k++) {
      g_spokes[w][k] = lv_line_create(g_standbyOverlay);
      // Local coordinates keep the dirty rectangle around the wheel. With
      // screen-relative points LVGL sized each line from the screen origin.
      lv_obj_set_pos(g_spokes[w][k], WCX[w] - 11, WCY - 11);
      lv_obj_set_size(g_spokes[w][k], 23, 23);
      lv_obj_set_style_line_color(g_spokes[w][k], C_CARD, 0);
      lv_obj_set_style_line_width(g_spokes[w][k], 2, 0);
      static lv_point_precise_t initSp[2] = {{0, 0}, {0, 0}};
      lv_line_set_points(g_spokes[w][k], initSp, 2);
    }
  }
  // 排气管尾气（3 团，初始透明，由定时器驱动）
  for (int i = 0; i < 3; i++) {
    g_puffs[i] = lv_obj_create(g_standbyOverlay);
    lv_obj_set_size(g_puffs[i], 6, 6);
    lv_obj_set_pos(g_puffs[i], 233, 73);
    lv_obj_set_style_bg_color(g_puffs[i], C_SUBTEXT, 0);
    lv_obj_set_style_radius(g_puffs[i], LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_border_width(g_puffs[i], 0, 0);
#if defined(CONFIG_IDF_TARGET_ESP32S3)
    lv_obj_set_style_bg_opa(g_puffs[i], 0, 0);
#else
    lv_obj_set_style_opa(g_puffs[i], 0, 0);
#endif
  }
  // 文案（待/唤/醒已补进三档字库，见 tools/gen_fonts.py）
  g_standbyTitle = mkLabel(g_standbyOverlay, "司稼漫游", &font_zh_22, C_TEXT);
  lv_obj_set_width(g_standbyTitle, lv_pct(100));
  lv_obj_set_style_text_align(g_standbyTitle, LV_TEXT_ALIGN_CENTER, 0);
  lv_obj_set_pos(g_standbyTitle, 0, 180);
  lv_obj_t *hint = mkLabel(g_standbyOverlay, "触摸或按 BOOT 返回", &font_zh_12, C_SUBTEXT);
  lv_obj_set_width(hint, lv_pct(100));
  lv_obj_set_style_text_align(hint, LV_TEXT_ALIGN_CENTER, 0);
  lv_obj_set_pos(hint, 0, 206);
  auto decor = [](auto &&self, lv_obj_t *parent) -> void {
    for (uint32_t i = 0; i < lv_obj_get_child_count(parent); ++i) {
      lv_obj_t *child = lv_obj_get_child(parent, i);
      lv_obj_remove_flag(child, (lv_obj_flag_t)(LV_OBJ_FLAG_CLICKABLE | LV_OBJ_FLAG_SCROLLABLE));
      self(self, child);
    }
  };
  decor(decor, g_standbyOverlay);
  lv_obj_set_hidden(g_standbyOverlay, true);
}

static void buildTelemetryAlertOverlay() {
  // 位于顶层，覆盖两页而不参与屏幕的 flex 排版；只在异常状态变化时更新。
  g_alarmOverlay = lv_obj_create(lv_layer_top());
  lv_obj_set_size(g_alarmOverlay, SCREEN_WIDTH, SCREEN_HEIGHT);
  lv_obj_set_pos(g_alarmOverlay, 0, 0);
  lv_obj_set_style_bg_color(g_alarmOverlay, C_TEXT, 0);
  lv_obj_set_style_bg_opa(g_alarmOverlay, LV_OPA_40, 0);
  lv_obj_set_style_border_width(g_alarmOverlay, 0, 0);
  lv_obj_set_style_radius(g_alarmOverlay, 0, 0);
  lv_obj_set_style_pad_all(g_alarmOverlay, 0, 0);
  lv_obj_set_scrollable(g_alarmOverlay, false);

  g_alarmPanel = lv_obj_create(g_alarmOverlay);
  lv_obj_set_width(g_alarmPanel, SCREEN_WIDTH - 32);
  lv_obj_set_height(g_alarmPanel, LV_SIZE_CONTENT);
  styleCard(g_alarmPanel);
  lv_obj_set_style_border_width(g_alarmPanel, 2, 0);
  lv_obj_set_style_pad_all(g_alarmPanel, 12, 0);
  lv_obj_set_style_pad_gap(g_alarmPanel, 8, 0);
  lv_obj_set_layout(g_alarmPanel, LV_LAYOUT_FLEX);
  lv_obj_set_flex_flow(g_alarmPanel, LV_FLEX_FLOW_COLUMN);
  lv_obj_center(g_alarmPanel);
  lv_obj_set_scrollable(g_alarmPanel, false);
  g_alarmTitle = mkLabel(g_alarmPanel, "报警", &font_zh_22, C_RED);
  g_alarmDetail = mkLabel(g_alarmPanel, "", &font_zh_16, C_TEXT);
  lv_obj_set_width(g_alarmDetail, lv_pct(100));
  lv_label_set_long_mode(g_alarmDetail, LV_LABEL_LONG_WRAP);
  mkLabel(g_alarmPanel, "模拟增强", &font_zh_12, C_SUBTEXT);

  lv_obj_t *actions = lv_obj_create(g_alarmPanel);
  lv_obj_set_width(actions, lv_pct(100));
  lv_obj_set_height(actions, 36);
  lv_obj_set_style_bg_opa(actions, LV_OPA_TRANSP, 0);
  lv_obj_set_style_border_width(actions, 0, 0);
  lv_obj_set_style_pad_all(actions, 0, 0);
  lv_obj_set_style_pad_gap(actions, 8, 0);
  lv_obj_set_layout(actions, LV_LAYOUT_FLEX);
  lv_obj_set_flex_flow(actions, LV_FLEX_FLOW_ROW);
  const char *labels[] = {"知道了", "开始诊断"};
  for (int i = 0; i < 2; i++) {
    lv_obj_t *b = lv_btn_create(actions);
    lv_obj_set_width(b, 0);
    lv_obj_set_flex_grow(b, 1);
    lv_obj_set_height(b, 36);
    lv_obj_set_style_bg_color(b, i ? C_PRIMARY : C_CARD, 0);
    lv_obj_set_style_border_color(b, i ? C_PRIMARY : C_BORDER, 0);
    lv_obj_set_style_border_width(b, 1, 0);
    lv_obj_set_style_radius(b, 6, 0);
    lv_obj_set_style_shadow_width(b, 0, 0);
    lv_obj_set_style_pad_all(b, 4, 0);
    stylePressable(b, i ? C_PRIMARY_DARK : C_TINT);
    lv_obj_t *label = mkLabel(b, labels[i], &font_zh_16, i ? C_WHITE : C_TEXT);
    lv_obj_center(label);
    lv_obj_add_event_cb(b, i ? onAlarmDiagnose : onAlarmDismiss, LV_EVENT_CLICKED, nullptr);
  }
  lv_obj_set_hidden(g_alarmOverlay, true);
}

static void buildUi() {
  // 按钮点按反馈的过渡描述（100ms）：pressed 变色 + 缩放 0.96。
  lv_style_transition_dsc_init(&g_pressTrans, g_pressProps, lv_anim_path_linear, 100, 0, nullptr);
  lv_obj_t *scr = lv_screen_active();
  lv_obj_set_style_bg_color(scr, C_BG, 0);
  lv_obj_set_style_text_font(scr, &font_zh_16, 0);
  lv_obj_set_style_text_color(scr, C_TEXT, 0);
  lv_obj_set_layout(scr, LV_LAYOUT_FLEX);
  lv_obj_set_flex_flow(scr, LV_FLEX_FLOW_COLUMN);
  lv_obj_set_style_pad_all(scr, 0, 0);
  lv_obj_set_style_pad_gap(scr, 0, 0);
  buildTopBar(scr);
  lv_obj_set_scroll_dir(scr, LV_DIR_NONE);
  lv_obj_set_scrollbar_mode(scr, LV_SCROLLBAR_MODE_OFF);
  g_tileview = lv_tileview_create(scr);
  lv_obj_set_scroll_dir(g_tileview, LV_DIR_NONE);
  lv_obj_set_scrollbar_mode(g_tileview, LV_SCROLLBAR_MODE_OFF);
  lv_obj_set_width(g_tileview, lv_pct(100));
  lv_obj_set_flex_grow(g_tileview, 1);
  lv_obj_set_style_bg_color(g_tileview, C_BG, 0);
  lv_obj_set_style_border_width(g_tileview, 0, 0);
  lv_obj_set_style_pad_all(g_tileview, 0, 0);
  lv_obj_t *t0 = lv_tileview_add_tile(g_tileview, 0, 0, LV_DIR_NONE);
  lv_obj_t *t1 = lv_tileview_add_tile(g_tileview, 1, 0, LV_DIR_NONE);
  lv_obj_t *t2 = lv_tileview_add_tile(g_tileview, 2, 0, LV_DIR_NONE);
  lv_obj_t *tiles[] = {t0, t1, t2};
  for (lv_obj_t *tile : tiles) {
    lv_obj_set_scroll_dir(tile, LV_DIR_VER);
    lv_obj_set_style_bg_color(tile, C_BG, 0);
    lv_obj_set_style_bg_opa(tile, LV_OPA_COVER, 0);
    lv_obj_set_style_border_width(tile, 0, 0);
    lv_obj_set_style_shadow_width(tile, 0, 0);
  }
  buildMonitorTile(t0);
  buildChatTile(t1);
  wifiPanelCreate(t2, queueWifiConfig);
  lv_obj_set_style_anim_duration(g_tileview, 0, 0);
  lv_tileview_set_tile_by_index(g_tileview, 0, 0, LV_ANIM_OFF);
  lv_obj_add_event_cb(g_tileview, onTileChanged, LV_EVENT_VALUE_CHANGED, nullptr);
  // 两个清楚可点的入口，保留固定位置；不呈现网站导航或知识条目。
  lv_obj_t *strip = lv_obj_create(scr);
  lv_obj_set_scrollable(strip, false);
  lv_obj_set_scrollbar_mode(strip, LV_SCROLLBAR_MODE_OFF);
  lv_obj_set_width(strip, lv_pct(100));
  lv_obj_set_height(strip, 32);
  lv_obj_set_style_bg_color(strip, C_CARD, 0);
  lv_obj_set_style_radius(strip, 0, 0);
  lv_obj_set_style_border_width(strip, 1, 0);
  lv_obj_set_style_border_side(strip, LV_BORDER_SIDE_TOP, 0);
  lv_obj_set_style_border_color(strip, C_BORDER, 0);
  lv_obj_set_style_pad_all(strip, 2, 0);
  lv_obj_set_style_pad_gap(strip, 4, 0);
  lv_obj_set_layout(strip, LV_LAYOUT_FLEX);
  lv_obj_set_flex_flow(strip, LV_FLEX_FLOW_ROW);
  lv_obj_set_flex_align(strip, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
  static const char *labels[] = {"监测", "对话", "联网"};
  for (int i = 0; i < 3; i++) {
    g_dots[i] = lv_btn_create(strip);
    lv_obj_set_width(g_dots[i], 0);
    lv_obj_set_flex_grow(g_dots[i], 1);
    lv_obj_set_height(g_dots[i], 26);
    lv_obj_set_style_radius(g_dots[i], 6, 0);
    lv_obj_set_style_bg_color(g_dots[i], C_CARD, 0);
    lv_obj_set_style_border_width(g_dots[i], 0, 0);
    lv_obj_set_style_shadow_width(g_dots[i], 0, 0);
    lv_obj_set_style_pad_all(g_dots[i], 2, 0);
    lv_obj_t *label = mkLabel(g_dots[i], labels[i], &font_zh_16, C_SUBTEXT);
    lv_obj_center(label);
    lv_obj_add_event_cb(g_dots[i], onDotClicked, LV_EVENT_CLICKED, (void *)(intptr_t)i);
  }
  g_navUnderline = lv_obj_create(strip);
  lv_obj_remove_style_all(g_navUnderline);
  lv_obj_add_flag(g_navUnderline, LV_OBJ_FLAG_FLOATING);
  lv_obj_set_size(g_navUnderline, 88, 2);
  lv_obj_set_pos(g_navUnderline, 8, 27);
  lv_obj_set_style_bg_color(g_navUnderline, C_PRIMARY, 0);
  lv_obj_set_style_bg_opa(g_navUnderline, LV_OPA_COVER, 0);
  updateDots(0);
  // Toast（悬浮提示，建在最上层）
  g_toast = lv_obj_create(lv_layer_top());
  lv_obj_set_width(g_toast, lv_pct(80));
  lv_obj_set_height(g_toast, LV_SIZE_CONTENT);
  lv_obj_set_style_bg_color(g_toast, C_TEXT, 0);
  lv_obj_set_style_radius(g_toast, 8, 0);
  lv_obj_set_style_pad_all(g_toast, 8, 0);
  lv_obj_set_align(g_toast, LV_ALIGN_BOTTOM_MID);
  lv_obj_set_y(g_toast, -10);
  lv_obj_t *tl = lv_label_create(g_toast);
  lv_obj_set_style_text_font(tl, &font_zh_12, 0);
  lv_obj_set_style_text_color(tl, C_WHITE, 0);
  lv_label_set_long_mode(tl, LV_LABEL_LONG_WRAP);
  lv_obj_set_width(tl, lv_pct(100));
  lv_obj_set_hidden(g_toast, true);
  buildTelemetryAlertOverlay();
  // 待机屏（盖在最上层）+ 待机动画定时器
  // Monitoring stays visible; no hidden standby objects or animation timers.
  buildStandbyOverlay(scr);
#if defined(CONFIG_IDF_TARGET_ESP32S3)
  g_standbyTimer = lv_timer_create(onStandbyTick, 32, nullptr);
#else
  g_standbyTimer = lv_timer_create(onStandbyTick, 40, nullptr);
#endif
}

#if SIJIA_VOICE_ENABLED
// ---------- 语音 UI（仅 S3；状态变化时才刷 LVGL，避免每循环重设文字）----------
static void updateVoiceUi() {
  static VoiceState lastState = VOICE_IDLE;
  static uint32_t lastSec = 0;
  VoiceState st = voiceGetState();
  uint32_t sec = voiceGetElapsedMs() / 1000;
  if (st == lastState && (st != VOICE_RECORDING || sec == lastSec)) return;
  lastState = st;
  lastSec = sec;
  if (g_voiceBtnLabel) {
    lv_label_set_text(g_voiceBtnLabel, st == VOICE_RECORDING ? "松开发送" : "按住说话");
  }
  if (!g_voiceStatus) return;
  switch (st) {
    case VOICE_RECORDING: {
      char buf[48];
      snprintf(buf, sizeof(buf), "● 录音中 %lu 秒，松开发送", (unsigned long)sec);
      lv_label_set_text(g_voiceStatus, buf);
      lv_obj_set_hidden(g_voiceStatus, false);
      break;
    }
    case VOICE_THINKING:
      lv_label_set_text(g_voiceStatus, "正在识别语音…");
      lv_obj_set_hidden(g_voiceStatus, false);
      break;
    case VOICE_PLAYING:
      lv_label_set_text(g_voiceStatus, "播报中，点屏幕或按 BOOT 打断");
      lv_obj_set_hidden(g_voiceStatus, false);
      break;
    default:
      lv_obj_set_hidden(g_voiceStatus, true);
      break;
  }
  fitChatContent();
}

// 消费一次语音问答结果：文字答案进对话（与文字问答同一份历史，供多轮追问）。
static void applyVoiceResult() {
  VoiceResult r;
  if (!voiceTakeResult(r)) return;
  if (!r.ok) {
    // 失败只 toast，不加气泡：不把“录音太短/发送失败”伪装成司稼的回答。
    showToast(r.error.length() > 0 ? r.error.c_str() : "语音失败，请重试");
    return;
  }
  if (r.answer.isEmpty() && r.transcript.length() > 0) {
    askQuestion(r.transcript.c_str());
    return;
  }
  if (r.transcript.length() > 0) {
    g_lastQuestion = r.transcript;
    addUserBubble(r.transcript.c_str());
    if (g_historyCount < MAX_HISTORY_MSGS) {
      g_history[g_historyCount].role = "user";
      g_history[g_historyCount].content = r.transcript;
      g_historyCount++;
    }
  }
  g_lastAnswer = r.answer;
  addAssistantCard(r.answer.c_str(), "司稼 · 语音");
  if (g_historyCount < MAX_HISTORY_MSGS) {
    g_history[g_historyCount].role = "assistant";
    g_history[g_historyCount].content = r.answer;
    g_historyCount++;
  }
  fitChatContent();
  // TTS 失败时服务端只给文字：照实提示，不编假音频、不谎称已播报。
  if (r.audioMissing) showToast("语音未生成，只显示文字");
}

// BOOT: short press cycles pages; hold >=1s starts touch calibration.
// GPIO ISR records edges so a slow render cannot lose the whole short press.
static portMUX_TYPE g_bootMux = portMUX_INITIALIZER_UNLOCKED;
static volatile bool g_bootDown = false, g_bootReleased = false;
static volatile uint32_t g_bootDownAt = 0, g_bootHeldMs = 0;
static void ARDUINO_ISR_ATTR onBootEdge() {
  const bool down = digitalRead(PIN_BOOT_BTN) == LOW;
  const uint32_t now = millis();
  portENTER_CRITICAL_ISR(&g_bootMux);
  if (down && !g_bootDown) g_bootDownAt = now;
  if (!down && g_bootDown) {
    const uint32_t duration = now - g_bootDownAt;
    if (duration >= 40) { g_bootHeldMs = duration; g_bootReleased = true; }
  }
  g_bootDown = down;
  portEXIT_CRITICAL_ISR(&g_bootMux);
}
static void pollVoiceBootBtn() {
  static bool calibrationStarted = false;
  portENTER_CRITICAL(&g_bootMux);
  const bool down = g_bootDown, released = g_bootReleased;
  const uint32_t pressedAt = g_bootDownAt, held = g_bootHeldMs;
  g_bootReleased = false;
  portEXIT_CRITICAL(&g_bootMux);
  if (released) {
    if (g_standbyOn && !calibrationStarted) {
      wakeStandby();
      calibrationStarted = false;
      return;
    }
    if (!calibrationStarted && held < 1000 && !touchCalibrationActive()) {
      if (g_alarmOverlay) lv_obj_set_hidden(g_alarmOverlay, true);
      const int page = (g_activePage + 1) % 3;
      lv_tileview_set_tile_by_index(g_tileview, page, 0, LV_ANIM_OFF);
      updateDots(page); markActive();
      Serial.printf("[boot] page=%d\n", page);
    }
    calibrationStarted = false;
  }
  if (down && !calibrationStarted && millis() - pressedAt >= 1000 && !touchCalibrationActive()) {
    calibrationStarted = true;
    wakeStandby();
    if (g_alarmOverlay) lv_obj_set_hidden(g_alarmOverlay, true);
    touchCalibrationStart();
    markActive();
    Serial.println("[boot] calibration started");
  }
}

#endif  // SIJIA_VOICE_ENABLED

// ---------- 主循环里消费网络结果 ----------
static void applyChatResult() {
  ChatResult r;
  if (!takeChatResult(r)) return;
  setThinking(false);
  g_chatBusy = false;
  if (!r.ok) {
    g_lastAnswer = "请求失败，请检查网络后重试。";
    addAssistantCard("请求失败，请检查网络后重试。", "司稼 · 离线");
    showToast("问答失败，请重试");
    return;
  }
  g_lastAnswer = r.answer;
  const char *tag = (r.mode == "local-evidence" || r.provider == "knowledge-base")
                        ? "司稼 · 本地资料" : "司稼";
  addAssistantCard(r.answer.c_str(), tag);
  if (g_historyCount < MAX_HISTORY_MSGS) {
    g_history[g_historyCount].role = "assistant";
    g_history[g_historyCount].content = r.answer;
    g_historyCount++;
  }
  if (r.sourceTotal > 0) {
    String s = "共 " + String(r.sourceTotal) + " 条依据：\n";
    for (int i = 0; i < r.sourceCount; i++) s += String(i + 1) + ". " + r.sources[i] + "\n";
    lv_label_set_text(g_sourcesLabel, s.c_str());
    lv_obj_set_hidden(g_sourcesBtn, false);
    g_sourcesOpen = false;
    lv_obj_set_hidden(g_sourcesBox, true);
    lv_label_set_text(lv_obj_get_child(g_sourcesBtn, 0), "查看依据与核对项（展开）");
  } else {
    lv_obj_set_hidden(g_sourcesBtn, true);
  }
  fitChatContent();
}

static void applyTeleResult() {
#if SIJIA_STREAM_TELEMETRY
  static uint32_t seen = 0;
  static bool wasStale = false;
  TelemetrySnapshot sample;
  if (!telemetryStreamRead(sample)) {
    static uint32_t lastWaitingLabel = 0;
    if (millis() - lastWaitingLabel >= 5000) {
      lastWaitingLabel = millis();
      lv_label_set_text(g_scenarioLabel, "等待数据");
      lv_label_set_text(g_updatedLabel, "尚未更新");
    }
    return;
  }
  if (sample.sequence != seen && !sample.stale) {
    seen = sample.sequence;
    for (int i = 0; i < 3; ++i) {
      const auto &from = sample.channels[i];
      auto &to = g_channels[i];
      to.value = from.value; to.minV = from.minValue; to.maxV = from.maxValue;
      to.precision = from.precision;
      to.hasAttention = from.hasAttention; to.hasAlarm = from.hasAlarm;
      to.attentionAbove = from.attentionAbove; to.attentionBelow = from.attentionBelow;
      to.alarmAbove = from.alarmAbove; to.alarmBelow = from.alarmBelow;
      memcpy(to.unit, from.unit, sizeof(to.unit));
      to.updatedAt = sample.receivedAtMs;
    }
    g_trendCount = sample.trendCount;
    memcpy(g_trendVals, sample.coolantTrend, sizeof(g_trendVals));
    memcpy(g_metricTrends[0], sample.coolantTrend, sizeof(g_trendVals));
    memcpy(g_metricTrends[1], sample.oilTrend, sizeof(g_trendVals));
    memcpy(g_metricTrends[2], sample.rpmTrend, sizeof(g_trendVals));
    if (g_standbyOn) maybeShowTelemetryAlert();
    else applyTelemetryToUi();
  }
  if (sample.stale != wasStale) {
    wasStale = sample.stale;
    if (sample.stale) {
      lv_label_set_text(g_updatedLabel, "离线，显示上次数据");
      lv_label_set_text(g_scenarioLabel, "数据未更新，请检查网络");
      lv_obj_set_style_text_color(g_scenarioLabel, C_AMBER, 0);
    }
  }
#else
  bool ok = false;
  if (g_resultMutex) xSemaphoreTake(g_resultMutex, portMAX_DELAY);
  if (!g_teleResult.ready) { if (g_resultMutex) xSemaphoreGive(g_resultMutex); return; }
  ok = g_teleResult.ok;
  g_teleResult.ready = false;
  if (g_resultMutex) xSemaphoreGive(g_resultMutex);
  if (ok) applyTelemetryToUi();
  else if (g_lastTeleOk > 0) lv_label_set_text(g_updatedLabel, "离线，显示上次数据");
#endif
}

#if ENABLE_OTA
static void applyOtaStatus() {
  int state = OTA_IDLE;
  if (g_resultMutex) xSemaphoreTake(g_resultMutex, portMAX_DELAY);
  if (!g_otaStatus.dirty) { if (g_resultMutex) xSemaphoreGive(g_resultMutex); return; }
  state = g_otaStatus.state;
  g_otaStatus.dirty = false;
  if (g_resultMutex) xSemaphoreGive(g_resultMutex);
  if (state == OTA_UPDATING) {
    lv_label_set_text(g_topStatus, "更新中…");
    lv_obj_set_style_text_color(g_topStatus, C_AMBER, 0);
    showToast("发现新版本，正在更新…");
  } else if (state == OTA_FAILED) {
    lv_label_set_text(g_topStatus, g_online ? "在线" : "离线");
    lv_obj_set_style_text_color(g_topStatus, g_online ? C_DARKGREEN : C_RED, 0);
    showToast("更新失败，继续使用当前版本");
  }
}
#endif

static void onUpdatedTick(lv_timer_t *t) {
  (void)t;
  if (g_lastTeleOk == 0) return;
  uint32_t mins = (millis() - g_lastTeleOk) / 60000;
  if (mins == 0) { lv_label_set_text(g_updatedLabel, "更新于刚刚"); return; }
  char buf[32];
  snprintf(buf, sizeof(buf), "更新于 %lu 分钟前", (unsigned long)mins);
  lv_label_set_text(g_updatedLabel, buf);
}

static void onTeleTimer(lv_timer_t *t) {
  (void)t;
  g_telePending = true;
}
#endif  // !USE_OLED_DISPLAY

// 占位符判定：secrets.h.example 的默认值（“你的WiFi名称/密码”）或空串都算未填。
// 未填的组不写入 NVS，也不参与连接。
static bool isPlaceholderWifi(const String &ssid, const String &pass) {
  if (ssid.length() == 0 || pass.length() == 0) return true;
  if (ssid == "你的WiFi名称" || pass == "你的WiFi密码") return true;
  return false;
}

// WiFi 凭证（NVS；首次开机从 secrets.h 取值并存入，之后只读 NVS）
// 注意：占位符组不会写入 NVS（见下）；已写入 NVS 的真值之后改 secrets.h 重烧
// 也不会变，只能整片擦除重烧（见 FLASHING.md §8）。
// 三 WiFi：第一组（ssid/pass，原有）与第二组（ssid2/pass2，新增）、第三组（ssid3/pass3，新增）分开存；
// 三组都只在 NVS 里没有、且 secrets.h 对应组不是占位符时才写入，
// 占位符绝不写入 NVS，也绝不覆盖已有组。之后改某组同样要擦除重烧。
static void loadWifiCreds() {
  Preferences prefs;
  prefs.begin("sijia", false);
  String ssid = prefs.getString("ssid", "");
  String pass = prefs.getString("pass", "");
  if (ssid.length() == 0 && !isPlaceholderWifi(String(WIFI_SSID), String(WIFI_PASSWORD))) {
    ssid = String(WIFI_SSID);
    pass = String(WIFI_PASSWORD);
    prefs.putString("ssid", ssid);
    prefs.putString("pass", pass);
    Serial.println("[司稼] NVS 首次写入 WiFi 账号（来自 secrets.h）");
  }
  String ssid2 = prefs.getString("ssid2", "");
  String pass2 = prefs.getString("pass2", "");
  if (ssid2.length() == 0 && !isPlaceholderWifi(String(WIFI_SSID_2), String(WIFI_PASS_2))) {
    ssid2 = String(WIFI_SSID_2);
    pass2 = String(WIFI_PASS_2);
    prefs.putString("ssid2", ssid2);
    prefs.putString("pass2", pass2);
    Serial.println("[司稼] NVS 写入第二组 WiFi 账号（来自 secrets.h）");
  }
  String ssid3 = prefs.getString("ssid3", "");
  String pass3 = prefs.getString("pass3", "");
  if (ssid3.length() == 0 && !isPlaceholderWifi(String(WIFI_SSID_3), String(WIFI_PASS_3))) {
    ssid3 = String(WIFI_SSID_3);
    pass3 = String(WIFI_PASS_3);
    prefs.putString("ssid3", ssid3);
    prefs.putString("pass3", pass3);
    Serial.println("[司稼] NVS 写入第三组 WiFi 账号（来自 secrets.h）");
  }
  prefs.end();
  g_wifiSsid = ssid;
  g_wifiPass = pass;
  g_wifiSsid2 = ssid2;
  g_wifiPass2 = pass2;
  g_wifiSsid3 = ssid3;
  g_wifiPass3 = pass3;
}

// 试连一组 WiFi（ssid/pass），最多等 timeoutMs；连上返回 true。
// 进度条从 progFrom 走到 progTo（OLED 启动页用；TFT 版跑 LVGL 定时器）。
static bool tryWifi(const String &ssid, const String &pass, uint32_t timeoutMs,
                    float progFrom, float progTo) {
  if (ssid.length() == 0) return false;
  wifiDisconnectSettle(200);  // 换组前先断开，否则驱动拒绝换配置（见上）
  WiFi.begin(ssid.c_str(), pass.c_str());
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < timeoutMs) {
#if USE_OLED_DISPLAY
    oledUiSplashProgress(progFrom + (float)(millis() - t0) / (float)timeoutMs * (progTo - progFrom));
    delay(100);  // OLED 版没有 LVGL 定时器要跑，等就是了
#else
    lv_timer_handler();
    delay(5);
#endif
  }
  return WiFi.status() == WL_CONNECTED;
}

// 三 WiFi 连接：按优先级试——第二组最先，第三组其次，第一组最后。
// 每组最多 6 秒；总耗时与原来单网 15 秒相当。
// 连上后 g_wifiActive 记下在用哪组，供掉线重连参考。
static bool connectWifi() {
  if (g_wifiSsid2.length() > 0) {
    if (tryWifi(g_wifiSsid2, g_wifiPass2, 12000, 0.0f, 0.2f)) {
      g_wifiActive = 2;
      return true;
    }
    Serial.println("[司稼] 第二组 WiFi 未连上，试第三组");
  }
  if (g_wifiSsid3.length() > 0) {
    if (tryWifi(g_wifiSsid3, g_wifiPass3, 6000, 0.2f, 0.4f)) {
      g_wifiActive = 3;
      return true;
    }
    Serial.println("[司稼] 第三组 WiFi 未连上，回落第一组");
  }
  if (tryWifi(g_wifiSsid, g_wifiPass, 6000, 0.4f, 0.6f)) {
    g_wifiActive = 1;
    return true;
  }
  return false;
}

// ---------- setup / loop ----------
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.printf("\n[司稼] 固件 %s 启动\n", FIRMWARE_VERSION);
#if defined(CONFIG_IDF_TARGET_ESP32S3)
  // Install before any TLS connection. Network buffers are large and cold;
  // keep repeatedly accessed LVGL objects and allocator metadata internal.
  const int tlsAllocatorResult = mbedtls_platform_set_calloc_free(
      [](size_t n, size_t size) -> void * {
        void *p = heap_caps_calloc(n, size, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
        return p ? p : heap_caps_calloc(n, size, MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
      }, free);
  Serial.printf("[memory] TLS PSRAM allocator=%d CPU=%uMHz\n", tlsAllocatorResult, getCpuFrequencyMhz());
#endif
  g_resultMutex = xSemaphoreCreateMutex();
#if USE_OLED_DISPLAY
  // OLED 版：初始化 I2C + SSD1306（亮启动页）；背光/触摸/LVGL 都没有。
  oledUiBegin();
#else
  // 背光
  analogWrite(PIN_TFT_BL, BACKLIGHT_BRIGHTNESS);
#if defined(SIJIA_C3_TFT)
  // C3 TFT：Arduino 默认 SPI 脚是 SCK 4/MOSI 6（见 variant pins_arduino.h），
  // 与接线表（SCK 6/MOSI 7）不一致；而触摸库 ts.begin() 用默认 SPI，
  // 必须先按接线表显式初始化总线。SPI.begin() 一旦启动总线，后面的无参
  // begin() 是 no-op，不会把脚改回去，所以必须抢在 tft.init()/ts.begin() 之前。
  SPI.begin(PIN_TFT_SCK, PIN_TFT_MISO, PIN_TFT_MOSI, PIN_TFT_CS);
#endif
  // 屏幕 + 触摸
  tft.init();
  tft.setRotation(SCREEN_ROTATION);
  tft.setSwapBytes(true);
#if !defined(SIJIA_C3_TFT)
  g_displayDma = tft.initDMA();   // Fall back to synchronous SPI if unavailable.
#endif
  tft.fillScreen(TFT_WHITE);
  ts.begin();
  // LVGL
  lv_init();
  lv_tick_set_cb([]() -> uint32_t { return millis(); });
  disp = lv_display_create(SCREEN_WIDTH, SCREEN_HEIGHT);
  lv_display_set_flush_cb(disp, flush_cb);
#if defined(CONFIG_IDF_TARGET_ESP32S3)
  lv_display_set_flush_wait_cb(disp, finishDisplayDma);
#endif
  lv_display_add_event_cb(disp, displayRefreshEvent, LV_EVENT_REFR_START, nullptr);
  lv_display_add_event_cb(disp, displayRefreshEvent, LV_EVENT_REFR_READY, nullptr);
  size_t bufBytes = SCREEN_WIDTH * DRAW_BUF_LINES * 2;
  // ESP32 DMA must use internal DMA-capable buffers. Avoid PSRAM bounce copies.
  drawBuf1 = (uint16_t *)heap_caps_malloc(bufBytes, MALLOC_CAP_INTERNAL | MALLOC_CAP_DMA);
  drawBuf2 = (uint16_t *)heap_caps_malloc(bufBytes, MALLOC_CAP_INTERNAL | MALLOC_CAP_DMA);
  if (!drawBuf1 || !drawBuf2) {
    Serial.println("[display] ERROR: cannot allocate DMA draw buffers");
    while (true) delay(1000);
  }
  Serial.printf("[display] LVGL %d.%d.%d, compressed-font=%d, SPI=%dMHz, DMA=%d, PSRAM=%uKB\n",
                LVGL_VERSION_MAJOR, LVGL_VERSION_MINOR, LVGL_VERSION_PATCH,
                LV_USE_FONT_COMPRESSED, SCREEN_SPI_MHZ, g_displayDma, (unsigned int)(ESP.getPsramSize() / 1024));
  lv_display_set_buffers(disp, drawBuf1, drawBuf2, bufBytes, LV_DISPLAY_RENDER_MODE_PARTIAL);
  lv_indev_t *indev = lv_indev_create();
  lv_indev_set_type(indev, LV_INDEV_TYPE_POINTER);
  lv_indev_set_read_cb(indev, touch_cb);
  lv_indev_set_display(indev, disp);
  lv_timer_set_period(lv_indev_get_read_timer(indev), 10);
  touchCalibrationBegin();
  buildUi();
  showBootSplash();
#if SIJIA_VOICE_ENABLED
  // BOOT 键（S3 是 GPIO 0）：长按触发语音录音（轮询见 loop 的 pollVoiceBootBtn）；
  // 板上已有上拉，INPUT_PULLUP 只是兜底；不影响启动时的下载模式（setup 之后才读）。
  pinMode(PIN_BOOT_BTN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PIN_BOOT_BTN), onBootEdge, CHANGE);
  voiceInit();
#endif
#endif  // USE_OLED_DISPLAY
  // WiFi（界面先出来，状态栏显示连接中）
  // 凭证存 NVS（命名空间 sijia，第一组键 ssid/pass，第二组键 ssid2/pass2，第三组键 ssid3/pass3）：
  // 首次开机用 secrets.h 的值并存入 NVS，以后联网一律读 NVS；
  // OTA 升级只写 app 分区，绝不碰 NVS，升级后不断网。
  // 三 WiFi：按优先级试第二组、第三组、第一组（见 connectWifi）。
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.setHostname("sijia-robot");
  WiFi.setAutoReconnect(false);
  loadWifiCreds();
#if SIJIA_STREAM_TELEMETRY
  const bool wifiOk = false;  // wifiManagerTask connects asynchronously below.
#else
  bool wifiOk = connectWifi();
#endif
  if (wifiOk) {
    Serial.printf("[司稼] WiFi 已连 %s（第 %d 组），IP %s\n", WiFi.SSID().c_str(), g_wifiActive, WiFi.localIP().toString().c_str());
#if USE_OLED_DISPLAY
    oledUiSplashProgress(0.75f);  // WiFi 已连，进度条到 75%
#endif
#if SIJIA_STREAM_TELEMETRY
    // Start the UI immediately. Backend reachability is reported by the SSE
    // and chat tasks; a TLS handshake must never freeze the boot/UI thread.
    g_online = true;
#else
    String h = httpGet(String(SIJIA_BASE_URL) + "/api/health", 5000);
    g_online = h.length() > 0;
#endif
#if USE_OLED_DISPLAY
    oledUiSplashProgress(0.95f);  // 健康检查完，进度条到 95%（随后主循环切到状态页）
#endif
#if !USE_OLED_DISPLAY
    lv_label_set_text(g_topStatus, g_online ? "在线" : "服务器不通");
    lv_obj_set_style_text_color(g_topStatus, g_online ? C_DARKGREEN : C_RED, 0);
#endif
  } else {
#if !USE_OLED_DISPLAY
    lv_label_set_text(g_topStatus, "离线");
    lv_obj_set_style_text_color(g_topStatus, C_RED, 0);
#endif
    Serial.println("[司稼] WiFi 未连上：检查 secrets.h，或用手机热点（校园网认证页连不上）");
  }
  localConsoleBegin();
  xTaskCreate(wifiManagerTask, "sijia-wifi", 4096, nullptr, 1, nullptr);
  // 网络任务 + 定时器
#ifdef CONFIG_FREERTOS_UNICORE
  // C3 单核：没有 core 1，不 pin 任务。
  xTaskCreate(netTask, "sijia-net", 8192, nullptr, 1, nullptr);
#else
  xTaskCreatePinnedToCore(netTask, "sijia-net", 8192, nullptr, 1, nullptr, 0);
#endif
#if USE_OLED_DISPLAY
  g_telePending = true;   // 启动后立刻取一次遥测；之后 loop() 每 15 秒触发一次
  Serial.println("[司稼] 就绪：OLED 每 5 秒轮换，BOOT 短按切页、长按提问");
#else
#if SIJIA_STREAM_TELEMETRY
  telemetryStreamBegin(SIJIA_BASE_URL);
#else
  lv_timer_create(onTeleTimer, 15000, nullptr);
#endif
  if (!SIJIA_STREAM_TELEMETRY) lv_timer_create(onUpdatedTick, 10000, nullptr);
  g_telePending = !SIJIA_STREAM_TELEMETRY;
  while (millis() - g_bootSplashAt < 1200) { lv_timer_handler(); delay(5); }
  finishBootSplash();
  g_lastInteractMs = millis();  // 待机计时从就绪起算（WiFi 等待期间不计，避免一开机就待机）
  Serial.println("[司稼] 就绪：点导航或短按BOOT切页，长按BOOT校准");
#endif
}

static void pollSerialControl() {
  static String line;
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\r') continue;
    if (c != '\n') {
      if (line.length() < 1024) line += c;
      else line = "";
      continue;
    }
    if (line.startsWith("WIFI ")) {
      JsonDocument cfg;
      bool valid = deserializeJson(cfg, line.substring(5)) == DeserializationError::Ok;
      if (valid) valid = queueWifiConfigSlot(cfg["ssid"] | "", cfg["password"] | "", cfg["slot"] | 2);
      Serial.println(valid ? "[control] WiFi queued" : "[control] WiFi rejected");
    } else if (line.startsWith("OTAPASS ")) {
      Serial.println(localConsoleSetOtaPassword(line.substring(8)) ? "[control] OTA configured" : "[control] OTA rejected");
    } else if (line == "STATUS") {
      Serial.printf("[status] firmware=%s wifi=%d ip=%s ota=%d psram=%uKB\n",
                    FIRMWARE_VERSION, WiFi.status() == WL_CONNECTED,
                    localConsoleAddress().c_str(), localConsoleOtaEnabled(),
                    (unsigned int)(ESP.getPsramSize() / 1024));
#if defined(CONFIG_IDF_TARGET_ESP32S3)
      const esp_partition_t *running = esp_ota_get_running_partition();
      if (running) Serial.printf("[status] slot=%s offset=0x%lx\n", running->label,
                                 (unsigned long)running->address);
#endif
      for (const auto &ch : g_channels) Serial.printf("[sample] %s %.2f %s state=%d\n", ch.id, ch.value, ch.unit, chanStateCode(ch));
#if !USE_OLED_DISPLAY
    } else if (line.startsWith("METRIC ")) {
      const int index = line.substring(7).toInt();
      if (index >= 0 && index < 3) {
        lv_obj_send_event(g_metricCards[index], LV_EVENT_CLICKED, nullptr);
        Serial.printf("[chart] selected=%d title=%s\n", g_selectedMetric, lv_label_get_text(g_chartTitle));
      }
    } else if (line.startsWith("CALRESTORE ")) {
      JsonDocument cfg;
      bool valid = deserializeJson(cfg, line.substring(11)) == DeserializationError::Ok;
      float matrix[6] = {};
      valid = valid && cfg.is<JsonArray>() && cfg.size() == 6;
      for (int i = 0; valid && i < 6; ++i) {
        valid = cfg[i].is<float>(); matrix[i] = cfg[i].as<float>();
      }
      if (!valid) Serial.printf("[calibration] restore JSON invalid array=%d size=%u\n", cfg.is<JsonArray>(), (unsigned)cfg.size());
      Serial.println(valid && touchCalibrationRestore(matrix) ? "[calibration] restored" : "[calibration] restore rejected");
    } else if (line == "CALIBRATE") {
      touchCalibrationStart();
#if defined(CONFIG_IDF_TARGET_ESP32S3)
    } else if (line == "DISPLAY BASE" || line == "DISPLAY FAST") {
      g_fastDisplay = line.endsWith("FAST");
      lv_timer_set_period(g_standbyTimer, g_fastDisplay ? 32 : 40);
      for (auto *puff : g_puffs) {
        lv_obj_set_style_opa(puff, LV_OPA_COVER, 0);
        lv_obj_set_style_bg_opa(puff, g_fastDisplay ? LV_OPA_TRANSP : LV_OPA_COVER, 0);
      }
      if (g_standbyOn) setStandbyCache(g_fastDisplay);
      Serial.printf("[display] profile=%s cached=%d\n",
                    g_fastDisplay ? "fast" : "baseline",
                    g_standbyCache && !lv_obj_has_flag(g_standbyCache, LV_OBJ_FLAG_HIDDEN));
#endif
    } else if (line == "PAGE STANDBY") {
      showStandby();
    } else if (line == "PAGE MONITOR") {
      wakeStandby();
      lv_tileview_set_tile_by_index(g_tileview, 0, 0, LV_ANIM_OFF); updateDots(0);
    } else if (line == "PAGE WIFI") {
      lv_tileview_set_tile_by_index(g_tileview, 2, 0, LV_ANIM_OFF); updateDots(2);
    } else if (line == "PAGE CHAT") {
      lv_tileview_set_tile_by_index(g_tileview, 1, 0, LV_ANIM_OFF); updateDots(1);
    } else if (line.startsWith("ASK ")) {
      askQuestion(line.substring(4).c_str());
#endif
    }
    line = "";
  }
}

void loop() {
  pollSerialControl();
  localConsoleLoop();
#if SIJIA_STREAM_TELEMETRY
  wifiPanelTick();
#endif
#if USE_OLED_DISPLAY
  maintainWifi();
  // 消费问答结果（有新结果才进；失败也记一句，供问答页显示）
  ChatResult r;
  if (takeChatResult(r)) {
    g_chatBusy = false;
    if (r.ok) {
      g_lastAnswer = r.answer;
      if (g_historyCount < MAX_HISTORY_MSGS) {
        g_history[g_historyCount].role = "assistant";
        g_history[g_historyCount].content = r.answer;
        g_historyCount++;
      }
    } else {
      g_lastAnswer = "请求失败，请检查网络后重试。";
    }
  }
  // 15 秒轮询一次遥测（LVGL 版用 lv_timer，这里用 millis 节流）
  static uint32_t lastTeleMs = 0;
  if (millis() - lastTeleMs >= 15000) {
    lastTeleMs = millis();
    g_telePending = true;
  }
  // 刷新 OLED（只手动换页；长按返回提问动作、从问答页翻到状态页返回清除动作，由主循环执行）
  OledPageData snap = buildOledSnapshot();
  int action = oledUiTick(snap);
  if (action == OLED_ACTION_ASK_PRESET_0) {
    startAsk(PRESET_QUESTIONS[0]);  // 失败（正忙/未联网）时 OLED 下次刷新仍显示旧状态
  } else if (action == OLED_ACTION_CLEAR_CHAT) {
    // 从问答页翻到状态页：问答清掉，不保留；回到问答页重新开始问。
    g_lastQuestion = "";
    g_lastAnswer = "";
    g_historyCount = 0;
  }
  delay(20);
#else
  const uint32_t handlerStart = millis();
  lv_timer_handler();
  g_handlerPeakMs = max(g_handlerPeakMs, millis() - handlerStart);
  g_handlerTotalMs += millis() - handlerStart;
#if defined(CONFIG_IDF_TARGET_ESP32S3)
  delay(g_fastDisplay ? 1 : 5);
#else
  delay(5);
#endif
  static uint32_t lastPerfReport = 0;
  if (millis() - lastPerfReport >= 5000) {
    const uint32_t reportNow = millis();
    Serial.printf("[fps] frames=%lu window_ms=%lu peak_us=%lu\n",
                  (unsigned long)g_frameCount, (unsigned long)(reportNow - lastPerfReport),
                  (unsigned long)g_framePeakUs);
    g_frameCount = g_framePeakUs = 0;
    lastPerfReport = reportNow;
    Serial.printf("[display] 5s flushes=%lu flush_peak_us=%lu handler_peak_ms=%lu heap=%uKB\n",
                  (unsigned long)g_flushCount, (unsigned long)g_flushPeakUs,
                  (unsigned long)g_handlerPeakMs, (unsigned int)(ESP.getFreeHeap() / 1024));
    Serial.printf("[display] render_total_ms=%lu spi_total_ms=%lu touch_peak_us=%lu\n", (unsigned long)g_handlerTotalMs, (unsigned long)(g_flushTotalUs / 1000), (unsigned long)g_touchPeakUs);
    lv_mem_monitor_t mem;
    lv_mem_monitor(&mem);
    Serial.printf("[memory] LVGL used=%uKB peak=%uKB free=%uKB\n", (unsigned)((mem.total_size-mem.free_size)/1024), (unsigned)(mem.max_used/1024), (unsigned)(mem.free_size/1024));
    g_flushCount = g_flushPeakUs = g_handlerPeakMs = 0;
    g_handlerTotalMs = g_flushTotalUs = g_touchPeakUs = 0;
  }
  // WiFi 状态栏（每约 1 秒检查一次，节流在 maintainWifi() 里）
  static bool displayedOnline = !g_online;
  if (displayedOnline != g_online) {
    displayedOnline = g_online;
    lv_label_set_text(g_topStatus, g_online ? "在线" : "离线");
    lv_obj_set_style_text_color(g_topStatus, g_online ? C_DARKGREEN : C_RED, 0);
  }
  // 10 秒无操作（且不在问答中）进待机；点一下唤醒（待机屏的 CLICKED 事件）。
  if (!g_standbyOn && !g_chatBusy && !voiceIsBusy() && !touchCalibrationActive() &&
      !wifiPanelInputOpen() && (!g_presetOverlay || lv_obj_has_flag(g_presetOverlay, LV_OBJ_FLAG_HIDDEN)) &&
      (!g_alarmOverlay || lv_obj_has_flag(g_alarmOverlay, LV_OBJ_FLAG_HIDDEN)) &&
      millis() - g_lastInteractMs > STANDBY_TIMEOUT_MS) {
    showStandby();
  }
  applyChatResult();
  applyTeleResult();
#if SIJIA_VOICE_ENABLED
  applyVoiceResult();
  updateVoiceUi();
  pollVoiceBootBtn();
#endif
#if ENABLE_OTA
  applyOtaStatus();
#endif
#endif  // USE_OLED_DISPLAY
}

// 司稼小机器人 RV0.1.0 — LVGL 界面 + WiFi 问答 + 遥测监控
// 硬件：ESP32-S3-N16R8 + 3.2 寸 ILI9341 触摸屏（默认配置档 A）
//   板子已按商品图核实（2026-11-10）：ESP32-S3-WROOM-1-N16R8，双核 240MHz，
//   16MB Flash + 8MB PSRAM（OPI）；双 Type-C：CH340 口（USB-ISP）烧录，
//   原生 USB 口（OTG）默认不用。禁区见 display_config.h（34-37/0/45/46/19/20/48）。
// TFT UI v2（2026-11-10）：旧版 UI1.14 浅色风格，3 页左右滑动；
//   底部胶囊翻页指示器（当前页 18x6 绿胶囊、未选中 6x6 灰圆、200ms 过渡、可点）；
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
#endif
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/semphr.h>
#include "display_config.h"
#include "secrets.h"
#include "version.h"
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

// ---------- 颜色（旧版 UI1.14 浅色规范，见方案 §3.5；仅 LVGL TFT 版用）----------
#if !USE_OLED_DISPLAY
#define C_BG       lv_color_hex(0xFBFDFC)
#define C_CARD     lv_color_hex(0xF7F9F8)
#define C_SUBBG    lv_color_hex(0xEEF1F0)
#define C_BORDER   lv_color_hex(0xD7DAD9)
#define C_TEXT     lv_color_hex(0x1A211E)
#define C_SUBTEXT  lv_color_hex(0x5F6563)
#define C_GREEN    lv_color_hex(0x46A758)
#define C_DARKGREEN lv_color_hex(0x2A7E3B)
#define C_GREENBG  lv_color_hex(0xC9E8CA)
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
// 显存：S3 有 PSRAM，双缓冲 40 行放 PSRAM；C3 无 PSRAM，双缓冲改 20 行放内部 RAM。
#ifdef CONFIG_SPIRAM
static const uint16_t DRAW_BUF_LINES = 40;   // 每缓冲 40 行，PSRAM
#else
static const uint16_t DRAW_BUF_LINES = 20;   // 每缓冲 20 行，内部 RAM
#endif

static void flush_cb(lv_display_t *d, const lv_area_t *area, uint8_t *color_p) {
  uint32_t w = area->x2 - area->x1 + 1, h = area->y2 - area->y1 + 1;
  tft.startWrite();
  tft.setAddrWindow(area->x1, area->y1, w, h);
  tft.pushPixelsDMA((uint16_t *)color_p, w * h);
  tft.dmaWait();
  tft.endWrite();
  lv_display_flush_ready(d);
}

// ---------- 交互计时（待机 10 秒用；任何一次触摸/点按都重置）----------
static uint32_t g_lastInteractMs = 0;
static bool g_standbyOn = false;
static void markActive() { g_lastInteractMs = millis(); }

static void touch_cb(lv_indev_t *indev, lv_indev_data_t *data) {
  (void)indev;
  // 去抖状态：单次跳变超过 80px 视为毛刺，沿用上一次坐标（XPT2046 偶发跳点）。
  static int32_t lx = -1, ly = -1;
  static bool wasPressed = false;
  if (!ts.touched()) {
    wasPressed = false;
    data->state = LV_INDEV_STATE_RELEASED;
    return;
  }
  TS_Point p = ts.getPoint();
  // 横屏 rotation 1 的常用映射；如实机上触摸轴反了/镜像了，交换下面两行或取反（见 README 排查）。
  // 旋转方向在 LVGL 里设（tft.setRotation(1) + 本映射），不要另调库的 setRotation（会叠加）。
  int32_t sx = map(p.x, TOUCH_X_MIN, TOUCH_X_MAX, 0, SCREEN_WIDTH - 1);
  int32_t sy = map(p.y, TOUCH_Y_MIN, TOUCH_Y_MAX, 0, SCREEN_HEIGHT - 1);
  sx = constrain(sx, 0, SCREEN_WIDTH - 1);
  sy = constrain(sy, 0, SCREEN_HEIGHT - 1);
  if (wasPressed && lx >= 0 && (abs(sx - lx) > 80 || abs(sy - ly) > 80)) { sx = lx; sy = ly; }
  lx = sx; ly = sy; wasPressed = true;
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

// 切到指定组（异步 WiFi.begin，不阻塞）；g 无效时什么都不做。
static void switchWifiGroup(int g) {
  if (g == 1) {
    WiFi.begin(g_wifiSsid.c_str(), g_wifiPass.c_str());
  } else if (g == 2) {
    WiFi.begin(g_wifiSsid2.c_str(), g_wifiPass2.c_str());
  } else if (g == 3) {
    WiFi.begin(g_wifiSsid3.c_str(), g_wifiPass3.c_str());
  } else {
    return;
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
  client.setInsecure();   // 演示终端：跳过证书校验（见 README 安全说明）
  HTTPClient http;
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
  client.setInsecure();
  HTTPClient http;
  http.begin(client, String(SIJIA_BASE_URL) + "/api/chat");
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(60000);
  // 注意：不要加 Origin 头；HTTPClient 默认不发，正好通过正式站同源检查。
  JsonDocument req;
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
  String body;
  serializeJson(req, body);
  int code = http.POST(body);
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
      const char *t = s["title"] | s["id"] | (const char *)nullptr;
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
    if (g_telePending) {
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
// 底部翻页指示器（胶囊式，见 buildUi 底部条带）：未选中 6x6 灰圆 #D7DAD9，
// 当前页 18x6 绿胶囊 #46A758，全圆角；宽 + 颜色 200ms 过渡；可点跳页。
static lv_obj_t *g_dots[3] = {nullptr, nullptr, nullptr};
static lv_obj_t *g_tileview = nullptr;
static lv_obj_t *g_msgList = nullptr;     // 对话消息容器
static lv_obj_t *g_thinking = nullptr;    // “正在诊断…”行
static lv_obj_t *g_thinkLabel = nullptr;  // “正在诊断” + 省略号循环
static lv_obj_t *g_thinkDots[3] = {nullptr, nullptr, nullptr};  // 三点呼吸动画
static lv_timer_t *g_thinkTimer = nullptr;
static int g_thinkStep = 0;
static lv_obj_t *g_sourcesBox = nullptr;  // 最新一条回答的依据区
static lv_obj_t *g_sourcesLabel = nullptr;
static lv_obj_t *g_sourcesBtn = nullptr;
static lv_obj_t *g_toast = nullptr;
// 监测页：3 张小卡片（大数字 + 单位 + 名称状态 + 底部细条）+ 1 张趋势图
static lv_obj_t *g_meterVal[3] = {nullptr, nullptr, nullptr};   // 大数字（28px）
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
// 指示器胶囊动画：一次 lv_anim 同时插值 3 个点的 x 与宽（200ms，ease-out）。
struct DotsAnimState { int32_t fromX[3], toX[3], fromW[3], toW[3]; };
static DotsAnimState g_dotsAnim;
static bool g_dotsReady = false;
// 按钮点按反馈：pressed 变色 + 缩放 0.96，100ms 过渡（见 stylePressable）。
static lv_style_transition_dsc_t g_pressTrans;
static const lv_style_prop_t g_pressProps[] = {
  LV_STYLE_BG_COLOR, LV_STYLE_TRANSFORM_SCALE_X, LV_STYLE_TRANSFORM_SCALE_Y,
  LV_STYLE_BORDER_COLOR, (lv_style_prop_t)0};
// ---------- 待机屏（10 秒无操作进；拖拉机动画只动轮子/尾气/光晕等小对象，
// LVGL 只重绘这些脏区，不全屏刷新）----------
#define STANDBY_TIMEOUT_MS 10000
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
static void fadeIn(lv_obj_t *o) {
  lv_obj_set_style_opa(o, 0, 0);
  lv_anim_t a;
  lv_anim_init(&a);
  lv_anim_set_var(&a, o);
  lv_anim_set_values(&a, 0, 255);
  lv_anim_set_duration(&a, 250);
  lv_anim_set_exec_cb(&a, animOpaCb);
  lv_anim_set_path_cb(&a, lv_anim_path_ease_out);
  lv_anim_start(&a);
}

// 按钮点按反馈：pressed 时换底色 + 缩到 0.96，100ms 过渡（g_pressTrans 在 buildUi 里初始化）。
static void stylePressable(lv_obj_t *b, lv_color_t pressedBg) {
  lv_obj_set_style_transition(b, &g_pressTrans, 0);
  lv_obj_set_style_bg_color(b, pressedBg, LV_STATE_PRESSED);
  // LVGL 9 里缩放属性叫 TRANSFORM_SCALE（旧名 zoom 是 v8 的别名映射）
  lv_obj_set_style_transform_scale(b, 245, LV_STATE_PRESSED);
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

// 指示器目标几何：未选中 6x6，当前页 18x6，间距 8；总宽 46，底部条带居中。
static void dotsTarget(int page, int32_t *xs, int32_t *ws) {
  int32_t x = 0;
  for (int i = 0; i < 3; i++) {
    ws[i] = (i == page) ? 18 : 6;
    xs[i] = x;
    x += ws[i] + 8;
  }
}

static void dotsAnimCb(void *var, int32_t v) {
  DotsAnimState *s = (DotsAnimState *)var;
  for (int i = 0; i < 3; i++) {
    int32_t x = s->fromX[i] + (s->toX[i] - s->fromX[i]) * v / 256;
    int32_t w = s->fromW[i] + (s->toW[i] - s->fromW[i]) * v / 256;
    lv_obj_set_x(g_dots[i], x);
    lv_obj_set_width(g_dots[i], w);
  }
}

// 滑动结束后再更新圆点（onTileChanged 调）；颜色用样式过渡 200ms 跟着变。
static void updateDots(int page) {
  int32_t tx[3], tw[3];
  dotsTarget(page, tx, tw);
  for (int i = 0; i < 3; i++) {
    lv_obj_set_style_bg_color(g_dots[i], i == page ? C_GREEN : C_BORDER, 0);
  }
  if (!g_dotsReady) {
    for (int i = 0; i < 3; i++) {
      lv_obj_set_x(g_dots[i], tx[i]);
      lv_obj_set_width(g_dots[i], tw[i]);
    }
    g_dotsReady = true;
    return;
  }
  for (int i = 0; i < 3; i++) {
    g_dotsAnim.fromX[i] = lv_obj_get_x(g_dots[i]);
    g_dotsAnim.fromW[i] = lv_obj_get_width(g_dots[i]);
    g_dotsAnim.toX[i] = tx[i];
    g_dotsAnim.toW[i] = tw[i];
  }
  lv_anim_t a;
  lv_anim_init(&a);
  lv_anim_set_var(&a, &g_dotsAnim);
  lv_anim_set_values(&a, 0, 256);
  lv_anim_set_duration(&a, 200);
  lv_anim_set_exec_cb(&a, dotsAnimCb);
  lv_anim_set_path_cb(&a, lv_anim_path_ease_out);
  lv_anim_start(&a);
}

// 圆点本身可点：点第 n 个跳到第 n 页。
static void onDotClicked(lv_event_t *e) {
  int idx = (int)(intptr_t)lv_event_get_user_data(e);
  markActive();
  lv_tileview_set_tile_by_index(g_tileview, idx, 0, LV_ANIM_ON);
  updateDots(idx);
}

// ---------- 对话 ----------
static void addUserBubble(const char *q) {
  lv_obj_t *row = lv_obj_create(g_msgList);
  lv_obj_set_width(row, lv_pct(100));
  lv_obj_set_height(row, LV_SIZE_CONTENT);
  lv_obj_set_style_bg_color(row, C_GREENBG, 0);
  lv_obj_set_style_radius(row, 8, 0);
  lv_obj_set_style_border_width(row, 0, 0);
  lv_obj_set_style_pad_all(row, 6, 0);
  lv_obj_t *l = mkLabel(row, q, &font_zh_16, C_TEXT);
  lv_label_set_long_mode(l, LV_LABEL_LONG_WRAP);
  lv_obj_set_width(l, lv_pct(100));
  fadeIn(row);
}

static void addAssistantCard(const char *answer, const char *tag) {
  lv_obj_t *row = lv_obj_create(g_msgList);
  lv_obj_set_width(row, lv_pct(100));
  lv_obj_set_height(row, LV_SIZE_CONTENT);
  styleCard(row);
  lv_obj_set_style_pad_all(row, 6, 0);
  lv_obj_t *tagL = mkLabel(row, tag, &font_zh_12, C_SUBTEXT);
  lv_obj_set_width(tagL, lv_pct(100));
  lv_obj_t *l = mkLabel(row, answer, &font_zh_16, C_TEXT);
  lv_label_set_long_mode(l, LV_LABEL_LONG_WRAP);
  lv_obj_set_width(l, lv_pct(100));
  lv_obj_scroll_to_y(g_msgList, LV_COORD_MAX, LV_ANIM_ON);
  fadeIn(row);
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
  if (on) {
    lv_obj_set_hidden(g_thinking, false);
    lv_obj_scroll_to_y(g_msgList, LV_COORD_MAX, LV_ANIM_ON);
    // 三点呼吸：透明度 70↔255 循环，依次延迟 160ms。
    for (int i = 0; i < 3; i++) {
      lv_anim_t a;
      lv_anim_init(&a);
      lv_anim_set_var(&a, g_thinkDots[i]);
      lv_anim_set_values(&a, 70, 255);
      lv_anim_set_duration(&a, 500);
      lv_anim_set_delay(&a, (uint32_t)i * 160);
      lv_anim_set_playback_duration(&a, 500);
      lv_anim_set_repeat_count(&a, LV_ANIM_REPEAT_INFINITE);
      lv_anim_set_exec_cb(&a, animOpaCb);
      lv_anim_start(&a);
    }
    if (g_thinkTimer) lv_timer_del(g_thinkTimer);
    g_thinkStep = 0;
    g_thinkTimer = lv_timer_create(onThinkTick, 450, nullptr);
  } else {
    lv_obj_set_hidden(g_thinking, true);
    for (int i = 0; i < 3; i++) lv_anim_delete(g_thinkDots[i], animOpaCb);
    if (g_thinkTimer) { lv_timer_del(g_thinkTimer); g_thinkTimer = nullptr; }
    lv_label_set_text(g_thinkLabel, "正在诊断");
  }
}

static void askQuestion(const char *q) {
  if (!startAsk(q)) {
    showToast(g_chatBusy ? "正在诊断，请稍等" : "未联网，请检查 WiFi");
    return;
  }
  addUserBubble(q);
  lv_tileview_set_tile_by_index(g_tileview, 1, 0, LV_ANIM_ON);
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
  showToast("输入法在 RV0.2.0（语音版）提供，当前用预设问题提问");
}
static void onSourcesToggle(lv_event_t *e) {
  (void)e;
  markActive();
  g_sourcesOpen = !g_sourcesOpen;
  if (g_sourcesOpen) lv_obj_set_hidden(g_sourcesBox, false);
  else lv_obj_set_hidden(g_sourcesBox, true);
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
static const char *chanStateText(const TeleChannel &ch, lv_color_t *color) {
  switch (chanStateCode(ch)) {
    case 2: *color = C_RED; return "报警";
    case 1: *color = C_AMBER; return "注意";
    case 0: *color = C_DARKGREEN; return "正常";
    default: *color = C_SUBTEXT; return "—";
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
    lv_label_set_text(g_meterVal[i], buf);
    lv_label_set_text(g_meterUnit[i], ch.unit);
    lv_color_t c;
    const char *st = chanStateText(ch, &c);
    char nbuf[32];
    snprintf(nbuf, sizeof(nbuf), "%s · %s", ch.label, st);
    lv_label_set_text(g_meterName[i], nbuf);
    lv_obj_set_style_text_color(g_meterName[i], c, 0);
    // 底部细条：宽度按量程比例，颜色跟状态走
    lv_coord_t bw = lv_obj_get_width(g_meterBarBg[i]);
    float frac = 0.0f;
    if (!isnan(ch.value) && ch.maxV > ch.minV)
      frac = (ch.value - ch.minV) / (ch.maxV - ch.minV);
    if (frac < 0) frac = 0;
    if (frac > 1) frac = 1;
    lv_obj_set_width(g_meterFill[i], (lv_coord_t)(frac * bw));
    lv_obj_set_style_bg_color(g_meterFill[i], c, 0);
  }
  // 告警横条：取最严重的一条；无告警时显示场景 + 暂无告警（不弹窗）
  int worstCode = 0;  // 0 正常，1 注意，2 报警
  int worstIdx = 0;
  for (int i = 0; i < 3; i++) {
    int code = chanStateCode(g_channels[i]);
    if (code > worstCode) { worstCode = code; worstIdx = i; }
  }
  char sbuf[64];
  if (worstCode == 2) {
    lv_obj_set_style_bg_color(g_alertStrip, C_LIGHTRED, 0);
    snprintf(sbuf, sizeof(sbuf), "报警：%s %.0f%s，超过阈值",
             g_channels[worstIdx].label, g_channels[worstIdx].value,
             g_channels[worstIdx].unit);
    lv_label_set_text(g_scenarioLabel, sbuf);
    lv_obj_set_style_text_color(g_scenarioLabel, C_RED, 0);
  } else if (worstCode == 1) {
    lv_obj_set_style_bg_color(g_alertStrip, C_LIGHTAMBER, 0);
    snprintf(sbuf, sizeof(sbuf), "注意：%s %.0f%s，接近阈值",
             g_channels[worstIdx].label, g_channels[worstIdx].value,
             g_channels[worstIdx].unit);
    lv_label_set_text(g_scenarioLabel, sbuf);
    lv_obj_set_style_text_color(g_scenarioLabel, C_AMBER, 0);
  } else {
    lv_obj_set_style_bg_color(g_alertStrip, C_GREENBG, 0);
    snprintf(sbuf, sizeof(sbuf), "场景：%s · 暂无告警", g_scenarioZh);
    lv_label_set_text(g_scenarioLabel, sbuf);
    lv_obj_set_style_text_color(g_scenarioLabel, C_DARKGREEN, 0);
  }
  // 水温趋势图：用 history 抽稀的 60 个点重填
  if (g_trendCount > 0) {
    for (int i = 0; i < 60; i++) {
      float v = i < g_trendCount ? g_trendVals[i] : g_trendVals[g_trendCount - 1];
      lv_chart_set_series_value_by_id(g_chart, g_chartSer, i, (int32_t)v);
    }
    lv_chart_refresh(g_chart);
  }
  // 报警阈值线（水温报警值来自 history 响应的 channel.threshold）
  float thr = g_channels[0].hasAlarm ? g_channels[0].alarmAbove : 85.0f;
  char tbuf[40];
  snprintf(tbuf, sizeof(tbuf), "水温趋势 · 近 5 分钟（报警 %.0f°C）", thr);
  lv_label_set_text(g_chartTitle, tbuf);
  if (g_thresholdLine) {
    lv_coord_t h = lv_obj_get_height(g_chart);
    lv_coord_t y = (lv_coord_t)(h - (thr / 100.0f) * h);
    static lv_point_precise_t pts[2];
    pts[0].x = 0; pts[0].y = y;
    pts[1].x = lv_obj_get_width(g_chart); pts[1].y = y;
    lv_line_set_points(g_thresholdLine, pts, 2);
  }
  g_lastTeleOk = millis();
  lv_label_set_text(g_updatedLabel, "更新于刚刚");
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
  lv_obj_set_layout(bar, LV_LAYOUT_FLEX);
  lv_obj_set_flex_flow(bar, LV_FLEX_FLOW_ROW);
  lv_obj_set_flex_align(bar, LV_FLEX_ALIGN_SPACE_BETWEEN, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
  mkLabel(bar, "司稼 · 智能运维", &font_zh_16, C_TEXT);
  g_topStatus = mkLabel(bar, "连接中…", &font_zh_12, C_SUBTEXT);
}

static void buildHomeTile(lv_obj_t *tile) {
  lv_obj_set_layout(tile, LV_LAYOUT_FLEX);
  lv_obj_set_flex_flow(tile, LV_FLEX_FLOW_COLUMN);
  lv_obj_set_style_pad_all(tile, 8, 0);
  lv_obj_set_style_pad_gap(tile, 8, 0);
  mkLabel(tile, "司稼", &font_zh_22, C_TEXT);
  mkLabel(tile, "拖拉机智能运维智能体 · 正式站 agridx.xyz", &font_zh_12, C_SUBTEXT);
  mkLabel(tile, "今天想问什么？", &font_zh_16, C_TEXT);
  lv_obj_t *grid = lv_obj_create(tile);
  lv_obj_set_width(grid, lv_pct(100));
  lv_obj_set_height(grid, LV_SIZE_CONTENT);
  lv_obj_set_style_bg_opa(grid, LV_OPA_TRANSP, 0);
  lv_obj_set_style_border_width(grid, 0, 0);
  lv_obj_set_style_pad_all(grid, 0, 0);
  lv_obj_set_style_pad_gap(grid, 6, 0);
  lv_obj_set_layout(grid, LV_LAYOUT_FLEX);
  lv_obj_set_flex_flow(grid, LV_FLEX_FLOW_ROW_WRAP);
  for (int i = 0; i < 4; i++) {
    lv_obj_t *b = lv_btn_create(grid);
    lv_obj_set_width(b, lv_pct(48));
    lv_obj_set_height(b, 44);
    lv_obj_set_style_bg_color(b, C_CARD, 0);
    lv_obj_set_style_radius(b, 8, 0);
    lv_obj_set_style_border_width(b, 1, 0);
    lv_obj_set_style_border_color(b, C_BORDER, 0);
    lv_obj_set_style_shadow_width(b, 0, 0);
    stylePressable(b, C_GREENBG);  // 点按：底色变浅绿 + 缩 0.96，100ms 过渡
    lv_obj_t *l = lv_label_create(b);
    lv_label_set_text(l, PRESET_LABELS[i]);
    lv_obj_set_style_text_font(l, &font_zh_16, 0);
    lv_obj_set_style_text_color(l, C_TEXT, 0);
    lv_obj_center(l);
    lv_obj_add_event_cb(b, onPreset, LV_EVENT_CLICKED, (void *)(intptr_t)i);
  }
  lv_obj_t *hint = mkLabel(tile, "点一个问题直接问 · 左右滑动切换对话 / 监控", &font_zh_12, C_SUBTEXT);
  (void)hint;
}

static void buildChatTile(lv_obj_t *tile) {
  lv_obj_set_layout(tile, LV_LAYOUT_FLEX);
  lv_obj_set_flex_flow(tile, LV_FLEX_FLOW_COLUMN);
  lv_obj_set_style_pad_all(tile, 6, 0);
  lv_obj_set_style_pad_gap(tile, 6, 0);
  g_msgList = lv_obj_create(tile);
  lv_obj_set_width(g_msgList, lv_pct(100));
  lv_obj_set_flex_grow(g_msgList, 1);
  lv_obj_set_style_bg_opa(g_msgList, LV_OPA_TRANSP, 0);
  lv_obj_set_style_border_width(g_msgList, 0, 0);
  lv_obj_set_style_pad_all(g_msgList, 2, 0);
  lv_obj_set_style_pad_gap(g_msgList, 6, 0);
  lv_obj_set_layout(g_msgList, LV_LAYOUT_FLEX);
  lv_obj_set_flex_flow(g_msgList, LV_FLEX_FLOW_COLUMN);
  // 欢迎行
  lv_obj_t *w = lv_obj_create(g_msgList);
  lv_obj_set_width(w, lv_pct(100));
  lv_obj_set_height(w, LV_SIZE_CONTENT);
  styleCard(w);
  lv_obj_set_style_pad_all(w, 6, 0);
  lv_obj_t *wl = mkLabel(w, "我是司稼，拖拉机智能运维智能体。点下面的预设问题，或者从首页选一个问题问我。", &font_zh_16, C_TEXT);
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
    lv_obj_set_style_bg_color(g_thinkDots[i], C_GREEN, 0);
    lv_obj_set_style_border_width(g_thinkDots[i], 0, 0);
  }
  lv_obj_set_hidden(g_thinking, true);
  // 依据区（默认隐藏，回答带依据时才出现）
  g_sourcesBox = lv_obj_create(tile);
  lv_obj_set_width(g_sourcesBox, lv_pct(100));
  lv_obj_set_height(g_sourcesBox, LV_SIZE_CONTENT);
  styleCard(g_sourcesBox);
  lv_obj_set_style_pad_all(g_sourcesBox, 6, 0);
  g_sourcesLabel = mkLabel(g_sourcesBox, "", &font_zh_12, C_SUBTEXT);
  lv_label_set_long_mode(g_sourcesLabel, LV_LABEL_LONG_WRAP);
  lv_obj_set_width(g_sourcesLabel, lv_pct(100));
  lv_obj_set_hidden(g_sourcesBox, true);
  g_sourcesBtn = lv_btn_create(tile);
  lv_obj_set_width(g_sourcesBtn, lv_pct(100));
  lv_obj_set_height(g_sourcesBtn, 28);
  lv_obj_set_style_bg_color(g_sourcesBtn, C_SUBBG, 0);
  lv_obj_set_style_radius(g_sourcesBtn, 4, 0);
  lv_obj_set_style_border_width(g_sourcesBtn, 0, 0);
  lv_obj_set_style_shadow_width(g_sourcesBtn, 0, 0);
  stylePressable(g_sourcesBtn, lv_color_hex(0xE2E7E6));
  lv_obj_t *sl = lv_label_create(g_sourcesBtn);
  lv_label_set_text(sl, "查看依据与核对项（展开）");
  lv_obj_set_style_text_font(sl, &font_zh_12, 0);
  lv_obj_set_style_text_color(sl, C_SUBTEXT, 0);
  lv_obj_center(sl);
  lv_obj_add_event_cb(g_sourcesBtn, onSourcesToggle, LV_EVENT_CLICKED, nullptr);
  lv_obj_set_hidden(g_sourcesBtn, true);
  // 底部：输入占位 + 新对话
  lv_obj_t *bottom = lv_obj_create(tile);
  lv_obj_set_width(bottom, lv_pct(100));
  lv_obj_set_height(bottom, 34);
  lv_obj_set_style_bg_opa(bottom, LV_OPA_TRANSP, 0);
  lv_obj_set_style_border_width(bottom, 0, 0);
  lv_obj_set_style_pad_all(bottom, 0, 0);
  lv_obj_set_layout(bottom, LV_LAYOUT_FLEX);
  lv_obj_set_flex_flow(bottom, LV_FLEX_FLOW_ROW);
  lv_obj_set_style_pad_gap(bottom, 6, 0);
  lv_obj_t *input = lv_btn_create(bottom);
  lv_obj_set_flex_grow(input, 1);
  lv_obj_set_height(input, 34);
  lv_obj_set_style_bg_color(input, C_CARD, 0);
  lv_obj_set_style_radius(input, 4, 0);
  lv_obj_set_style_border_width(input, 1, 0);
  lv_obj_set_style_border_color(input, C_BORDER, 0);
  lv_obj_set_style_shadow_width(input, 0, 0);
  stylePressable(input, C_SUBBG);
  lv_obj_t *il = lv_label_create(input);
  lv_label_set_text(il, "描述故障现象…");
  lv_obj_set_style_text_font(il, &font_zh_16, 0);
  lv_obj_set_style_text_color(il, C_SUBTEXT, 0);
  lv_obj_align(il, LV_ALIGN_LEFT_MID, 8, 0);
  lv_obj_add_event_cb(input, onInputPlaceholder, LV_EVENT_CLICKED, nullptr);
  lv_obj_t *nc = lv_btn_create(bottom);
  lv_obj_set_width(nc, 64);
  lv_obj_set_height(nc, 34);
  lv_obj_set_style_bg_color(nc, C_GREEN, 0);
  lv_obj_set_style_radius(nc, 4, 0);
  lv_obj_set_style_shadow_width(nc, 0, 0);
  stylePressable(nc, C_DARKGREEN);
  lv_obj_t *nl = lv_label_create(nc);
  lv_label_set_text(nl, "新对话");
  lv_obj_set_style_text_font(nl, &font_zh_16, 0);
  lv_obj_set_style_text_color(nl, C_WHITE, 0);
  lv_obj_center(nl);
  lv_obj_add_event_cb(nc, onNewChat, LV_EVENT_CLICKED, nullptr);
}

static void buildMonitorTile(lv_obj_t *tile) {
  // 320x240 放不下 3 个大圆表：上半 3 张并排小卡片（约 100x72，大数字 28px +
  // 单位 12px + 名称状态 + 底部细条），下半一张水温趋势图；告警用顶部横条，不弹窗。
  lv_obj_set_layout(tile, LV_LAYOUT_FLEX);
  lv_obj_set_flex_flow(tile, LV_FLEX_FLOW_COLUMN);
  lv_obj_set_style_pad_all(tile, 6, 0);
  lv_obj_set_style_pad_gap(tile, 6, 0);
  // 三张小卡片
  lv_obj_t *row = lv_obj_create(tile);
  lv_obj_set_width(row, lv_pct(100));
  lv_obj_set_height(row, 72);
  lv_obj_set_style_bg_opa(row, LV_OPA_TRANSP, 0);
  lv_obj_set_style_border_width(row, 0, 0);
  lv_obj_set_style_pad_all(row, 0, 0);
  lv_obj_set_style_pad_gap(row, 6, 0);
  lv_obj_set_layout(row, LV_LAYOUT_FLEX);
  lv_obj_set_flex_flow(row, LV_FLEX_FLOW_ROW);
  for (int i = 0; i < 3; i++) {
    lv_obj_t *card = lv_obj_create(row);
    lv_obj_set_flex_grow(card, 1);
    lv_obj_set_height(card, 72);
    styleCard(card);
    lv_obj_set_style_pad_all(card, 6, 0);
    lv_obj_set_style_pad_gap(card, 2, 0);
    lv_obj_set_layout(card, LV_LAYOUT_FLEX);
    lv_obj_set_flex_flow(card, LV_FLEX_FLOW_COLUMN);
    // 大数字 + 单位（同一行；数字用 LVGL 内建 montserrat_28，单位用中文字库 12px）
    lv_obj_t *vrow = lv_obj_create(card);
    lv_obj_set_width(vrow, lv_pct(100));
    lv_obj_set_height(vrow, 30);
    lv_obj_set_style_bg_opa(vrow, LV_OPA_TRANSP, 0);
    lv_obj_set_style_border_width(vrow, 0, 0);
    lv_obj_set_style_pad_all(vrow, 0, 0);
    lv_obj_set_layout(vrow, LV_LAYOUT_FLEX);
    lv_obj_set_flex_flow(vrow, LV_FLEX_FLOW_ROW);
    lv_obj_set_flex_align(vrow, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_END, LV_FLEX_ALIGN_CENTER);
    lv_obj_set_style_pad_gap(vrow, 2, 0);
    g_meterVal[i] = lv_label_create(vrow);
    lv_label_set_text(g_meterVal[i], "--");
    lv_obj_set_style_text_font(g_meterVal[i], &lv_font_montserrat_28, 0);
    lv_obj_set_style_text_color(g_meterVal[i], C_TEXT, 0);
    g_meterUnit[i] = mkLabel(vrow, "", &font_zh_12, C_SUBTEXT);
    // 名称 + 状态（“水温 · 正常”，状态变色）
    g_meterName[i] = mkLabel(card, g_channels[i].label, &font_zh_12, C_SUBTEXT);
    // 底部细条：灰底 + 按量程比例填充，颜色跟状态走
    g_meterBarBg[i] = lv_obj_create(card);
    lv_obj_set_width(g_meterBarBg[i], lv_pct(100));
    lv_obj_set_height(g_meterBarBg[i], 4);
    lv_obj_set_style_bg_color(g_meterBarBg[i], C_SUBBG, 0);
    lv_obj_set_style_radius(g_meterBarBg[i], 2, 0);
    lv_obj_set_style_border_width(g_meterBarBg[i], 0, 0);
    lv_obj_set_style_pad_all(g_meterBarBg[i], 0, 0);
    g_meterFill[i] = lv_obj_create(g_meterBarBg[i]);
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
  lv_obj_set_style_pad_all(g_alertStrip, 4, 0);
  lv_obj_set_layout(g_alertStrip, LV_LAYOUT_FLEX);
  lv_obj_set_flex_flow(g_alertStrip, LV_FLEX_FLOW_ROW);
  lv_obj_set_flex_align(g_alertStrip, LV_FLEX_ALIGN_SPACE_BETWEEN, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
  g_scenarioLabel = mkLabel(g_alertStrip, "场景：正常运行 · 暂无告警", &font_zh_12, C_DARKGREEN);
  mkLabel(g_alertStrip, "模拟数据", &font_zh_12, C_DARKGREEN);
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
  g_chartTitle = mkLabel(trow, "水温趋势 · 近 5 分钟（报警 85°C）", &font_zh_12, C_TEXT);
  g_updatedLabel = mkLabel(trow, "尚未更新", &font_zh_12, C_SUBTEXT);
  // 水温趋势图：只画水温实线 + 报警阈值虚线
  g_chart = lv_chart_create(tile);
  lv_obj_set_width(g_chart, lv_pct(100));
  lv_obj_set_height(g_chart, 62);
  lv_obj_set_style_bg_color(g_chart, C_CARD, 0);
  lv_obj_set_style_radius(g_chart, 8, 0);
  lv_obj_set_style_border_width(g_chart, 1, 0);
  lv_obj_set_style_border_color(g_chart, C_BORDER, 0);
  lv_obj_set_style_pad_all(g_chart, 0, 0);
  lv_chart_set_type(g_chart, LV_CHART_TYPE_LINE);
  lv_chart_set_point_count(g_chart, 60);
  lv_chart_set_range(g_chart, LV_CHART_AXIS_PRIMARY_Y, 0, 100);
  g_chartSer = lv_chart_add_series(g_chart, C_GREEN, LV_CHART_AXIS_PRIMARY_Y);
  for (int i = 0; i < 60; i++) lv_chart_set_series_value_by_id(g_chart, g_chartSer, i, 0);
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
  lv_obj_set_pos(o, x, y);
  lv_obj_set_size(o, w, h);
  lv_obj_set_style_bg_color(o, bg, 0);
  lv_obj_set_style_radius(o, radius, 0);
  lv_obj_set_style_border_width(o, 0, 0);
  lv_obj_set_style_pad_all(o, 0, 0);
  return o;
}

static void showStandby() {
  if (g_standbyOn || !g_standbyOverlay) return;
  g_standbyOn = true;
  lv_obj_set_hidden(g_standbyOverlay, false);
  fadeIn(g_standbyOverlay);
  analogWrite(PIN_TFT_BL, 110);  // 待机调暗背光
  Serial.println("[司稼] 10 秒无操作，进待机");
}

static void wakeStandby() {
  if (!g_standbyOn) return;
  g_standbyOn = false;
  lv_obj_set_hidden(g_standbyOverlay, true);
  analogWrite(PIN_TFT_BL, BACKLIGHT_BRIGHTNESS);
  markActive();
  Serial.println("[司稼] 待机唤醒");
}

static void onStandbyTap(lv_event_t *e) {
  (void)e;
  wakeStandby();
}

// 待机动画定时器（70ms）：只动轮辐线、尾气、地面点、光晕这几个小对象，
// LVGL 只重绘它们的脏区，不全屏刷新。
static void onStandbyTick(lv_timer_t *t) {
  (void)t;
  if (!g_standbyOn || !g_standbyOverlay) return;
  // 轮子：两根轮辐线绕轮心转
  g_wheelAngle += 0.30f;
  static const int32_t WCX[2] = {104, 216};
  static const int32_t WCY = 152;
  static lv_point_precise_t pts[2][2][2];
  for (int w = 0; w < 2; w++) {
    float c = cosf(g_wheelAngle), s = sinf(g_wheelAngle);
    const int32_t r = 11;
    pts[w][0][0].x = WCX[w] - (int32_t)(r * c);
    pts[w][0][0].y = WCY - (int32_t)(r * s);
    pts[w][0][1].x = WCX[w] + (int32_t)(r * c);
    pts[w][0][1].y = WCY + (int32_t)(r * s);
    pts[w][1][0].x = WCX[w] + (int32_t)(r * s);
    pts[w][1][0].y = WCY - (int32_t)(r * c);
    pts[w][1][1].x = WCX[w] - (int32_t)(r * s);
    pts[w][1][1].y = WCY + (int32_t)(r * c);
    lv_line_set_points(g_spokes[w][0], pts[w][0], 2);
    lv_line_set_points(g_spokes[w][1], pts[w][1], 2);
  }
  // 排气管尾气：3 团依次上升、变大、变淡
  for (int i = 0; i < 3; i++) {
    g_puffPhase[i] += 0.025f;
    if (g_puffPhase[i] > 1.0f) g_puffPhase[i] -= 1.0f;
    float p = g_puffPhase[i];
    int32_t sz = 6 + (int32_t)(p * 8);
    lv_obj_set_size(g_puffs[i], sz, sz);
    lv_obj_set_pos(g_puffs[i], 236 - sz / 2, (lv_coord_t)(76 - p * 36 - sz / 2));
    lv_obj_set_style_opa(g_puffs[i], (lv_opa_t)((1.0f - p) * 160), 0);
  }
  // 地面点左移（拖拉机原地开的感觉），出界绕回
  for (int i = 0; i < 3; i++) {
    g_groundX[i] -= 2;
    if (g_groundX[i] < 34) g_groundX[i] = 286;
    lv_obj_set_x(g_groundDots[i], g_groundX[i]);
  }
  // 呼吸光晕 + 标题呼吸
  float ph = (float)millis() / 1200.0f;
  float br = sinf(ph);
  int32_t d = 150 + (int32_t)(br * 10);
  lv_obj_set_size(g_standbyHalo, d, d);
  lv_obj_set_pos(g_standbyHalo, 160 - d / 2, 112 - d / 2);
  lv_obj_set_style_opa(g_standbyHalo, (lv_opa_t)(90 + br * 40), 0);
  lv_obj_set_style_opa(g_standbyTitle, (lv_opa_t)(220 + br * 35), 0);
}

static void buildStandbyOverlay(lv_obj_t *scr) {
  // 待机屏与 OLED 同一套语言（拖拉机动画），但按 TFT 浅色风格画：浅底 + 绿拖拉机。
  g_standbyOverlay = lv_obj_create(scr);
  lv_obj_set_size(g_standbyOverlay, SCREEN_WIDTH, SCREEN_HEIGHT);
  lv_obj_set_pos(g_standbyOverlay, 0, 0);
  lv_obj_set_style_bg_color(g_standbyOverlay, C_BG, 0);
  lv_obj_set_style_radius(g_standbyOverlay, 0, 0);
  lv_obj_set_style_border_width(g_standbyOverlay, 0, 0);
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
    lv_obj_set_style_opa(g_puffs[i], 0, 0);
  }
  // 文案（待/唤/醒已补进三档字库，见 tools/gen_fonts.py）
  g_standbyTitle = mkLabel(g_standbyOverlay, "待机中", &font_zh_22, C_TEXT);
  lv_obj_set_width(g_standbyTitle, lv_pct(100));
  lv_obj_set_style_text_align(g_standbyTitle, LV_TEXT_ALIGN_CENTER, 0);
  lv_obj_set_pos(g_standbyTitle, 0, 180);
  lv_obj_t *hint = mkLabel(g_standbyOverlay, "点一下唤醒", &font_zh_16, C_SUBTEXT);
  lv_obj_set_width(hint, lv_pct(100));
  lv_obj_set_style_text_align(hint, LV_TEXT_ALIGN_CENTER, 0);
  lv_obj_set_pos(hint, 0, 206);
  lv_obj_set_hidden(g_standbyOverlay, true);
}

static void buildUi() {
  // 按钮点按反馈的过渡描述（100ms）：pressed 变色 + 缩放 0.96。
  lv_style_transition_dsc_init(&g_pressTrans, g_pressProps, lv_anim_path_linear, 100, 0, nullptr);
  lv_obj_t *scr = lv_screen_active();
  lv_obj_set_style_bg_color(scr, C_BG, 0);
  lv_obj_set_style_text_font(scr, &font_zh_16, 0);
  lv_obj_set_layout(scr, LV_LAYOUT_FLEX);
  lv_obj_set_flex_flow(scr, LV_FLEX_FLOW_COLUMN);
  lv_obj_set_style_pad_all(scr, 0, 0);
  lv_obj_set_style_pad_gap(scr, 0, 0);
  buildTopBar(scr);
  g_tileview = lv_tileview_create(scr);
  lv_obj_set_width(g_tileview, lv_pct(100));
  lv_obj_set_flex_grow(g_tileview, 1);
  lv_obj_set_style_bg_color(g_tileview, C_BG, 0);
  lv_obj_set_style_border_width(g_tileview, 0, 0);
  lv_obj_set_style_pad_all(g_tileview, 0, 0);
  lv_obj_t *t0 = lv_tileview_add_tile(g_tileview, 0, 0, LV_DIR_RIGHT);
  lv_obj_t *t1 = lv_tileview_add_tile(g_tileview, 1, 0, (lv_dir_t)(LV_DIR_LEFT | LV_DIR_RIGHT));
  lv_obj_t *t2 = lv_tileview_add_tile(g_tileview, 2, 0, LV_DIR_LEFT);
  buildHomeTile(t0);
  buildChatTile(t1);
  buildMonitorTile(t2);
  lv_obj_add_event_cb(g_tileview, onTileChanged, LV_EVENT_VALUE_CHANGED, nullptr);
  // 底部翻页指示条带（12px 专属条带）：胶囊指示器底部居中，3 个点间距 8px。
  lv_obj_t *strip = lv_obj_create(scr);
  lv_obj_set_width(strip, lv_pct(100));
  lv_obj_set_height(strip, 12);
  lv_obj_set_style_bg_color(strip, C_BG, 0);
  lv_obj_set_style_radius(strip, 0, 0);
  lv_obj_set_style_border_width(strip, 0, 0);
  lv_obj_set_style_pad_all(strip, 0, 0);
  lv_obj_set_layout(strip, LV_LAYOUT_FLEX);
  lv_obj_set_flex_flow(strip, LV_FLEX_FLOW_ROW);
  lv_obj_set_flex_align(strip, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
  lv_obj_t *wrap = lv_obj_create(strip);
  lv_obj_set_size(wrap, 46, 6);
  lv_obj_set_style_bg_opa(wrap, LV_OPA_TRANSP, 0);
  lv_obj_set_style_border_width(wrap, 0, 0);
  lv_obj_set_style_pad_all(wrap, 0, 0);
  static lv_style_transition_dsc_t dotsTrans;
  static const lv_style_prop_t dotsProps[] = {LV_STYLE_BG_COLOR, (lv_style_prop_t)0};
  lv_style_transition_dsc_init(&dotsTrans, dotsProps, lv_anim_path_linear, 200, 0, nullptr);
  for (int i = 0; i < 3; i++) {
    g_dots[i] = lv_obj_create(wrap);
    lv_obj_set_size(g_dots[i], 6, 6);
    lv_obj_set_style_radius(g_dots[i], 3, 0);
    lv_obj_set_style_bg_color(g_dots[i], C_BORDER, 0);
    lv_obj_set_style_border_width(g_dots[i], 0, 0);
    lv_obj_set_style_transition(g_dots[i], &dotsTrans, 0);
    lv_obj_add_event_cb(g_dots[i], onDotClicked, LV_EVENT_CLICKED, (void *)(intptr_t)i);
  }
  updateDots(0);
  // Toast（悬浮提示，建在最上层）
  g_toast = lv_obj_create(scr);
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
  // 待机屏（盖在最上层）+ 待机动画定时器
  buildStandbyOverlay(scr);
  lv_timer_create(onStandbyTick, 70, nullptr);
}

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
}

static void applyTeleResult() {
  bool ok = false;
  if (g_resultMutex) xSemaphoreTake(g_resultMutex, portMAX_DELAY);
  if (!g_teleResult.ready) { if (g_resultMutex) xSemaphoreGive(g_resultMutex); return; }
  ok = g_teleResult.ok;
  g_teleResult.ready = false;
  if (g_resultMutex) xSemaphoreGive(g_resultMutex);
  if (ok) applyTelemetryToUi();
  else if (g_lastTeleOk > 0) lv_label_set_text(g_updatedLabel, "离线，显示上次数据");
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
// 未填的第二组不写入 NVS，也不参与连接。
static bool isPlaceholderWifi(const String &ssid, const String &pass) {
  if (ssid.length() == 0 || pass.length() == 0) return true;
  if (ssid == "你的WiFi名称" || pass == "你的WiFi密码") return true;
  return false;
}

// WiFi 凭证（NVS；首次开机从 secrets.h 取值并存入，之后只读 NVS）
// 注意：首次开机前必须先填好真实的 secrets.h——如果先用占位值开机，NVS 会存下占位值，
// 之后改 secrets.h 重烧也不会生效，只能整片擦除重烧（见 FLASHING.md §8）。
// 三 WiFi：第一组（ssid/pass，原有）与第二组（ssid2/pass2，新增）、第三组（ssid3/pass3，新增）分开存；
// 第二、三组只在 NVS 里没有、且 secrets.h 对应组不是占位符时才写入，
// 占位符绝不写入 NVS，也绝不覆盖已有组。之后改某组同样要擦除重烧。
static void loadWifiCreds() {
  Preferences prefs;
  prefs.begin("sijia", false);
  String ssid = prefs.getString("ssid", "");
  String pass = prefs.getString("pass", "");
  if (ssid.length() == 0) {
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
  WiFi.begin(ssid.c_str(), pass.c_str());
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < timeoutMs) {
#if USE_OLED_DISPLAY
    oledUiSplashProgress(progFrom + (float)(millis() - t0) / (float)timeoutMs * (progTo - progFrom));
    delay(100);  // OLED 版没有 LVGL 定时器要跑，等就是了
#else
    lv_tick_inc(5);
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
    if (tryWifi(g_wifiSsid2, g_wifiPass2, 6000, 0.0f, 0.2f)) {
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
  g_resultMutex = xSemaphoreCreateMutex();
#if USE_OLED_DISPLAY
  // OLED 版：初始化 I2C + SSD1306（亮启动页）；背光/触摸/LVGL 都没有。
  oledUiBegin();
#else
  // 背光
  analogWrite(PIN_TFT_BL, BACKLIGHT_BRIGHTNESS);
  // 屏幕 + 触摸
  tft.init();
  tft.setRotation(SCREEN_ROTATION);
  tft.setSwapBytes(true);
  tft.initDMA();
  tft.fillScreen(TFT_WHITE);
  ts.begin();
  // LVGL
  lv_init();
  disp = lv_display_create(SCREEN_WIDTH, SCREEN_HEIGHT);
  lv_display_set_flush_cb(disp, flush_cb);
  size_t bufBytes = SCREEN_WIDTH * DRAW_BUF_LINES * 2;
#ifdef CONFIG_SPIRAM
  drawBuf1 = (uint16_t *)heap_caps_malloc(bufBytes, MALLOC_CAP_SPIRAM);
  drawBuf2 = (uint16_t *)heap_caps_malloc(bufBytes, MALLOC_CAP_SPIRAM);
  if (!drawBuf1) drawBuf1 = (uint16_t *)malloc(bufBytes);
  if (!drawBuf2) drawBuf2 = (uint16_t *)malloc(bufBytes);
#else
  // C3 无 PSRAM：双缓冲放内部 RAM（20 行，见 DRAW_BUF_LINES）。
  drawBuf1 = (uint16_t *)malloc(bufBytes);
  drawBuf2 = (uint16_t *)malloc(bufBytes);
#endif
  lv_display_set_buffers(disp, drawBuf1, drawBuf2, bufBytes, LV_DISPLAY_RENDER_MODE_PARTIAL);
  lv_indev_t *indev = lv_indev_create();
  lv_indev_set_type(indev, LV_INDEV_TYPE_POINTER);
  lv_indev_set_read_cb(indev, touch_cb);
  lv_indev_set_display(indev, disp);
  buildUi();
#endif  // USE_OLED_DISPLAY
  // WiFi（界面先出来，状态栏显示连接中）
  // 凭证存 NVS（命名空间 sijia，第一组键 ssid/pass，第二组键 ssid2/pass2，第三组键 ssid3/pass3）：
  // 首次开机用 secrets.h 的值并存入 NVS，以后联网一律读 NVS；
  // OTA 升级只写 app 分区，绝不碰 NVS，升级后不断网。
  // 三 WiFi：按优先级试第二组、第三组、第一组（见 connectWifi）。
  WiFi.mode(WIFI_STA);
  WiFi.setHostname("sijia-robot");
  loadWifiCreds();
  bool wifiOk = connectWifi();
  if (wifiOk) {
    Serial.printf("[司稼] WiFi 已连 %s（第 %d 组），IP %s\n", WiFi.SSID().c_str(), g_wifiActive, WiFi.localIP().toString().c_str());
#if USE_OLED_DISPLAY
    oledUiSplashProgress(0.75f);  // WiFi 已连，进度条到 75%
#endif
    String h = httpGet(String(SIJIA_BASE_URL) + "/api/health", 5000);
    g_online = h.length() > 0;
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
  lv_timer_create(onTeleTimer, 15000, nullptr);
  lv_timer_create(onUpdatedTick, 10000, nullptr);
  g_telePending = true;   // 启动后立刻取一次遥测
  g_lastInteractMs = millis();  // 待机计时从就绪起算（WiFi 等待期间不计，避免一开机就待机）
  Serial.println("[司稼] 就绪：左右滑动切换 首页 / 对话 / 监控");
#endif
}

void loop() {
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
  lv_tick_inc(5);
  lv_timer_handler();
  delay(5);
  // WiFi 状态栏（每约 1 秒检查一次，节流在 maintainWifi() 里）
  if (maintainWifi()) {
    lv_label_set_text(g_topStatus, g_online ? "在线" : "离线");
    lv_obj_set_style_text_color(g_topStatus, g_online ? C_DARKGREEN : C_RED, 0);
  }
  // 10 秒无操作（且不在问答中）进待机；点一下唤醒（待机屏的 CLICKED 事件）。
  if (!g_standbyOn && !g_chatBusy && millis() - g_lastInteractMs > STANDBY_TIMEOUT_MS) {
    showStandby();
  }
  applyChatResult();
  applyTeleResult();
#if ENABLE_OTA
  applyOtaStatus();
#endif
#endif  // USE_OLED_DISPLAY
}

// 司稼小机器人 RV0.1.0 — LVGL 界面 + WiFi 问答 + 遥测监控
// 硬件：ESP32-S3-N16R8 + 3.2 寸 ILI9341 触摸屏（默认配置档 A）
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

static void touch_cb(lv_indev_t *indev, lv_indev_data_t *data) {
  (void)indev;
  if (!ts.touched()) { data->state = LV_INDEV_STATE_RELEASED; return; }
  TS_Point p = ts.getPoint();
  // 横屏 rotation 1 的常用映射；如实机上触摸轴反了/镜像了，交换下面两行或取反（见 README 排查）。
  int32_t sx = map(p.x, TOUCH_X_MIN, TOUCH_X_MAX, 0, SCREEN_WIDTH - 1);
  int32_t sy = map(p.y, TOUCH_Y_MIN, TOUCH_Y_MAX, 0, SCREEN_HEIGHT - 1);
  data->point.x = constrain(sx, 0, SCREEN_WIDTH - 1);
  data->point.y = constrain(sy, 0, SCREEN_HEIGHT - 1);
  data->state = LV_INDEV_STATE_PRESSED;
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
  const char *unit = "";
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

// 维护 WiFi 在线状态（内部每秒检查一次）；状态变了返回 true。
// 注意：g_online 在 setup() 里由 /api/health 检查结果设定；这里只看 WiFi 链路。
static bool maintainWifi() {
  static uint32_t lastWifiCheck = 0;
  if (millis() - lastWifiCheck <= 1000) return false;
  lastWifiCheck = millis();
  bool up = WiFi.status() == WL_CONNECTED;
  if (up == g_online) return false;
  g_online = up;
  if (!up) WiFi.reconnect();
  return true;
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
    strncpy(s.teleUnit[i], g_channels[i].unit ? g_channels[i].unit : "", sizeof(s.teleUnit[i]) - 1);
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
  ch.unit = c["unit"] | "";
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
static lv_obj_t *g_dots[3] = {nullptr, nullptr, nullptr};
static lv_obj_t *g_tileview = nullptr;
static lv_obj_t *g_msgList = nullptr;     // 对话消息容器
static lv_obj_t *g_thinking = nullptr;    // “正在诊断…”行
static lv_obj_t *g_sourcesBox = nullptr;  // 最新一条回答的依据区
static lv_obj_t *g_sourcesLabel = nullptr;
static lv_obj_t *g_sourcesBtn = nullptr;
static lv_obj_t *g_toast = nullptr;
static lv_obj_t *g_meterVal[3] = {nullptr, nullptr, nullptr};
static lv_obj_t *g_meterState[3] = {nullptr, nullptr, nullptr};
static lv_obj_t *g_meters[3] = {nullptr, nullptr, nullptr};
static lv_obj_t *g_meterNeedle[3] = {nullptr, nullptr, nullptr};  // 表盘指针（line 对象）
static lv_obj_t *g_alertBar = nullptr;
static lv_obj_t *g_scenarioLabel = nullptr;
static lv_obj_t *g_updatedLabel = nullptr;
static lv_obj_t *g_chart = nullptr;
static lv_chart_series_t *g_chartSer = nullptr;
static lv_obj_t *g_thresholdLine = nullptr;
static lv_obj_t *g_chartTitle = nullptr;
static uint32_t g_lastTeleOk = 0;
static bool g_sourcesOpen = false;

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

static void updateDots(int page) {
  for (int i = 0; i < 3; i++) {
    lv_obj_set_style_bg_color(g_dots[i], i == page ? C_GREEN : C_BORDER, 0);
  }
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
}

static void setThinking(bool on) {
  if (on) lv_obj_set_hidden(g_thinking, false);
  else lv_obj_set_hidden(g_thinking, true);
  if (on) lv_obj_scroll_to_y(g_msgList, LV_COORD_MAX, LV_ANIM_ON);
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
  askQuestion(PRESET_QUESTIONS[idx]);
}
static void onInputPlaceholder(lv_event_t *e) {
  (void)e;
  showToast("输入法在 RV0.2.0（语音版）提供，当前用预设问题提问");
}
static void onSourcesToggle(lv_event_t *e) {
  (void)e;
  g_sourcesOpen = !g_sourcesOpen;
  if (g_sourcesOpen) lv_obj_set_hidden(g_sourcesBox, false);
  else lv_obj_set_hidden(g_sourcesBox, true);
  lv_label_set_text(lv_obj_get_child(g_sourcesBtn, 0),
                    g_sourcesOpen ? "查看依据与核对项（收起）" : "查看依据与核对项（展开）");
}
static void onNewChat(lv_event_t *e) {
  (void)e;
  g_historyCount = 0;
  lv_obj_clean(g_msgList);
  lv_obj_set_hidden(g_sourcesBox, true);
  g_sourcesOpen = false;
  showToast("已开始新对话");
}
static void onTileChanged(lv_event_t *e) {
  (void)e;
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
  // 三个表盘
  for (int i = 0; i < 3; i++) {
    TeleChannel &ch = g_channels[i];
    char buf[32];
    if (isnan(ch.value)) snprintf(buf, sizeof(buf), "-- %s", ch.unit);
    else if (ch.precision == 0) snprintf(buf, sizeof(buf), "%.0f %s", ch.value, ch.unit);
    else snprintf(buf, sizeof(buf), "%.*f %s", ch.precision, ch.value, ch.unit);
    lv_label_set_text(g_meterVal[i], buf);
    lv_color_t c;
    lv_label_set_text(g_meterState[i], chanStateText(ch, &c));
    lv_obj_set_style_text_color(g_meterState[i], c, 0);
    if (!isnan(ch.value) && g_meters[i] && g_meterNeedle[i])
      lv_scale_set_line_needle_value(g_meters[i], g_meterNeedle[i], 20, (int32_t)ch.value);
  }
  // 告警横条：取最严重的一条
  const char *worst = nullptr;
  lv_color_t worstColor = C_DARKGREEN;
  for (int i = 0; i < 3; i++) {
    lv_color_t c;
    const char *s = chanStateText(g_channels[i], &c);
    if (strcmp(s, "报警") == 0) { worst = s; worstColor = C_RED; break; }
    if (strcmp(s, "注意") == 0) { worst = s; worstColor = C_AMBER; }
  }
  if (worst) {
    char buf[64];
    snprintf(buf, sizeof(buf), "%s：%s %.0f%s，超过阈值（模拟数据）",
             worst, g_channels[0].label, g_channels[0].value, g_channels[0].unit);
    lv_label_set_text(g_alertBar, buf);
    lv_obj_set_style_text_color(g_alertBar, worstColor, 0);
  } else {
    lv_label_set_text(g_alertBar, "暂无告警，全部正常（模拟数据）");
    lv_obj_set_style_text_color(g_alertBar, C_DARKGREEN, 0);
  }
  // 场景
  char sbuf[48];
  snprintf(sbuf, sizeof(sbuf), "场景：%s", g_scenarioZh);
  lv_label_set_text(g_scenarioLabel, sbuf);
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
  lv_obj_t *dots = lv_obj_create(bar);
  lv_obj_set_size(dots, 48, 10);
  lv_obj_set_style_bg_opa(dots, LV_OPA_TRANSP, 0);
  lv_obj_set_style_border_width(dots, 0, 0);
  lv_obj_set_style_pad_all(dots, 0, 0);
  lv_obj_set_layout(dots, LV_LAYOUT_FLEX);
  lv_obj_set_flex_flow(dots, LV_FLEX_FLOW_ROW);
  lv_obj_set_flex_align(dots, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
  for (int i = 0; i < 3; i++) {
    g_dots[i] = lv_obj_create(dots);
    lv_obj_set_size(g_dots[i], 8, 8);
    lv_obj_set_style_radius(g_dots[i], LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_bg_color(g_dots[i], i == 0 ? C_GREEN : C_BORDER, 0);
    lv_obj_set_style_border_width(g_dots[i], 0, 0);
  }
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
  // 思考中
  g_thinking = lv_obj_create(tile);
  lv_obj_set_width(g_thinking, lv_pct(100));
  lv_obj_set_height(g_thinking, 24);
  lv_obj_set_style_bg_opa(g_thinking, LV_OPA_TRANSP, 0);
  lv_obj_set_style_border_width(g_thinking, 0, 0);
  lv_obj_set_style_pad_all(g_thinking, 0, 0);
  lv_obj_set_layout(g_thinking, LV_LAYOUT_FLEX);
  lv_obj_set_flex_flow(g_thinking, LV_FLEX_FLOW_ROW);
  lv_obj_t *sp = lv_spinner_create(g_thinking);
  lv_obj_set_size(sp, 18, 18);
  lv_obj_set_style_arc_color(sp, C_GREEN, LV_PART_INDICATOR);
  mkLabel(g_thinking, "正在诊断…", &font_zh_16, C_SUBTEXT);
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
  lv_obj_t *nl = lv_label_create(nc);
  lv_label_set_text(nl, "新对话");
  lv_obj_set_style_text_font(nl, &font_zh_16, 0);
  lv_obj_set_style_text_color(nl, C_WHITE, 0);
  lv_obj_center(nl);
  lv_obj_add_event_cb(nc, onNewChat, LV_EVENT_CLICKED, nullptr);
}

static void buildMonitorTile(lv_obj_t *tile) {
  lv_obj_set_layout(tile, LV_LAYOUT_FLEX);
  lv_obj_set_flex_flow(tile, LV_FLEX_FLOW_COLUMN);
  lv_obj_set_style_pad_all(tile, 6, 0);
  lv_obj_set_style_pad_gap(tile, 6, 0);
  // 三个表盘
  lv_obj_t *row = lv_obj_create(tile);
  lv_obj_set_width(row, lv_pct(100));
  lv_obj_set_height(row, 96);
  lv_obj_set_style_bg_opa(row, LV_OPA_TRANSP, 0);
  lv_obj_set_style_border_width(row, 0, 0);
  lv_obj_set_style_pad_all(row, 0, 0);
  lv_obj_set_style_pad_gap(row, 6, 0);
  lv_obj_set_layout(row, LV_LAYOUT_FLEX);
  lv_obj_set_flex_flow(row, LV_FLEX_FLOW_ROW);
  const int32_t meterMin[3] = {0, 0, 0}, meterMax[3] = {140, 800, 4000};
  for (int i = 0; i < 3; i++) {
    lv_obj_t *card = lv_obj_create(row);
    lv_obj_set_flex_grow(card, 1);
    lv_obj_set_height(card, 96);
    styleCard(card);
    lv_obj_set_style_pad_all(card, 4, 0);
    lv_obj_set_style_pad_gap(card, 0, 0);
    lv_obj_set_layout(card, LV_LAYOUT_FLEX);
    lv_obj_set_flex_flow(card, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_flex_align(card, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    // LVGL 9 的表盘叫 scale（meter 已删除）：270° 圆弧 + 指针
    lv_obj_t *m = lv_scale_create(card);
    lv_obj_set_size(m, 72, 56);
    lv_scale_set_mode(m, LV_SCALE_MODE_ROUND_INNER);
    lv_scale_set_total_tick_count(m, 11);
    lv_scale_set_major_tick_every(m, 2);
    lv_scale_set_label_show(m, false);  // 数值另有下方大字 label，盘上不印数字
    lv_scale_set_range(m, meterMin[i], meterMax[i]);
    lv_scale_set_angle_range(m, 270);
    lv_scale_set_rotation(m, 135);
    lv_obj_set_style_length(m, 4, LV_PART_ITEMS);
    lv_obj_set_style_line_color(m, C_BORDER, LV_PART_ITEMS);
    lv_obj_set_style_length(m, 6, LV_PART_INDICATOR);
    lv_obj_set_style_line_color(m, C_SUBTEXT, LV_PART_INDICATOR);
    lv_obj_t *needle = lv_line_create(m);
    static lv_point_precise_t needlePts[2] = {{0, 0}, {0, -20}};
    lv_line_set_points(needle, needlePts, 2);
    lv_obj_set_style_line_color(needle, C_TEXT, 0);
    lv_obj_set_style_line_width(needle, 2, 0);
    lv_scale_set_line_needle_value(m, needle, 20, meterMin[i]);
    g_meterNeedle[i] = needle;
    g_meters[i] = m;
    g_meterVal[i] = mkLabel(card, "--", &font_zh_16, C_TEXT);
    g_meterState[i] = mkLabel(card, "—", &font_zh_12, C_SUBTEXT);
    lv_obj_t *nl = mkLabel(card, g_channels[i].label, &font_zh_12, C_SUBTEXT);
    (void)nl;
  }
  // 场景 + 更新时间
  lv_obj_t *srow = lv_obj_create(tile);
  lv_obj_set_width(srow, lv_pct(100));
  lv_obj_set_height(srow, 20);
  lv_obj_set_style_bg_opa(srow, LV_OPA_TRANSP, 0);
  lv_obj_set_style_border_width(srow, 0, 0);
  lv_obj_set_style_pad_all(srow, 0, 0);
  lv_obj_set_layout(srow, LV_LAYOUT_FLEX);
  lv_obj_set_flex_flow(srow, LV_FLEX_FLOW_ROW);
  lv_obj_set_flex_align(srow, LV_FLEX_ALIGN_SPACE_BETWEEN, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
  g_scenarioLabel = mkLabel(srow, "场景：正常运行", &font_zh_12, C_TEXT);
  g_updatedLabel = mkLabel(srow, "尚未更新", &font_zh_12, C_SUBTEXT);
  // 告警横条
  g_alertBar = mkLabel(tile, "暂无告警，全部正常（模拟数据）", &font_zh_12, C_DARKGREEN);
  lv_obj_set_width(g_alertBar, lv_pct(100));
  lv_label_set_long_mode(g_alertBar, LV_LABEL_LONG_WRAP);
  // 水温趋势图
  g_chartTitle = mkLabel(tile, "水温趋势 · 近 5 分钟（报警 85°C）", &font_zh_12, C_TEXT);
  g_chart = lv_chart_create(tile);
  lv_obj_set_width(g_chart, lv_pct(100));
  lv_obj_set_height(g_chart, 72);
  lv_obj_set_style_bg_color(g_chart, C_CARD, 0);
  lv_obj_set_style_radius(g_chart, 8, 0);
  lv_obj_set_style_border_width(g_chart, 1, 0);
  lv_obj_set_style_border_color(g_chart, C_BORDER, 0);
  lv_obj_set_style_pad_all(g_chart, 0, 0);
  lv_chart_set_type(g_chart, LV_CHART_TYPE_LINE);
  lv_chart_set_point_count(g_chart, 60);
  lv_chart_set_range(g_chart, LV_CHART_AXIS_PRIMARY_Y, 0, 100);
  // LVGL 9 的 chart 已不画坐标轴刻度数字（set_axis_tick 已删除），无需再关
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

static void buildUi() {
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

// WiFi 凭证（NVS；首次开机从 secrets.h 取值并存入，之后只读 NVS）
// 注意：首次开机前必须先填好真实的 secrets.h——如果先用占位值开机，NVS 会存下占位值，
// 之后改 secrets.h 重烧也不会生效，只能整片擦除重烧（见 FLASHING.md §8）。
static String g_wifiSsid, g_wifiPass;
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
  prefs.end();
  g_wifiSsid = ssid;
  g_wifiPass = pass;
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
  // WiFi（异步连；界面先出来，状态栏显示连接中）
  // 凭证存 NVS（命名空间 sijia，键 ssid/pass）：首次开机用 secrets.h 的值并存入 NVS，
  // 以后联网一律读 NVS；OTA 升级只写 app 分区，绝不碰 NVS，升级后不断网。
  WiFi.mode(WIFI_STA);
  WiFi.setHostname("sijia-robot");
  loadWifiCreds();
  WiFi.begin(g_wifiSsid.c_str(), g_wifiPass.c_str());
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 15000) {
#if USE_OLED_DISPLAY
    delay(100);  // OLED 版没有 LVGL 定时器要跑，等就是了
#else
    lv_tick_inc(5);
    lv_timer_handler();
    delay(5);
#endif
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[司稼] WiFi 已连 %s，IP %s\n", WiFi.SSID().c_str(), WiFi.localIP().toString().c_str());
    String h = httpGet(String(SIJIA_BASE_URL) + "/api/health", 5000);
    g_online = h.length() > 0;
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
  // 刷新 OLED（内部处理自动轮换 + BOOT 切页；长按返回提问动作，由主循环执行）
  OledPageData snap = buildOledSnapshot();
  int action = oledUiTick(snap);
  if (action == OLED_ACTION_ASK_PRESET_0) {
    startAsk(PRESET_QUESTIONS[0]);  // 失败（正忙/未联网）时 OLED 下次刷新仍显示旧状态
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
  applyChatResult();
  applyTeleResult();
#if ENABLE_OTA
  applyOtaStatus();
#endif
#endif  // USE_OLED_DISPLAY
}

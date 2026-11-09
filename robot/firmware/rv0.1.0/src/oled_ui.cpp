// 司稼小机器人 RV0.1.0 — 0.96 寸 OLED 显示 UI（第二个显示版本）
// 硬件：SSD1306 128x64，I2C 地址 0x3C；SDA/SCL 以 display_config.h 为准
// （DevKitM-1/合宙板：SDA=GPIO12、SCL=GPIO13；SuperMini：SDA=GPIO4、SCL=GPIO5）。
// 驱动：U8g2 全缓冲模式（128x64/8 = 1024 字节显存，C3 内部 RAM 够用）。
//
// 字库为什么用 U8g2 自带 wqy16（GB2312，16px），而不用小子集字库：
// 问答页显示服务器返回的答案，字符集事先不可穷举——子集只能覆盖固定界面文案，
// 答案里一有子集外的字就显示不出。wqy16 覆盖 GB2312 常用字，任意答案都能显示；
// OLED 版不编 LVGL/TFT_eSPI/XPT2046，省出的 Flash 足够放下这一个字库，
// 固件仍放得进 C3 app0 分区（约 2.9MB，实测大小见 PR 说明）。
// GB2312 之外的生僻字、Emoji：U8g2 找不到字形，会留空，不断行不花屏。
//
// 页面（3 页，16px 行高，每页 4 行）：
//   0 状态页：司稼 + 在线/离线/服务器不通、WiFi 名称、IP、当前场景
//   1 监测页：水温/油压/转速三行数值 + 右侧状态（正常/注意/报警），标题标“模拟数据”
//   2 问答页：最后一问（截断显示）+ 答案前两行；答案写不下时末行写“请在主屏查看”
// 切页：每 5 秒自动轮换；BOOT 按键（GPIO9）短按手动切页，长按（≥800ms）问第一条预设问题。
// GPIO9 是 strapping 脚，只在启动后读按键，不影响启动；按键平时高电平，按下为低电平。
// 重绘策略：只有翻页或快照内容变化时才重绘（全屏刷新走 I2C，频繁刷会拖慢主循环）。

#include "oled_ui.h"

// 整个文件只在 OLED 版编译：TFT 版没有 U8g2 依赖，
// 这里把 U8g2 的 include 也包进条件里，避免 TFT 环境编译本文件时找不到头文件。
#if USE_OLED_DISPLAY

#include <U8g2lib.h>
#include <Wire.h>

#include "display_config.h"
#include "version.h"

#define OLED_FONT u8g2_font_wqy16_t_gb2312  // 16px 中文（GB2312）+ ASCII
#define OLED_W 128
#define OLED_H 64
#define OLED_LINE_H 16      // 行高 = 字号
#define OLED_PAGE_COUNT 3
#define OLED_AUTO_MS 5000   // 自动轮换间隔
#define OLED_LONG_PRESS_MS 800
#define OLED_DEBOUNCE_MS 50

// 硬件 I2C：U8g2 按构造参数里的时钟/数据脚调 Wire.begin(SDA, SCL)。
// 默认地址就是 0x3C（与模块跳线 0x78 的 8 位写地址一致），不用另设。
static U8G2_SSD1306_128X64_NONAME_F_HW_I2C u8g2(U8G2_R0, U8X8_PIN_NONE, PIN_OLED_SCL, PIN_OLED_SDA);

// ---------- UTF-8 小工具（只处理显示截断与换行；畸形字节按 U+FFFD 跳过）----------
static const char *utf8Next(const char *p, uint32_t *cp) {
  uint8_t c = (uint8_t)*p;
  if (c < 0x80) { *cp = c; return p + 1; }
  if ((c & 0xE0) == 0xC0 && p[1]) {
    *cp = ((c & 0x1F) << 6) | ((uint8_t)p[1] & 0x3F);
    return p + 2;
  }
  if ((c & 0xF0) == 0xE0 && p[1] && p[2]) {
    *cp = ((c & 0x0F) << 12) | (((uint8_t)p[1] & 0x3F) << 6) | ((uint8_t)p[2] & 0x3F);
    return p + 3;
  }
  if ((c & 0xF8) == 0xF0 && p[1] && p[2] && p[3]) {
    *cp = ((c & 0x07) << 18) | (((uint8_t)p[1] & 0x3F) << 12) |
          (((uint8_t)p[2] & 0x3F) << 6) | ((uint8_t)p[3] & 0x3F);
    return p + 4;
  }
  *cp = 0xFFFD;
  return p + 1;
}

// 把 text 按像素宽截断后画在 (x, baselineY)；超宽直接截断，不加省略号。
static void drawTruncated(int x, int baselineY, const char *text, int maxWidth) {
  char buf[96];
  size_t len = 0;
  buf[0] = '\0';
  const char *p = text;
  while (*p) {
    uint32_t cp = 0;
    const char *next = utf8Next(p, &cp);
    size_t chLen = (size_t)(next - p);
    if (len + chLen >= sizeof(buf)) break;
    memcpy(buf + len, p, chLen);
    buf[len + chLen] = '\0';
    if (u8g2.getUTF8Width(buf) > (u8g2_uint_t)maxWidth) {
      buf[len] = '\0';  // 加这个字就超宽，退回上一个字
      break;
    }
    len += chLen;
    p = next;
  }
  u8g2.drawUTF8(x, baselineY, buf);
}

// 把 text 按像素宽换行；lines 填最多 maxLines 行，每行不超过 maxWidth 像素；
// 返回实际填的行数；*hasMore 表示原文还有未显示的内容（调用方据此写“请在主屏查看”）。
// 注意：中文按字断行即可（无需英文单词不断词），ASCII 长词会被从中间断开。
static int wrapText(const char *text, int maxWidth, char lines[][40], int maxLines, bool *hasMore) {
  int n = 0;
  *hasMore = false;
  const char *p = text;
  while (*p && n < maxLines) {
    char *dst = lines[n];
    size_t len = 0;
    dst[0] = '\0';
    while (*p) {
      uint32_t cp = 0;
      const char *next = utf8Next(p, &cp);
      size_t chLen = (size_t)(next - p);
      if (len + chLen >= 40) break;
      memcpy(dst + len, p, chLen);
      dst[len + chLen] = '\0';
      if (u8g2.getUTF8Width(dst) > (u8g2_uint_t)maxWidth) {
        dst[len] = '\0';
        break;
      }
      len += chLen;
      p = next;
    }
    if (len == 0) break;  // 第一个字就超宽（maxWidth 太小），避免死循环
    n++;
  }
  if (*p) *hasMore = true;
  return n;
}

// ---------- 页面状态 ----------
static int s_page = 0;                 // 当前页：0 状态，1 监测，2 问答
static uint32_t s_lastSwitchMs = 0;    // 上次翻页时刻（自动轮换计时）
static OledPageData s_lastDrawn;       // 上次画出的快照（用于变化检测）
static bool s_haveDrawn = false;
static bool s_btnLast = HIGH;          // BOOT 按键上次读到的电平
static uint32_t s_btnChangeMs = 0;     // 电平上次变化时刻（消抖计时）
static bool s_btnStable = HIGH;        // 消抖后的稳定电平
static uint32_t s_btnDownMs = 0;       // 本次按下（消抖确认后）时刻
static bool s_btnPressed = false;      // 当前是否处于按下状态

static const char *stateText(int state) {
  switch (state) {
    case 0: return "正常";
    case 1: return "注意";
    case 2: return "报警";
    default: return "—";
  }
}

static bool snapshotChanged(const OledPageData &a, const OledPageData &b) {
  if (a.wifiConnected != b.wifiConnected || a.online != b.online || a.chatBusy != b.chatBusy) return true;
  if (strcmp(a.ssid, b.ssid) || strcmp(a.ip, b.ip) || strcmp(a.scenario, b.scenario)) return true;
  if (strcmp(a.lastQuestion, b.lastQuestion) || strcmp(a.lastAnswer, b.lastAnswer)) return true;
  for (int i = 0; i < 3; i++) {
    if (a.teleValid[i] != b.teleValid[i] || a.telePrecision[i] != b.telePrecision[i] ||
        a.teleState[i] != b.teleState[i] || strcmp(a.teleUnit[i], b.teleUnit[i])) return true;
    // float 不能直接比：NaN != NaN 恒成立，先把 NaN 当相等处理。
    bool aNan = isnan(a.teleValue[i]), bNan = isnan(b.teleValue[i]);
    if (aNan != bNan) return true;
    if (!aNan && a.teleValue[i] != b.teleValue[i]) return true;
  }
  return false;
}

// ---------- 三页绘制（y 传基线：4 行基线分别是 16/32/48/64）----------
static void drawStatusPage(const OledPageData &d) {
  // L1：司稼 + 状态（右对齐）
  u8g2.drawUTF8(0, 16, "司稼");
  const char *st = !d.wifiConnected ? "离线" : (d.online ? "在线" : "服务器不通");
  u8g2.drawUTF8(OLED_W - u8g2.getUTF8Width(st), 16, st);
  // L2：WiFi 名称
  char line[64];
  if (d.wifiConnected) snprintf(line, sizeof(line), "WiFi %s", d.ssid);
  else snprintf(line, sizeof(line), "WiFi 未连接");
  drawTruncated(0, 32, line, OLED_W);
  // L3：IP
  if (d.wifiConnected) snprintf(line, sizeof(line), "IP %s", d.ip);
  else snprintf(line, sizeof(line), "IP --");
  drawTruncated(0, 48, line, OLED_W);
  // L4：当前场景
  snprintf(line, sizeof(line), "场景：%s", d.scenario);
  drawTruncated(0, 64, line, OLED_W);
}

static void drawMonitorPage(const OledPageData &d) {
  // L1：标题（遥测是仿真数据，必须标“模拟数据”）
  u8g2.drawUTF8(0, 16, "监测 · 模拟数据");
  // L2–L4：每通道一行“标签数值单位”，状态右对齐。
  for (int i = 0; i < 3; i++) {
    char val[32];
    if (d.teleValid[i]) {
      if (d.telePrecision[i] == 0) snprintf(val, sizeof(val), "%s%.0f%s",
                                            d.teleLabel[i], d.teleValue[i], d.teleUnit[i]);
      else snprintf(val, sizeof(val), "%s%.*f%s",
                    d.teleLabel[i], d.telePrecision[i], d.teleValue[i], d.teleUnit[i]);
    } else {
      snprintf(val, sizeof(val), "%s--", d.teleLabel[i]);
    }
    int y = 32 + i * OLED_LINE_H;
    const char *st = stateText(d.teleState[i]);
    int stW = u8g2.getUTF8Width(st);
    drawTruncated(0, y, val, OLED_W - stW - 4);  // 给右侧状态留位置
    u8g2.drawUTF8(OLED_W - stW, y, st);
  }
}

static void drawChatPage(const OledPageData &d) {
  // L1：标题；正在诊断时右侧显示“正在诊断…”
  u8g2.drawUTF8(0, 16, "问答");
  if (d.chatBusy) {
    const char *busy = "正在诊断…";
    u8g2.drawUTF8(OLED_W - u8g2.getUTF8Width(busy), 16, busy);
  }
  // L2：最后一问（截断显示）；没问过就提示长按 BOOT 提问。
  char q[80];
  if (d.lastQuestion[0]) snprintf(q, sizeof(q), "问：%s", d.lastQuestion);
  else snprintf(q, sizeof(q), "长按 BOOT 提问");
  drawTruncated(0, 32, q, OLED_W);
  // L3–L4：答案前两行；写不下时末行写“请在主屏查看”。
  if (d.lastAnswer[0]) {
    char lines[2][40];
    bool hasMore = false;
    int n = wrapText(d.lastAnswer, OLED_W, lines, 2, &hasMore);
    if (n >= 1) u8g2.drawUTF8(0, 48, lines[0]);
    if (hasMore) u8g2.drawUTF8(0, 64, "请在主屏查看");
    else if (n >= 2) u8g2.drawUTF8(0, 64, lines[1]);
  }
}

static void drawPage(const OledPageData &d) {
  u8g2.clearBuffer();
  u8g2.setFont(OLED_FONT);
  switch (s_page) {
    case 0: drawStatusPage(d); break;
    case 1: drawMonitorPage(d); break;
    default: drawChatPage(d); break;
  }
  u8g2.sendBuffer();
}

// ---------- 对外接口 ----------
void oledUiBegin() {
  // BOOT 按键：平时高电平，按下为低电平；只在启动后读，不影响 strapping 采样。
  pinMode(PIN_BOOT_BTN, INPUT_PULLUP);
  u8g2.begin();
  u8g2.setFont(OLED_FONT);
  // 启动页：先亮屏，说明这块屏通了；主循环随后按快照重绘。
  u8g2.clearBuffer();
  u8g2.drawUTF8(0, 16, "司稼");
  u8g2.drawUTF8(0, 32, "正在启动…");
  u8g2.drawUTF8(0, 48, "OLED 128x64");
  u8g2.sendBuffer();
  s_lastSwitchMs = millis();
}

int oledUiTick(const OledPageData &d) {
  uint32_t now = millis();
  int action = OLED_ACTION_NONE;

  // ---- BOOT 按键：消抖 + 短按切页 / 长按提问 ----
  bool level = digitalRead(PIN_BOOT_BTN);
  if (level != s_btnLast) {
    s_btnLast = level;
    s_btnChangeMs = now;
  }
  if (now - s_btnChangeMs >= OLED_DEBOUNCE_MS && level != s_btnStable) {
    s_btnStable = level;
    if (level == LOW) {
      s_btnDownMs = now;
      s_btnPressed = true;
    } else if (s_btnPressed) {
      s_btnPressed = false;
      if (now - s_btnDownMs >= OLED_LONG_PRESS_MS) {
        action = OLED_ACTION_ASK_PRESET_0;  // 长按：问第一条预设问题
      } else {
        s_page = (s_page + 1) % OLED_PAGE_COUNT;  // 短按：下一页
        s_lastSwitchMs = now;
      }
    }
  }

  // ---- 自动轮换：每 5 秒下一页 ----
  if (now - s_lastSwitchMs >= OLED_AUTO_MS) {
    s_page = (s_page + 1) % OLED_PAGE_COUNT;
    s_lastSwitchMs = now;
  }

  // ---- 按需重绘：翻页或内容变化时才刷（全屏 I2C 传输不便宜）----
  static int lastPageDrawn = -1;
  bool pageChanged = (s_page != lastPageDrawn);
  if (!s_haveDrawn || pageChanged || snapshotChanged(d, s_lastDrawn)) {
    drawPage(d);
    s_lastDrawn = d;
    s_haveDrawn = true;
    lastPageDrawn = s_page;
  }
  return action;
}

#endif  // USE_OLED_DISPLAY

// 司稼小机器人 RV0.1.0 — 0.96 寸 OLED 显示 UI（第二个显示版本）
// 硬件：SSD1315 128x64（模组 NFP1315-157B），I2C 地址 0x3C；SDA=GPIO12、SCL=GPIO13（见 display_config.h）。
// 驱动：U8g2 全缓冲模式（128x64/8 = 1024 字节显存，C3 内部 RAM 够用）。
//
// 字库：正文与标题用 U8g2 自带 wqy12（GB2312，12px），启动页大标题用 wqy16。
// 为什么不用 16px 做正文：16px 一行只能放 8 个汉字，监测页“油压136.2kPa”一行
// 放不下数值+单位+状态，单位会被截掉半个，数值一变截断位置跟着变，看起来“单位在跳”。
// 12px 一行放 10 个汉字，三个通道都能完整显示数值+单位+状态；问答答案每行也多放 2 个字。
// 问答页显示服务器返回的答案，字符集事先不可穷举——子集只能覆盖固定界面文案，
// 答案里一有子集外的字就显示不出。wqy12 覆盖 GB2312 常用字，任意答案都能显示；
// OLED 版不编 LVGL/TFT_eSPI/XPT2046，省出的 Flash 足够放下这两个字库，
// 固件仍放得进 C3 app0 分区（约 2.9MB，实测大小见 PR 说明）。
// GB2312 之外的生僻字、Emoji：U8g2 找不到字形，会留空，不断行不花屏。
//
// 版式（128x64，12px 正文）：
//   标题栏（0–13px，反白：白底黑字）：“司稼 · 状态/监测/问答”，右侧放状态/模拟数据/诊断中/问答页码
//   内容（3 行，基线 27/40/53）+ 底栏页点（3 个点，y=61，当前页实心）
//   0 状态页：WiFi 名称、IP、当前场景（在线状态放标题栏右侧）
//   1 监测页：水温/油压/转速三行数值 + 右侧状态（正常/注意/报警）；遥测是仿真数据，标题栏标“模拟数据”；
//     报警时状态字反白（白底黑字），一眼看到
//   2 问答页：最后一问 + 答案；答案长时可翻页看完全部（见下）
// 切页：只手动换页，不自动轮换。BOOT 按键（GPIO9）短按翻页；长按（≥800ms）问第一条预设问题。
// 问答翻页：短按先翻答案的子页（第 1 页是问题+答案前 2 行，之后每页 3 行答案），
//   答案翻完再短按回到状态页；新答案来了自动回到问答第 1 页。
// GPIO9 是 strapping 脚，只在启动后读按键，不影响启动；按键平时高电平，按下为低电平。
// 重绘策略：只有翻页（含问答子页）或快照内容变化时才重绘（全屏刷新走 I2C，频繁刷会拖慢主循环）。

#include "oled_ui.h"

// 整个文件只在 OLED 版编译：TFT 版没有 U8g2 依赖，
// 这里把 U8g2 的 include 也包进条件里，避免 TFT 环境编译本文件时找不到头文件。
#if USE_OLED_DISPLAY

#include <U8g2lib.h>
#include <Wire.h>

#include "display_config.h"
#include "version.h"

#define OLED_FONT u8g2_font_wqy16_t_gb2312    // 16px 中文（仅启动页大标题）
#define OLED_FONT_S u8g2_font_wqy12_t_gb2312  // 12px 中文（标题栏与正文）
#define OLED_W 128
#define OLED_H 64
#define OLED_HEADER_H 14   // 标题栏高（反白条）
#define OLED_LINE_H 13     // 12px 行距
#define OLED_L1 27         // 内容行 1 基线
#define OLED_L2 40         // 内容行 2 基线
#define OLED_L3 53         // 内容行 3 基线
#define OLED_DOTS_Y 61     // 底栏页点中心 y
#define OLED_PAGE_COUNT 3
#define OLED_LONG_PRESS_MS 800
#define OLED_DEBOUNCE_MS 50
#define OLED_ANS_MAX_LINES 64  // 答案换行后最多存 64 行（512 字答案约 51 行，够用）

// 硬件 I2C：U8g2 按构造参数里的时钟/数据脚调 Wire.begin(SDA, SCL)。
// 默认地址就是 0x3C（与模块跳线 0x78 的 8 位写地址一致），不用另设。
static U8G2_SSD1315_128X64_NONAME_F_HW_I2C u8g2(U8G2_R0, U8X8_PIN_NONE, PIN_OLED_SCL, PIN_OLED_SDA);

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
static int s_page = 0;                 // 当前主页面：0 状态，1 监测，2 问答
static int s_chatSub = 0;              // 问答子页（0 起；只在问答页有效）
static uint32_t s_lastSwitchMs = 0;    // 上次翻页时刻（保留：暂无自动轮换用不到，留作以后扩展）
static OledPageData s_lastDrawn;       // 上次画出的快照（用于变化检测）
static bool s_haveDrawn = false;
static bool s_btnLast = HIGH;          // BOOT 按键上次读到的电平
static uint32_t s_btnChangeMs = 0;     // 电平上次变化时刻（消抖计时）
static bool s_btnStable = HIGH;        // 消抖后的稳定电平
static uint32_t s_btnDownMs = 0;       // 本次按下（消抖确认后）时刻
static bool s_btnPressed = false;      // 当前是否处于按下状态

// 答案换行缓存：答案一变就重新换行（12px，行宽 128），问答页直接按行取，不用每次重算。
// 第 0 子页：问题 + 答案第 0–1 行；第 k≥1 子页：答案第 2+3(k-1) .. 2+3k-1 行。
static char s_ansLines[OLED_ANS_MAX_LINES][40];
static int s_ansLineCount = 0;

static void rewrapAnswer(const char *answer) {
  u8g2.setFont(OLED_FONT_S);
  bool hasMore = false;
  s_ansLineCount = wrapText(answer, OLED_W, s_ansLines, OLED_ANS_MAX_LINES, &hasMore);
}

// 问答总子页数（答案行数 N：N≤2 时 1 页，否则 1 + ceil((N-2)/3)）。
static int chatPageCount() {
  if (s_ansLineCount <= 2) return 1;
  return 1 + (s_ansLineCount - 2 + 2) / 3;
}

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

// ---------- 通用绘制：标题栏（反白）与底栏页点 ----------
// 标题栏：白底条 + 黑字，左侧标题，右侧信息（右对齐；空串则不画）。
static void drawHeader(const char *title, const char *right) {
  u8g2.drawBox(0, 0, OLED_W, OLED_HEADER_H);
  u8g2.setDrawColor(0);  // 黑字写在白条上
  u8g2.drawUTF8(0, 11, title);
  if (right && right[0]) {
    u8g2.drawUTF8(OLED_W - u8g2.getUTF8Width(right), 11, right);
  }
  u8g2.setDrawColor(1);
}

// 底栏页点：3 个点居中，当前主页面实心，其余空心。
static void drawPageDots() {
  const int xs[OLED_PAGE_COUNT] = {56, 64, 72};
  for (int i = 0; i < OLED_PAGE_COUNT; i++) {
    if (i == s_page) u8g2.drawDisc(xs[i], OLED_DOTS_Y, 2);
    else u8g2.drawCircle(xs[i], OLED_DOTS_Y, 2);
  }
}

// ---------- 三页绘制（12px 正文；内容行基线 27/40/53）----------
static void drawStatusPage(const OledPageData &d) {
  // 标题栏右侧放在线状态；内容三行：WiFi、IP、场景。
  const char *st = !d.wifiConnected ? "离线" : (d.online ? "在线" : "服务器不通");
  drawHeader("司稼 · 状态", st);
  char line[64];
  if (d.wifiConnected) snprintf(line, sizeof(line), "WiFi %s", d.ssid);
  else snprintf(line, sizeof(line), "WiFi 未连接");
  drawTruncated(0, OLED_L1, line, OLED_W);
  if (d.wifiConnected) snprintf(line, sizeof(line), "IP %s", d.ip);
  else snprintf(line, sizeof(line), "IP --");
  drawTruncated(0, OLED_L2, line, OLED_W);
  snprintf(line, sizeof(line), "场景：%s", d.scenario);
  drawTruncated(0, OLED_L3, line, OLED_W);
  drawPageDots();
}

static void drawMonitorPage(const OledPageData &d) {
  // 标题栏右侧标“模拟数据”（遥测是仿真数据，必须标）。
  drawHeader("司稼 · 监测", "模拟数据");
  // 每通道一行“标签数值单位”，状态右对齐；12px 下三行都放得下单位，不会截掉。
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
    int y = OLED_L1 + i * OLED_LINE_H;
    const char *st = stateText(d.teleState[i]);
    int stW = u8g2.getUTF8Width(st);
    drawTruncated(0, y, val, OLED_W - stW - 4);  // 给右侧状态留位置
    if (d.teleState[i] == 2) {
      // 报警：状态字反白（白底黑字），一眼看到。
      u8g2.drawBox(OLED_W - stW - 4, y - 11, stW + 4, 13);
      u8g2.setDrawColor(0);
      u8g2.drawUTF8(OLED_W - stW - 2, y, st);
      u8g2.setDrawColor(1);
    } else {
      u8g2.drawUTF8(OLED_W - stW, y, st);
    }
  }
  drawPageDots();
}

static void drawChatPage(const OledPageData &d) {
  // 标题栏右侧：诊断中显示“正在诊断…”；答案有多页时显示“当前/总数”（如 1/3）。
  char right[16] = "";
  if (d.chatBusy) snprintf(right, sizeof(right), "正在诊断…");
  else if (chatPageCount() > 1) snprintf(right, sizeof(right), "%d/%d", s_chatSub + 1, chatPageCount());
  drawHeader("司稼 · 问答", right);
  if (!d.lastQuestion[0] && s_ansLineCount == 0) {
    // 还没问过：提示长按 BOOT 提问。
    u8g2.drawUTF8(0, OLED_L1, "长按 BOOT 提问");
    drawPageDots();
    return;
  }
  if (s_chatSub == 0) {
    // 第 0 子页：第 1 行是问题，第 2–3 行是答案第 0–1 行。
    char q[80];
    snprintf(q, sizeof(q), "问：%s", d.lastQuestion);
    drawTruncated(0, OLED_L1, q, OLED_W);
    if (s_ansLineCount >= 1) u8g2.drawUTF8(0, OLED_L2, s_ansLines[0]);
    if (s_ansLineCount >= 2) u8g2.drawUTF8(0, OLED_L3, s_ansLines[1]);
    else if (d.chatBusy) u8g2.drawUTF8(0, OLED_L2, "正在诊断…");
  } else {
    // 第 k≥1 子页：3 行全是答案（第 2+3(k-1) .. 2+3k-1 行）。
    int first = 2 + (s_chatSub - 1) * 3;
    const int ys[3] = {OLED_L1, OLED_L2, OLED_L3};
    for (int i = 0; i < 3; i++) {
      if (first + i < s_ansLineCount) u8g2.drawUTF8(0, ys[i], s_ansLines[first + i]);
    }
  }
  drawPageDots();
}

static void drawPage(const OledPageData &d) {
  u8g2.clearBuffer();
  u8g2.setFont(OLED_FONT_S);
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
  // 启动页：大标题居中 + 分隔线 + 提示（先亮屏，说明这块屏通了；主循环随后按快照重绘）。
  u8g2.clearBuffer();
  u8g2.setFont(OLED_FONT);
  u8g2.drawUTF8((OLED_W - u8g2.getUTF8Width("司稼")) / 2, 30, "司稼");
  u8g2.drawHLine(44, 36, 40);
  u8g2.setFont(OLED_FONT_S);
  u8g2.drawUTF8((OLED_W - u8g2.getUTF8Width("正在启动…")) / 2, 50, "正在启动…");
  u8g2.sendBuffer();
  s_lastSwitchMs = millis();
}

int oledUiTick(const OledPageData &d) {
  uint32_t now = millis();
  int action = OLED_ACTION_NONE;

  // 答案变了 → 重新换行，问答回到第 1 页（放按钮处理前面，让翻页逻辑用新的页数）。
  if (strcmp(d.lastAnswer, s_lastDrawn.lastAnswer) != 0) {
    rewrapAnswer(d.lastAnswer);
    s_chatSub = 0;
  }

  // ---- BOOT 按键：消抖 + 短按翻页 / 长按提问 ----
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
        s_chatSub = 0;  // 新问题来了，问答回到第 1 页
      } else {
        // 短按翻页：问答页先翻答案子页，翻完再到下一主页面；其他页直接到下一主页面。
        if (s_page == 2 && s_chatSub < chatPageCount() - 1) {
          s_chatSub++;
        } else {
          s_page = (s_page + 1) % OLED_PAGE_COUNT;
          s_chatSub = 0;
        }
        s_lastSwitchMs = now;
      }
    }
  }

  // 注意：不自动轮换，只手动换页（用户要求）。

  // ---- 按需重绘：翻页（含问答子页）或内容变化时才刷（全屏 I2C 传输不便宜）----
  static int lastPageDrawn = -1;
  static int lastSubDrawn = -1;
  bool pageChanged = (s_page != lastPageDrawn) || (s_chatSub != lastSubDrawn);
  if (!s_haveDrawn || pageChanged || snapshotChanged(d, s_lastDrawn)) {
    if (s_chatSub >= chatPageCount()) s_chatSub = chatPageCount() - 1;
    if (s_chatSub < 0) s_chatSub = 0;
    drawPage(d);
    s_lastDrawn = d;
    s_haveDrawn = true;
    lastPageDrawn = s_page;
    lastSubDrawn = s_chatSub;
  }
  return action;
}

#endif  // USE_OLED_DISPLAY

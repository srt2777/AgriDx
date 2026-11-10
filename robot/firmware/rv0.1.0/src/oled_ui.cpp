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
//   标题栏（0–13px，反白：白底黑字）：左侧是名字“司稼Agent”，右侧放状态/模拟数据/诊断中/问答页码；
//     标题栏放不下页名（“司稼Agent · 状态”+右侧信息会超宽），页面由底栏页点和内容区分
//   内容（3 行，基线 27/40/53）+ 底栏页点（3 个点，y=61，当前页实心）
//   0 状态页：WiFi 名称、IP、当前场景（在线状态放标题栏右侧）；WiFi 行配小图标
//   1 监测页：水温/油压/转速三行数值 + 右侧状态（正常/注意/报警）；每行配 12×12 小图标；
//     遥测是仿真数据，标题栏标“模拟数据”；报警时状态字反白（白底黑字），一眼看到
//   2 问答页：最后一问 + 答案；答案长时可翻页看完全部（见下）；没问过时显示眼睛 + 提示
// 切页：只手动换页，不自动轮换。BOOT 按键（GPIO9）短按翻页；长按（≥800ms）问第一条预设问题。
//   主页面切换有滑动过渡（新页从右滑入，8 帧约 200ms）；问答子页翻页不滑动，要快。
// 动效：启动页淡入（对比度 ramp）+ 进度条 + 眨眼；诊断中标题栏转圈；
//   问答空闲页眼睛会眨眼、左右看。动效只在可见时定时重绘（50ms/20fps），平时仍按需重绘。
// 待机：10 秒无操作（按键/新答案到达都算操作，诊断中不进待机）自动进入，
//   全屏一辆老式蒸汽拖拉机（轮子转、烟囱冒烟、从左侧开进来，小树小草滚过）；按一下 BOOT 唤醒（那一下只唤醒，不翻页、不提问）。
// 切页：只手动换页，不自动轮换。BOOT 按键（GPIO9）短按翻页；长按（≥800ms）问第一条预设问题。
// 问答翻页：短按先翻答案的子页（第 1 页是问题+答案前 2 行，之后每页 3 行答案），
//   答案翻完再短按回到状态页；新答案来了自动回到问答第 1 页。
//   从问答页翻到状态页时，问答自动清除（不保留），回到问答页就是重新开始问。
// GPIO9 是 strapping 脚，只在启动后读按键，不影响启动；按键平时高电平，按下为低电平。
// 重绘策略：只有翻页（含问答子页）或快照内容变化时才重绘（全屏刷新走 I2C，频繁刷会拖慢主循环）。

#include "oled_ui.h"

// 整个文件只在 OLED 版编译：TFT 版没有 U8g2 依赖，
// 这里把 U8g2 的 include 也包进条件里，避免 TFT 环境编译本文件时找不到头文件。
#if USE_OLED_DISPLAY

#include <U8g2lib.h>
#include <Wire.h>
#include <math.h>  // sinf/cosf（眼睛左右看、转圈）

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
#define OLED_ANIM_MS 50  // 动效重绘间隔（20fps；原来 120ms/约 8fps，看着卡）。
// 帧率预算：128×64 全帧经 I2C（400kHz）发送约 23ms，50ms 间隔留约 27ms 余量；
// 再短（33ms/30fps）只剩约 10ms，I2C 稍一抖就拖垮主循环、WiFi/HTTP 也会受挤，
// 所以 50ms 是稳妥值。动效只在可见时才按此间隔重绘，平时仍按需重绘。
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

// ---------- 12×12 小图标（XBM，LSB=最左像素；drawXBMP 绘制）----------
// 每行一个图标 + 数值，视觉层次比纯文字清楚；图标 12px + 2px 间距，文字从 x=14 起。
// WiFi（弧线+圆点）、温度计（杆+圆泡）、油滴、水压表（圆盘+指针）。
static const uint8_t ICON_WIFI[] = {
  0x00, 0x00, 0xf8, 0x01, 0x0c, 0x03, 0x04, 0x02, 0xf8, 0x01, 0x90, 0x00,
  0x60, 0x00, 0x60, 0x00, 0x60, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00};
static const uint8_t ICON_THERMO[] = {
  0x60, 0x00, 0x60, 0x00, 0x60, 0x00, 0x60, 0x00, 0x60, 0x00, 0xf0, 0x00,
  0xf8, 0x01, 0xf8, 0x01, 0xf8, 0x01, 0xf0, 0x00, 0x00, 0x00, 0x00, 0x00};
static const uint8_t ICON_DROP[] = {
  0x60, 0x00, 0xf0, 0x00, 0xf0, 0x00, 0xf8, 0x01, 0xfc, 0x03, 0xfc, 0x03,
  0xfc, 0x03, 0xf8, 0x01, 0xf0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00};
static const uint8_t ICON_GAUGE[] = {
  0xf8, 0x01, 0xfc, 0x03, 0x06, 0x06, 0x62, 0x04, 0xc2, 0x04, 0x82, 0x04,
  0x06, 0x06, 0xfc, 0x03, 0xf8, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00};
#define OLED_ICON_W 12
#define OLED_ICON_X 14  // 图标后文字起始 x

// ---------- 眼睛与转圈（动效） ----------
// 眼睛：两只圆角方块眼，瞳孔可左右看；eyeH 缩小就是眨眼/半闭。
// cx, cy = 两眼中心；eyeW=单眼宽，eyeH=单眼高；lookX=瞳孔横向偏移（±2）。
static void drawEyes(int cx, int cy, int eyeW, int eyeH, int lookX) {
  int gap = 8;
  int leftX = cx - gap / 2 - eyeW;
  int rightX = cx + gap / 2;
  int topY = cy - eyeH / 2;
  // 圆角半径不能超过眼高的一半：眨眼时 eyeH 会缩到 2，
  // 固定 r=3 会让 U8g2 drawRBox 内部 h-2r 无符号下溢（uint16_t 绕回约 65532），
  // 眼睛那一条画成超大白块、闪一下。半径按眼高收紧，闭眼时就是一条细线。
  int r = eyeH / 2;
  if (r > 3) r = 3;
  u8g2.drawRBox(leftX, topY, eyeW, eyeH, r);
  u8g2.drawRBox(rightX, topY, eyeW, eyeH, r);
  if (eyeH >= 6) {
    // 瞳孔（黑点，左右看）
    u8g2.setDrawColor(0);
    int pw = 4, ph = 5;
    u8g2.drawBox(leftX + eyeW / 2 - pw / 2 + lookX, cy - ph / 2, pw, ph);
    u8g2.drawBox(rightX + eyeW / 2 - pw / 2 + lookX, cy - ph / 2, pw, ph);
    u8g2.setDrawColor(1);
  }
}

// 眨眼：每 2.8 秒眨一次，闭眼 150ms（75ms 闭上、75ms 睁开）；返回眼高。
static int eyeHeight(int fullH, uint32_t now) {
  uint32_t t = now % 2800;
  if (t >= 150) return fullH;
  float f = (t < 75) ? (1.0f - (float)t / 75.0f * 0.85f)
                     : (0.15f + (float)(t - 75) / 75.0f * 0.85f);
  int h = (int)(fullH * f + 0.5f);
  return h < 2 ? 2 : h;
}

// 瞳孔左右看：缓慢来回，偏移 ±2px。
static int eyeLookX(uint32_t now) {
  float s = sinf((float)now / 1500.0f);
  return (int)(s * 2.0f + (s >= 0 ? 0.5f : -0.5f));
}

// 诊断中转圈：8 个点围成圈，每 100ms 亮一个（顺时针转）；画在标题栏右侧（黑点，白底上）。
static void drawSpinner(int cx, int cy, uint32_t now) {
  int frame = (int)((now / 100) % 8);
  u8g2.setDrawColor(0);
  for (int i = 0; i < 8; i++) {
    float a = (float)i * 3.14159f / 4.0f;
    int x = cx + (int)(4.0f * cosf(a) + 0.5f);
    int y = cy + (int)(4.0f * sinf(a) + 0.5f);
    if (i == frame) u8g2.drawDisc(x, y, 2);
    else u8g2.drawDisc(x, y, 1);
  }
  u8g2.setDrawColor(1);
}

// 待机：10 秒无操作（按键/新答案到达都算操作，诊断中不进待机）自动进入，
//   全屏一辆老式蒸汽拖拉机（轮子转、烟囱冒烟、从左侧开进来，小树小草滚过）；按一下 BOOT 唤醒（那一下只唤醒，不翻页、不提问）。
#define OLED_STANDBY_MS 10000
static bool s_standby = false;           // 是否在待机模式
static uint32_t s_standbyStartMs = 0;    // 本次进入待机的时刻（开场动画计时）
static uint32_t s_lastActivityMs = 0;    // 上次操作时刻
static bool s_wakeConsumed = false;      // 唤醒那一下按下已被消耗（松开时不触发操作）

// 待机拖拉机 v6b（最原始的蒸汽拖拉机，会动的场景）：大后轮 + 小前轮 + 卧式锅炉 + 高烟囱冒烟 + 尾部小驾驶室。
// 动感：轮子转 + 烟囱冒烟 + 从左侧开进来 + 小树小草从右向左滚过。50ms 一帧（20fps），启动页/问答页的小眼睛不受影响（只换待机屏）。
// 版式（128×64）：地面 y=56；大后轮中心 (38,44) r=12，小前轮中心 (80,48) r=8，车头朝右；
// 锅炉：x=47–78，顶线微弧 y≈28–30，底 y=42；高烟囱 x=80–84，顶 y=12，喇叭口 x=78–86、y=10–12；
// 驾驶室（v6b：右移到大后轮正上方，骑在后轮上）：x=27–49，顶棚 y=22，小窗 (33,26,10,8)，底边 y=44 与后轮顶部重叠；锅炉侧面小飞轮 (58,36) r=4；
// 开场：待机开始后 1.5 秒内从 dx=-110 二次缓出滑到 0（停在中间偏左）；
// 烟：每 360ms 冒一个烟圈，寿命约 1080ms，往上飘、慢慢散开、带一点往左飘；
// 景物：256px 一循环，3 棵树 + 6 簇草，滚动速度与后轮转速对得上（后轮周长 2π×12 ≈ 75px/1440ms ≈ 0.052px/ms）。
// 画一个轮子：外胎（两圈）+ 胎纹（10 个短辐纹，嵌在胎环里，随时间转）
// + 6 根辐条（3 条直径线，120° 夹角，随时间转）+ 轮毂环 + 轴心。
// 辐条角/胎纹角按毫秒算（1440ms 转一圈，即 0.25°/ms），与帧率无关，帧率越高越顺滑。
static void drawStandbyWheel(int cx, int cy, int r, uint32_t now) {
  u8g2.drawCircle(cx, cy, (u8g2_uint_t)r);
  u8g2.drawCircle(cx, cy, (u8g2_uint_t)(r - 2));
  float base = (float)(now % 1440) * 3.14159f / 720.0f;
  for (int k = 0; k < 10; k++) {  // 胎纹：36° 一个，嵌在胎环（r-2 到 r）里
    float a = base + (float)k * 3.14159f * 2.0f / 10.0f;
    int x1 = cx + (int)((r - 2) * cosf(a) + 0.5f);
    int y1 = cy + (int)((r - 2) * sinf(a) + 0.5f);
    int x2 = cx + (int)(r * cosf(a) + 0.5f);
    int y2 = cy + (int)(r * sinf(a) + 0.5f);
    u8g2.drawLine(x1, y1, x2, y2);
  }
  for (int i = 0; i < 3; i++) {
    float a = base + (float)i * 3.14159f * 2.0f / 3.0f;
    int dx = (int)((r - 3) * cosf(a) + 0.5f);
    int dy = (int)((r - 3) * sinf(a) + 0.5f);
    u8g2.drawLine(cx - dx, cy - dy, cx + dx, cy + dy);
  }
  u8g2.drawCircle(cx, cy, 4);  // 轮毂环
  u8g2.drawDisc(cx, cy, 2);    // 轴心
}

// ---------- 待机拖拉机（v6：最原始的蒸汽拖拉机，会动的场景）----------
// 第六版 v6b：大后轮 + 小前轮 + 卧式锅炉 + 高烟囱冒烟 + 驾驶室（右移到大后轮正上方，骑在后轮上），车头朝右；
// 动感：轮子照样转 + 烟囱冒烟 + 从左侧开进来 + 小树小草从右向左滚过。
// 开场滑入：t<1500ms 时 dx 从 -110 二次缓出到 0（车头朝右，整车从左侧开进来，停在中间偏左）。
static int standbyEntryDx(uint32_t t) {
  if (t >= 1500) return 0;
  int f = (int)(t * 1000 / 1500);        // 0..1000
  int e = f * (2000 - f) / 1000;         // 二次缓出 0..1000
  return -110 + 110 * e / 1000;
}

// 烟囱冒烟：每 360ms 冒一个烟圈，寿命约 1080ms，往上飘、慢慢散开（半径变大）、带一点往左飘。
// chimneyX = 烟囱口中心 x（已含开场偏移 dx）。
static void drawStandbySmoke(int chimneyX, uint32_t t) {
  uint32_t last = (t / 360) * 360;   // 最近一次冒烟的时刻
  for (int j = 0; j < 3; j++) {      // 寿命 1080ms 内最多 3 个烟圈
    if (last < (uint32_t)j * 360) break;
    uint32_t born = last - (uint32_t)j * 360;
    uint32_t age = t - born;
    if (age >= 1080) continue;
    int sx = chimneyX - (int)(age / 360);        // 往左飘约 3px
    int sy = 9 - (int)(age / 110);               // 往上飘约 10px
    int r = 1 + (int)(age / 400);                // 慢慢散开 1→3
    u8g2.drawCircle(sx, sy, (u8g2_uint_t)r);
  }
}

// 地面景物：小树（竖线树干 + 小三角树冠）+ 小草（3 根短竖线簇），从右向左滚过，256px 一循环，间距不整齐。
// 滚动速度与后轮转速对得上：后轮周长 2π×12 ≈ 75px/1440ms ≈ 0.052px/ms，50ms 一帧约 2.6px。
static void drawStandbyScenery(uint32_t t) {
  uint32_t s = (uint32_t)((float)t * 0.0524f);    // 滚动距离 px
  int off = (int)(s % 256);
  static const int treeX[] = {20, 118, 201};
  static const int grassX[] = {55, 71, 152, 168, 233, 247};
  for (int i = 0; i < 3; i++) {
    int x = (treeX[i] - off + 256) % 256;
    if (x >= 128) continue;
    u8g2.drawLine(x, 56, x, 51);                          // 树干
    u8g2.drawTriangle(x - 3, 51, x + 3, 51, x, 46);       // 树冠小三角
  }
  for (int i = 0; i < 6; i++) {
    int x = (grassX[i] - off + 256) % 256;
    if (x >= 128) continue;
    u8g2.drawLine(x - 2, 56, x - 2, 53);
    u8g2.drawLine(x, 56, x, 52);
    u8g2.drawLine(x + 2, 56, x + 2, 53);
  }
}

static void drawStandbyTractor(uint32_t now) {
  uint32_t t = now - s_standbyStartMs;   // 待机开始后的毫秒数（开场/烟/景物都按它计时）
  int dx = standbyEntryDx(t);
  // 地面线
  u8g2.drawHLine(4, 56, 119);
  // 景物：小树小草从右向左滚过（先画，拖拉机盖在上面，树从车后经过）
  drawStandbyScenery(t);
  // ---- 蒸汽拖拉机本体（车头朝右，停在中间偏左；所有 x 都加开场偏移 dx）----
  // 驾驶室（v6b：右移到大后轮正上方，骑在后轮上，底边 y=44 与后轮顶部重叠）
  u8g2.drawLine(27 + dx, 22, 49 + dx, 22);       // 顶棚（略外伸）
  u8g2.drawLine(29 + dx, 22, 29 + dx, 44);       // 后墙
  u8g2.drawLine(47 + dx, 22, 47 + dx, 44);       // 前墙（连锅炉）
  u8g2.drawFrame(33 + dx, 26, 10, 8);            // 小窗
  u8g2.drawHLine(29 + dx, 44, 19);               // 驾驶室底
  // 卧式锅炉：从驾驶室前沿伸到烟囱，顶线微弧（两段折线）+ 底线 + 前端盖
  u8g2.drawLine(47 + dx, 30, 62 + dx, 28);       // 锅炉顶前半（微弧）
  u8g2.drawLine(62 + dx, 28, 78 + dx, 30);       // 锅炉顶后半
  u8g2.drawHLine(47 + dx, 42, 32);               // 锅炉底 47–78
  u8g2.drawLine(78 + dx, 30, 82 + dx, 33);       // 前端盖上斜角
  u8g2.drawLine(82 + dx, 33, 82 + dx, 39);       // 前端盖
  u8g2.drawLine(82 + dx, 39, 78 + dx, 42);       // 前端盖下斜角
  // 锅炉侧面小飞轮（圆圈 + 一根随轮子转的辐条）
  float base = (float)(now % 1440) * 3.14159f / 720.0f;
  u8g2.drawCircle(58 + dx, 36, 4);
  int fx = (int)(4 * cosf(base) + 0.5f);
  int fy = (int)(4 * sinf(base) + 0.5f);
  u8g2.drawLine(58 + dx - fx, 36 - fy, 58 + dx + fx, 36 + fy);
  // 高烟囱（车头前方）：细管 + 顶部喇叭口
  u8g2.drawLine(80 + dx, 30, 80 + dx, 12);       // 烟囱左壁
  u8g2.drawLine(84 + dx, 30, 84 + dx, 12);       // 烟囱右壁
  u8g2.drawBox(78 + dx, 10, 9, 3);               // 喇叭口 x=78–86，y=10–12
  // 烟囱冒烟（烟圈从喇叭口往上飘）
  drawStandbySmoke(82 + dx, t);
  // 轮子：大后轮（驱动轮）+ 小前轮（胎纹/辐条随时间转）
  drawStandbyWheel(38 + dx, 44, 12, now);
  drawStandbyWheel(80 + dx, 48, 8, now);
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
  drawHeader("司稼Agent", st);
  char line[64];
  if (d.wifiConnected) snprintf(line, sizeof(line), "WiFi %s", d.ssid);
  else snprintf(line, sizeof(line), "WiFi 未连接");
  u8g2.drawXBMP(0, OLED_L1 - 11, OLED_ICON_W, OLED_ICON_W, ICON_WIFI);
  drawTruncated(OLED_ICON_X, OLED_L1, line, OLED_W - OLED_ICON_X);
  if (d.wifiConnected) snprintf(line, sizeof(line), "IP %s", d.ip);
  else snprintf(line, sizeof(line), "IP --");
  drawTruncated(0, OLED_L2, line, OLED_W);
  snprintf(line, sizeof(line), "场景：%s", d.scenario);
  drawTruncated(0, OLED_L3, line, OLED_W);
  drawPageDots();
}

static void drawMonitorPage(const OledPageData &d) {
  // 标题栏右侧标“模拟数据”（遥测是仿真数据，必须标）。
  drawHeader("司稼Agent", "模拟数据");
  // 每通道一行“图标 + 标签数值单位”，状态右对齐；12px 下三行都放得下单位，不会截掉。
  static const uint8_t *ICONS[3] = {ICON_THERMO, ICON_DROP, ICON_GAUGE};
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
    u8g2.drawXBMP(0, y - 11, OLED_ICON_W, OLED_ICON_W, ICONS[i]);
    drawTruncated(OLED_ICON_X, y, val, OLED_W - OLED_ICON_X - stW - 4);  // 给右侧状态留位置
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
  // 标题栏右侧：诊断中显示转圈 + “诊断中”；答案有多页时显示“当前/总数”（如 1/3）。
  char right[16] = "";
  if (d.chatBusy) snprintf(right, sizeof(right), "诊断中");
  else if (chatPageCount() > 1) snprintf(right, sizeof(right), "%d/%d", s_chatSub + 1, chatPageCount());
  drawHeader("司稼Agent", right);
  if (d.chatBusy) {
    // 转圈画在标题栏右侧、“诊断中”文字的左边（白底上画黑点）。
    int textW = u8g2.getUTF8Width("诊断中");
    drawSpinner(OLED_W - textW - 6 - 5, OLED_HEADER_H / 2, millis());
  }
  if (!d.lastQuestion[0] && s_ansLineCount == 0) {
    // 还没问过：眼睛（等提问，会眨眼、左右看）+ 居中的提示。
    uint32_t now = millis();
    drawEyes(OLED_W / 2, 22, 14, eyeHeight(9, now), eyeLookX(now));
    const char *hint = "长按 BOOT 提问";
    u8g2.drawUTF8((OLED_W - u8g2.getUTF8Width(hint)) / 2, OLED_L2, hint);
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

// 只画进显存，不推屏（滑动动画要先把旧页/新页各画一份拷走）。
static void renderPageContent(const OledPageData &d) {
  u8g2.clearBuffer();
  u8g2.setFont(OLED_FONT_S);
  switch (s_page) {
    case 0: drawStatusPage(d); break;
    case 1: drawMonitorPage(d); break;
    default: drawChatPage(d); break;
  }
}

static void drawPage(const OledPageData &d) {
  renderPageContent(d);
  u8g2.sendBuffer();
}

// ---------- 滑动切页动画 ----------
// 新页从右侧滑入、旧页向左侧滑出（8 帧，约 200ms；I2C 推一整帧约 23ms，帧再密也快不了）。
// 实现：切页时先把旧页、新页各画进显存拷一份（renderPageContent 不推屏），
//   再逐帧按字节合成——显存布局是 8 行 × 128 列，每字节是 1 列 8 个垂直像素，
//   所以水平滑动就是按字节重排（display[x] = old[x+k] | new[x+k-128]），不用改任何画图调用。
static bool s_animActive = false;
static uint32_t s_animStartMs = 0;
static uint8_t s_animOldBuf[1024];
static uint8_t s_animNewBuf[1024];
#define OLED_ANIM_FRAMES 8
#define OLED_ANIM_FRAME_MS 25  // 8 帧 × 25ms = 200ms

static void animStart(int fromPage, int fromSub, int toPage, int toSub, const OledPageData &d) {
  int savePage = s_page, saveSub = s_chatSub;
  s_page = fromPage; s_chatSub = fromSub;
  renderPageContent(d);
  memcpy(s_animOldBuf, u8g2.getBufferPtr(), 1024);
  s_page = toPage; s_chatSub = toSub;
  renderPageContent(d);
  memcpy(s_animNewBuf, u8g2.getBufferPtr(), 1024);
  s_page = toPage; s_chatSub = toSub;  // 最终状态就是新页
  (void)savePage; (void)saveSub;
  s_animStartMs = millis();
  s_animActive = true;
}

// 推进一帧；动画结束时把新页画干净并返回 false（调用方据此同步重绘状态）。
static bool animFrame(const OledPageData &d, uint32_t now) {
  uint32_t elapsed = now - s_animStartMs;
  int frame = (int)(elapsed / OLED_ANIM_FRAME_MS);
  if (frame >= OLED_ANIM_FRAMES) {
    s_animActive = false;
    renderPageContent(d);
    u8g2.sendBuffer();
    return false;
  }
  int k = (frame + 1) * OLED_W / OLED_ANIM_FRAMES;  // 已滑过的像素：16, 32, …, 128
  uint8_t *dst = u8g2.getBufferPtr();
  for (int ty = 0; ty < 8; ty++) {
    for (int x = 0; x < OLED_W; x++) {
      uint8_t b = 0;
      int ox = x + k;               // 旧页：向左滑出
      if (ox < OLED_W) b |= s_animOldBuf[ty * OLED_W + ox];
      int nx = x + k - OLED_W;      // 新页：从右侧滑入
      if (nx >= 0) b |= s_animNewBuf[ty * OLED_W + nx];
      dst[ty * OLED_W + x] = b;
    }
  }
  u8g2.sendBuffer();
  return true;
}

// ---------- 对外接口 ----------
// ---------- 启动页 ----------
// 版式（128x64，全部居中）：眼睛（眨眼+左右看，刚睡醒的感觉）+ 大标题（16px）
//   + 进度条（外框 x=14~113、y=30~39，内填按 frac）+ “正在启动…”（12px，居中）。
//   进度条在开机过程中按阶段填充（见 main.cpp setup）。
// 注意：启动页在 setup() 里画，oledUiTick 还没跑；眼睛的眨眼/左右看按 millis() 取，
//   每次 oledUiSplashProgress 重绘时都会更新（WiFi 等待循环每 100ms 调一次，正好让眼睛动起来）。
static void drawSplashFrame(float frac) {
  if (frac < 0.0f) frac = 0.0f;
  if (frac > 1.0f) frac = 1.0f;
  uint32_t now = millis();
  u8g2.clearBuffer();
  // 眼睛（居中，12×7，会眨眼、左右看）
  drawEyes(OLED_W / 2, 8, 12, eyeHeight(7, now), eyeLookX(now));
  // 大标题居中
  u8g2.setFont(OLED_FONT);
  u8g2.drawUTF8((OLED_W - u8g2.getUTF8Width("司稼Agent")) / 2, 29, "司稼Agent");
  // 进度条：外框 + 按 frac 填充
  u8g2.drawFrame(14, 35, 100, 10);
  int fillW = (int)(frac * 96.0f + 0.5f);
  if (fillW > 0) u8g2.drawBox(16, 37, fillW, 6);
  // 提示居中
  u8g2.setFont(OLED_FONT_S);
  u8g2.drawUTF8((OLED_W - u8g2.getUTF8Width("正在启动…")) / 2, 58, "正在启动…");
  u8g2.sendBuffer();
}

void oledUiBegin() {
  // BOOT 按键：平时高电平，按下为低电平；只在启动后读，不影响 strapping 采样。
  pinMode(PIN_BOOT_BTN, INPUT_PULLUP);
  u8g2.begin();
  // 启动页淡入：先画好启动页（进度条 0%），对比度从 0 慢慢 ramp 到 255（约 220ms），
  //   画面从黑里亮出来；主循环随后按快照重绘。
  u8g2.setContrast(0);
  drawSplashFrame(0.0f);
  for (int c = 0; c <= 255; c += 25) {
    u8g2.setContrast((uint8_t)c);
    delay(20);
  }
  u8g2.setContrast(255);
  s_lastSwitchMs = millis();
  s_lastActivityMs = millis();  // 待机计时从开机起算：10 秒没人按就进待机拖拉机
}

void oledUiSplashProgress(float frac) {
  drawSplashFrame(frac);
}

int oledUiTick(const OledPageData &d) {
  uint32_t now = millis();
  int action = OLED_ACTION_NONE;

  // 答案变了 → 重新换行，问答回到第 1 页（放按钮处理前面，让翻页逻辑用新的页数）。
  // 新答案到达也算一次“操作”：用户要读答案，待机计时重算。
  if (strcmp(d.lastAnswer, s_lastDrawn.lastAnswer) != 0) {
    rewrapAnswer(d.lastAnswer);
    s_chatSub = 0;
    s_lastActivityMs = now;
  }

  // ---- BOOT 按键：消抖 + 短按翻页 / 长按提问 ----
  bool level = digitalRead(PIN_BOOT_BTN);
  if (level != s_btnLast) {
    s_btnLast = level;
    s_btnChangeMs = now;
  }
  if (now - s_btnChangeMs >= OLED_DEBOUNCE_MS && level != s_btnStable) {
    s_btnStable = level;
    s_lastActivityMs = now;  // 任何按键动作都算操作，待机计时重算
    if (level == LOW) {
      s_btnDownMs = now;
      s_btnPressed = true;
      if (s_standby) {
        // 待机中按一下：只唤醒，不翻页、不提问；这次按下被“消耗”掉。
        s_standby = false;
        s_wakeConsumed = true;
        s_haveDrawn = false;  // 唤醒后强制重画页面（屏上现在是拖拉机）
      }
    } else if (s_btnPressed) {
      s_btnPressed = false;
      if (s_wakeConsumed) {
        s_wakeConsumed = false;  // 唤醒那一下，松开时不触发任何操作
      } else if (now - s_btnDownMs >= OLED_LONG_PRESS_MS) {
        action = OLED_ACTION_ASK_PRESET_0;  // 长按：问第一条预设问题
        s_chatSub = 0;  // 新问题来了，问答回到第 1 页
      } else {
        // 短按翻页：问答页先翻答案子页（不做滑动，翻答案要快），翻完再到下一主页面；
        //   其他页直接到下一主页面。主页面切换时启动滑动切页动画。
        if (s_page == 2 && s_chatSub < chatPageCount() - 1) {
          s_chatSub++;
        } else {
          int oldPage = s_page, oldSub = s_chatSub;
          // 从问答页翻到状态页：问答答案自动清除，不保留（回到问答页重新开始问）。
          if (s_page == 2) action = OLED_ACTION_CLEAR_CHAT;
          s_page = (s_page + 1) % OLED_PAGE_COUNT;
          s_chatSub = 0;
          if (s_animActive) {
            // 上一个滑动还没跑完：先把它收尾（显存留到目标页），再开新的。
            renderPageContent(d);
            u8g2.sendBuffer();
            s_animActive = false;
          }
          animStart(oldPage, oldSub, s_page, s_chatSub, d);
        }
        s_lastSwitchMs = now;
      }
    }
  }

  // 注意：不自动轮换，只手动换页（用户要求）。

  // ---- 待机：10 秒无操作（且不在诊断中）自动进入，全屏拖拉机 ----
  if (!s_standby && !d.chatBusy && (now - s_lastActivityMs >= OLED_STANDBY_MS)) {
    s_standby = true;
    s_standbyStartMs = now;  // 开场动画从这一刻计时
    if (s_animActive) s_animActive = false;  // 正在滑页就停掉，切到待机眼睛
  }

  // ---- 待机中：只画拖拉机动画（轮子转、冒烟），不画页面；每 50ms 重绘一帧（20fps） ----
  static uint32_t s_lastStandbyMs = 0;
  if (s_standby) {
    if (now - s_lastStandbyMs >= OLED_ANIM_MS) {
      s_lastStandbyMs = now;
      u8g2.clearBuffer();
      u8g2.setFont(OLED_FONT_S);
      drawStandbyTractor(now);
      u8g2.sendBuffer();
    }
    return action;
  }

  // ---- 滑动动画进行中：每轮推进一帧（非阻塞，millis 计时），不走下面的按需重绘 ----
  static int lastPageDrawn = -1;
  static int lastSubDrawn = -1;
  if (s_animActive) {
    if (!animFrame(d, now)) {
      // 动画刚结束：同步重绘状态，避免下一轮重复画。
      s_lastDrawn = d;
      s_haveDrawn = true;
      lastPageDrawn = s_page;
      lastSubDrawn = s_chatSub;
    }
    return action;
  }

  // ---- 按需重绘：翻页（含问答子页）或内容变化时才刷（全屏 I2C 传输不便宜）----
  // 动效要定时刷：诊断中转圈（100ms 一格）、问答空闲页眼睛眨眼/左右看。
  //   只在动效可见时才定时刷，平时仍按需重绘，不拖慢主循环。
  static uint32_t s_lastAnimRedrawMs = 0;
  bool animVisible = (s_page == 2) &&
                     (d.chatBusy || (!d.lastQuestion[0] && s_ansLineCount == 0));
  bool animTick = animVisible && (now - s_lastAnimRedrawMs >= OLED_ANIM_MS);
  if (animTick) s_lastAnimRedrawMs = now;
  bool pageChanged = (s_page != lastPageDrawn) || (s_chatSub != lastSubDrawn);
  if (!s_haveDrawn || pageChanged || snapshotChanged(d, s_lastDrawn) || animTick) {
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

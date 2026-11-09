// 司稼小机器人 RV0.1.0 — 0.96 寸 OLED 显示 UI（第二个显示版本）
// 硬件：SSD1315 128x64，I2C，地址 0x3C（模块跳线标 0x78 是 8 位写地址）；
//   SDA/SCL 见 display_config.h（C3：SDA=GPIO12、SCL=GPIO13）。
// 驱动：U8g2 全缓冲模式；字库：U8g2 自带 wqy16（GB2312，16px）。
// 页面：3 页，每页 3–4 行，16px 行高；每 5 秒自动轮换；BOOT 按键（GPIO9）
//   短按手动切页，长按（≥800ms）问第一条预设问题。
// 本模块只做渲染：主循环每轮把共享状态抄进 OledPageData 传进来；
// 不碰网络、不碰 LVGL、不直接读共享变量（快照以外的状态）。

#pragma once

#include <Arduino.h>

// 主循环 → OLED 的快照（按值拷贝；OLED 只读）。
struct OledPageData {
  bool wifiConnected = false;  // WiFi 链路是否已连
  bool online = false;         // 健康检查是否通过（在线 / 服务器不通 / 离线）
  char ssid[32] = "";
  char ip[16] = "";
  char scenario[24] = "";      // 如“正常运行”
  // 遥测三通道：OLED 上用短标签（水温/油压/转速），一行放得下数值+状态。
  const char *teleLabel[3] = {nullptr, nullptr, nullptr};
  bool teleValid[3] = {false, false, false};
  float teleValue[3] = {NAN, NAN, NAN};
  char teleUnit[3][8] = {"", "", ""};
  int telePrecision[3] = {0, 0, 0};
  int teleState[3] = {-1, -1, -1};  // -1 无数据，0 正常，1 注意，2 报警
  char lastQuestion[64] = "";  // 最后一问（绘制时再按宽度截断）
  char lastAnswer[160] = "";   // 最后答案（已去 Markdown；绘制时按宽度换行取前两行）
  bool chatBusy = false;       // 正在诊断
};

// oledUiTick() 返回值：主循环据此执行动作。
#define OLED_ACTION_NONE 0
#define OLED_ACTION_ASK_PRESET_0 1  // BOOT 长按：问第一条预设问题

void oledUiBegin();                     // 初始化 I2C + SSD1306，显示启动页
int oledUiTick(const OledPageData &d);  // 每轮调用：处理按键/轮换，按需重绘

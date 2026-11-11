#include "wifi_panel.h"

#if !defined(USE_OLED_DISPLAY) || !USE_OLED_DISPLAY

#include <WiFi.h>

#if !LV_USE_TEXTAREA || !LV_USE_KEYBOARD || !LV_USE_BUTTONMATRIX
#error "wifi_panel requires LV_USE_TEXTAREA, LV_USE_KEYBOARD and LV_USE_BUTTONMATRIX"
#endif

LV_FONT_DECLARE(font_zh_16);
LV_FONT_DECLARE(font_zh_12);

namespace {
constexpr uint8_t kMaxNetworks = 12;
constexpr uint32_t kTickMs = 1000;
constexpr uint32_t kConnectWaitMs = 30000;
struct NetworkRow {
  String ssid;
  int32_t rssi = -127;
  bool open = false;
};
NetworkRow networks[kMaxNetworks];
uint8_t networkCount = 0;
WifiPanelSubmit submitCredentials = nullptr;
lv_obj_t *panel = nullptr, *list = nullptr, *status = nullptr, *refresh = nullptr;
lv_obj_t *inputLayer = nullptr, *networkTitle = nullptr, *password = nullptr;
lv_obj_t *keyboard = nullptr, *inputStatus = nullptr;
String selectedSsid, pendingSsid, lastStatus;
bool scanning = false, firstScan = true;
uint32_t lastTick = 0, submittedAt = 0;

lv_color_t bg() { return lv_color_hex(0xF3F6FB); }
lv_color_t card() { return lv_color_hex(0xFFFFFF); }
lv_color_t ink() { return lv_color_hex(0x172B45); }
lv_color_t muted() { return lv_color_hex(0x536780); }
lv_color_t line() { return lv_color_hex(0xDCE5EF); }
lv_color_t blue() { return lv_color_hex(0x2863D6); }

lv_obj_t *makeLabel(lv_obj_t *parent, const char *text,
                    const lv_font_t *font = &font_zh_16) {
  lv_obj_t *label = lv_label_create(parent);
  lv_obj_set_style_text_font(label, font, 0);
  lv_obj_set_style_text_color(label, ink(), 0);
  lv_label_set_text(label, text);
  return label;
}

lv_obj_t *makeButton(lv_obj_t *parent, const char *text, int width, int height,
                     bool primary, lv_event_cb_t callback) {
  lv_obj_t *button = lv_button_create(parent);
  lv_obj_set_size(button, width, height);
  lv_obj_set_style_bg_color(button, primary ? blue() : card(), 0);
  lv_obj_set_style_bg_color(button, lv_color_hex(primary ? 0x1E50B5 : 0xEDF3FF), LV_STATE_PRESSED);
  lv_obj_set_style_border_color(button, primary ? blue() : line(), 0);
  lv_obj_set_style_border_width(button, 1, 0);
  lv_obj_set_style_radius(button, 6, 0);
  lv_obj_set_style_shadow_width(button, 0, 0);
  lv_obj_set_style_pad_all(button, 3, 0);
  lv_obj_t *label = makeLabel(button, text);
  lv_obj_set_style_text_color(label, primary ? card() : ink(), 0);
  lv_obj_center(label);
  lv_obj_add_event_cb(button, callback, LV_EVENT_CLICKED, nullptr);
  return button;
}

void setStatus(const String &text) {
  if (status && text != lastStatus) {
    lv_label_set_text(status, text.c_str());
    lastStatus = text;
  }
}

void closeInput() {
  if (!inputLayer) return;
  lv_keyboard_set_textarea(keyboard, nullptr);
  lv_textarea_set_text(password, "");
  selectedSsid = "";
  lv_obj_add_flag(inputLayer, LV_OBJ_FLAG_HIDDEN);
}

bool submitNetwork(const String &ssid, const String &pass) {
  if (!submitCredentials || !submitCredentials(ssid, pass)) {
    setStatus("连接请求未提交，请重试");
    return false;
  }
  pendingSsid = ssid;
  submittedAt = millis();
  setStatus(String("正在连接：") + ssid);
  return true;
}

void connectInput() {
  const String ssid = selectedSsid;
  const String pass = lv_textarea_get_text(password);
  if (pass.length() == 0) {
    lv_label_set_text(inputStatus, "请输入密码");
    return;
  }
  if (submitNetwork(ssid, pass)) closeInput();
  else lv_label_set_text(inputStatus, "请稍后重试");
}

void onConnect(lv_event_t *) { connectInput(); }
void onBack(lv_event_t *) { closeInput(); }
void onKeyboard(lv_event_t *event) {
  const lv_event_code_t code = lv_event_get_code(event);
  if (code == LV_EVENT_READY) connectInput();
  else if (code == LV_EVENT_CANCEL) closeInput();
}

void buildInputLayer() {
  inputLayer = lv_obj_create(lv_layer_top());
  lv_obj_set_size(inputLayer, 320, 240);
  lv_obj_set_pos(inputLayer, 0, 0);
  lv_obj_set_style_bg_color(inputLayer, bg(), 0);
  lv_obj_set_style_bg_opa(inputLayer, LV_OPA_COVER, 0);
  lv_obj_set_style_border_width(inputLayer, 0, 0);
  lv_obj_set_style_radius(inputLayer, 0, 0);
  lv_obj_set_style_pad_all(inputLayer, 0, 0);
  lv_obj_remove_flag(inputLayer, LV_OBJ_FLAG_SCROLLABLE);

  networkTitle = makeLabel(inputLayer, "");
  lv_obj_set_pos(networkTitle, 8, 4);
  lv_obj_set_width(networkTitle, 236);
  lv_label_set_long_mode(networkTitle, LV_LABEL_LONG_DOT);
  lv_obj_t *back = makeButton(inputLayer, "返回", 62, 26, false, onBack);
  lv_obj_set_pos(back, 250, 2);

  password = lv_textarea_create(inputLayer);
  lv_obj_set_pos(password, 8, 32);
  lv_obj_set_size(password, 304, 34);
  lv_obj_set_style_text_font(password, &lv_font_montserrat_16, 0);
  lv_obj_set_style_bg_color(password, card(), 0);
  lv_obj_set_style_border_width(password, 1, 0);
  lv_obj_set_style_border_color(password, line(), 0);
  lv_obj_set_style_radius(password, 6, 0);
  lv_obj_set_style_pad_all(password, 6, 0);
  lv_textarea_set_one_line(password, true);
  lv_textarea_set_password_mode(password, true);
  lv_textarea_set_password_bullet(password, "*");
  lv_textarea_set_password_show_time(password, 0);
  lv_textarea_set_max_length(password, 64);
  lv_textarea_set_placeholder_text(password, "Password");

  inputStatus = makeLabel(inputLayer, "输入密码后连接");
  lv_obj_set_pos(inputStatus, 8, 76);
  lv_obj_set_width(inputStatus, 220);
  lv_label_set_long_mode(inputStatus, LV_LABEL_LONG_DOT);
  lv_obj_t *connect = makeButton(inputLayer, "连接", 76, 30, true, onConnect);
  lv_obj_set_pos(connect, 236, 70);

  keyboard = lv_keyboard_create(inputLayer);
  lv_obj_set_pos(keyboard, 0, 104);
  lv_obj_set_size(keyboard, 320, 136);
  // Keep LVGL's built-in font for its keyboard symbols and ASCII characters.
  lv_obj_set_style_text_font(keyboard, &lv_font_montserrat_16, LV_PART_ITEMS);
  lv_obj_set_style_bg_color(keyboard, bg(), 0);
  lv_obj_set_style_bg_color(keyboard, card(), LV_PART_ITEMS);
  lv_obj_set_style_bg_color(keyboard, lv_color_hex(0xEDF3FF), LV_PART_ITEMS | LV_STATE_PRESSED);
  lv_obj_set_style_text_color(keyboard, ink(), LV_PART_ITEMS);
  lv_obj_set_style_shadow_width(keyboard, 0, LV_PART_ITEMS);
  lv_keyboard_set_mode(keyboard, LV_KEYBOARD_MODE_TEXT_LOWER);
  lv_keyboard_set_popovers(keyboard, false);
  lv_obj_add_event_cb(keyboard, onKeyboard, LV_EVENT_ALL, nullptr);
  lv_obj_add_flag(inputLayer, LV_OBJ_FLAG_HIDDEN);
}

void onNetwork(lv_event_t *event) {
  const int index = static_cast<int>(reinterpret_cast<intptr_t>(lv_event_get_user_data(event)));
  if (index < 0 || index >= networkCount) return;
  const NetworkRow &row = networks[index];
  if (row.open) {
    submitNetwork(row.ssid, String());
    return;
  }
  if (!inputLayer) buildInputLayer();
  selectedSsid = row.ssid;
  lv_label_set_text(networkTitle, selectedSsid.c_str());
  lv_label_set_text(inputStatus, "输入密码后连接");
  lv_textarea_set_text(password, "");
  lv_keyboard_set_mode(keyboard, LV_KEYBOARD_MODE_TEXT_LOWER);
  lv_keyboard_set_textarea(keyboard, password);
  lv_obj_add_state(password, LV_STATE_FOCUSED);
  lv_obj_remove_flag(inputLayer, LV_OBJ_FLAG_HIDDEN);
  lv_obj_move_foreground(inputLayer);
}

void showNetworks(int count) {
  networkCount = 0;
  // Arduino's per-result accessor uses uint8_t; never wrap an index > 255.
  for (int i = 0; i < count && i < 256; ++i) {
    const String ssid = WiFi.SSID(static_cast<uint8_t>(i));
    if (ssid.length() == 0) continue;
    const int32_t rssi = WiFi.RSSI(static_cast<uint8_t>(i));
    int target = -1;
    for (uint8_t j = 0; j < networkCount; ++j) {
      if (networks[j].ssid == ssid) { target = j; break; }
    }
    if (target >= 0) {
      if (rssi <= networks[target].rssi) continue;
    } else if (networkCount < kMaxNetworks) {
      target = networkCount++;
    } else {
      int weakest = 0;
      for (uint8_t j = 1; j < networkCount; ++j)
        if (networks[j].rssi < networks[weakest].rssi) weakest = j;
      if (rssi <= networks[weakest].rssi) continue;
      target = weakest;
    }
    networks[target].ssid = ssid;
    networks[target].rssi = rssi;
    networks[target].open = WiFi.encryptionType(static_cast<uint8_t>(i)) == WIFI_AUTH_OPEN;
  }
  for (uint8_t i = 0; i < networkCount; ++i) {
    for (uint8_t j = i + 1; j < networkCount; ++j) {
      if (networks[j].rssi > networks[i].rssi) {
        NetworkRow tmp = networks[i]; networks[i] = networks[j]; networks[j] = tmp;
      }
    }
  }
  WiFi.scanDelete();
  const String connectedSsid = WiFi.status() == WL_CONNECTED ? WiFi.SSID() : String();
  lv_obj_clean(list);
  for (uint8_t i = 0; i < networkCount; ++i) {
    lv_obj_t *row = lv_button_create(list);
    lv_obj_set_width(row, lv_pct(100));
    lv_obj_set_height(row, LV_SIZE_CONTENT);
    lv_obj_set_style_min_height(row, 40, 0);
    const bool connected = networks[i].ssid == connectedSsid;
    lv_obj_set_style_bg_color(row, connected ? lv_color_hex(0xEDF3FF) : card(), 0);
    lv_obj_set_style_bg_color(row, lv_color_hex(0xEDF3FF), LV_STATE_PRESSED);
    lv_obj_set_style_border_width(row, 1, 0);
    lv_obj_set_style_border_color(row, line(), 0);
    lv_obj_set_style_radius(row, 6, 0);
    lv_obj_set_style_shadow_width(row, 0, 0);
    lv_obj_set_style_pad_all(row, 6, 0);
    lv_obj_set_style_pad_gap(row, 4, 0);
    lv_obj_set_layout(row, LV_LAYOUT_FLEX);
    lv_obj_set_flex_flow(row, LV_FLEX_FLOW_ROW);
    lv_obj_set_flex_align(row, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    lv_obj_t *name = makeLabel(row, networks[i].ssid.c_str());
    lv_obj_set_width(name, 0);
    lv_obj_set_flex_grow(name, 1);
    lv_label_set_long_mode(name, LV_LABEL_LONG_WRAP);
    char meta[32];
    snprintf(meta, sizeof(meta), "%ld dBm\n%s", (long)networks[i].rssi, connected ? "已连接" : networks[i].open ? "开放" : "加密");
    lv_obj_t *signal = makeLabel(row, meta, &font_zh_12);
    lv_obj_set_width(signal, 60);
    lv_obj_set_style_text_align(signal, LV_TEXT_ALIGN_RIGHT, 0);
    lv_obj_set_style_text_color(signal, muted(), 0);
    lv_obj_add_event_cb(row, onNetwork, LV_EVENT_CLICKED, reinterpret_cast<void *>(static_cast<intptr_t>(i)));
  }
  if (!networkCount) makeLabel(list, "没有发现网络，请刷新");
}

void startScan() {
  if (scanning) return;
  if (WiFi.getMode() != WIFI_MODE_STA) {
    setStatus("联网准备中，请稍后刷新");
    return;
  }
  const int existing = WiFi.scanComplete();
  if (existing != WIFI_SCAN_RUNNING) WiFi.scanDelete();
  const int result = existing == WIFI_SCAN_RUNNING ? WIFI_SCAN_RUNNING : WiFi.scanNetworks(true);
  if (result == WIFI_SCAN_FAILED) {
    setStatus("扫描失败，请稍后刷新");
    return;
  }
  scanning = true;
  lv_obj_add_state(refresh, LV_STATE_DISABLED);
  setStatus("正在扫描附近网络…");
}

void onRefresh(lv_event_t *) { startScan(); }

void onDelete(lv_event_t *event) {
  if (lv_event_get_target(event) != panel) return;
  if (inputLayer) lv_obj_delete(inputLayer);
  panel = list = status = refresh = nullptr;
  inputLayer = networkTitle = password = keyboard = inputStatus = nullptr;
  submitCredentials = nullptr;
  selectedSsid = pendingSsid = lastStatus = "";
  scanning = false;
}
}  // namespace

lv_obj_t *wifiPanelCreate(lv_obj_t *parent, WifiPanelSubmit submit) {
  if (panel) return panel;
  submitCredentials = submit;
  firstScan = true;
  lastTick = 0;
  panel = lv_obj_create(parent);
  lv_obj_set_size(panel, lv_pct(100), lv_pct(100));
  lv_obj_set_style_bg_color(panel, bg(), 0);
  lv_obj_set_style_border_width(panel, 0, 0);
  lv_obj_set_style_radius(panel, 0, 0);
  lv_obj_set_style_pad_all(panel, 6, 0);
  lv_obj_set_style_pad_gap(panel, 4, 0);
  lv_obj_set_layout(panel, LV_LAYOUT_FLEX);
  lv_obj_set_flex_flow(panel, LV_FLEX_FLOW_COLUMN);
  lv_obj_remove_flag(panel, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_add_event_cb(panel, onDelete, LV_EVENT_DELETE, nullptr);

  lv_obj_t *heading = lv_obj_create(panel);
  lv_obj_set_size(heading, lv_pct(100), 28);
  lv_obj_remove_flag(heading, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_set_style_bg_opa(heading, LV_OPA_TRANSP, 0);
  lv_obj_set_style_border_width(heading, 0, 0);
  lv_obj_set_style_pad_all(heading, 0, 0);
  lv_obj_set_layout(heading, LV_LAYOUT_FLEX);
  lv_obj_set_flex_flow(heading, LV_FLEX_FLOW_ROW);
  lv_obj_set_flex_align(heading, LV_FLEX_ALIGN_SPACE_BETWEEN, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
  makeLabel(heading, "Wi-Fi 网络");
  refresh = makeButton(heading, "刷新", 66, 28, false, onRefresh);

  list = lv_obj_create(panel);
  lv_obj_set_width(list, lv_pct(100));
  lv_obj_set_height(list, 0);
  lv_obj_set_flex_grow(list, 1);
  lv_obj_set_style_bg_opa(list, LV_OPA_TRANSP, 0);
  lv_obj_set_style_border_width(list, 0, 0);
  lv_obj_set_style_pad_all(list, 0, 0);
  lv_obj_set_style_pad_gap(list, 4, 0);
  lv_obj_set_layout(list, LV_LAYOUT_FLEX);
  lv_obj_set_flex_flow(list, LV_FLEX_FLOW_COLUMN);
  lv_obj_set_scroll_dir(list, LV_DIR_VER);
  lv_obj_set_scrollbar_mode(list, LV_SCROLLBAR_MODE_AUTO);
  makeLabel(list, "正在准备网络列表…");
  status = makeLabel(panel, "点网络名称连接");
  lv_obj_set_width(status, lv_pct(100));
  lv_obj_set_style_text_color(status, muted(), 0);
  lv_label_set_long_mode(status, LV_LABEL_LONG_DOT);
  lastStatus = "点网络名称连接";
  return panel;
}

void wifiPanelTick() {
  if (!panel) return;
  const uint32_t now = millis();
  if (now - lastTick < kTickMs) return;
  lastTick = now;
  if (firstScan && lv_obj_is_visible(panel) && WiFi.getMode() == WIFI_MODE_STA) {
    firstScan = false;
    startScan();
  }
  if (scanning) {
    const int result = WiFi.scanComplete();
    if (result != WIFI_SCAN_RUNNING) {
      scanning = false;
      lv_obj_remove_state(refresh, LV_STATE_DISABLED);
      if (result >= 0) {
        showNetworks(result);
        setStatus(String("发现 ") + networkCount + " 个网络，点名称连接");
      } else setStatus("扫描失败，请刷新重试");
    }
    return;
  }
  const bool connected = WiFi.status() == WL_CONNECTED;
  const String ssid = connected ? WiFi.SSID() : String();
  if (pendingSsid.length()) {
    if (connected && ssid == pendingSsid) {
      pendingSsid = "";
      setStatus(String("已连接：") + ssid);
    } else if (now - submittedAt >= kConnectWaitMs) {
      pendingSsid = "";
      setStatus("未连上，请点网络重试");
    }
  } else if (connected) setStatus(String("已连接：") + ssid);
  else if (lastStatus.startsWith("已连接：")) setStatus("网络已断开，请重新连接");
}

bool wifiPanelInputOpen() {
  return inputLayer && !lv_obj_has_flag(inputLayer, LV_OBJ_FLAG_HIDDEN);
}

#else
lv_obj_t *wifiPanelCreate(lv_obj_t *, WifiPanelSubmit) { return nullptr; }
void wifiPanelTick() {}
bool wifiPanelInputOpen() { return false; }
#endif

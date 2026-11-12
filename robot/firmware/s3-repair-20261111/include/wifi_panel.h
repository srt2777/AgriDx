#pragma once

#include <Arduino.h>
#if defined(USE_OLED_DISPLAY) && USE_OLED_DISPLAY
struct _lv_obj_t;
typedef struct _lv_obj_t lv_obj_t;
#else
#include <lvgl.h>
#endif

// Return true after copying/queueing the credentials; false leaves input open.
// The owner is responsible for NVS persistence and its network task connection.
using WifiPanelSubmit = bool (*)(const String &ssid, const String &password);

// One panel per screen. Both functions must run on the LVGL/main thread.
// Requires LV_USE_TEXTAREA, LV_USE_KEYBOARD and LV_USE_BUTTONMATRIX = 1.
lv_obj_t *wifiPanelCreate(lv_obj_t *parent, WifiPanelSubmit submit);
void wifiPanelTick();

// Keep credential entry visible while the user is typing.
bool wifiPanelInputOpen();

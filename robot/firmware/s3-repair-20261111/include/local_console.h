#pragma once

#include <Arduino.h>

// Local Wi-Fi OTA only. No HTTP server, browser console or access point.
// Call Begin once in setup, and Loop from the same main loop as LVGL.
void localConsoleBegin();
void localConsoleLoop();

// Called only from the authorized serial OTAPASS command. Accepts 16–128
// printable ASCII characters; persists SHA256, never the plaintext password.
// Returns false on invalid input or NVS failure. Never logs the password/hash.
bool localConsoleSetOtaPassword(const String &password);

// Empty while STA is disconnected. Use this IP with the core's espota.py.
String localConsoleAddress();
bool localConsoleOtaConfigured();
bool localConsoleOtaEnabled();
bool localConsoleOtaBusy();

#include "local_console.h"

#if defined(ARDUINO_ARCH_ESP32) && defined(CONFIG_IDF_TARGET_ESP32S3)

#include <ArduinoOTA.h>
#include <Preferences.h>
#include <SHA2Builder.h>
#include <WiFi.h>

namespace {
constexpr char kNvsNamespace[] = "sijia-local";
constexpr char kPasswordKey[] = "ota_sha256";
constexpr char kHostname[] = "sijia-robot";
constexpr uint32_t kNetworkCheckMs = 1000;
String otaHash;
IPAddress activeIp;
bool initialized = false;
bool otaEnabled = false;
bool otaBusy = false;
uint32_t lastNetworkCheck = 0;
uint32_t otaStarted = 0;
uint32_t otaYieldAt = 0;
uint32_t otaReportAt = 0;
wifi_ps_type_t previousSleep = WIFI_PS_MIN_MODEM;

void finishTransfer() {
  if (otaBusy) WiFi.setSleep(previousSleep);
  otaBusy = false;
}

bool validHash(const String &value) {
  if (value.length() != 64) return false;
  for (size_t i = 0; i < value.length(); ++i) {
    const char c = value[i];
    if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
  }
  return true;
}

bool validPassword(const String &value) {
  if (value.length() < 16 || value.length() > 128) return false;
  for (size_t i = 0; i < value.length(); ++i) {
    const uint8_t c = static_cast<uint8_t>(value[i]);
    if (c < 0x20 || c > 0x7e) return false;
  }
  return true;
}

bool staConnected() {
  // ArduinoOTA binds its UDP listener to all interfaces. Refuse to run in
  // AP/AP+STA mode so this service is available only on the existing STA LAN.
  return WiFi.getMode() == WIFI_MODE_STA && WiFi.status() == WL_CONNECTED &&
         WiFi.localIP() != IPAddress(0, 0, 0, 0);
}

void stopOta() {
  if (otaEnabled) ArduinoOTA.end();
  otaEnabled = false;
  finishTransfer();
  activeIp = IPAddress();
}

void updateListener() {
  if (!validHash(otaHash) || !staConnected()) {
    stopOta();
    return;
  }
  const IPAddress ip = WiFi.localIP();
  if (otaEnabled && activeIp == ip) return;
  stopOta();
  ArduinoOTA.setHostname(kHostname);
  ArduinoOTA.setPort(3232);
  // Arduino core 3.3.12 uses SHA256/PBKDF2 authentication. A missing or invalid
  // digest never reaches begin(), so no passwordless OTA listener is created.
  ArduinoOTA.setPasswordHash(otaHash.c_str());
  ArduinoOTA.setRebootOnSuccess(true);
  ArduinoOTA.setTimeout(3000);
  ArduinoOTA.onStart([]() {
    otaBusy = true;
    otaStarted = millis();
    otaYieldAt = 0;
    otaReportAt = 0;
    previousSleep = WiFi.getSleep();
    WiFi.setSleep(WIFI_PS_NONE);
    Serial.println("[ota] update started");
  });
  ArduinoOTA.onProgress([](unsigned written, unsigned total) {
    if (written - otaYieldAt >= 64 * 1024) {
      otaYieldAt = written;
      delay(1);  // Let the idle task run even under a continuous TCP stream.
    }
    if (written - otaReportAt >= 512 * 1024) {
      otaReportAt = written;
      Serial.printf("[ota] progress=%u/%u\n", written, total);
    }
  });
  ArduinoOTA.onEnd([]() {
    finishTransfer();
    Serial.printf("[ota] verified elapsed_ms=%lu\n", (unsigned long)(millis() - otaStarted));
  });
  ArduinoOTA.onError([](ota_error_t error) {
    finishTransfer();
    Serial.printf("[ota] error=%u\n", (unsigned)error);
  });
  ArduinoOTA.begin();
  activeIp = ip;
  otaEnabled = true;
}
}  // namespace

void localConsoleBegin() {
  if (initialized) return;
  initialized = true;
  Preferences prefs;
  if (prefs.begin(kNvsNamespace, true)) {
    otaHash = prefs.getString(kPasswordKey, "");
    prefs.end();
  }
  if (!validHash(otaHash)) otaHash = "";
  updateListener();
  lastNetworkCheck = millis();
}

void localConsoleLoop() {
  if (!initialized) return;
  const uint32_t now = millis();
  if (now - lastNetworkCheck >= kNetworkCheckMs) {
    lastNetworkCheck = now;
    updateListener();
  }
  if (otaEnabled) {
    // Recheck the interface before handling any packet, even between polls.
    if (!staConnected()) stopOta();
    else ArduinoOTA.handle();
  }
}

bool localConsoleSetOtaPassword(const String &password) {
  if (otaBusy || !validPassword(password)) return false;
  SHA256Builder hash;
  hash.begin();
  hash.add(password.c_str());
  hash.calculate();
  const String digest = hash.toString();
  if (!validHash(digest)) return false;
  Preferences prefs;
  if (!prefs.begin(kNvsNamespace, false)) return false;
  const bool saved = prefs.putString(kPasswordKey, digest) == digest.length() &&
                     prefs.getString(kPasswordKey, "") == digest;
  prefs.end();
  if (!saved) return false;
  stopOta();
  otaHash = digest;
  if (initialized) updateListener();
  return true;
}

String localConsoleAddress() {
  return staConnected() ? WiFi.localIP().toString() : String();
}
bool localConsoleOtaConfigured() { return validHash(otaHash); }
bool localConsoleOtaEnabled() { return otaEnabled && staConnected(); }
bool localConsoleOtaBusy() { return otaBusy; }

#else

// Preserve existing C3/OLED builds without adding a new network service.
void localConsoleBegin() {}
void localConsoleLoop() {}
bool localConsoleSetOtaPassword(const String &) { return false; }
String localConsoleAddress() { return String(); }
bool localConsoleOtaConfigured() { return false; }
bool localConsoleOtaEnabled() { return false; }
bool localConsoleOtaBusy() { return false; }

#endif

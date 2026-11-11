#pragma once

#include <stdint.h>

struct TelemetryStreamChannel {
  float value;
  float minValue, maxValue;
  float attentionAbove, attentionBelow, alarmAbove, alarmBelow;
  bool hasAttention, hasAlarm, valid;
  uint8_t precision;
  char unit[8];
};

struct TelemetrySnapshot {
  // Fixed order: coolant, oil pressure, engine RPM.
  TelemetryStreamChannel channels[3];
  float coolantTrend[60];
  float oilTrend[60];
  float rpmTrend[60];
  uint8_t trendCount;
  uint32_t sequence;       // Local revision; changes only for a complete sample.
  uint32_t receivedAtMs;   // Local millis(), for disconnect/stale detection.
  uint64_t sampleAt;       // Server sample timestamp in milliseconds.
  bool simulated;
  bool connected;
  bool stale;             // True when disconnected or no sample for 5 seconds.
};

// Starts one independent core-0 task. Idempotent. Does not touch LVGL or Wi-Fi credentials.
bool telemetryStreamBegin(const char *baseUrl);
// Thread-safe copy. Returns false until at least one complete three-channel sample.
bool telemetryStreamRead(TelemetrySnapshot &out);

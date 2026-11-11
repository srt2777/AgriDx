#pragma once

// Pure protocol parser, shared by the ESP32 task and the host replay check.
#include "telemetry_stream.h"
#include <ArduinoJson.h>
#include <math.h>
#include <stddef.h>
#include <string.h>

class TelemetryProtocol {
 public:
  static constexpr size_t kMaxLine = 16 * 1024;
  static constexpr uint32_t kStaleAfterMs = 5000;

  explicit TelemetryProtocol(ArduinoJson::Allocator *allocator = nullptr)
      : allocator_(allocator) {
    memset(&snapshot_, 0, sizeof(snapshot_));
    for (auto &c : snapshot_.channels) resetChannel(c);
    snapshot_.stale = true;
  }

  void resetConnection() {
    lineLength_ = dataLength_ = 0;
    event_[0] = '\0';
    failed_ = false;
    catalogReady_ = false;
    snapshot_.connected = false;
    snapshot_.stale = true;
    snapshot_.trendCount = 0;  // A reconnect must not join samples across a data gap.
  }

  bool feed(char byte, uint32_t now) {
    if (failed_) return false;
    if (byte == '\r') return true;
    if (byte != '\n') {
      if (lineLength_ == kMaxLine) { failed_ = true; return false; }
      line_[lineLength_++] = byte;
      return true;
    }
    line_[lineLength_] = '\0';
    if (lineLength_ == 0) {
      if (dataLength_) {
        data_[dataLength_] = '\0';
        dispatch(now);
      }
      event_[0] = '\0';
      dataLength_ = 0;
    } else if (strncmp(line_, "event:", 6) == 0) {
      const char *value = line_ + 6;
      if (*value == ' ') ++value;
      strncpy(event_, value, sizeof(event_) - 1);
      event_[sizeof(event_) - 1] = '\0';
    } else if (strncmp(line_, "data:", 5) == 0) {
      const char *value = line_ + 5;
      if (*value == ' ') ++value;
      size_t count = strlen(value);
      if (dataLength_ + count + (dataLength_ ? 1 : 0) > kMaxLine) {
        failed_ = true;
        return false;
      }
      if (dataLength_) data_[dataLength_++] = '\n';
      memcpy(data_ + dataLength_, value, count);
      dataLength_ += count;
    }
    lineLength_ = 0;
    return true;
  }

  const TelemetrySnapshot &snapshot() const { return snapshot_; }
  uint32_t rejectedEvents() const { return rejected_; }

 private:
  static int channelIndex(const char *id) {
    if (!id) return -1;
    if (!strcmp(id, "diesel.engine.coolant")) return 0;
    if (!strcmp(id, "diesel.engine.oil-pressure")) return 1;
    if (!strcmp(id, "diesel.engine.rpm")) return 2;
    return -1;
  }
  static void resetChannel(TelemetryStreamChannel &c) {
    memset(&c, 0, sizeof(c));
    c.value = c.minValue = c.maxValue = NAN;
    c.attentionAbove = c.attentionBelow = c.alarmAbove = c.alarmBelow = NAN;
  }
  static float number(JsonVariantConst value) {
    return value.is<float>() || value.is<int>() || value.is<double>()
               ? value.as<float>() : NAN;
  }
  void dispatch(uint32_t now) {
    if (strcmp(event_, "catalog") && strcmp(event_, "telemetry") && strcmp(event_, "reset")) return;
    if (!strcmp(event_, "reset")) {
      // A server restart starts a new time series. Old samples remain visibly stale.
      snapshot_.trendCount = 0;
      snapshot_.connected = false;
      snapshot_.stale = true;
      return;
    }
    JsonDocument doc = allocator_ ? JsonDocument(allocator_) : JsonDocument();
    const auto error = deserializeJson(doc, data_, dataLength_, DeserializationOption::NestingLimit(12));
    if (error || doc["schemaVersion"].as<int>() != 1 ||
        strcmp(doc["source"] | "", "simulated")) { ++rejected_; return; }
    if (!strcmp(event_, "catalog")) {
      bool found[3] = {};
      for (JsonObjectConst item : doc["channels"].as<JsonArrayConst>()) {
        int i = channelIndex(item["id"] | "");
        if (i < 0 || strcmp(item["source"] | "", "simulated")) continue;
        auto &c = snapshot_.channels[i];
        c.minValue = number(item["range"]["min"]);
        c.maxValue = number(item["range"]["max"]);
        c.precision = (uint8_t)(item["precision"] | 0);
        if (c.precision > 2) c.precision = 2;
        strncpy(c.unit, item["unit"] | "", sizeof(c.unit) - 1);
        c.unit[sizeof(c.unit) - 1] = '\0';
        c.attentionAbove = number(item["threshold"]["attention"]["above"]);
        c.attentionBelow = number(item["threshold"]["attention"]["below"]);
        c.alarmAbove = number(item["threshold"]["alarm"]["above"]);
        c.alarmBelow = number(item["threshold"]["alarm"]["below"]);
        c.hasAttention = isfinite(c.attentionAbove) || isfinite(c.attentionBelow);
        c.hasAlarm = isfinite(c.alarmAbove) || isfinite(c.alarmBelow);
        found[i] = isfinite(c.minValue) && isfinite(c.maxValue) && c.maxValue > c.minValue;
      }
      catalogReady_ = found[0] && found[1] && found[2];
      if (!catalogReady_) ++rejected_;
      return;
    }
    if (!catalogReady_) { ++rejected_; return; }
    const uint64_t at = doc["at"] | uint64_t(0);
    if (!at || (snapshot_.connected && at <= snapshot_.sampleAt)) { ++rejected_; return; }
    float values[3] = {NAN, NAN, NAN};
    for (JsonObjectConst point : doc["points"].as<JsonArrayConst>()) {
      int i = channelIndex(point["channelId"] | "");
      if (i < 0 || strcmp(point["source"] | "", "simulated")) continue;
      values[i] = number(point["value"]);
    }
    if (!isfinite(values[0]) || !isfinite(values[1]) || !isfinite(values[2])) { ++rejected_; return; }
    for (int i = 0; i < 3; ++i) {
      snapshot_.channels[i].value = values[i];
      snapshot_.channels[i].valid = true;
    }
    float *trends[] = {snapshot_.coolantTrend, snapshot_.oilTrend, snapshot_.rpmTrend};
    for (int i = 0; i < 3; ++i) {
      if (snapshot_.trendCount == 60) {
        memmove(trends[i], trends[i] + 1, sizeof(float) * 59);
        trends[i][59] = values[i];
      } else trends[i][snapshot_.trendCount] = values[i];
    }
    if (snapshot_.trendCount < 60) ++snapshot_.trendCount;
    snapshot_.sampleAt = at;
    snapshot_.receivedAtMs = now;
    snapshot_.simulated = snapshot_.connected = true;
    snapshot_.stale = false;
    ++snapshot_.sequence;
  }

  ArduinoJson::Allocator *allocator_;
  TelemetrySnapshot snapshot_;
  char line_[kMaxLine + 1] = {};
  char data_[kMaxLine + 1] = {};
  char event_[24] = {};
  size_t lineLength_ = 0, dataLength_ = 0;
  bool catalogReady_ = false, failed_ = false;
  uint32_t rejected_ = 0;
};

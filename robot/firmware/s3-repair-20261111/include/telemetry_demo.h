#pragma once
#include "telemetry_stream.h"
#include <math.h>
#include <string.h>

// Explicitly local simulated enhancement; never apply to real or stale samples.
// One gradual 24-second fault per 150 seconds, alternating hot coolant / low oil.
// Use sample time (not render frequency), retain server provenance and thresholds.
class TelemetryDemo {
 public:
  void apply(TelemetrySnapshot &s) {
    if (!s.simulated || s.stale || !s.connected) { count_ = 0; return; }
    if (lastAt_ && (s.sampleAt <= lastAt_ || s.sampleAt - lastAt_ > 5000)) count_ = 0;
    lastAt_ = s.sampleAt;
    const double seconds = s.sampleAt / 1000.0;
    const double phase = fmod(seconds, 150.0);
    const float pulse = phase >= 90 && phase < 114
        ? sinf((phase - 90) * 3.14159265f / 24) : 0;
    s.channels[0].value += 3.5f * sinf(seconds * 0.20f);
    s.channels[1].value += 12.0f * sinf(seconds * 0.27f);
    s.channels[2].value += 140.0f * sinf(seconds * 0.18f);
    const int faultChannel = ((uint64_t)(seconds / 150) % 2) ? 1 : 0;
    auto &c = s.channels[faultChannel];
    if (pulse > 0 && c.hasAlarm) {
      const float target = faultChannel == 0 ? c.alarmAbove + 12 : c.alarmBelow - 35;
      if (isfinite(target)) c.value += (target - c.value) * pulse;
    }
    for (auto &channel : s.channels)
      channel.value = fmaxf(channel.minValue, fminf(channel.maxValue, channel.value));
    float *dest[] = {s.coolantTrend, s.oilTrend, s.rpmTrend};
    for (int i = 0; i < 3; ++i) {
      if (count_ == 60) {
        memmove(trend_[i], trend_[i] + 1, 59 * sizeof(float));
        trend_[i][59] = s.channels[i].value;
      } else trend_[i][count_] = s.channels[i].value;
      memcpy(dest[i], trend_[i], (count_ < 60 ? count_ + 1 : 60) * sizeof(float));
    }
    if (count_ < 60) ++count_;
    s.trendCount = count_;

  }
 private:
  uint64_t lastAt_ = 0;
  uint8_t count_ = 0;
  float trend_[3][60] = {};
};

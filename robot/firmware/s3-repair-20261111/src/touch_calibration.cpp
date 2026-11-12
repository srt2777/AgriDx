#include "touch_calibration.h"

#include <Preferences.h>
#include <cmath>
#include <cstddef>
#include <cstring>
#include <initializer_list>

#if !defined(USE_OLED_DISPLAY) || !USE_OLED_DISPLAY
#include <lvgl.h>
LV_FONT_DECLARE(font_zh_16);
#endif

namespace {
constexpr uint32_t kMagic = 0x534A5443;  // SJTC
constexpr uint16_t kVersion = 1;
constexpr uint8_t kSamples = 16;
constexpr int16_t kTargets[4][2] = {{24, 24}, {296, 24}, {24, 216}, {160, 120}};
struct Calibration {
  uint32_t magic;
  uint16_t version;
  uint16_t reserved;
  float m[6];  // x = m0*rawX+m1*rawY+m2; y = m3*rawX+m4*rawY+m5
  uint32_t checksum;
};
Calibration current{};
bool calibrated = false;

uint32_t checksum(const Calibration &value) {
  const auto *bytes = reinterpret_cast<const uint8_t *>(&value);
  uint32_t sum = 2166136261u;
  for (size_t i = 0; i < offsetof(Calibration, checksum); ++i)
    sum = (sum ^ bytes[i]) * 16777619u;
  return sum;
}

bool valid(const Calibration &value) {
  if (value.magic != kMagic || value.version != kVersion || value.reserved != 0 ||
      value.checksum != checksum(value)) return false;
  for (float f : value.m) if (!std::isfinite(f) || std::fabs(f) > 100000.0f) return false;
  const double det = double(value.m[0]) * value.m[4] - double(value.m[1]) * value.m[3];
  return std::fabs(det) > 1e-8 && std::fabs(det) < 100.0;
}

// Store aligned numeric entries instead of an NVS blob. On this board the
// last word of some NVS write records duplicated the preceding word. Mirroring
// each word keeps both halves identical and the original checksum detects
// missing, mixed or corrupt records.
constexpr char kCalibrationNamespace[] = "sijia";
constexpr char kBankKey[] = "cal_bank";
constexpr size_t kWords = sizeof(Calibration) / sizeof(uint32_t);
static_assert(sizeof(Calibration) == 36, "Unexpected calibration record layout");

uint64_t mirror(uint32_t word) {
  return (uint64_t(word) << 32) | word;
}

bool loadBank(Preferences &prefs, uint8_t bank, Calibration &value) {
  uint32_t words[kWords];
  for (size_t i = 0; i < kWords; ++i) {
    char key[12];
    snprintf(key, sizeof(key), "cal%u_%u", unsigned(bank), unsigned(i));
    const uint64_t stored = prefs.getULong64(key, UINT64_MAX);
    const uint32_t word = uint32_t(stored);
    if (stored != mirror(word) || (stored == UINT64_MAX && !prefs.isKey(key))) return false;
    words[i] = word;
  }
  memcpy(&value, words, sizeof(value));
  return valid(value);
}

bool save(const Calibration &value) {
  Preferences prefs;
  if (!prefs.begin(kCalibrationNamespace, false)) return false;
  const uint64_t active = prefs.getULong64(kBankKey, UINT64_MAX);
  const uint8_t bank = active == mirror(0) ? 1 : 0;
  uint32_t words[kWords];
  memcpy(words, &value, sizeof(words));
  bool ok = true;
  for (size_t i = 0; ok && i < kWords; ++i) {
    char key[12];
    snprintf(key, sizeof(key), "cal%u_%u", unsigned(bank), unsigned(i));
    ok = prefs.putULong64(key, mirror(words[i])) == sizeof(uint64_t);
  }
  Calibration verified{};
  ok = ok && loadBank(prefs, bank, verified) &&
       memcmp(&value, &verified, sizeof(value)) == 0;
  if (ok) {
    ok = prefs.putULong64(kBankKey, mirror(bank)) == sizeof(uint64_t) &&
         prefs.getULong64(kBankKey, UINT64_MAX) == mirror(bank);
  }
  prefs.end();
  Serial.printf("[calibration] save=%s checksum=%08lx\n",
                ok ? "verified" : "failed", (unsigned long)value.checksum);
  return ok;
}

#if !defined(USE_OLED_DISPLAY) || !USE_OLED_DISPLAY
enum class Stage { Idle, Sampling, Retry, Success };
Stage stage = Stage::Idle;
lv_obj_t *overlay = nullptr, *crossH = nullptr, *crossV = nullptr;
lv_obj_t *instruction = nullptr, *progress = nullptr;
lv_timer_t *closeTimer = nullptr;
uint8_t point = 0, samples = 0;
int32_t sumX = 0, sumY = 0;
double rawPoints[4][2]{};
bool wasPressed = false, waitForRelease = true;

lv_obj_t *label(const char *text, int y, int height) {
  lv_obj_t *obj = lv_label_create(overlay);
  lv_obj_set_pos(obj, 36, y);
  lv_obj_set_size(obj, 248, height);
  lv_obj_set_style_text_font(obj, &font_zh_16, 0);
  lv_obj_set_style_text_color(obj, lv_color_hex(0x172B45), 0);
  lv_obj_set_style_text_align(obj, LV_TEXT_ALIGN_CENTER, 0);
  lv_label_set_long_mode(obj, LV_LABEL_LONG_WRAP);
  lv_label_set_text(obj, text);
  return obj;
}

void target() {
  samples = 0;
  sumX = sumY = 0;
  lv_obj_remove_flag(crossH, LV_OBJ_FLAG_HIDDEN);
  lv_obj_remove_flag(crossV, LV_OBJ_FLAG_HIDDEN);
  lv_obj_set_pos(crossH, kTargets[point][0] - 12, kTargets[point][1] - 1);
  lv_obj_set_pos(crossV, kTargets[point][0] - 1, kTargets[point][1] - 12);
  lv_label_set_text(instruction, "按住十字，采样后松开");
  lv_label_set_text_fmt(progress, "第 %u / 4 点", unsigned(point + 1));
}

void fail(const char *reason) {
  Serial.printf("[calibration] error=%s\n", reason);
  stage = Stage::Retry;
  wasPressed = false;
  lv_obj_add_flag(crossH, LV_OBJ_FLAG_HIDDEN);
  lv_obj_add_flag(crossV, LV_OBJ_FLAG_HIDDEN);
  lv_label_set_text(instruction, "校准失败，未保存\n点任意位置重试");
  lv_label_set_text(progress, "请对准十字中心按住");
}

bool solve(Calibration &value) {
  const double x0 = rawPoints[0][0], y0 = rawPoints[0][1];
  const double ux = rawPoints[1][0] - x0, uy = rawPoints[1][1] - y0;
  const double vx = rawPoints[2][0] - x0, vy = rawPoints[2][1] - y0;
  const double det = ux * vy - uy * vx;
  if (!std::isfinite(det) || std::fabs(det) < 10000.0) return false;
  value = {};
  value.magic = kMagic;
  value.version = kVersion;
  // These equations also handle reversed axes and X/Y interchange.
  value.m[0] = float(272.0 * vy / det);
  value.m[1] = float(-272.0 * vx / det);
  value.m[2] = float(24.0 - value.m[0] * x0 - value.m[1] * y0);
  value.m[3] = float(-192.0 * uy / det);
  value.m[4] = float(192.0 * ux / det);
  value.m[5] = float(24.0 - value.m[3] * x0 - value.m[4] * y0);
  value.checksum = checksum(value);
  return valid(value);
}

void finish() {
  Calibration candidate{};
  if (!solve(candidate)) { fail("degenerate-points"); return; }
  const double x = candidate.m[0] * rawPoints[3][0] + candidate.m[1] * rawPoints[3][1] + candidate.m[2];
  const double y = candidate.m[3] * rawPoints[3][0] + candidate.m[4] * rawPoints[3][1] + candidate.m[5];
  const double error = std::hypot(x - 160.0, y - 120.0);
  Serial.printf("[calibration] result center=%.2f,%.2f error=%.2fpx\n", x, y, error);
  if (!std::isfinite(error) || error > 15.0) { fail("center-error-over-15px"); return; }
  if (!save(candidate)) { fail("nvs-write"); return; }
  current = candidate;
  calibrated = true;
  stage = Stage::Success;
  lv_obj_add_flag(crossH, LV_OBJ_FLAG_HIDDEN);
  lv_obj_add_flag(crossV, LV_OBJ_FLAG_HIDDEN);
  lv_label_set_text(instruction, "校准成功，已保存");
  char resultText[48];
  snprintf(resultText, sizeof(resultText), "中心误差 %.1f px", error);
  lv_label_set_text(progress, resultText);
  Serial.println("[calibration] result=saved");
  closeTimer = lv_timer_create([](lv_timer_t *) {
    closeTimer = nullptr;
    stage = Stage::Idle;
    if (overlay) lv_obj_delete(overlay);
    overlay = crossH = crossV = instruction = progress = nullptr;
  }, 1400, nullptr);
  if (closeTimer) lv_timer_set_repeat_count(closeTimer, 1);
  else {
    stage = Stage::Idle;
    lv_obj_delete(overlay);
    overlay = crossH = crossV = instruction = progress = nullptr;
  }
}
#endif
}  // namespace

void touchCalibrationBegin() {
  calibrated = false;
  current = {};
  Preferences prefs;
  String encoded;
  if (prefs.begin(kCalibrationNamespace, true)) {
    const uint64_t active = prefs.getULong64(kBankKey, UINT64_MAX);
    if ((active == mirror(0) || active == mirror(1)) && loadBank(prefs, uint8_t(active), current)) {
      prefs.end();
      calibrated = true;
      Serial.printf("[calibration] result=loaded checksum=%08lx\n", (unsigned long)current.checksum);
      return;
    }
    const uint8_t bank = prefs.getUChar("touch-bank", 255);
    if (bank <= 1) {
      for (unsigned part = 0; part < 3; ++part) {
        char key[12]; snprintf(key, sizeof(key), "touch%u-%u", bank, part);
        encoded += prefs.getString(key, "");
      }
    }
    if (encoded.length() != sizeof(Calibration) * 2) encoded = prefs.getString("touch-v2", "");
    prefs.end();
  }
  Calibration loaded{};
  if (encoded.length() == sizeof(loaded) * 2) {
    uint8_t *raw = reinterpret_cast<uint8_t *>(&loaded);
    bool decoded = true;
    auto nibble = [](char c) -> int { return c >= '0' && c <= '9' ? c-'0' : c >= 'a' && c <= 'f' ? c-'a'+10 : -1; };
    for (size_t i = 0; i < sizeof(loaded); ++i) {
      const int hi = nibble(encoded[i*2]), lo = nibble(encoded[i*2+1]);
      if (hi < 0 || lo < 0) { decoded = false; break; }
      raw[i] = (hi << 4) | lo;
    }
    if (decoded && valid(loaded)) { current = loaded; calibrated = true; }
  }
  if (!calibrated && prefs.begin("sijia-touch", true)) {
    if (prefs.getBytesLength("affine") == sizeof(loaded) &&
        prefs.getBytes("affine", &loaded, sizeof(loaded)) == sizeof(loaded) && valid(loaded)) {
      current = loaded; calibrated = true;
    }
    prefs.end();
  }
  Serial.printf("[calibration] result=%s\n", calibrated ? "loaded" : "default-map");
}

void touchCalibrationStart() {
#if !defined(USE_OLED_DISPLAY) || !USE_OLED_DISPLAY
  if (closeTimer) { lv_timer_delete(closeTimer); closeTimer = nullptr; }
  if (overlay) lv_obj_delete(overlay);
  overlay = lv_obj_create(lv_layer_top());
  lv_obj_remove_style_all(overlay);
  lv_obj_set_pos(overlay, 0, 0);
  lv_obj_set_size(overlay, 320, 240);
  lv_obj_set_style_bg_color(overlay, lv_color_hex(0xF3F6FB), 0);
  lv_obj_set_style_bg_opa(overlay, LV_OPA_COVER, 0);
  lv_obj_remove_flag(overlay, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_add_flag(overlay, LV_OBJ_FLAG_CLICKABLE);
  label("触摸校准", 42, 24);
  instruction = label("", 72, 44);
  progress = label("", 158, 44);
  crossH = lv_obj_create(overlay);
  crossV = lv_obj_create(overlay);
  for (lv_obj_t *bar : {crossH, crossV}) {
    lv_obj_remove_style_all(bar);
    lv_obj_set_style_bg_color(bar, lv_color_hex(0x2863D6), 0);
    lv_obj_set_style_bg_opa(bar, LV_OPA_COVER, 0);
    lv_obj_remove_flag(bar, static_cast<lv_obj_flag_t>(LV_OBJ_FLAG_CLICKABLE | LV_OBJ_FLAG_SCROLLABLE));
  }
  lv_obj_set_size(crossH, 25, 3);
  lv_obj_set_size(crossV, 3, 25);
  point = 0;
  wasPressed = false;
  waitForRelease = true;  // Ignore the press that opened calibration.
  stage = Stage::Sampling;
  target();
  Serial.println("[calibration] result=started");
#endif
}

void touchCalibrationFeed(bool pressed, int16_t rawX, int16_t rawY) {
#if !defined(USE_OLED_DISPLAY) || !USE_OLED_DISPLAY
  if (stage == Stage::Idle || stage == Stage::Success) return;
  if (waitForRelease) {
    if (!pressed) waitForRelease = false;
    return;
  }
  if (stage == Stage::Retry) {
    if (pressed) wasPressed = true;
    else if (wasPressed) {
      wasPressed = false;
      point = 0;
      stage = Stage::Sampling;
      target();
    }
    return;
  }
  if (pressed) {
    wasPressed = true;
    if (samples < kSamples && rawX >= 0 && rawX <= 4095 && rawY >= 0 && rawY <= 4095) {
      sumX += rawX;
      sumY += rawY;
      ++samples;
      if (samples == kSamples) lv_label_set_text(progress, "采样完成，请松开");
    }
    return;
  }
  if (!wasPressed) return;
  wasPressed = false;
  if (samples < kSamples) {
    target();
    lv_label_set_text(progress, "按住时间太短，请重试");
    return;
  }
  rawPoints[point][0] = double(sumX) / kSamples;
  rawPoints[point][1] = double(sumY) / kSamples;
  Serial.printf("[calibration] point=%u target=%d,%d raw=%.2f,%.2f\n", unsigned(point + 1),
                kTargets[point][0], kTargets[point][1], rawPoints[point][0], rawPoints[point][1]);
  if (++point == 4) finish();
  else target();
#else
  (void)pressed; (void)rawX; (void)rawY;
#endif
}

bool touchCalibrationActive() {
#if !defined(USE_OLED_DISPLAY) || !USE_OLED_DISPLAY
  return stage != Stage::Idle;
#else
  return false;
#endif
}

void touchCalibrationMap(int16_t rawX, int16_t rawY, int32_t &x, int32_t &y) {
  double px, py;
  if (calibrated) {
    px = current.m[0] * double(rawX) + current.m[1] * double(rawY) + current.m[2];
    py = current.m[3] * double(rawX) + current.m[4] * double(rawY) + current.m[5];
  } else {
    px = (double(rawX) - 200.0) * 319.0 / 3600.0;
    py = (double(rawY) - 200.0) * 239.0 / 3600.0;
  }
  x = int32_t(std::lround(px));
  y = int32_t(std::lround(py));
  if (x < 0) x = 0;
  if (x > 319) x = 319;
  if (y < 0) y = 0;
  if (y > 239) y = 239;
}

bool touchCalibrationRestore(const float matrix[6]) {
  Calibration restored{};
  restored.magic = kMagic; restored.version = kVersion;
  memcpy(restored.m, matrix, sizeof(restored.m));
  restored.checksum = checksum(restored);
  if (!valid(restored)) { Serial.println("[calibration] restore coefficients invalid"); return false; }
  if (!save(restored)) { Serial.println("[calibration] restore NVS save failed"); return false; }
  current = restored; calibrated = true;
  return true;
}

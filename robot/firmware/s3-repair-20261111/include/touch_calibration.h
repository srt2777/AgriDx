#pragma once

#include <Arduino.h>

// All calls run on the LVGL/main thread. Raw coordinates must come from the
// same XPT2046 rotation used during calibration; do not pre-map or swap axes.
void touchCalibrationBegin();
void touchCalibrationStart();
void touchCalibrationFeed(bool pressed, int16_t rawX, int16_t rawY);
bool touchCalibrationActive();
void touchCalibrationMap(int16_t rawX, int16_t rawY, int32_t &x, int32_t &y);

// Restore this device's previously measured coefficients over the USB console.
bool touchCalibrationRestore(const float matrix[6]);

#include "telemetry_stream.h"

#include <Arduino.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <esp_heap_caps.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include <freertos/task.h>
#include <new>
#include <stdlib.h>
#include "telemetry_protocol.h"
#include "telemetry_demo.h"

namespace {
constexpr uint32_t kNetworkTimeoutMs = 12000;
constexpr uint32_t kConnectionLifetimeMs = 30UL * 60UL * 1000UL;
SemaphoreHandle_t snapshotMutex = nullptr;
TaskHandle_t taskHandle = nullptr;
TelemetrySnapshot latest = {};
char endpoint[192] = {};

class PsramAllocator final : public ArduinoJson::Allocator {
 public:
  void *allocate(size_t size) override {
    void *p = heap_caps_malloc(size, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    return p ? p : malloc(size);
  }
  void deallocate(void *p) override { free(p); }
  void *reallocate(void *p, size_t size) override {
    if (!p) return allocate(size);
    return heap_caps_realloc(p, size, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  }
};

void publish(const TelemetrySnapshot &snapshot) {
  static TelemetryDemo demo;
  TelemetrySnapshot enhanced = snapshot;
  demo.apply(enhanced);
  xSemaphoreTake(snapshotMutex, portMAX_DELAY);
  latest = enhanced;
  xSemaphoreGive(snapshotMutex);
}

void markDisconnected() {
  xSemaphoreTake(snapshotMutex, portMAX_DELAY);
  latest.connected = false;
  latest.stale = true;
  xSemaphoreGive(snapshotMutex);
}

// HTTPClient exposes its raw TCP body, including chunk framing. Decode that
// framing before feeding SSE so a chunk boundary in the middle of JSON is safe.
class HttpBodyDecoder {
 public:
  HttpBodyDecoder(bool chunked, TelemetryProtocol &protocol) : chunked_(chunked), protocol_(protocol) {}
  bool feed(char ch, uint32_t now) {
    if (!chunked_) return protocol_.feed(ch, now);
    if (remaining_) {
      if (!protocol_.feed(ch, now)) return false;
      if (--remaining_ == 0) trailer_ = 2;
      return true;
    }
    if (trailer_) {
      if (ch != (trailer_ == 2 ? '\r' : '\n')) return false;
      --trailer_;
      return true;
    }
    if (ch == '\r') return true;
    if (ch == '\n') {
      chunkLine_[chunkLength_] = '\0';
      char *end = nullptr;
      unsigned long count = strtoul(chunkLine_, &end, 16);
      if (!chunkLength_ || end == chunkLine_ || (*end && *end != ';') || count > 65536 || !count) return false;
      remaining_ = count;
      chunkLength_ = 0;
      return true;
    }
    if (chunkLength_ == sizeof(chunkLine_) - 1) return false;
    chunkLine_[chunkLength_++] = ch;
    return true;
  }
 private:
  bool chunked_;
  TelemetryProtocol &protocol_;
  char chunkLine_[48] = {};
  uint8_t chunkLength_ = 0, trailer_ = 0;
  uint32_t remaining_ = 0;
};

void streamTask(void *) {
  PsramAllocator allocator;
  void *storage = allocator.allocate(sizeof(TelemetryProtocol));
  if (!storage) {
    Serial.println("[telemetry] ERROR: parser allocation failed");
    taskHandle = nullptr;
    vTaskDelete(nullptr);
    return;
  }
  auto *protocol = new (storage) TelemetryProtocol(&allocator);
  uint32_t backoffMs = 1000;
  for (;;) {
    if (WiFi.status() != WL_CONNECTED) {
      markDisconnected();
      vTaskDelay(pdMS_TO_TICKS(1000));
      continue;
    }
    protocol->resetConnection();
    WiFiClientSecure client;
    client.setInsecure();  // Same trust model as the existing terminal HTTP code.
    client.setHandshakeTimeout(10);
    HTTPClient http;
    http.setConnectTimeout(10000);
    http.setTimeout(kNetworkTimeoutMs);
    http.setReuse(false);
    const char *headers[] = {"Transfer-Encoding", "Content-Type"};
    http.collectHeaders(headers, 2);
    bool began = http.begin(client, endpoint);
    if (began) {
      http.addHeader("Accept", "text/event-stream");
      int code = http.GET();
      if (code == 200 && http.header("Content-Type").startsWith("text/event-stream")) {
        const bool chunked = http.header("Transfer-Encoding").indexOf("chunked") >= 0;
        HttpBodyDecoder decoder(chunked, *protocol);
        NetworkClient *input = http.getStreamPtr();
        const uint32_t opened = millis();
        uint32_t lastByte = opened;
        uint32_t publishedSequence = protocol->snapshot().sequence;
        bool announcedSample = false;
        bool valid = true;
        Serial.println("[telemetry] SSE connected; receiving simulated data");
        while (input && valid && WiFi.status() == WL_CONNECTED &&
               (input->connected() || input->available()) &&
               millis() - lastByte < kNetworkTimeoutMs &&
               millis() - opened < kConnectionLifetimeMs) {
          uint8_t buffer[512];
          int available = input->available();
          if (available > 0) {
            int count = input->read(buffer, min(available, (int)sizeof(buffer)));
            if (count > 0) lastByte = millis();
            for (int i = 0; i < count && valid; ++i) valid = decoder.feed((char)buffer[i], millis());
            const auto &snapshot = protocol->snapshot();
            if (snapshot.sequence != publishedSequence) {
              publish(snapshot);
              publishedSequence = snapshot.sequence;
              backoffMs = 1000;
              if (!announcedSample) {
                Serial.printf("[telemetry] simulated sample: coolant=%.1fC oil=%.1fkPa rpm=%.0f\n",
                              snapshot.channels[0].value, snapshot.channels[1].value,
                              snapshot.channels[2].value);
                announcedSample = true;
              }
            }
          }
          vTaskDelay(pdMS_TO_TICKS(2));
        }
      } else {
        Serial.printf("[telemetry] stream HTTP status=%d; retrying\n", code);
      }
      http.end();
    }
    markDisconnected();
    vTaskDelay(pdMS_TO_TICKS(backoffMs));
    backoffMs = min(backoffMs * 2, uint32_t(30000));
  }
}
}  // namespace

bool telemetryStreamBegin(const char *baseUrl) {
  if (taskHandle) return true;
  if (!baseUrl || !*baseUrl || strlen(baseUrl) + strlen("/api/telemetry/stream") >= sizeof(endpoint)) return false;
  if (!snapshotMutex) snapshotMutex = xSemaphoreCreateMutex();
  if (!snapshotMutex) return false;
  snprintf(endpoint, sizeof(endpoint), "%s/api/telemetry/stream", baseUrl);
  latest.stale = true;
#if CONFIG_IDF_TARGET_ESP32C3
  return xTaskCreate(streamTask, "sijia-telemetry", 8192, nullptr, 1, &taskHandle) == pdPASS;
#else
  return xTaskCreatePinnedToCore(streamTask, "sijia-telemetry", 8192, nullptr, 1, &taskHandle, 0) == pdPASS;
#endif
}

bool telemetryStreamRead(TelemetrySnapshot &out) {
  if (!snapshotMutex) return false;
  xSemaphoreTake(snapshotMutex, portMAX_DELAY);
  out = latest;
  xSemaphoreGive(snapshotMutex);
  out.stale = !out.connected || out.sequence == 0 ||
              millis() - out.receivedAtMs > TelemetryProtocol::kStaleAfterMs;
  return out.sequence != 0;
}

#include "telemetry_protocol.h"
#include <cassert>
#include <fstream>
#include <iostream>
#include <iterator>
#include <memory>
#include <string>

static void feed(TelemetryProtocol &p, const std::string &data, uint32_t now) {
  // Every byte is delivered individually: TCP packet/event boundaries need not align.
  for (char c : data) assert(p.feed(c, now));
}
int main(int argc, char **argv) {
  assert(argc == 2);
  std::ifstream file(argv[1]);
  assert(file.good());
  std::string real((std::istreambuf_iterator<char>(file)), {});
  auto p = std::make_unique<TelemetryProtocol>();
  feed(*p, real, 1000);
  const auto &s = p->snapshot();
  assert(s.sequence >= 2 && s.trendCount >= 2);
  assert(s.simulated && s.connected && !s.stale);
  assert(s.channels[0].alarmAbove == 85 && s.channels[0].attentionAbove == 65);
  assert(s.channels[1].alarmBelow == 40 && s.channels[1].attentionBelow == 80);
  assert(!s.channels[2].hasAlarm && !s.channels[2].hasAttention);
  assert(!strcmp(s.channels[0].unit, "°C"));
  assert(!strcmp(s.channels[1].unit, "kPa"));
  assert(!strcmp(s.channels[2].unit, "rpm"));
  const auto before = s.sequence;
  const auto receivedBefore = s.receivedAtMs;
  feed(*p, "event: telemetry\ndata: {\"schemaVersion\":1,\"source\":\"simulated\",\"at\":9999999999999,\"points\":[{\"channelId\":\"diesel.engine.coolant\",\"source\":\"simulated\",\"value\":null}]}\n\n", 2000);
  assert(p->snapshot().sequence == before);
  assert(p->snapshot().receivedAtMs == receivedBefore);
  assert(p->rejectedEvents() == 1);
  auto duplicate = std::make_unique<TelemetryProtocol>();
  feed(*duplicate, real, 1000);
  auto sequence = duplicate->snapshot().sequence;
  feed(*duplicate, real, 2000);
  assert(duplicate->snapshot().sequence == sequence);
  auto overflow = std::make_unique<TelemetryProtocol>();
  for (size_t i=0; i < TelemetryProtocol::kMaxLine; ++i) assert(overflow->feed('x', 0));
  assert(!overflow->feed('x', 0));
  p->resetConnection();
  assert(!p->snapshot().connected);
  assert(p->snapshot().channels[0].value == s.channels[0].value);
  std::cout << "PASS real SSE bytewise replay: samples=" << before
            << "; all 3 channel units/thresholds; incomplete/null sample rejection; duplicate rejection; 16KB line bound; disconnect retains data\n";
}

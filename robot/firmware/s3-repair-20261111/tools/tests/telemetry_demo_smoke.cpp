#include "telemetry_demo.h"
#include <cassert>
#include <cstdio>
int main() {
  TelemetryDemo demo;
  bool hot=false, oil=false, recovered=false;
  for (unsigned sec=1; sec<=300; ++sec) {
    TelemetrySnapshot s={};
    s.simulated=s.connected=true; s.sampleAt=sec*1000;
    for (auto &c:s.channels) { c.minValue=0; c.maxValue=4000; }
    s.channels[0].value=60; s.channels[0].alarmAbove=85; s.channels[0].hasAlarm=true;
    s.channels[1].value=200; s.channels[1].alarmBelow=40; s.channels[1].hasAlarm=true;
    s.channels[2].value=1800;
    demo.apply(s);
    hot |= s.channels[0].value>85; oil |= s.channels[1].value<40;
    if(sec==120) recovered = s.channels[0].value<65;
    assert(s.trendCount<=60 && s.coolantTrend[s.trendCount-1]==s.channels[0].value);
    assert(s.oilTrend[s.trendCount-1]==s.channels[1].value);
    assert(s.rpmTrend[s.trendCount-1]==s.channels[2].value);
    assert(s.sampleAt==sec*1000);
  }
  assert(hot && oil && recovered);
  TelemetrySnapshot real={}; real.connected=true; real.channels[0].value=62;
  demo.apply(real); assert(real.channels[0].value==62 && real.trendCount==0);
  real.simulated=true; real.stale=true; demo.apply(real); assert(real.channels[0].value==62);
  puts("PASS gradual hot/low-oil faults, recovery, trend consistency, real/stale samples unchanged");
}

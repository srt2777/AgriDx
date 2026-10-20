import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  HALL_EXAMPLE_DEVICES,
  HALL_EXAMPLE_TOTAL,
  HALL_STATUS_EXAMPLE,
  HALL_ZONES,
  hallStatusCount,
} from '../src/pages/HallPage/hall-example-data';

test('展厅示例环的四段状态合计为 12，并与设备表逐项一致', () => {
  assert.equal(HALL_EXAMPLE_TOTAL, 12);
  assert.equal(HALL_STATUS_EXAMPLE.reduce((sum, item) => sum + item.count, 0), 12);
  assert.equal(HALL_EXAMPLE_DEVICES.length, 12);
  for (const item of HALL_STATUS_EXAMPLE) {
    assert.equal(hallStatusCount(item.id), item.count);
  }
  const zones = new Set(HALL_ZONES.map((zone) => zone.id));
  for (const device of HALL_EXAMPLE_DEVICES) {
    assert.equal(zones.has(device.zone), true);
    assert.match(device.specZh, /示例/);
    assert.match(device.specEn, /Example/);
  }
  for (const zone of HALL_ZONES) {
    assert.equal(HALL_EXAMPLE_DEVICES.filter((device) => device.zone === zone.id).length, 3);
  }
});

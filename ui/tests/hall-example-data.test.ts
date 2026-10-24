import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  HALL_EXAMPLE_DEVICES,
  HALL_EXAMPLE_TOTAL,
  HALL_STATUS_EXAMPLE,
  HALL_ZONES,
  adjacentHallZone,
  devicesInZone,
  exampleDataLabel,
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
    assert.equal(devicesInZone(zone.id).length, 3);
    assert.deepEqual(devicesInZone(zone.id).map((device) => device.id), HALL_EXAMPLE_DEVICES.filter((device) => device.zone === zone.id).map((device) => device.id));
  }
});

test('展区方向键在 A 与 D 之间折返，示例标签跟着语言走', () => {
  assert.equal(adjacentHallZone('A', -1), 'D');
  assert.equal(adjacentHallZone('D', 1), 'A');
  assert.equal(adjacentHallZone('B', 1), 'C');
  assert.equal(adjacentHallZone('C', -1), 'B');
  assert.equal(exampleDataLabel('zh'), '示例数据');
  assert.equal(exampleDataLabel('en'), 'Example data');
  for (const zone of HALL_ZONES) {
    for (const device of devicesInZone(zone.id)) {
      assert.match(device.specZh, /^示例/);
      assert.match(device.specEn, /^Example/);
    }
  }
});
